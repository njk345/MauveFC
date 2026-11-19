set local lock_timeout='5s';
set local statement_timeout='30s';
-- Stop rather than replace an unexpected live validation/projection edit.
do $$begin
  if (select md5(prosrc) from pg_proc where oid='public.validate_result_payload(uuid,jsonb,boolean)'::regprocedure)<>'93c0ab0ef80a9b08a0bb4cf62196c0ac'
    or (select md5(prosrc) from pg_proc where oid='public.save_match_lineup(uuid,integer,jsonb,boolean)'::regprocedure)<>'3ee0cf99bcfdafe77673b9352810c7d2'
    or (select md5(prosrc) from pg_proc where oid='private.validate_suggested_lineup(uuid,jsonb)'::regprocedure)<>'cc0ce208f590e486cbcabb905bf83606'
    or (select md5(prosrc) from pg_proc where oid='public.get_team_club(uuid)'::regprocedure)<>'0d66a4260e98edb2362a46727fe0fd7c'
    or (select md5(prosrc) from pg_proc where oid='public.get_captain_club(uuid)'::regprocedure)<>'06a566cfa6a5f8003343dec3abb1af5a'
    or (select md5(prosrc) from pg_proc where oid='private.season_stats(uuid,uuid)'::regprocedure)<>'93c2d7ebda60d65042e8bb9394ed4c8e'
  then raise exception 'A player validation or projection changed; review before applying guest support';end if;
end;$$;
-- Players are club-wide identities; season_roster remains official membership.
-- A guest assignment grants eligibility for exactly one fixture, never an account
-- or an appearance. Existing player IDs and historical stats are retained.
create table private.match_guests (
  club_id uuid not null, match_id uuid not null, player_id uuid not null,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key(match_id,player_id),
  foreign key(match_id,club_id) references public.matches(id,club_id),
  foreign key(player_id,club_id) references public.players(id,club_id)
);
create index match_guests_player_idx on private.match_guests(club_id,player_id);
alter table private.match_guests enable row level security;
revoke all on private.match_guests from public,anon,authenticated;

create function private.match_player_eligible(p_match_id uuid,p_player_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.matches m where m.id=p_match_id and (
    exists(select 1 from public.season_roster sr where sr.club_id=m.club_id and sr.season_id=m.season_id and sr.player_id=p_player_id)
    or exists(select 1 from private.match_guests g where g.club_id=m.club_id and g.match_id=m.id and g.player_id=p_player_id)
  ));
$$;
revoke all on function private.match_player_eligible(uuid,uuid) from public,anon,authenticated;

create function private.player_directory(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,
    'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public,
    'rosterSeasonIds',coalesce((select jsonb_agg(sr.season_id) from public.season_roster sr where sr.club_id=p_club_id and sr.player_id=p.id),'[]'::jsonb),
    'guestGames',(select count(*) from private.match_guests g where g.club_id=p_club_id and g.player_id=p.id),
    'appearances',(select count(*) from public.match_player_stats ps join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id where ps.club_id=p_club_id and ps.player_id=p.id and ps.appeared and m.status='completed' and r.published)
  ) order by lower(p.name),p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb);
end;$$;
revoke all on function private.player_directory(uuid) from public,anon,authenticated;
grant execute on function private.player_directory(uuid) to authenticated;
create function public.get_player_directory(p_club_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.player_directory(p_club_id);$$;
revoke all on function public.get_player_directory(uuid) from public,anon,authenticated;
grant execute on function public.get_player_directory(uuid) to authenticated;

create function private.add_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid default null,p_player jsonb default null,p_allow_same_name boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches; person public.players; display_name text; new_revision integer; added integer;
begin
  if auth.uid() is null then raise exception 'Captain access required' using errcode='42501';end if;
  select * into strict m from public.matches where id=p_match_id for update;
  if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
  if m.revision is distinct from p_expected_revision then raise exception 'Match changed; reload before adding a guest' using errcode='40001';end if;
  if m.status='cancelled' then raise exception 'Cannot add a guest to a cancelled fixture';end if;
  if (p_player_id is null)=(p_player is null) then raise exception 'Choose an existing player or create a new player';end if;
  if p_player_id is not null then
    select * into person from public.players where id=p_player_id and club_id=m.club_id;
    if not found then raise exception 'Player not found in this club';end if;
  else
    if jsonb_typeof(p_player) is distinct from 'object' or jsonb_typeof(p_player->'name') is distinct from 'string' then raise exception 'Enter a player name';end if;
    display_name:=regexp_replace(btrim(p_player->>'name'),'\s+',' ','g');
    if length(display_name) not between 1 and 100 or coalesce(p_player->>'number','')!~'^(0|[1-9][0-9]?)$'
      or coalesce(p_player->>'position','') not in ('Forward','Midfielder','Defender','Goalkeeper') then raise exception 'Enter a name, position and jersey number from 0 to 99';end if;
    -- Serialize identical-name creates across fixtures, without treating names
    -- as unique identities. Explicitly distinct same-name people are allowed.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(m.club_id::text||lower(display_name),0));
    if not coalesce(p_allow_same_name,false) and exists(select 1 from public.players p where p.club_id=m.club_id and lower(regexp_replace(btrim(p.name),'\s+',' ','g'))=lower(display_name)) then
      raise exception 'A player with this name already exists. Select them from the directory, or confirm this is a different person.' using errcode='23505';
    end if;
    insert into public.players(club_id,name,number,position,initials,is_public)
    values(m.club_id,display_name,(p_player->>'number')::integer,p_player->>'position',upper(left(display_name,1)||case when position(' ' in display_name)>0 then left(regexp_replace(display_name,'^.* ',''),1) else '' end),false)
    returning * into person;
  end if;
  if exists(select 1 from public.season_roster where club_id=m.club_id and season_id=m.season_id and player_id=person.id) then raise exception 'This player is already on the season roster';end if;
  if (select count(*) from private.match_guests where match_id=m.id)>=100 and not exists(select 1 from private.match_guests where match_id=m.id and player_id=person.id) then raise exception 'This game has reached its guest limit';end if;
  insert into private.match_guests(club_id,match_id,player_id,added_by) values(m.club_id,m.id,person.id,auth.uid()) on conflict do nothing;
  get diagnostics added=row_count;
  new_revision:=m.revision;
  if added>0 then
    update public.matches set revision=revision+1 where id=m.id returning revision into new_revision;
    update public.match_drafts set base_revision=new_revision,payload=jsonb_set(payload,'{baseRevision}',to_jsonb(new_revision)),updated_at=now()
    where match_id=m.id and editor_id=auth.uid() and base_revision=m.revision;
  end if;
  return jsonb_build_object('matchId',m.id,'revision',new_revision,'action','add','player',jsonb_build_object('id',person.id,'name',person.name,'number',person.number,'position',person.position,'initials',person.initials,'hometown',person.hometown,'bio',person.bio,'isPublic',person.is_public));
end;$$;
revoke all on function private.add_match_guest(uuid,integer,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.add_match_guest(uuid,integer,uuid,jsonb,boolean) to authenticated;
create function public.add_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid default null,p_player jsonb default null,p_allow_same_name boolean default false)
returns jsonb language sql security invoker set search_path='' as $$select private.add_match_guest(p_match_id,p_expected_revision,p_player_id,p_player,p_allow_same_name);$$;
revoke all on function public.add_match_guest(uuid,integer,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.add_match_guest(uuid,integer,uuid,jsonb,boolean) to authenticated;

create function private.lineup_has_player(p_payload jsonb,p_player_id uuid) returns boolean language sql immutable set search_path='' as $$
  select (coalesce(p_payload->'starters','[]'::jsonb)||coalesce(p_payload->'bench','[]'::jsonb)) @> jsonb_build_array(p_player_id::text);
$$;
revoke all on function private.lineup_has_player(jsonb,uuid) from public,anon,authenticated;
create function private.remove_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches;person public.players;new_revision integer;removed integer;before_value jsonb;after_value jsonb;
begin
  if auth.uid() is null then raise exception 'Captain access required' using errcode='42501';end if;
  select * into strict m from public.matches where id=p_match_id for update;
  if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
  if m.revision is distinct from p_expected_revision then raise exception 'Match changed; reload before removing a guest' using errcode='40001';end if;
  select * into strict person from public.players where id=p_player_id and club_id=m.club_id;
  if exists(select 1 from public.match_player_stats where match_id=m.id and player_id=person.id and (appeared or goals>0 or coalesce(assists,0)>0))
    or exists(select 1 from public.match_drafts d,jsonb_array_elements(d.payload->'stats') s where d.match_id=m.id and s->>'playerId'=person.id::text and ((s->>'appeared')::boolean or (s->>'goals')::integer>0 or coalesce((s->>'assists')::integer,0)>0))
    or exists(select 1 from private.match_lineups l where l.match_id=m.id and (private.lineup_has_player(l.draft_payload,person.id) or private.lineup_has_player(l.published_payload,person.id)))
    or exists(select 1 from private.lineup_posts p where p.match_id=m.id and private.lineup_has_player(p.payload,person.id)) then
    raise exception 'This guest is used in recorded stats or a saved lineup. Keep them in this game history, or clear current entries before removing them.';
  end if;
  delete from private.match_guests where match_id=m.id and player_id=person.id;
  get diagnostics removed=row_count;
  new_revision:=m.revision;
  if removed>0 then
    select value->'result' into before_value from jsonb_array_elements(public.club_snapshot(m.club_id,true)->'matches') where value->>'id'=m.id::text;
    delete from public.match_player_stats where match_id=m.id and player_id=person.id;
    if found and before_value is not null then
      select value->'result' into after_value from jsonb_array_elements(public.club_snapshot(m.club_id,true)->'matches') where value->>'id'=m.id::text;
      insert into public.result_history(club_id,match_id,editor_id,before_value,after_value) values(m.club_id,m.id,auth.uid(),before_value,after_value);
    end if;
    update public.matches set revision=revision+1 where id=m.id returning revision into new_revision;
    update public.match_drafts d set base_revision=new_revision,payload=jsonb_set(jsonb_set(d.payload,'{baseRevision}',to_jsonb(new_revision)),'{stats}',coalesce((select jsonb_agg(s) from jsonb_array_elements(d.payload->'stats') s where s->>'playerId'<>person.id::text),'[]'::jsonb)),updated_at=now()
    where match_id=m.id and editor_id=auth.uid() and base_revision=m.revision;
  end if;
  return jsonb_build_object('matchId',m.id,'revision',new_revision,'action','remove','player',jsonb_build_object('id',person.id,'name',person.name,'number',person.number,'position',person.position,'initials',person.initials,'hometown',person.hometown,'bio',person.bio,'isPublic',person.is_public));
end;$$;
revoke all on function private.remove_match_guest(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function private.remove_match_guest(uuid,integer,uuid) to authenticated;
create function public.remove_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.remove_match_guest(p_match_id,p_expected_revision,p_player_id);$$;
revoke all on function public.remove_match_guest(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.remove_match_guest(uuid,integer,uuid) to authenticated;

create function private.with_match_guests(p_data jsonb,p_club_id uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_set(p_data,'{matches}',coalesce((select jsonb_agg(m.value||jsonb_build_object('guestPlayerIds',coalesce((select jsonb_agg(g.player_id order by g.added_at,g.player_id) from private.match_guests g where g.club_id=p_club_id and g.match_id=(m.value->>'id')::uuid),'[]'::jsonb)) order by m.ordinality) from jsonb_array_elements(p_data->'matches') with ordinality m),'[]'::jsonb));
$$;
revoke all on function private.with_match_guests(jsonb,uuid) from public,anon,authenticated;
create or replace function public.get_captain_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.with_match_guests(private.league_club_snapshot(p_club_id,true),p_club_id);$$;

create or replace function public.validate_result_payload(p_match_id uuid,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches; s jsonb; field text; total integer:=0;begin
 select * into strict m from public.matches where id=p_match_id;
 if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'stats') is distinct from 'array' or jsonb_array_length(p_payload->'stats')>200 then raise exception 'Invalid result payload';end if;
 foreach field in array array['home','away','onFieldHome','onFieldAway','ownGoals'] loop
  if jsonb_typeof(p_payload->field) is distinct from 'number' or (p_payload->>field)!~'^(0|[1-9][0-9]?)$' then raise exception 'Scores must be whole numbers from 0 to 99';end if;
 end loop;
 if coalesce(p_payload->>'basis','') not in ('played','forfeit','adjusted') or coalesce(p_payload->>'attendance','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'scorers','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'assists','') not in ('unrecorded','partial','complete') or jsonb_typeof(p_payload->'published') is distinct from 'boolean' or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(p_payload->>'reason')>500 then raise exception 'Invalid result fields';end if;
 if (select count(*)<>count(distinct value->>'playerId') from jsonb_array_elements(p_payload->'stats')) then raise exception 'Duplicate player';end if;
 for s in select value from jsonb_array_elements(p_payload->'stats') loop
  if not private.match_player_eligible(m.id,(s->>'playerId')::uuid) then raise exception 'Player is not eligible for this season';end if;
  if jsonb_typeof(s->'appeared') is distinct from 'boolean' or jsonb_typeof(s->'goals') is distinct from 'number' or (s->>'goals')!~'^(0|[1-9][0-9]?)$' or (jsonb_typeof(s->'assists') is distinct from 'null' and (jsonb_typeof(s->'assists') is distinct from 'number' or coalesce(s->>'assists','')!~'^(0|[1-9][0-9]?)$')) then raise exception 'Invalid player totals';end if;
  total:=total+(s->>'goals')::integer;
  if p_publish then
   if not (s->>'appeared')::boolean and ((s->>'goals')::integer>0 or coalesce((s->>'assists')::integer,0)>0) then raise exception 'Player must have appeared';end if;
   if (s->>'appeared')::boolean and p_payload->>'attendance'='unrecorded' then raise exception 'Attendance must be marked partial or complete';end if;
   if p_payload->>'assists'='unrecorded' and s->'assists'<>'null'::jsonb then raise exception 'Unrecorded assists must be unknown';end if;
   if p_payload->>'assists'='complete' and (s->>'appeared')::boolean and s->'assists'='null'::jsonb then raise exception 'Complete assist capture requires known totals';end if;
  end if;
 end loop;
 if p_publish then
  if m.status='cancelled' then raise exception 'Cancelled fixtures cannot be published';end if;
  if p_payload->>'basis'<>'played' and btrim(p_payload->>'reason')='' then raise exception 'An adjustment reason is required';end if;
  if p_payload->>'basis'='played' and ((p_payload->>'home')::integer<>(p_payload->>'onFieldHome')::integer or (p_payload->>'away')::integer<>(p_payload->>'onFieldAway')::integer) then raise exception 'Official and on-field scores must match for played results';end if;
  total:=total+(p_payload->>'ownGoals')::integer;
  if total>(p_payload->>'onFieldHome')::integer then raise exception 'Attributed goals exceed on-field score';end if;
  if p_payload->>'scorers'='complete' and total<>(p_payload->>'onFieldHome')::integer then raise exception 'Complete scoring must reconcile';end if;
  if p_payload->>'scorers'='unrecorded' and total>0 then raise exception 'Scorers must be marked partial or complete';end if;
 end if;
end;$$;

create or replace function public.save_match_lineup(p_match_id uuid,p_expected_revision integer,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;l private.match_lineups;player text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select * into l from private.match_lineups where match_id=m.id for update;
 if coalesce(l.revision,0) is distinct from p_expected_revision then raise exception 'The lineup changed. Reload before saving.' using errcode='40001';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'formation','') not in ('2-3-1','3-2-1','2-2-2') or jsonb_typeof(p_payload->'starters') is distinct from 'array' or jsonb_array_length(p_payload->'starters')<>7 or jsonb_typeof(p_payload->'bench') is distinct from 'array' or jsonb_array_length(p_payload->'bench')>100 or p_publish is null then raise exception 'Invalid lineup';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'starters') s where jsonb_typeof(s) not in ('string','null')) or exists(select 1 from jsonb_array_elements(p_payload->'bench') s where jsonb_typeof(s)<>'string') then raise exception 'Invalid lineup player';end if;
 if p_publish and exists(select 1 from jsonb_array_elements(p_payload->'starters') s where s='null'::jsonb) then raise exception 'Choose all seven starters before sharing';end if;
 if (select count(*)<>count(distinct value) from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null) then raise exception 'A player cannot appear twice';end if;
 for player in select value from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null loop
  if not private.match_player_eligible(m.id,player::uuid) then raise exception 'Player is not eligible for this fixture';end if;
 end loop;
 perform private.validate_lineup_sheet(p_payload);
 insert into private.match_lineups(club_id,match_id,published_payload,draft_payload,revision,published_at)
 values(m.club_id,m.id,case when p_publish then p_payload end,case when not p_publish then p_payload end,1,case when p_publish then now() end)
 on conflict(match_id) do update set published_payload=case when p_publish then p_payload else match_lineups.published_payload end,draft_payload=case when p_publish then null else p_payload end,revision=match_lineups.revision+1,published_at=case when p_publish then now() else match_lineups.published_at end,updated_at=now();
end;$$;

create or replace function private.validate_suggested_lineup(p_match_id uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare m public.matches;player text;begin
 select * into strict m from public.matches where id=p_match_id;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'formation','') not in ('2-3-1','3-2-1','2-2-2') or jsonb_typeof(p_payload->'starters') is distinct from 'array' or jsonb_typeof(p_payload->'bench') is distinct from 'array' then raise exception 'Invalid lineup';end if;
 if jsonb_array_length(p_payload->'starters')<>7 or jsonb_array_length(p_payload->'bench')>100 then raise exception 'Choose all seven starters before posting';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'starters') s where jsonb_typeof(s)<>'string') or exists(select 1 from jsonb_array_elements(p_payload->'bench') s where jsonb_typeof(s)<>'string') then raise exception 'Choose all seven starters before posting';end if;
 if (select count(*)<>count(distinct value) from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench'))) then raise exception 'A player cannot appear twice';end if;
 for player in select value from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) loop
  if not private.match_player_eligible(m.id,player::uuid) then raise exception 'Player is not eligible for this fixture';end if;
 end loop;
 perform private.validate_lineup_sheet(p_payload);
end;$$;

create or replace function public.get_team_club(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb;captain boolean;begin
 if not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 captain:=public.is_captain(p_club_id);
 data:=private.with_match_guests(public.get_public_club(p_club_id),p_club_id);
 return data || jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'number',number,'position',position,'initials',initials,'hometown',hometown,'bio',bio,'isPublic',is_public) order by number,name) from public.players where club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',season_id,'playerId',player_id)) from public.season_roster where club_id=p_club_id),'[]'::jsonb),
  'rsvps',coalesce((select jsonb_agg(jsonb_build_object('matchId',r.match_id,'playerId',r.player_id,'response',r.response,'updatedAt',r.updated_at,'needsConfirmation',r.kickoff_at_response is distinct from m.kickoff)) from private.match_rsvps r join public.matches m on m.id=r.match_id where r.club_id=p_club_id),'[]'::jsonb),
  'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchId',match_id,'payload',case when captain then coalesce(draft_payload,published_payload) else published_payload end,'shared',published_payload is not null,'updatedAt',case when captain then updated_at else published_at end) || case when captain then jsonb_build_object('revision',revision,'hasDraft',draft_payload is not null) else '{}'::jsonb end) from private.match_lineups where club_id=p_club_id and (captain or published_payload is not null)),'[]'::jsonb)
 );
end;$$;

create or replace function private.season_stats(p_club_id uuid, p_season_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare team_view boolean; data jsonb;
begin
  if not exists(select 1 from public.seasons where id=p_season_id and club_id=p_club_id) then
    raise exception 'Season not found' using errcode='22023';
  end if;
  team_view := private.is_team_member(p_club_id);
  with finals as (
    select r.* from public.matches m join public.match_results r on r.match_id=m.id and r.club_id=m.club_id
    where m.club_id=p_club_id and m.season_id=p_season_id and m.status='completed' and r.published
  ), recorded as (
    select s.*, r.attendance as attendance_capture, r.scorers as goals_capture, r.assists as assists_capture
    from finals r join public.match_player_stats s on s.match_id=r.match_id and s.club_id=r.club_id
  ), eligible as (
    select p.*, not exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=p_season_id and sr.player_id=p.id) as is_guest
    from public.players p where p.club_id=p_club_id and (
      exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=p_season_id and sr.player_id=p.id)
      or exists(select 1 from private.match_guests g join public.matches m on m.id=g.match_id and m.club_id=g.club_id where g.club_id=p_club_id and m.season_id=p_season_id and g.player_id=p.id)
    )
  ), visible as (
    select p.id,p.name,p.number,p.position,p.initials,p.is_public,p.is_guest,
      count(*) filter(where s.appeared)::integer as appearances,
      coalesce(sum(s.goals) filter(where s.goals_capture<>'unrecorded'),0)::integer as goals,
      coalesce(sum(s.assists) filter(where s.assists_capture<>'unrecorded'),0)::integer as assists,
      coalesce(bool_or(s.appeared or s.attendance_capture='complete'),false) as appearances_known,
      coalesce(bool_or(s.goals>0 or s.goals_capture='complete'),false) as goals_known,
      coalesce(bool_or(s.assists_capture<>'unrecorded' and s.assists is not null),false) as assists_known
    from eligible p left join recorded s on s.player_id=p.id
    where team_view or p.is_public
    group by p.id,p.name,p.number,p.position,p.initials,p.is_public,p.is_guest
  )
  select jsonb_build_object(
    'teamView',team_view,
    'privatePlayerCount',(select count(*) from eligible where not is_public and not team_view),
    'assistsTotal',case when exists(select 1 from finals where assists='complete')
      or exists(select 1 from recorded where assists_capture<>'unrecorded' and assists is not null)
      then (select coalesce(sum(assists),0) from recorded where assists_capture<>'unrecorded') else null end,
    'assistsRecordedMatches',(select count(*) from finals where assists<>'unrecorded'),
    'assistsCompleteMatches',(select count(*) from finals where assists='complete'),
    'players',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'number',number,'position',position,'initials',initials,'isPublic',is_public,'isGuest',is_guest,
      'appearances',appearances,'goals',goals,'assists',assists,
      'appearancesKnown',appearances_known,'goalsKnown',goals_known,'assistsKnown',assists_known
    ) order by number,name) from visible),'[]'::jsonb)
  ) into data;
  return data;
end;$$;
