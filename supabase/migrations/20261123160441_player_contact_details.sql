set local lock_timeout='5s';
set local statement_timeout='30s';

-- Keep contact information and captain notes out of the exposed player table.
-- Player identity, rather than account or season membership, owns these details.
create table private.player_details (
 club_id uuid not null,
 player_id uuid primary key,
 email text not null default '' check(length(email)<=254 and (email='' or (email=lower(btrim(email)) and email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))),
 phone text not null default '' check(length(phone)<=50),
 relationship_note text not null default '' check(length(relationship_note)<=2000),
 preferred_positions text[] not null default '{}' check(preferred_positions <@ array['Goalkeeper','Center back','Left back','Right back','Defensive midfield','Central midfield','Attacking midfield','Left wing','Right wing','Striker']::text[] and array_position(preferred_positions,null) is null),
 revision integer not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 foreign key(player_id,club_id) references public.players(id,club_id) on delete cascade
);
create index player_details_club_idx on private.player_details(club_id);
alter table private.player_details enable row level security;
create policy captain_player_details on private.player_details for all to authenticated
 using (public.is_captain(club_id)) with check (public.is_captain(club_id));
-- RPCs are the only client entry point, including for captains.
revoke all on private.player_details from public,anon,authenticated;

create function private.player_profile_details(p_club_id uuid,p_player_id uuid,p_captain boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d private.player_details;begin
 if auth.uid() is null or not private.is_team_member(p_club_id) or (p_captain and not public.is_captain(p_club_id)) then
  raise exception 'Team access required' using errcode='42501';
 end if;
 select * into d from private.player_details where club_id=p_club_id and player_id=p_player_id;
 return jsonb_build_object('preferredPositions',coalesce(to_jsonb(d.preferred_positions),'[]'::jsonb))
  || case when p_captain then jsonb_build_object('captainDetails',jsonb_build_object('email',coalesce(d.email,''),'phone',coalesce(d.phone,''),'relationshipNote',coalesce(d.relationship_note,''),'revision',coalesce(d.revision,0))) else '{}'::jsonb end;
end;$$;
revoke all on function private.player_profile_details(uuid,uuid,boolean) from public,anon,authenticated;

create function private.save_player_details(p_club_id uuid,p_player_id uuid,p_expected_revision integer,p_details jsonb) returns jsonb
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
  if jsonb_typeof(p_details->'preferredPositions')<>'array' or jsonb_array_length(p_details->'preferredPositions')>10 then raise exception 'Choose valid preferred positions';end if;
  if exists(select 1 from jsonb_array_elements(p_details->'preferredPositions') v where jsonb_typeof(v)<>'string') then raise exception 'Choose valid preferred positions';end if;
  select coalesce(array_agg(distinct v order by v),'{}') into positions from jsonb_array_elements_text(p_details->'preferredPositions') v;
  if not positions <@ array['Goalkeeper','Center back','Left back','Right back','Defensive midfield','Central midfield','Attacking midfield','Left wing','Right wing','Striker']::text[] then raise exception 'Choose valid preferred positions';end if;
 end if;
 insert into private.player_details(club_id,player_id,email,phone,relationship_note,preferred_positions,revision)
 values(p_club_id,p_player_id,mail,tel,note,positions,coalesce(d.revision,0)+1)
 on conflict(player_id) do update set email=excluded.email,phone=excluded.phone,relationship_note=excluded.relationship_note,preferred_positions=excluded.preferred_positions,revision=excluded.revision,updated_at=now();
 return private.player_profile_details(p_club_id,p_player_id,true);
end;$$;
revoke all on function private.save_player_details(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function private.save_player_details(uuid,uuid,integer,jsonb) to authenticated;
create function public.save_player_details(p_club_id uuid,p_player_id uuid,p_expected_revision integer,p_details jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.save_player_details(p_club_id,p_player_id,p_expected_revision,p_details);$$;
revoke all on function public.save_player_details(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_player_details(uuid,uuid,integer,jsonb) to authenticated;

-- A valid invitation saves its required email atomically. Other details survive
-- re-invitations, failed link generation, access revocation and invite acceptance.
create function private.capture_player_invite_email() returns trigger
language plpgsql security definer set search_path='' as $$begin
 insert into private.player_details(club_id,player_id,email,revision) values(new.club_id,new.player_id,new.email,1)
 on conflict(player_id) do update set email=excluded.email,revision=private.player_details.revision+1,updated_at=now()
 where private.player_details.email is distinct from excluded.email;
 return new;
end;$$;
revoke all on function private.capture_player_invite_email() from public,anon,authenticated;
create trigger capture_player_invite_email after insert or update of email on private.player_invites
 for each row execute function private.capture_player_invite_email();

-- Backfill explicit identity links only: prefer the linked, verified account,
-- then a still-pending invitation. No name matching or guessed addresses.
insert into private.player_details(club_id,player_id,email,revision)
 select distinct on (club_id,player_id) club_id,player_id,email,1 from (
  select m.club_id,m.player_id,lower(btrim(u.email)) email,0 priority from public.club_memberships m join auth.users u on u.id=m.user_id where m.player_id is not null and u.email_confirmed_at is not null
  union all
  select club_id,player_id,email,1 priority from private.player_invites
 ) linked where email~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email)<=254
 order by club_id,player_id,priority
 on conflict(player_id) do nothing;

-- Refuse to replace an unexpectedly changed production function.
do $$begin
 if md5((select prosrc from pg_proc where oid='public.save_roster_player(uuid,uuid,jsonb)'::regprocedure))<>'a686652db165f70cf3a7880ea45687a4' or
    md5((select prosrc from pg_proc where oid='public.get_captain_club(uuid)'::regprocedure))<>'b796e672e910306133e7ce07d386558d' or
    md5((select prosrc from pg_proc where oid='private.player_directory(uuid)'::regprocedure))<>'f0b54891a5f69cd7addc4fd1e7248d4a' or
    md5((select prosrc from pg_proc where oid='private.member_player_profiles(uuid)'::regprocedure))<>'2657ea1a88b96e56236ba104c46bc5fc' then raise exception 'Player projection changed; review before applying';end if;
end;$$;

-- Existing clients omitting captainDetails preserve the new fields.
create or replace function public.save_roster_player(p_club_id uuid,p_season_id uuid,p_player jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare player_id uuid:=coalesce(nullif(p_player->>'id','')::uuid,gen_random_uuid());begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if exists(select 1 from public.players where id=player_id and club_id<>p_club_id) then raise exception 'Club mismatch' using errcode='42501';end if;
 insert into public.players(id,club_id,name,number,position,initials,hometown,bio,is_public) values(player_id,p_club_id,btrim(p_player->>'name'),(p_player->>'number')::integer,p_player->>'position',p_player->>'initials',coalesce(p_player->>'hometown',''),coalesce(p_player->>'bio',''),coalesce((p_player->>'isPublic')::boolean,false))
 on conflict(id) do update set name=excluded.name,number=excluded.number,position=excluded.position,initials=excluded.initials,hometown=excluded.hometown,bio=excluded.bio,is_public=excluded.is_public where public.players.club_id=p_club_id;
 if not found then raise exception 'Club mismatch' using errcode='42501';end if;
 if p_player ? 'captainDetails' then
  perform private.save_player_details(p_club_id,player_id,(p_player->'captainDetails'->>'revision')::integer,(p_player->'captainDetails')||case when p_player ? 'preferredPositions' then jsonb_build_object('preferredPositions',p_player->'preferredPositions') else '{}'::jsonb end);
 end if;
 insert into public.season_roster(club_id,season_id,player_id) values(p_club_id,p_season_id,player_id) on conflict do nothing;return player_id;
end;$$;

create function private.with_player_details(p_club_id uuid,p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 return jsonb_set(p_data,'{players}',coalesce((select jsonb_agg(p.value||private.player_profile_details(p_club_id,(p.value->>'id')::uuid,true) order by p.ordinality) from jsonb_array_elements(p_data->'players') with ordinality p),'[]'::jsonb));
end;$$;
revoke all on function private.with_player_details(uuid,jsonb) from public,anon,authenticated;
create or replace function public.get_captain_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.with_player_details(p_club_id,private.with_match_guests(private.league_club_snapshot(p_club_id,true),p_club_id)||jsonb_build_object('removedFixtures',private.removed_feed_fixtures(p_club_id)));$$;

create or replace function private.player_directory(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
  return coalesce((select jsonb_agg((jsonb_build_object(
    'id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,
    'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public,
    'rosterSeasonIds',coalesce((select jsonb_agg(sr.season_id) from public.season_roster sr where sr.club_id=p_club_id and sr.player_id=p.id),'[]'::jsonb),
    'guestGames',(select count(*) from private.match_guests g join public.matches m on m.id=g.match_id where g.club_id=p_club_id and g.player_id=p.id and m.removed_at is null),
    'appearances',(select count(*) from public.match_player_stats ps join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id where ps.club_id=p_club_id and ps.player_id=p.id and ps.appeared and m.status='completed' and r.published and m.removed_at is null)
  )||private.player_profile_details(p_club_id,p.id,public.is_captain(p_club_id))) order by lower(p.name),p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb);
end;$$;


-- Member projections include position preferences only, never contact or notes.
create or replace function private.member_player_profiles(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;begin
 if auth.uid() is null or not private.is_team_member(p_club_id) then
  raise exception 'Team membership required' using errcode='42501';
 end if;
 data:=public.get_public_club(p_club_id);
 data:=data||jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public)||private.player_profile_details(p_club_id,p.id,false) order by p.number,p.name,p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',r.season_id,'playerId',r.player_id)) from public.season_roster r where r.club_id=p_club_id),'[]'::jsonb)
 );
 -- Active, published match-player rows provide accurate profile totals and
 -- appearance histories. No drafts, editor identities or captain tools enter
 -- this response; removed fixtures were already excluded by get_public_club.
 return jsonb_set(data,'{matches}',coalesce((select jsonb_agg(
  case when m.value ? 'result' then jsonb_set(m.value,'{result,stats}',coalesce((select jsonb_agg(jsonb_build_object('playerId',s.player_id,'appeared',s.appeared,'goals',s.goals,'assists',s.assists) order by s.player_id) from public.match_player_stats s where s.club_id=p_club_id and s.match_id=(m.value->>'id')::uuid),'[]'::jsonb)) else m.value end order by m.ordinality
 ) from jsonb_array_elements(data->'matches') with ordinality m),'[]'::jsonb));
end;$$;
