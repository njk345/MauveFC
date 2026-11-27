set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.players
  add column secondary_position text,
  add constraint players_secondary_position_check
  check (secondary_position is null or (
    secondary_position in ('Forward', 'Midfielder', 'Defender', 'Goalkeeper')
    and secondary_position <> position
  ));

create function private.detailed_position_names() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'Goalkeeper', 'Center back', 'Left back', 'Right back', 'Defensive midfield',
    'Central midfield', 'Attacking midfield', 'Left midfield', 'Right midfield',
    'Left wing', 'Right wing', 'Striker', 'Left striker', 'Right striker'
  ]::text[];
$$;
revoke all on function private.detailed_position_names() from public,anon,authenticated;

alter table private.player_details
  drop constraint player_details_preferred_positions_check,
  add constraint player_details_preferred_positions_check
  check (preferred_positions <@ private.detailed_position_names()
    and array_position(preferred_positions, null) is null);


create or replace function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format,'completed',s.completed,'completedAt',s.completed_at,'finalPosition',case when s.completed and s.manual_standings then (select (v->>'position')::integer from jsonb_array_elements(private.manual_standings(s.id)) v join private.season_teams t on t.id=(v->>'teamId')::uuid where t.is_ours and (v->>'played')::integer>0) else s.final_position end,'revision',s.completion_revision,'year',s.year,'term',s.term,'teamName',s.team_name,'location',s.location,'leagueWebsite',s.league_website,'timeZone',s.source_timezone,'manualStandings',s.manual_standings,'settingsRevision',s.settings_revision,'source',case when exists(select 1 from private.league_sources ls where ls.season_id=s.id) then 'leagueapps' else 'manual' end,'leagueTeams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'isOurs',t.is_ours) order by t.is_ours desc,t.name) from private.season_teams t where t.season_id=s.id),'[]'::jsonb)) order by s.year desc nulls last,case s.term when 'Fall' then 4 when 'Summer' then 3 when 'Spring' then 2 else 1 end desc,s.name,s.id) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'secondaryPosition',p.secondary_position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',sr.season_id,'playerId',sr.player_id)) from public.season_roster sr join public.players p on p.id=sr.player_id where sr.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round) || case when m.feed_source is not null then jsonb_build_object('source',m.feed_source) else '{}'::jsonb end || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'decision',r.decision,'penaltyOutcome',r.penalty_outcome,'basis',r.basis,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'updatedAt',r.updated_at,'stats',coalesce((select jsonb_agg(jsonb_build_object('playerId',ps.player_id,'appeared',ps.appeared,'goals',ps.goals,'assists',ps.assists)) from public.match_player_stats ps join public.players p on p.id=ps.player_id where ps.match_id=m.id and (p_private or p.is_public)),'[]'::jsonb))) else '{}'::jsonb end order by m.round) from public.matches m left join public.match_results r on r.match_id=m.id where m.club_id=p_club_id and m.removed_at is null),'[]'::jsonb)
 ) into response;
 return response;
end;$$;

create or replace function public.get_team_club(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb;captain boolean;begin
 if not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 captain:=public.is_captain(p_club_id);
 data:=private.with_match_guests(public.get_public_club(p_club_id),p_club_id);
 return data || jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'number',number,'position',position,'secondaryPosition',secondary_position,'initials',initials,'hometown',hometown,'bio',bio,'isPublic',is_public) order by number,name) from public.players where club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',season_id,'playerId',player_id)) from public.season_roster where club_id=p_club_id),'[]'::jsonb),
  'rsvps',coalesce((select jsonb_agg(jsonb_build_object('matchId',r.match_id,'playerId',r.player_id,'response',r.response,'updatedAt',r.updated_at,'needsConfirmation',r.kickoff_at_response is distinct from m.kickoff)) from private.match_rsvps r join public.matches m on m.id=r.match_id where r.club_id=p_club_id and m.removed_at is null),'[]'::jsonb),
  'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchId',match_id,'payload',case when captain then coalesce(draft_payload,published_payload) else published_payload end,'shared',published_payload is not null,'updatedAt',case when captain then updated_at else published_at end) || case when captain then jsonb_build_object('revision',revision,'hasDraft',draft_payload is not null) else '{}'::jsonb end) from private.match_lineups where club_id=p_club_id and exists(select 1 from public.matches m where m.id=match_id and m.removed_at is null) and (captain or published_payload is not null)),'[]'::jsonb)
 );
end;$$;

create or replace function private.player_directory(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
  return coalesce((select jsonb_agg((jsonb_build_object(
    'id',p.id,'name',p.name,'number',p.number,'position',p.position,'secondaryPosition',p.secondary_position,'initials',p.initials,
    'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public,
    'rosterSeasonIds',coalesce((select jsonb_agg(sr.season_id) from public.season_roster sr where sr.club_id=p_club_id and sr.player_id=p.id),'[]'::jsonb),
    'guestGames',(select count(*) from private.match_guests g join public.matches m on m.id=g.match_id where g.club_id=p_club_id and g.player_id=p.id and m.removed_at is null),
    'appearances',(select count(*) from public.match_player_stats ps join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id where ps.club_id=p_club_id and ps.player_id=p.id and ps.appeared and m.status='completed' and r.published and m.removed_at is null)
  )||private.player_profile_details(p_club_id,p.id,public.is_captain(p_club_id))) order by lower(p.name),p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb);
end;$$;

create or replace function private.member_player_profiles(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;begin
 if auth.uid() is null or not private.is_team_member(p_club_id) then
  raise exception 'Team membership required' using errcode='42501';
 end if;
 data:=public.get_public_club(p_club_id);
 data:=data||jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'secondaryPosition',p.secondary_position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public)||private.player_profile_details(p_club_id,p.id,false) order by p.number,p.name,p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',r.season_id,'playerId',r.player_id)) from public.season_roster r where r.club_id=p_club_id),'[]'::jsonb)
 );
 -- Active, published match-player rows provide accurate profile totals and
 -- appearance histories. No drafts, editor identities or captain tools enter
 -- this response; removed fixtures were already excluded by get_public_club.
 return jsonb_set(data,'{matches}',coalesce((select jsonb_agg(
  case when m.value ? 'result' then jsonb_set(m.value,'{result,stats}',coalesce((select jsonb_agg(jsonb_build_object('playerId',s.player_id,'appeared',s.appeared,'goals',s.goals,'assists',s.assists) order by s.player_id) from public.match_player_stats s where s.club_id=p_club_id and s.match_id=(m.value->>'id')::uuid),'[]'::jsonb)) else m.value end order by m.ordinality
 ) from jsonb_array_elements(data->'matches') with ordinality m),'[]'::jsonb));
end;$$;

create or replace function private.add_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid default null,p_player jsonb default null,p_allow_same_name boolean default false)
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
    insert into public.players(club_id,name,number,position,secondary_position,initials,is_public)
    values(m.club_id,display_name,(p_player->>'number')::integer,p_player->>'position',p_player->>'secondaryPosition',upper(left(display_name,1)||case when position(' ' in display_name)>0 then left(regexp_replace(display_name,'^.* ',''),1) else '' end),false)
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
  return jsonb_build_object('matchId',m.id,'revision',new_revision,'action','add','player',jsonb_build_object('id',person.id,'name',person.name,'number',person.number,'position',person.position,'secondaryPosition',person.secondary_position,'initials',person.initials,'hometown',person.hometown,'bio',person.bio,'isPublic',person.is_public));
end;$$;

create or replace function private.remove_match_guest(p_match_id uuid,p_expected_revision integer,p_player_id uuid) returns jsonb
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
  return jsonb_build_object('matchId',m.id,'revision',new_revision,'action','remove','player',jsonb_build_object('id',person.id,'name',person.name,'number',person.number,'position',person.position,'secondaryPosition',person.secondary_position,'initials',person.initials,'hometown',person.hometown,'bio',person.bio,'isPublic',person.is_public));
end;$$;

create or replace function public.save_roster_player(p_club_id uuid,p_season_id uuid,p_player jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare player_id uuid:=coalesce(nullif(p_player->>'id','')::uuid,gen_random_uuid());begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if exists(select 1 from public.players where id=player_id and club_id<>p_club_id) then raise exception 'Club mismatch' using errcode='42501';end if;
 insert into public.players(id,club_id,name,number,position,secondary_position,initials,hometown,bio,is_public) values(player_id,p_club_id,btrim(p_player->>'name'),(p_player->>'number')::integer,p_player->>'position',p_player->>'secondaryPosition',p_player->>'initials',coalesce(p_player->>'hometown',''),coalesce(p_player->>'bio',''),coalesce((p_player->>'isPublic')::boolean,false))
 on conflict(id) do update set name=excluded.name,number=excluded.number,position=excluded.position,
  secondary_position=case
   when p_player ? 'secondaryPosition' then excluded.secondary_position
   when players.secondary_position=excluded.position then null
   else players.secondary_position end,
  initials=excluded.initials,hometown=excluded.hometown,bio=excluded.bio,is_public=excluded.is_public where public.players.club_id=p_club_id;
 if not found then raise exception 'Club mismatch' using errcode='42501';end if;
 if p_player ? 'captainDetails' then
  perform private.save_player_details(p_club_id,player_id,(p_player->'captainDetails'->>'revision')::integer,(p_player->'captainDetails')||case when p_player ? 'preferredPositions' then jsonb_build_object('preferredPositions',p_player->'preferredPositions') else '{}'::jsonb end);
 end if;
 insert into public.season_roster(club_id,season_id,player_id) values(p_club_id,p_season_id,player_id) on conflict do nothing;return player_id;
end;$$;

create or replace function private.player_profile_details(p_club_id uuid,p_player_id uuid,p_captain boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d private.player_details;begin
 if auth.uid() is null or not private.is_team_member(p_club_id) or (p_captain and not public.is_captain(p_club_id)) then
  raise exception 'Team access required' using errcode='42501';
 end if;
 select * into d from private.player_details where club_id=p_club_id and player_id=p_player_id;
 return jsonb_build_object('preferredPositions',coalesce(to_jsonb(d.preferred_positions),'[]'::jsonb))
  || coalesce((
    select jsonb_build_object('position',p.position,'secondaryPosition',p.secondary_position)
    from public.players p where p.id=p_player_id and p.club_id=p_club_id
  ), '{}'::jsonb)
  || case when p_captain then jsonb_build_object('captainDetails',jsonb_build_object('email',coalesce(d.email,''),'phone',coalesce(d.phone,''),'relationshipNote',coalesce(d.relationship_note,''),'revision',coalesce(d.revision,0))) else '{}'::jsonb end;
end;$$;

create or replace function private.save_player_details(p_club_id uuid,p_player_id uuid,p_expected_revision integer,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.player_details;mail text;tel text;note text;positions text[];begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform 1 from public.players where club_id=p_club_id and id=p_player_id for update;
 if not found then raise exception 'Player does not belong to this club' using errcode='42501';end if;
 select * into d from private.player_details where club_id=p_club_id and player_id=p_player_id for update;
 if p_expected_revision is null or p_expected_revision<>coalesce(d.revision,0) then raise exception 'Player details changed. Reload the player and try again.' using errcode='40001';end if;
 if p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'Invalid player details';end if;
 if exists(select 1 from jsonb_each(p_details) e where e.key in ('email','phone','relationshipNote') and jsonb_typeof(e.value)<>'string') then raise exception 'Contact details must be text';end if;
 mail:=case when p_details ? 'email' then lower(btrim(p_details->>'email')) else coalesce(d.email,'') end;
 tel:=case when p_details ? 'phone' then btrim(p_details->>'phone') else coalesce(d.phone,'') end;
 note:=case when p_details ? 'relationshipNote' then btrim(p_details->>'relationshipNote') else coalesce(d.relationship_note,'') end;
 if length(mail)>254 or (mail<>'' and mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid contact email';end if;
 if length(tel)>50 then raise exception 'Phone must be 50 characters or fewer';end if;
 if length(note)>2000 then raise exception 'Captain note must be 2000 characters or fewer';end if;
 positions:=coalesce(d.preferred_positions,'{}');
 if p_details ? 'preferredPositions' then
  if jsonb_typeof(p_details->'preferredPositions')<>'array' or jsonb_array_length(p_details->'preferredPositions')>cardinality(private.detailed_position_names()) then raise exception 'Choose valid preferred positions';end if;
  if exists(select 1 from jsonb_array_elements(p_details->'preferredPositions') v where jsonb_typeof(v)<>'string') then raise exception 'Choose valid preferred positions';end if;
  select coalesce(array_agg(distinct v order by v),'{}') into positions from jsonb_array_elements_text(p_details->'preferredPositions') v;
  if not positions <@ private.detailed_position_names() then raise exception 'Choose valid preferred positions';end if;
 end if;
 if p_details ? 'position' or p_details ? 'secondaryPosition' then
  update public.players p
  set position=case when p_details ? 'position' then p_details->>'position' else p.position end,
      secondary_position=case
        when p_details ? 'secondaryPosition' then p_details->>'secondaryPosition'
        when p_details->>'position'=p.secondary_position then null
        else p.secondary_position end
  where p.id=p_player_id and p.club_id=p_club_id;
 end if;
 insert into private.player_details(club_id,player_id,email,phone,relationship_note,preferred_positions,revision)
 values(p_club_id,p_player_id,mail,tel,note,positions,coalesce(d.revision,0)+1)
 on conflict(player_id) do update set email=excluded.email,phone=excluded.phone,relationship_note=excluded.relationship_note,preferred_positions=excluded.preferred_positions,revision=excluded.revision,updated_at=now();
 return private.player_profile_details(p_club_id,p_player_id,true);
end;$$;

create or replace function private.archive_season_stats(p_club_id uuid, p_season_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare team_view boolean; data jsonb;
begin
  if coalesce(cardinality(p_season_ids),0)=0 or exists (
    select 1 from unnest(p_season_ids) as selected(id)
    where not exists (select 1 from public.seasons s where s.id=selected.id and s.club_id=p_club_id)
  ) then
    raise exception 'Select valid club seasons' using errcode='22023';
  end if;
  team_view := private.is_team_member(p_club_id);
  with finals as (
    select r.* from public.matches m join public.match_results r on r.match_id=m.id and r.club_id=m.club_id
    where m.club_id=p_club_id and m.season_id=any(p_season_ids) and m.status='completed' and r.published and m.removed_at is null
  ), recorded as (
    select s.*, r.attendance as attendance_capture, r.scorers as goals_capture, r.assists as assists_capture
    from finals r join public.match_player_stats s on s.match_id=r.match_id and s.club_id=r.club_id
  ), eligible as (
    select p.*, not exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=any(p_season_ids) and sr.player_id=p.id) as is_guest
    from public.players p where p.club_id=p_club_id and (
      exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=any(p_season_ids) and sr.player_id=p.id)
      or exists(select 1 from private.match_guests g join public.matches m on m.id=g.match_id and m.club_id=g.club_id where g.club_id=p_club_id and m.season_id=any(p_season_ids) and m.removed_at is null and g.player_id=p.id)
    )
  ), visible as (
    select p.id,p.name,p.number,p.position,p.secondary_position,p.initials,p.is_public,p.is_guest,
      count(*) filter(where s.appeared)::integer as appearances,
      coalesce(sum(s.goals) filter(where s.goals_capture<>'unrecorded'),0)::integer as goals,
      coalesce(sum(s.assists) filter(where s.assists_capture<>'unrecorded'),0)::integer as assists,
      coalesce(bool_or(s.appeared or s.attendance_capture='complete'),false) as appearances_known,
      coalesce(bool_or(s.goals_capture<>'unrecorded' and (s.goals>0 or s.goals_capture='complete')),false) as goals_known,
      coalesce(bool_or(s.assists_capture<>'unrecorded' and s.assists is not null),false) as assists_known
    from eligible p left join recorded s on s.player_id=p.id
    where team_view or p.is_public
    group by p.id,p.name,p.number,p.position,p.secondary_position,p.initials,p.is_public,p.is_guest
  )
  select jsonb_build_object(
    'teamView',team_view,
    'privatePlayerCount',(select count(*) from eligible where not is_public and not team_view),
    'assistsTotal',case when exists(select 1 from finals where assists='complete')
      or exists(select 1 from recorded where assists_capture<>'unrecorded' and assists is not null)
      then (select coalesce(sum(assists),0) from recorded where assists_capture<>'unrecorded') else null end,
    'appearanceRecords',(select count(*) from finals where attendance<>'unrecorded'),
    'goalRecords',(select count(*) from finals where scorers<>'unrecorded'),
    'assistsRecordedMatches',(select count(*) from finals where assists<>'unrecorded'),
    'assistsCompleteMatches',(select count(*) from finals where assists='complete'),
    'players',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'number',number,'position',position,'secondaryPosition',secondary_position,'initials',initials,'isPublic',is_public,'isGuest',is_guest,
      'appearances',appearances,'goals',goals,'assists',assists,
      'appearancesKnown',appearances_known,'goalsKnown',goals_known,'assistsKnown',assists_known
    ) order by number,name) from visible),'[]'::jsonb)
  ) into data;
  return data;
end;$$;

create or replace function private.validate_lineup_sheet(p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare entry record;begin
 if p_payload ? 'hideNumbers' and jsonb_typeof(p_payload->'hideNumbers') is distinct from 'boolean' then raise exception 'Invalid jersey-number option';end if;
 if p_payload ? 'firstNamesOnly' and jsonb_typeof(p_payload->'firstNamesOnly') is distinct from 'boolean' then raise exception 'Invalid team-sheet name option';end if;
 if p_payload ? 'benchPositions' then
  if jsonb_typeof(p_payload->'benchPositions') is distinct from 'object' then raise exception 'Invalid substitute positions';end if;
  for entry in select key,value from jsonb_each(p_payload->'benchPositions') loop
   if not (p_payload->'bench' @> jsonb_build_array(entry.key)) or jsonb_typeof(entry.value) is distinct from 'number' or entry.value::text !~ '^[0-6]$' then raise exception 'A position substitute must be on the bench with a valid position';end if;
  end loop;
 end if;
 if p_payload ? 'slotPositions' then
  if jsonb_typeof(p_payload->'slotPositions') is distinct from 'object' then
   raise exception 'Invalid position roles';
  end if;
  for entry in select key,value from jsonb_each_text(p_payload->'slotPositions') loop
   if entry.key !~ '^[1-6]$'
     or entry.value is null
     or entry.value='Goalkeeper'
     or not (entry.value=any(private.detailed_position_names())) then
    raise exception 'Choose a valid outfield position for this slot';
   end if;
  end loop;
 end if;
end;$$;

-- The same slot order as formations.ts. Existing official sheets have no
-- slotPositions override, so their roles are available immediately.
create function private.lineup_slot_position(p_payload jsonb, p_index integer)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    p_payload->'slotPositions'->>(p_index::text),
    (case p_payload->>'formation'
      when '2-3-1' then array['Goalkeeper','Left back','Right back','Left midfield','Central midfield','Right midfield','Striker']
      when '3-2-1' then array['Goalkeeper','Left back','Center back','Right back','Left midfield','Right midfield','Striker']
      when '2-2-2' then array['Goalkeeper','Left back','Right back','Left midfield','Right midfield','Left striker','Right striker']
    end)[p_index + 1]
  );
$$;
revoke all on function private.lineup_slot_position(jsonb,integer) from public,anon,authenticated;

-- One current assignment per player/match, derived from the same saved official
-- payload that is shared with the team. Drafts, suggestions, older versions,
-- and attendance never participate. An unshare clears these assignments;
-- fixture removal hides them and restoring that fixture brings them back.
create view private.latest_official_lineup_positions with (security_invoker = true) as
select l.club_id, m.season_id, l.match_id, p.id as player_id, roles.slot_index,
       private.lineup_slot_position(l.published_payload, roles.slot_index) as position,
       roles.assignment, l.published_at
from private.match_lineups l
join public.matches m on m.id=l.match_id and m.club_id=l.club_id
cross join lateral (
  select s.value as player_id, (s.ordinality - 1)::integer as slot_index, 'starter'::text as assignment
  from jsonb_array_elements_text(l.published_payload->'starters') with ordinality s(value, ordinality)
  where s.value is not null
  union all
  select b.key, b.value::integer, 'substitute'::text
  from jsonb_each_text(l.published_payload->'benchPositions') b
) roles
join public.players p on p.id=roles.player_id::uuid and p.club_id=l.club_id
where l.published_payload is not null and m.removed_at is null;
revoke all on private.latest_official_lineup_positions from public,anon,authenticated;

