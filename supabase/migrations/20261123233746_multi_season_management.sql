set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('private.dispatch_league_sync(uuid)') is not null and (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.dispatch_league_sync(uuid)'))<>'fa712d47d22a863549244287f2a6ba0a' then raise exception 'League dispatcher changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='public.apply_league_sync(uuid,jsonb)'::regprocedure)<>'24358fd464824eedf05597f1471aa00c' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='public.begin_league_sync(uuid)'::regprocedure)<>'14aaf4f084e18d2b954686830d9b2a93' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='public.fail_league_sync(uuid)'::regprocedure)<>'b278a38552ad91eb8fd7b4b49be1fe70' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='private.league_club_snapshot(uuid,boolean)'::regprocedure)<>'2741bab07bcfa15062b7191d5bc40c67' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='public.club_snapshot(uuid,boolean)'::regprocedure)<>'71d0bc1bba16aa42706671c8f54df55e' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='private.set_season_complete(uuid,integer,boolean)'::regprocedure)<>'9b230c7b9a892c5399f5c2d0aed1650c' then raise exception 'Season source functions changed; review before applying';end if;
 if (select md5(prosrc) from pg_proc where oid='private.removed_feed_fixtures(uuid)'::regprocedure)<>'18417de8f7c5108976cabe0abf7ab7e4' then raise exception 'Season source functions changed; review before applying';end if;
end;$$;

-- Preserve the stable club and player identities while making competition data seasonal.
alter table public.seasons
 add column year integer check(year between 1900 and 2100),
 add column term text check(term in ('Winter','Spring','Summer','Fall')),
 add column team_name text not null default 'Mauve FC' check(length(btrim(team_name)) between 1 and 100),
 add column location text not null default '' check(length(location)<=150),
 add column league_website text not null default '' check(length(league_website)<=500),
 add column source_timezone text not null default 'America/New_York',
 add column manual_standings boolean not null default false,
 add column settings_revision integer not null default 0,
 add column creation_hash text;
update public.seasons set year=substring(name from '(20[0-9]{2})')::integer,
 term=case when name~*'winter' then 'Winter' when name~*'spring' then 'Spring' when name~*'summer' then 'Summer' when name~*'fall|autumn' then 'Fall' end;
update public.seasons s set team_name=l.team_name from private.league_sources l where l.season_id=s.id;

-- Existing source records and game identities remain intact.
alter table private.league_runs add column season_id uuid;
alter table private.league_games add column season_id uuid;
update private.league_runs j set season_id=s.season_id from private.league_sources s where s.club_id=j.club_id;
update private.league_games j set season_id=s.season_id from private.league_sources s where s.club_id=j.club_id;
alter table private.league_runs drop constraint league_runs_club_id_fkey;
alter table private.league_games drop constraint league_games_club_id_fkey;
alter table private.league_sources drop constraint league_sources_pkey,
 drop constraint league_sources_program_id_check,drop constraint league_sources_team_id_check,
 add column origin text not null default 'https://nycsoccer.leagueapps.com' check(origin~'^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.leagueapps\.com$'),
 add column time_zone text not null default 'America/New_York',
 add primary key(club_id,season_id),
 add constraint league_source_program_valid check(program_id~'^[0-9]+$'),
 add constraint league_source_team_valid check(team_id~'^[0-9]+$'),
 add unique(club_id,origin,program_id,team_id);
alter table private.league_runs alter column season_id set not null,
 add foreign key(club_id,season_id) references private.league_sources(club_id,season_id);
alter table private.league_games alter column season_id set not null,
 drop constraint league_games_pkey,add primary key(club_id,season_id,external_id),
 add foreign key(club_id,season_id) references private.league_sources(club_id,season_id);
create index league_runs_season_time_idx on private.league_runs(club_id,season_id,requested_at desc);
-- Old one-season job callers remain valid only while there is an unambiguous source.
create function private.fill_league_season_scope() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.season_id is null then
  if tg_table_name='league_games' then select season_id into new.season_id from public.matches where id=new.match_id and club_id=new.club_id;
  else
   if (select count(*) from private.league_sources where club_id=new.club_id)<>1 then raise exception 'Choose a season for this refresh';end if;
   select season_id into new.season_id from private.league_sources where club_id=new.club_id;
  end if;
 end if;return new;
end;$$;
revoke all on function private.fill_league_season_scope() from public,anon,authenticated;
create trigger fill_league_run_scope before insert on private.league_runs for each row execute function private.fill_league_season_scope();
create trigger fill_league_game_scope before insert on private.league_games for each row execute function private.fill_league_season_scope();

create table private.season_teams (
 id uuid primary key default gen_random_uuid(),club_id uuid not null,season_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 100),is_ours boolean not null default false,
 foreign key(season_id,club_id) references public.seasons(id,club_id),unique(id,season_id)
);
create unique index season_team_name_idx on private.season_teams(season_id,lower(btrim(name)));
create unique index season_one_own_team_idx on private.season_teams(season_id) where is_ours;
create table private.manual_league_results (
 id uuid primary key default gen_random_uuid(),club_id uuid not null,season_id uuid not null,
 home_team_id uuid not null,away_team_id uuid not null,
 home integer not null check(home between 0 and 99),away integer not null check(away between 0 and 99),
 played_on date,decision text not null default 'regulation' check(decision in ('regulation','overtime','penalties')),
 penalty_outcome text check(penalty_outcome in ('W','L')),
 revision integer not null default 0,updated_at timestamptz not null default now(),
 foreign key(season_id,club_id) references public.seasons(id,club_id),
 foreign key(home_team_id,season_id) references private.season_teams(id,season_id),
 foreign key(away_team_id,season_id) references private.season_teams(id,season_id),
 check(home_team_id<>away_team_id),
 check((decision='penalties' and home=away and penalty_outcome is not null) or (decision<>'penalties' and penalty_outcome is null))
);
create index manual_league_results_season_idx on private.manual_league_results(season_id);
create table private.season_import_previews (
 id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs(id),
 created_by uuid not null references auth.users(id) on delete cascade,
 config jsonb not null,snapshot jsonb not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '30 minutes',consumed_by uuid references public.seasons(id)
);
create index season_import_previews_owner_idx on private.season_import_previews(club_id,created_by,created_at desc);
alter table private.season_teams enable row level security;
alter table private.manual_league_results enable row level security;
alter table private.season_import_previews enable row level security;
create policy captain_season_teams on private.season_teams for all to authenticated using(public.is_captain(club_id)) with check(public.is_captain(club_id));
create policy captain_manual_results on private.manual_league_results for all to authenticated using(public.is_captain(club_id)) with check(public.is_captain(club_id));
create policy captain_import_previews on private.season_import_previews for all to authenticated using(public.is_captain(club_id) and created_by=auth.uid()) with check(public.is_captain(club_id) and created_by=auth.uid());
revoke all on private.season_teams,private.manual_league_results,private.season_import_previews from public,anon,authenticated;

create function private.manual_standings(p_season_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with scores as (
  select own.id h,opp.id a,r.home hg,r.away ag,case when r.decision='penalties' then r.penalty_outcome when r.home>r.away then 'W' when r.home<r.away then 'L' else 'D' end outcome
  from public.matches m join public.match_results r on r.match_id=m.id
  join private.season_teams own on own.season_id=m.season_id and own.is_ours
  join private.season_teams opp on opp.season_id=m.season_id and not opp.is_ours and lower(btrim(opp.name))=lower(btrim(m.opponent))
  where m.season_id=p_season_id and m.removed_at is null and m.playoff_round is null and m.status='completed' and r.published
  union all
  select home_team_id,away_team_id,home,away,case when decision='penalties' then penalty_outcome when home>away then 'W' when home<away then 'L' else 'D' end from private.manual_league_results where season_id=p_season_id
 ), sides as (
  select h id,hg gf,ag ga,outcome from scores union all select a,ag,hg,case outcome when 'W' then 'L' when 'L' then 'W' else 'D' end from scores
 ), totals as (
  select t.id,t.name,count(s.id)::integer played,count(*) filter(where s.outcome='W')::integer wins,count(*) filter(where s.outcome='L')::integer losses,count(*) filter(where s.outcome='D')::integer draws,
  coalesce(sum(s.gf),0)::integer gf,coalesce(sum(s.ga),0)::integer ga,coalesce(sum(case s.outcome when 'W' then 3 when 'D' then 1 else 0 end),0)::integer points
  from private.season_teams t left join sides s on s.id=t.id where t.season_id=p_season_id group by t.id,t.name
 ), ranked as (
  select *,row_number() over(order by points desc,(gf-ga) desc,gf desc,lower(name),id)::integer position from totals
 ) select coalesce(jsonb_agg(jsonb_build_object('teamId',id,'name',name,'position',position,'played',played,'wins',wins,'losses',losses,'draws',draws,'goalsFor',gf,'goalsAgainst',ga,'difference',gf-ga,'points',points,'forfeits',0) order by position),'[]'::jsonb)
 from ranked where exists(select 1 from public.seasons where id=p_season_id and manual_standings);
$$;
revoke all on function private.manual_standings(uuid) from public,anon,authenticated;

create function private.season_connection(p_season_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.seasons;l private.league_sources;begin
 select * into strict s from public.seasons where id=p_season_id;
 select * into l from private.league_sources where season_id=s.id and club_id=s.club_id;
 if found then return jsonb_build_object('kind','leagueapps','seasonId',s.id,'teamId',l.team_id,'teamName',l.team_name,'leagueName',s.competition,'standings',l.standings,'lastSuccess',l.last_success,'lastAttempt',l.last_attempt,'error',l.last_error,'scheduleUrl',l.origin||'/leagues/'||l.program_id||'/schedule','standingsUrl',l.origin||'/leagues/'||l.program_id||'/standings','refreshesAutomatically',not s.completed,'state',coalesce((select case when state in ('queued','running') and requested_at<now()-interval '10 minutes' then 'failed' else state end from private.league_runs where club_id=s.club_id and season_id=s.id order by requested_at desc,token desc limit 1),'idle'));end if;
 if not s.manual_standings then return null;end if;
 return jsonb_build_object('kind','manual','seasonId',s.id,'teamId',(select id from private.season_teams where season_id=s.id and is_ours),'teamName',s.team_name,'leagueName',s.competition,'standings',private.manual_standings(s.id),'state','idle','lastSuccess',null,'lastAttempt',null,'error',null,
 'unmatchedGames',(select count(*) from public.matches m join public.match_results r on r.match_id=m.id where m.season_id=s.id and m.removed_at is null and m.playoff_round is null and m.status='completed' and r.published and not exists(select 1 from private.season_teams t where t.season_id=s.id and not t.is_ours and lower(btrim(t.name))=lower(btrim(m.opponent)))));
end;$$;
revoke all on function private.season_connection(uuid) from public,anon,authenticated;

create or replace function public.begin_league_sync(p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.league_runs;s private.league_sources;begin
 select * into r from private.league_runs where token=p_token for update;
 if not found or r.state<>'queued' or r.requested_at<now()-interval '10 minutes' then raise exception 'Invalid sync job' using errcode='42501';end if;
 select * into strict s from private.league_sources where club_id=r.club_id and season_id=r.season_id and enabled;
 update private.league_runs set state='running',started_at=now() where token=p_token;
 return jsonb_build_object('clubId',s.club_id,'programId',s.program_id,'teamId',s.team_id,'origin',s.origin,'timeZone',s.time_zone);
end;$$;

create or replace function public.fail_league_sync(p_token uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid;sid uuid;begin
 update private.league_runs set state='failed',finished_at=now() where token=p_token and state='running' returning club_id,season_id into c,sid;
 update private.league_sources set last_error='LeagueApps could not be refreshed. Showing the last successful update.' where club_id=c and season_id=sid;
end;$$;

create or replace function public.apply_league_sync(p_token uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.league_runs;src private.league_sources;g jsonb;link private.league_games;m public.matches;r public.match_results;
 mid uuid;review boolean;changed boolean;result_changed boolean;score jsonb;conflicts int:=0;begin
 select * into strict job from private.league_runs where token=p_token for update;
 if job.state<>'running' or job.requested_at<now()-interval '10 minutes' then raise exception 'Expired sync job' using errcode='42501';end if;
 select * into strict src from private.league_sources where club_id=job.club_id and season_id=job.season_id for update;
 if not src.enabled or p_snapshot->>'programId' is distinct from src.program_id or p_snapshot->>'teamId' is distinct from src.team_id then raise exception 'Source mismatch';end if;
 if jsonb_typeof(p_snapshot->'games') is distinct from 'array' or jsonb_array_length(p_snapshot->'games') not between 1 and 200 or jsonb_typeof(p_snapshot->'standings') is distinct from 'array' or jsonb_array_length(p_snapshot->'standings') not between 2 and 100 then raise exception 'Incomplete snapshot';end if;
 if not exists(select 1 from jsonb_array_elements(p_snapshot->'standings') s where s->>'teamId'=src.team_id) then raise exception 'Team missing from standings';end if;
 if (select count(*)<>count(distinct value->>'externalId') from jsonb_array_elements(p_snapshot->'games')) then raise exception 'Duplicate external ID';end if;
 for g in select value from jsonb_array_elements(p_snapshot->'games') loop
  if coalesce(g->>'externalId','')!~'^[0-9]+$' or coalesce(g->>'status','') not in ('scheduled','completed','postponed','cancelled') then raise exception 'Invalid game';end if;
  select * into link from private.league_games where club_id=src.club_id and season_id=src.season_id and external_id=g->>'externalId';
  if found then
   mid:=link.match_id;
   select * into strict m from public.matches where id=mid for update;
  else
   insert into public.matches(club_id,season_id,opponent,opponent_code,kickoff,venue,round,home,status)
   values(src.club_id,src.season_id,g->>'opponent',g->>'opponentCode',(g->>'kickoff')::timestamptz,g->>'venue',(g->>'round')::int,(g->>'home')::boolean,g->>'status') returning * into m;
   mid:=m.id;
   insert into private.league_games(club_id,season_id,external_id,match_id,snapshot) values(src.club_id,src.season_id,g->>'externalId',mid,g);
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
 update private.league_sources set standings=p_snapshot->'standings',last_success=now(),last_error=null where club_id=src.club_id and season_id=src.season_id;
 update private.league_runs set state='succeeded',finished_at=now(),summary=jsonb_build_object('games',jsonb_array_length(p_snapshot->'games'),'teams',jsonb_array_length(p_snapshot->'standings'),'conflicts',conflicts) where token=p_token;
 return jsonb_build_object('games',jsonb_array_length(p_snapshot->'games'),'conflicts',conflicts);
end;$$;

create or replace function private.league_club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb;src private.league_sources;begin
 data:=public.club_snapshot(p_club_id,p_private);
 data:=jsonb_set(data,'{matches}',coalesce((select jsonb_agg(a.value || case when l.match_id is null then '{}'::jsonb else jsonb_build_object('source','leagueapps','externalId',l.external_id,'fixtureOverride',m.league_fixture_override,'resultSource',case when r.editor_id is null then 'leagueapps' else 'captain' end) || case when p_private then jsonb_build_object('leagueScore',l.snapshot->'score','needsReview',l.needs_review) else '{}'::jsonb end end order by (a.value->>'round')::int) from jsonb_array_elements(data->'matches') a left join private.league_games l on l.match_id=(a.value->>'id')::uuid left join public.matches m on m.id=l.match_id left join public.match_results r on r.match_id=l.match_id),'[]'::jsonb));
 return data || jsonb_build_object('leagues',coalesce((select jsonb_agg(private.season_connection(id) order by year desc nulls last,case term when 'Fall' then 4 when 'Summer' then 3 when 'Spring' then 2 else 1 end desc,name,id) filter(where private.season_connection(id) is not null) from public.seasons where club_id=p_club_id),'[]'::jsonb),
 'league',(select private.season_connection(id) from public.seasons where club_id=p_club_id and private.season_connection(id) is not null order by year desc nulls last,case term when 'Fall' then 4 when 'Summer' then 3 when 'Spring' then 2 else 1 end desc,name,id limit 1));
end;$$;

create or replace function private.removed_feed_fixtures(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round,
  'source',m.feed_source,'removedAt',m.removed_at,'feedAvailable',case when m.feed_source='leagueapps' then coalesce(g.last_seen>=src.last_success,false) end
 ) || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'basis',r.basis,'decision',r.decision,'penaltyOutcome',r.penalty_outcome,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'stats','[]'::jsonb)) else '{}'::jsonb end order by m.removed_at desc,m.id)
 from public.matches m left join public.match_results r on r.match_id=m.id left join private.league_games g on g.match_id=m.id left join private.league_sources src on src.club_id=g.club_id and src.season_id=g.season_id
 where m.club_id=p_club_id and m.removed_at is not null and m.feed_source is not null),'[]'::jsonb);
end;$$;

create or replace function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format,'completed',s.completed,'completedAt',s.completed_at,'finalPosition',case when s.completed and s.manual_standings then (select (v->>'position')::integer from jsonb_array_elements(private.manual_standings(s.id)) v join private.season_teams t on t.id=(v->>'teamId')::uuid where t.is_ours and (v->>'played')::integer>0) else s.final_position end,'revision',s.completion_revision,'year',s.year,'term',s.term,'teamName',s.team_name,'location',s.location,'leagueWebsite',s.league_website,'timeZone',s.source_timezone,'manualStandings',s.manual_standings,'settingsRevision',s.settings_revision,'source',case when exists(select 1 from private.league_sources ls where ls.season_id=s.id) then 'leagueapps' else 'manual' end,'leagueTeams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'isOurs',t.is_ours) order by t.is_ours desc,t.name) from private.season_teams t where t.season_id=s.id),'[]'::jsonb)) order by s.year desc nulls last,case s.term when 'Fall' then 4 when 'Summer' then 3 when 'Spring' then 2 else 1 end desc,s.name,s.id) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',sr.season_id,'playerId',sr.player_id)) from public.season_roster sr join public.players p on p.id=sr.player_id where sr.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round) || case when m.feed_source is not null then jsonb_build_object('source',m.feed_source) else '{}'::jsonb end || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'decision',r.decision,'penaltyOutcome',r.penalty_outcome,'basis',r.basis,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'updatedAt',r.updated_at,'stats',coalesce((select jsonb_agg(jsonb_build_object('playerId',ps.player_id,'appeared',ps.appeared,'goals',ps.goals,'assists',ps.assists)) from public.match_player_stats ps join public.players p on p.id=ps.player_id where ps.match_id=m.id and (p_private or p.is_public)),'[]'::jsonb))) else '{}'::jsonb end order by m.round) from public.matches m left join public.match_results r on r.match_id=m.id where m.club_id=p_club_id and m.removed_at is null),'[]'::jsonb)
 ) into response;
 return response;
end;$$;

create or replace function private.set_season_complete(p_season_id uuid,p_expected_revision integer,p_completed boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.seasons;position integer;begin
 select * into strict s from public.seasons where id=p_season_id for update;
 if not public.is_captain(s.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if s.completion_revision is distinct from p_expected_revision then raise exception 'Season changed; reload before saving' using errcode='40001';end if;
 if p_completed is null then raise exception 'Choose a season status';end if;
 if s.completed=p_completed then return;end if;
 if p_completed and s.manual_standings then
  select (v->>'position')::integer into position from jsonb_array_elements(private.manual_standings(s.id)) v join private.season_teams t on t.id=(v->>'teamId')::uuid where t.is_ours and (v->>'played')::integer>0;
 elsif p_completed then
  select (row.value->>'position')::integer into position from private.league_sources src cross join lateral jsonb_array_elements(src.standings) row(value)
  where src.club_id=s.club_id and src.season_id=s.id and row.value->>'teamId'=src.team_id and row.value->>'position' ~ '^[1-9][0-9]*$' limit 1;
 end if;
 update public.seasons set completed=p_completed,completed_at=case when p_completed then now() end,final_position=position,completion_revision=completion_revision+1 where id=s.id;
end;$$;

create function private.stage_season_import(p_club_id uuid,p_user_id uuid,p_config jsonb,p_snapshot jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare preview_id uuid;begin
 if not exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=p_user_id and role='captain') then raise exception 'Captain access required' using errcode='42501';end if;
 if coalesce(p_config->>'origin','')!~'^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?\.leagueapps\.com$' or coalesce(p_config->>'programId','')!~'^[0-9]+$' or coalesce(p_config->>'teamId','')!~'^[0-9]+$' or not exists(select 1 from pg_timezone_names where name=p_config->>'timeZone') then raise exception 'Invalid LeagueApps source';end if;
 if p_snapshot->>'programId' is distinct from p_config->>'programId' or p_snapshot->>'teamId' is distinct from p_config->>'teamId' or jsonb_typeof(p_snapshot->'games') is distinct from 'array' or jsonb_typeof(p_snapshot->'standings') is distinct from 'array' then raise exception 'Invalid preview';end if;
 if jsonb_array_length(p_snapshot->'games') not between 1 and 200 or jsonb_array_length(p_snapshot->'standings') not between 2 and 100 or not exists(select 1 from jsonb_array_elements(p_snapshot->'standings') v where v->>'teamId'=p_config->>'teamId') then raise exception 'Incomplete preview';end if;
 delete from private.season_import_previews where expires_at<now()-interval '1 day';
 insert into private.season_import_previews(club_id,created_by,config,snapshot) values(p_club_id,p_user_id,p_config,p_snapshot) returning id into preview_id;
 return preview_id;
end;$$;
revoke all on function private.stage_season_import(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.stage_season_import(uuid,uuid,jsonb,jsonb) to service_role;
create function public.stage_season_import(p_club_id uuid,p_user_id uuid,p_config jsonb,p_snapshot jsonb) returns uuid language sql security invoker set search_path='' as $$select private.stage_season_import(p_club_id,p_user_id,p_config,p_snapshot);$$;
revoke all on function public.stage_season_import(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stage_season_import(uuid,uuid,jsonb,jsonb) to service_role;

create function private.create_club_season(p_club_id uuid,p_input jsonb,p_preview_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid:=(p_input->>'id')::uuid;fingerprint text:=md5(p_input::text||coalesce(p_preview_id::text,''));existing public.seasons;pv private.season_import_previews;team text;opponent text;player uuid;job uuid;is_manual boolean;begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if sid is null then raise exception 'Missing season request ID';end if;
 if octet_length(p_input::text)>50000 or length(coalesce(p_input->>'name',''))>150 then raise exception 'Season details are too long';end if;
 select * into existing from public.seasons where id=sid for update;
 if found then
  if existing.club_id=p_club_id and existing.creation_hash=fingerprint then return sid;end if;
  raise exception 'This season request already exists. Reload seasons.';
 end if;
 if coalesce(p_input->>'source','') not in ('manual','leagueapps') or coalesce(p_input->>'term','') not in ('Winter','Spring','Summer','Fall') or (p_input->>'year')::integer not between 1900 and 2100 then raise exception 'Choose a season, year and source';end if;
 if p_input->>'year' is null then raise exception 'Enter the season year';end if;
 if length(btrim(coalesce(p_input->>'competition',''))) not between 1 and 150 or length(btrim(coalesce(p_input->>'location',''))) not between 1 and 150 then raise exception 'Enter the league name and location';end if;
 if length(coalesce(p_input->>'leagueWebsite',''))>500 or (coalesce(p_input->>'leagueWebsite','')<>'' and p_input->>'leagueWebsite'!~'^https?://[^/[:space:]@]+(/[^[:space:]]*)?$') then raise exception 'Enter a valid league website URL';end if;
 if not exists(select 1 from pg_timezone_names where name=p_input->>'timeZone') then raise exception 'Choose a valid league time zone';end if;
 if coalesce(p_input->>'format','') not in ('5v5','6v6','7v7','8v8','9v9','11v11') then raise exception 'Choose a playing format';end if;
 if jsonb_typeof(p_input->'rosterPlayerIds') is distinct from 'array' or jsonb_array_length(p_input->'rosterPlayerIds')>200 then raise exception 'Choose roster players';end if;
 for player in select distinct value::uuid from jsonb_array_elements_text(p_input->'rosterPlayerIds') loop
  if not exists(select 1 from public.players where id=player and club_id=p_club_id) then raise exception 'A roster player does not belong to this club' using errcode='42501';end if;
 end loop;
 is_manual:=p_input->>'source'='manual';team:=btrim(coalesce(p_input->>'teamName',''));
 if not is_manual then
  select * into pv from private.season_import_previews where id=p_preview_id and club_id=p_club_id and created_by=auth.uid() for update;
  if not found or pv.expires_at<now() or pv.consumed_by is not null then raise exception 'Import preview expired or was already used. Preview the source again.';end if;
  if pv.config->>'timeZone' is distinct from p_input->>'timeZone' then raise exception 'Time zone changed. Preview the source again.';end if;
  if exists(select 1 from private.league_sources where club_id=p_club_id and origin=pv.config->>'origin' and program_id=pv.config->>'programId' and team_id=pv.config->>'teamId') then raise exception 'This LeagueApps team is already linked to a season';end if;
  if team='' then select v->>'name' into team from jsonb_array_elements(pv.snapshot->'standings') v where v->>'teamId'=pv.config->>'teamId';end if;
 elsif p_preview_id is not null then raise exception 'Manual seasons do not use a LeagueApps preview';end if;
 if length(team) not between 1 and 100 then raise exception 'Enter this season’s team name';end if;
 if is_manual and (jsonb_typeof(p_input->'teams') is distinct from 'array' or jsonb_array_length(p_input->'teams')>99) then raise exception 'Enter league team names';end if;
 insert into public.seasons(id,club_id,name,competition,format,year,term,team_name,location,league_website,source_timezone,manual_standings,creation_hash)
 values(sid,p_club_id,coalesce(nullif(btrim(p_input->>'name'),''),(p_input->>'term')||' '||(p_input->>'year')||' · '||btrim(p_input->>'competition')),btrim(p_input->>'competition'),p_input->>'format',(p_input->>'year')::integer,p_input->>'term',team,btrim(p_input->>'location'),coalesce(p_input->>'leagueWebsite',''),p_input->>'timeZone',is_manual and coalesce((p_input->>'manualStandings')::boolean,false),fingerprint);
 if is_manual then
  insert into private.season_teams(club_id,season_id,name,is_ours) values(p_club_id,sid,team,true);
  for opponent in select btrim(value) from jsonb_array_elements_text(p_input->'teams') loop
   if length(opponent) not between 1 and 100 then raise exception 'Each league team needs a name of 100 characters or fewer';end if;
   if exists(select 1 from private.season_teams where season_id=sid and lower(btrim(name))=lower(opponent)) then raise exception 'League team names must be distinct, including our team';end if;
   insert into private.season_teams(club_id,season_id,name) values(p_club_id,sid,opponent);
  end loop;
  if coalesce((p_input->>'manualStandings')::boolean,false) and jsonb_array_length(p_input->'teams')<1 then raise exception 'Add at least one other league team to construct standings';end if;
 else
  insert into private.league_sources(club_id,season_id,program_id,team_id,team_name,origin,time_zone) values(p_club_id,sid,pv.config->>'programId',pv.config->>'teamId',(select v->>'name' from jsonb_array_elements(pv.snapshot->'standings') v where v->>'teamId'=pv.config->>'teamId'),pv.config->>'origin',pv.config->>'timeZone');
  insert into private.league_runs(club_id,season_id,state,started_at) values(p_club_id,sid,'running',now()) returning token into job;
  perform public.apply_league_sync(job,pv.snapshot);
  update private.season_import_previews set consumed_by=sid where id=pv.id;
 end if;
 insert into public.season_roster(club_id,season_id,player_id) select p_club_id,sid,value::uuid from (select distinct value from jsonb_array_elements_text(p_input->'rosterPlayerIds')) players;
 if coalesce((p_input->>'completed')::boolean,false) then perform private.set_season_complete(sid,0,true);end if;
 return sid;
end;$$;
revoke all on function private.create_club_season(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.create_club_season(uuid,jsonb,uuid) to authenticated;
create function public.create_club_season(p_club_id uuid,p_input jsonb,p_preview_id uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.create_club_season(p_club_id,p_input,p_preview_id);$$;
revoke all on function public.create_club_season(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_club_season(uuid,jsonb,uuid) to authenticated;

create function private.configure_manual_standings(p_season_id uuid,p_expected_revision integer,p_enabled boolean,p_team_names jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.seasons;team text;begin
 select * into strict s from public.seasons where id=p_season_id for update;
 if not public.is_captain(s.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if s.settings_revision is distinct from p_expected_revision then raise exception 'Season settings changed. Reload before saving.' using errcode='40001';end if;
 if exists(select 1 from private.league_sources where season_id=s.id) then raise exception 'LeagueApps standings are managed by the feed';end if;
 if p_enabled is null or jsonb_typeof(p_team_names) is distinct from 'array' or jsonb_array_length(p_team_names)>99 then raise exception 'Enter valid team names';end if;
 insert into private.season_teams(club_id,season_id,name,is_ours) values(s.club_id,s.id,s.team_name,true) on conflict do nothing;
 for team in select btrim(value) from jsonb_array_elements_text(p_team_names) loop
  if length(team) not between 1 and 100 then raise exception 'Each team name must contain 1 to 100 characters';end if;
  if lower(team)=lower(btrim(s.team_name)) then raise exception 'Our team is already included';end if;
  if not exists(select 1 from private.season_teams where season_id=s.id and lower(btrim(name))=lower(team)) then insert into private.season_teams(club_id,season_id,name) values(s.club_id,s.id,team);end if;
 end loop;
 if (select count(*) from private.season_teams where season_id=s.id)>100 then raise exception 'A season supports up to 100 league teams';end if;
 if p_enabled and (select count(*) from private.season_teams where season_id=s.id)<2 then raise exception 'Add the other league teams before enabling standings';end if;
 update public.seasons set manual_standings=p_enabled,settings_revision=settings_revision+1 where id=s.id;
end;$$;
revoke all on function private.configure_manual_standings(uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function private.configure_manual_standings(uuid,integer,boolean,jsonb) to authenticated;
create function public.configure_manual_standings(p_season_id uuid,p_expected_revision integer,p_enabled boolean,p_team_names jsonb) returns void language sql security invoker set search_path='' as $$select private.configure_manual_standings(p_season_id,p_expected_revision,p_enabled,p_team_names);$$;
revoke all on function public.configure_manual_standings(uuid,integer,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.configure_manual_standings(uuid,integer,boolean,jsonb) to authenticated;

create function private.manual_league_results(p_season_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c uuid;begin
 select club_id into c from public.seasons where id=p_season_id;
 if c is null or not public.is_captain(c) then raise exception 'Captain access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'seasonId',season_id,'homeTeamId',home_team_id,'awayTeamId',away_team_id,'home',home,'away',away,'playedOn',played_on,'decision',decision,'penaltyOutcome',penalty_outcome,'revision',revision) order by played_on desc nulls last,id) from private.manual_league_results where season_id=p_season_id),'[]'::jsonb);
end;$$;
revoke all on function private.manual_league_results(uuid) from public,anon,authenticated;
grant execute on function private.manual_league_results(uuid) to authenticated;
create function public.get_manual_league_results(p_season_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.manual_league_results(p_season_id);$$;
revoke all on function public.get_manual_league_results(uuid) from public,anon,authenticated;
grant execute on function public.get_manual_league_results(uuid) to authenticated;

create function private.write_manual_league_result(p_season_id uuid,p_expected_revision integer,p_result jsonb,p_remove boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.seasons;r private.manual_league_results;rid uuid:=(p_result->>'id')::uuid;h uuid:=(p_result->>'homeTeamId')::uuid;a uuid:=(p_result->>'awayTeamId')::uuid;begin
 select * into strict s from public.seasons where id=p_season_id for update;
 if not public.is_captain(s.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if exists(select 1 from private.league_sources where season_id=s.id) then raise exception 'Use the LeagueApps standings for this season';end if;
 select * into r from private.manual_league_results where id=rid for update;
 if found and (r.season_id<>s.id or r.club_id<>s.club_id) then raise exception 'Season mismatch' using errcode='42501';end if;
 if p_expected_revision is null or coalesce(r.revision,0)<>p_expected_revision then raise exception 'League result changed. Reload before saving.' using errcode='40001';end if;
 if p_remove then
  if r.id is null then raise exception 'League result was already removed';end if;
  delete from private.manual_league_results where id=r.id;return rid;
 end if;
 if not s.manual_standings then raise exception 'Enable manual standings before adding league results';end if;
 if rid is null or h is null or a is null or h=a then raise exception 'Choose two different league teams';end if;
 if (select count(*) from private.season_teams where season_id=s.id and id in (h,a) and not is_ours)<>2 then raise exception 'Choose two other teams from this season. Enter our team’s games through Fixtures and Results.';end if;
 insert into private.manual_league_results(id,club_id,season_id,home_team_id,away_team_id,home,away,played_on,decision,penalty_outcome,revision)
 values(rid,s.club_id,s.id,h,a,(p_result->>'home')::integer,(p_result->>'away')::integer,nullif(p_result->>'playedOn','')::date,coalesce(p_result->>'decision','regulation'),nullif(p_result->>'penaltyOutcome',''),coalesce(r.revision,0)+1)
 on conflict(id) do update set home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,home=excluded.home,away=excluded.away,played_on=excluded.played_on,decision=excluded.decision,penalty_outcome=excluded.penalty_outcome,revision=excluded.revision,updated_at=now();
 return rid;
end;$$;
revoke all on function private.write_manual_league_result(uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.write_manual_league_result(uuid,integer,jsonb,boolean) to authenticated;
create function public.write_manual_league_result(p_season_id uuid,p_expected_revision integer,p_result jsonb,p_remove boolean default false) returns uuid language sql security invoker set search_path='' as $$select private.write_manual_league_result(p_season_id,p_expected_revision,p_result,p_remove);$$;
revoke all on function public.write_manual_league_result(uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.write_manual_league_result(uuid,integer,jsonb,boolean) to authenticated;

create function private.dispatch_league_sync(p_club_id uuid,p_season_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare capability uuid;begin
 perform 1 from private.league_sources where club_id=p_club_id and season_id=p_season_id and enabled for update;
 if not found then raise exception 'League source is not configured for this season';end if;
 if exists(select 1 from private.league_runs where club_id=p_club_id and season_id=p_season_id and requested_at>now()-interval '5 minutes') then return;end if;
 update private.league_runs set state='failed',finished_at=now() where club_id=p_club_id and season_id=p_season_id and state in ('queued','running') and requested_at<now()-interval '10 minutes';
 if exists(select 1 from private.league_runs where club_id=p_club_id and season_id=p_season_id and state in ('queued','running')) then return;end if;
 insert into private.league_runs(club_id,season_id) values(p_club_id,p_season_id) returning token into capability;
 update private.league_sources set last_attempt=now() where club_id=p_club_id and season_id=p_season_id;
 perform net.http_post(url:='https://maupvkabgveqvwkivtyh.supabase.co/functions/v1/leagueapps-sync',body:=jsonb_build_object('token',capability),headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=60000);
 delete from private.league_runs where club_id=p_club_id and season_id=p_season_id and requested_at<now()-interval '30 days';
end;$$;
revoke all on function private.dispatch_league_sync(uuid,uuid) from public,anon,authenticated;
create or replace function private.dispatch_league_sync(p_club_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 if (select count(*) from private.league_sources where club_id=p_club_id and enabled)<>1 then raise exception 'Choose a season to refresh';end if;
 select season_id into sid from private.league_sources where club_id=p_club_id and enabled;
 perform private.dispatch_league_sync(p_club_id,sid);
end;$$;
revoke all on function private.dispatch_league_sync(uuid) from public,anon,authenticated;
create function private.request_season_sync(p_club_id uuid,p_season_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform private.dispatch_league_sync(p_club_id,p_season_id);
end;$$;
revoke all on function private.request_season_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function private.request_season_sync(uuid,uuid) to authenticated;
create function public.request_league_sync(p_club_id uuid,p_season_id uuid) returns void language sql security invoker set search_path='' as $$select private.request_season_sync(p_club_id,p_season_id);$$;
revoke all on function public.request_league_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_league_sync(uuid,uuid) to authenticated;
