-- Public-page adapter. Source capabilities stay in private tables, never in snapshots.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.league_sources (
 club_id uuid primary key references public.clubs(id), season_id uuid not null,
 program_id text not null check(program_id='5162244'), team_id text not null check(team_id='8032635'),
 team_name text not null default 'It’s Coming Home (Lilac)', enabled boolean not null default true,
 last_attempt timestamptz,last_success timestamptz,last_error text,
 standings jsonb not null default '[]',
 foreign key(season_id,club_id) references public.seasons(id,club_id)
);
create table private.league_runs (
 token uuid primary key default gen_random_uuid(),club_id uuid not null references private.league_sources(club_id),
 requested_at timestamptz not null default now(),started_at timestamptz,finished_at timestamptz,
 state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),summary jsonb
);
create index league_runs_club_time_idx on private.league_runs(club_id,requested_at desc);
create table private.league_games (
 club_id uuid not null references private.league_sources(club_id), external_id text not null,
 match_id uuid not null unique references public.matches(id), snapshot jsonb not null,
 needs_review boolean not null default false,last_seen timestamptz not null default now(),
 primary key(club_id,external_id)
);
create table private.league_changes (
 id bigint generated always as identity primary key,match_id uuid not null references public.matches(id),
 changed_at timestamptz not null default now(),before_value jsonb,after_value jsonb not null
);
create index league_changes_match_idx on private.league_changes(match_id,changed_at);
alter table private.league_sources enable row level security;
alter table private.league_runs enable row level security;
alter table private.league_games enable row level security;
alter table private.league_changes enable row level security;
revoke all on all tables in schema private from public,anon,authenticated;
alter table public.matches add column league_fixture_override boolean not null default false;

-- A captain changing a league fixture takes ownership of that fixture's metadata.
create function private.protect_league_fixture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and public.is_captain(new.club_id) and exists(select 1 from private.league_games where match_id=new.id) and
 (row(new.opponent,new.opponent_code,new.color,new.kickoff,new.venue,new.round,new.home) is distinct from row(old.opponent,old.opponent_code,old.color,old.kickoff,old.venue,old.round,old.home) or (new.status is distinct from old.status and new.status in ('scheduled','postponed','cancelled'))) then
  new.league_fixture_override:=true;
 end if;
 return new;
end;$$;
create trigger protect_league_fixture before update on public.matches for each row execute function private.protect_league_fixture();
revoke all on function private.protect_league_fixture() from public,anon,authenticated;

-- Dispatcher is installed in the next migration (pg_net + pg_cron).
create function public.request_league_sync(p_club_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform private.dispatch_league_sync(p_club_id);
end;$$;
revoke all on function public.request_league_sync(uuid) from public,anon,authenticated;
grant execute on function public.request_league_sync(uuid) to authenticated;

create function public.use_league_fixture(p_match_id uuid,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;g jsonb;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if m.revision is distinct from p_expected_revision then raise exception 'Fixture changed' using errcode='40001';end if;
 select snapshot into strict g from private.league_games where match_id=m.id;
 update public.matches set opponent=g->>'opponent',opponent_code=g->>'opponentCode',color='#657293',kickoff=(g->>'kickoff')::timestamptz,venue=g->>'venue',round=(g->>'round')::int,home=(g->>'home')::boolean,status=case when exists(select 1 from public.match_results where match_id=m.id and published) then 'completed' else g->>'status' end,revision=revision+1 where id=m.id;
 -- Metadata trigger marks captain edits; explicitly relinquish ownership afterwards.
 update public.matches set league_fixture_override=false where id=m.id;
end;$$;
revoke all on function public.use_league_fixture(uuid,integer) from public,anon,authenticated;
grant execute on function public.use_league_fixture(uuid,integer) to authenticated;

-- Edge-only capabilities. Each queued token can start once and expires in ten minutes.
create function public.begin_league_sync(p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.league_runs;s private.league_sources;begin
 select * into r from private.league_runs where token=p_token for update;
 if not found or r.state<>'queued' or r.requested_at<now()-interval '10 minutes' then raise exception 'Invalid sync job' using errcode='42501';end if;
 select * into strict s from private.league_sources where club_id=r.club_id and enabled;
 update private.league_runs set state='running',started_at=now() where token=p_token;
 return jsonb_build_object('clubId',s.club_id,'programId',s.program_id,'teamId',s.team_id);
end;$$;
create function public.fail_league_sync(p_token uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid;begin
 update private.league_runs set state='failed',finished_at=now() where token=p_token and state='running' returning club_id into c;
 update private.league_sources set last_error='LeagueApps could not be refreshed. Showing the last successful update.' where club_id=c;
end;$$;

create function public.apply_league_sync(p_token uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.league_runs;src private.league_sources;g jsonb;link private.league_games;m public.matches;r public.match_results;
 mid uuid;review boolean;changed boolean;result_changed boolean;score jsonb;conflicts int:=0;begin
 select * into strict job from private.league_runs where token=p_token for update;
 if job.state<>'running' or job.requested_at<now()-interval '10 minutes' then raise exception 'Expired sync job' using errcode='42501';end if;
 select * into strict src from private.league_sources where club_id=job.club_id for update;
 if not src.enabled or p_snapshot->>'programId' is distinct from src.program_id or p_snapshot->>'teamId' is distinct from src.team_id then raise exception 'Source mismatch';end if;
 if jsonb_typeof(p_snapshot->'games') is distinct from 'array' or jsonb_array_length(p_snapshot->'games') not between 1 and 200 or jsonb_typeof(p_snapshot->'standings') is distinct from 'array' or jsonb_array_length(p_snapshot->'standings') not between 2 and 100 then raise exception 'Incomplete snapshot';end if;
 if not exists(select 1 from jsonb_array_elements(p_snapshot->'standings') s where s->>'teamId'=src.team_id) then raise exception 'Team missing from standings';end if;
 if (select count(*)<>count(distinct value->>'externalId') from jsonb_array_elements(p_snapshot->'games')) then raise exception 'Duplicate external ID';end if;
 for g in select value from jsonb_array_elements(p_snapshot->'games') loop
  if coalesce(g->>'externalId','')!~'^[0-9]+$' or coalesce(g->>'status','') not in ('scheduled','completed','postponed','cancelled') then raise exception 'Invalid game';end if;
  select * into link from private.league_games where club_id=src.club_id and external_id=g->>'externalId';
  if found then
   mid:=link.match_id;
   select * into strict m from public.matches where id=mid for update;
  else
   insert into public.matches(club_id,season_id,opponent,opponent_code,kickoff,venue,round,home,status)
   values(src.club_id,src.season_id,g->>'opponent',g->>'opponentCode',(g->>'kickoff')::timestamptz,g->>'venue',(g->>'round')::int,(g->>'home')::boolean,g->>'status') returning * into m;
   mid:=m.id;
   insert into private.league_games(club_id,external_id,match_id,snapshot) values(src.club_id,g->>'externalId',mid,g);
  end if;
  select * into r from public.match_results where match_id=mid;
  score:=nullif(g->'score','null'::jsonb);
  if (g->>'status'='completed') is distinct from (score is not null) then raise exception 'Invalid final score state';end if;
  review:=false;changed:=false;result_changed:=false;
  if r.editor_id is not null then
   -- Keep captain corrections and all player details. Show a conflict for review.
   review:=score is null or row(r.home,r.away,r.basis) is distinct from row((score->>'home')::int,(score->>'away')::int,score->>'basis');
  elsif score is not null then
   if coalesce(score->>'basis','') not in ('played','forfeit') or (score->>'home')::int not between 0 and 99 or (score->>'away')::int not between 0 and 99 then raise exception 'Invalid official score';end if;
   result_changed:=r.match_id is null or row(r.home,r.away,r.basis,r.published) is distinct from row((score->>'home')::int,(score->>'away')::int,score->>'basis',true);
   if result_changed then
    insert into public.match_results(match_id,club_id,home,away,on_field_home,on_field_away,basis,reason,attendance,scorers,assists,own_goals,published)
    values(mid,src.club_id,(score->>'home')::int,(score->>'away')::int,case when score->>'basis'='forfeit' then 0 else (score->>'home')::int end,case when score->>'basis'='forfeit' then 0 else (score->>'away')::int end,score->>'basis',case when score->>'basis'='forfeit' then 'LeagueApps official forfeit; on-field score not recorded' else '' end,'unrecorded','unrecorded','unrecorded',0,true)
    on conflict(match_id) do update set home=excluded.home,away=excluded.away,on_field_home=excluded.on_field_home,on_field_away=excluded.on_field_away,basis=excluded.basis,reason=excluded.reason,published=true,updated_at=now();
   end if;
  elsif r.match_id is not null then
   -- A withdrawn result is unpublished; its previous payload stays in the source audit.
   update public.match_results set published=false,updated_at=now() where match_id=mid and published;
   result_changed:=r.published;
  end if;
  if not m.league_fixture_override then
   changed:=row(m.opponent,m.opponent_code,m.kickoff,m.venue,m.round,m.home,m.status) is distinct from row(g->>'opponent',g->>'opponentCode',(g->>'kickoff')::timestamptz,g->>'venue',(g->>'round')::int,(g->>'home')::boolean,case when r.editor_id is not null and r.published then 'completed' else g->>'status' end);
   if changed then
    update public.matches set opponent=g->>'opponent',opponent_code=g->>'opponentCode',kickoff=(g->>'kickoff')::timestamptz,venue=g->>'venue',round=(g->>'round')::int,home=(g->>'home')::boolean,status=case when r.editor_id is not null and r.published then 'completed' else g->>'status' end where id=mid;
   end if;
  elsif score is not null and r.editor_id is null then
   update public.matches set status='completed' where id=mid;
   changed:=m.status<>'completed';
  end if;
  if changed or result_changed then update public.matches set revision=revision+1 where id=mid;end if;
  if link.snapshot is distinct from g then insert into private.league_changes(match_id,before_value,after_value) values(mid,link.snapshot,g);end if;
  update private.league_games set snapshot=g,needs_review=review,last_seen=now() where match_id=mid;
  if review then conflicts:=conflicts+1;end if;
 end loop;
 -- Missing games are retained. Disappearance is not evidence of a cancellation.
 update private.league_sources set standings=p_snapshot->'standings',last_success=now(),last_error=null where club_id=src.club_id;
 update private.league_runs set state='succeeded',finished_at=now(),summary=jsonb_build_object('games',jsonb_array_length(p_snapshot->'games'),'teams',jsonb_array_length(p_snapshot->'standings'),'conflicts',conflicts) where token=p_token;
 return jsonb_build_object('games',jsonb_array_length(p_snapshot->'games'),'conflicts',conflicts);
end;$$;
revoke all on function public.begin_league_sync(uuid),public.fail_league_sync(uuid),public.apply_league_sync(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_league_sync(uuid),public.fail_league_sync(uuid),public.apply_league_sync(uuid,jsonb) to service_role;

create function private.league_club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb;src private.league_sources;begin
 data:=public.club_snapshot(p_club_id,p_private);
 select * into src from private.league_sources where club_id=p_club_id;
 if not found then return data;end if;
 data:=jsonb_set(data,'{matches}',coalesce((select jsonb_agg(a.value || case when l.match_id is null then '{}'::jsonb else jsonb_build_object('source','leagueapps','externalId',l.external_id,'fixtureOverride',m.league_fixture_override,'resultSource',case when r.editor_id is null then 'leagueapps' else 'captain' end) || case when p_private then jsonb_build_object('leagueScore',l.snapshot->'score','needsReview',l.needs_review) else '{}'::jsonb end end order by (a.value->>'round')::int) from jsonb_array_elements(data->'matches') a left join private.league_games l on l.match_id=(a.value->>'id')::uuid left join public.matches m on m.id=l.match_id left join public.match_results r on r.match_id=l.match_id),'[]'::jsonb));
 return data || jsonb_build_object('league',jsonb_build_object('seasonId',src.season_id,'teamId',src.team_id,'teamName',src.team_name,'standings',src.standings,'lastSuccess',src.last_success,'lastAttempt',src.last_attempt,'error',src.last_error,'state',coalesce((select case when state in ('queued','running') and requested_at<now()-interval '10 minutes' then 'failed' else state end from private.league_runs where club_id=p_club_id order by requested_at desc limit 1),'idle')));
end;$$;
revoke all on function private.league_club_snapshot(uuid,boolean) from public,anon,authenticated;
create or replace function public.get_public_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.league_club_snapshot(p_club_id,false);$$;
create or replace function public.get_captain_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.league_club_snapshot(p_club_id,true);$$;
