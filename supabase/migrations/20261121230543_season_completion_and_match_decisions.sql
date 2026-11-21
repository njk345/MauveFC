set local lock_timeout='5s';
set local statement_timeout='30s';
-- Fail rather than replace unexpected intervening changes to these workflows.
do $$begin
 if (select md5(prosrc) from pg_proc where oid='public.save_match_result(uuid,integer,jsonb)'::regprocedure)<>'697ca75f598011df60511fc705d2b284'
 or (select md5(prosrc) from pg_proc where oid='public.validate_result_payload(uuid,jsonb,boolean)'::regprocedure)<>'4944c8c41324d66ee322d4e66822faa9'
 or (select md5(prosrc) from pg_proc where oid='public.club_snapshot(uuid,boolean)'::regprocedure)<>'d3ae7a6a13ee4c8d175005064d2f7a7b'
 then raise exception 'Result workflow changed; review before adding match decisions';end if;
end;$$;

alter table public.match_results
 add column decision text not null default 'regulation' check(decision in ('regulation','overtime','penalties')),
 add column penalty_outcome text,
 add constraint match_decision_valid check(
   (decision='penalties' and penalty_outcome is not null and penalty_outcome in ('W','L') and home=away and on_field_home=on_field_away and basis='played')
   or (decision<>'penalties' and penalty_outcome is null and (decision='regulation' or basis='played'))
 );
comment on column public.match_results.decision is 'Match duration/decider. Official goals include overtime and exclude shootout kicks.';
grant select(decision,penalty_outcome) on public.match_results to anon,authenticated;

alter table public.seasons
 add column completed boolean not null default false,
 add column completed_at timestamptz,
 add column final_position integer check(final_position>0),
 add column completion_revision integer not null default 0 check(completion_revision>=0),
 add constraint season_completion_valid check((completed and completed_at is not null) or (not completed and completed_at is null and final_position is null));
comment on column public.seasons.final_position is 'LeagueApps placing captured when a captain completes the season; does not change on later imports.';

-- Privileged work stays in the unexposed schema, behind a membership check.
create function private.set_season_complete(p_season_id uuid,p_expected_revision integer,p_completed boolean) returns void language plpgsql security definer set search_path='' as $$
declare s public.seasons;position integer;begin
 select * into strict s from public.seasons where id=p_season_id for update;
 if not public.is_captain(s.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if s.completion_revision is distinct from p_expected_revision then raise exception 'Season changed; reload before saving' using errcode='40001';end if;
 if p_completed is null then raise exception 'Choose a season status';end if;
 if s.completed=p_completed then return;end if;
 if p_completed then
  select (row.value->>'position')::integer into position from private.league_sources src cross join lateral jsonb_array_elements(src.standings) row(value)
  where src.club_id=s.club_id and src.season_id=s.id and row.value->>'teamId'=src.team_id and row.value->>'position' ~ '^[1-9][0-9]*$' limit 1;
 end if;
 update public.seasons set completed=p_completed,completed_at=case when p_completed then now() end,final_position=position,completion_revision=completion_revision+1 where id=s.id;
end;$$;
revoke all on function private.set_season_complete(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function private.set_season_complete(uuid,integer,boolean) to authenticated;
create function public.set_season_complete(p_season_id uuid,p_expected_revision integer,p_completed boolean) returns void language sql security invoker set search_path='' as $$select private.set_season_complete(p_season_id,p_expected_revision,p_completed);$$;
revoke all on function public.set_season_complete(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.set_season_complete(uuid,integer,boolean) to authenticated;

create or replace function public.validate_result_payload(p_match_id uuid,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches; s jsonb; field text; total integer:=0;begin
 select * into strict m from public.matches where id=p_match_id;
 if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'stats') is distinct from 'array' or jsonb_array_length(p_payload->'stats')>200 then raise exception 'Invalid result payload';end if;
 foreach field in array array['home','away','onFieldHome','onFieldAway','ownGoals'] loop
  if jsonb_typeof(p_payload->field) is distinct from 'number' or (p_payload->>field)!~'^(0|[1-9][0-9]?)$' then raise exception 'Scores must be whole numbers from 0 to 99';end if;
 end loop;
 if coalesce(p_payload->>'basis','') not in ('played','forfeit','adjusted') or coalesce(p_payload->>'attendance','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'scorers','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'assists','') not in ('unrecorded','partial','complete') or jsonb_typeof(p_payload->'published') is distinct from 'boolean' or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(p_payload->>'reason')>500 then raise exception 'Invalid result fields';end if;

 if (p_payload ? 'decision' and jsonb_typeof(p_payload->'decision') is distinct from 'string') or coalesce(p_payload->>'decision','regulation') not in ('regulation','overtime','penalties') then raise exception 'Invalid match decision';end if;
 if p_payload->'penaltyOutcome' is not null and p_payload->'penaltyOutcome'<>'null'::jsonb and (jsonb_typeof(p_payload->'penaltyOutcome') is distinct from 'string' or p_payload->>'penaltyOutcome' not in ('W','L')) then raise exception 'Penalties must end in a win or loss';end if;
 if coalesce(p_payload->>'decision','regulation')<>'penalties' and nullif(p_payload->'penaltyOutcome','null'::jsonb) is not null then raise exception 'Only penalties can have a penalty result';end if;
 if p_publish then
  if coalesce(p_payload->>'decision','regulation')<>'regulation' and p_payload->>'basis'<>'played' then raise exception 'Overtime and penalties apply to played games';end if;
  if p_payload->>'decision'='penalties' and (coalesce(p_payload->>'penaltyOutcome','') not in ('W','L') or (p_payload->>'home')::int<>(p_payload->>'away')::int or (p_payload->>'onFieldHome')::int<>(p_payload->>'onFieldAway')::int) then raise exception 'Choose a penalty win or loss and enter the tied match score before the shootout';end if;
 end if;
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

create or replace function public.save_match_result(p_match_id uuid,p_expected_revision integer,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;current_result public.match_results; before_snapshot jsonb; publish boolean;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if m.revision is distinct from p_expected_revision then raise exception 'Match changed; reload before saving' using errcode='40001';end if;
 -- Older clients may edit player stats without knowing about match decisions.
 select * into current_result from public.match_results where match_id=m.id;
 if not p_payload ? 'decision' then p_payload:=p_payload||jsonb_build_object('decision',coalesce(current_result.decision,'regulation'));end if;
 if not p_payload ? 'penaltyOutcome' then p_payload:=p_payload||jsonb_build_object('penaltyOutcome',case when p_payload->>'decision'='penalties' then current_result.penalty_outcome end);end if;
 publish:=coalesce((p_payload->>'published')::boolean,false);
 perform public.validate_result_payload(p_match_id,p_payload,publish);
 if not publish then
  insert into public.match_drafts(club_id,match_id,editor_id,payload,base_revision) values(m.club_id,m.id,auth.uid(),p_payload,m.revision)
  on conflict(match_id,editor_id) do update set payload=excluded.payload,base_revision=excluded.base_revision,updated_at=now();return;
 end if;
 select jsonb_build_object('result',to_jsonb(r),'stats',coalesce((select jsonb_agg(to_jsonb(ps)) from public.match_player_stats ps where ps.match_id=m.id),'[]'::jsonb)) into before_snapshot from public.match_results r where r.match_id=m.id;
 insert into public.match_results(match_id,club_id,home,away,on_field_home,on_field_away,basis,reason,attendance,scorers,assists,own_goals,published,editor_id,decision,penalty_outcome)
 values(m.id,m.club_id,(p_payload->>'home')::int,(p_payload->>'away')::int,(p_payload->>'onFieldHome')::int,(p_payload->>'onFieldAway')::int,p_payload->>'basis',p_payload->>'reason',p_payload->>'attendance',p_payload->>'scorers',p_payload->>'assists',(p_payload->>'ownGoals')::int,true,auth.uid(),p_payload->>'decision',p_payload->>'penaltyOutcome')
 on conflict(match_id) do update set home=excluded.home,away=excluded.away,on_field_home=excluded.on_field_home,on_field_away=excluded.on_field_away,basis=excluded.basis,reason=excluded.reason,attendance=excluded.attendance,scorers=excluded.scorers,assists=excluded.assists,own_goals=excluded.own_goals,published=true,editor_id=auth.uid(),decision=excluded.decision,penalty_outcome=excluded.penalty_outcome,updated_at=now();
 delete from public.match_player_stats where match_id=m.id;
 insert into public.match_player_stats(club_id,match_id,player_id,appeared,goals,assists)
 select m.club_id,m.id,(s->>'playerId')::uuid,(s->>'appeared')::boolean,(s->>'goals')::integer,(s->>'assists')::integer from jsonb_array_elements(p_payload->'stats') s;
 update public.matches set status='completed',revision=revision+1 where id=m.id;
 insert into public.result_history(club_id,match_id,editor_id,before_value,after_value) values(m.club_id,m.id,auth.uid(),before_snapshot,p_payload);
 delete from public.match_drafts where match_id=m.id and editor_id=auth.uid();
end;$$;

create or replace function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format,'completed',s.completed,'completedAt',s.completed_at,'finalPosition',s.final_position,'revision',s.completion_revision) order by s.name desc) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',sr.season_id,'playerId',sr.player_id)) from public.season_roster sr join public.players p on p.id=sr.player_id where sr.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round) || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'decision',r.decision,'penaltyOutcome',r.penalty_outcome,'basis',r.basis,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'updatedAt',r.updated_at,'stats',coalesce((select jsonb_agg(jsonb_build_object('playerId',ps.player_id,'appeared',ps.appeared,'goals',ps.goals,'assists',ps.assists)) from public.match_player_stats ps join public.players p on p.id=ps.player_id where ps.match_id=m.id and (p_private or p.is_public)),'[]'::jsonb))) else '{}'::jsonb end order by m.round) from public.matches m left join public.match_results r on r.match_id=m.id where m.club_id=p_club_id),'[]'::jsonb)
 ) into response;
 return response;
end;$$;

-- Home's regular-season record uses the decider for W/D/L, never shootout goals.
create or replace view public.public_season_totals with(security_invoker=true) as
 select club_id,season_id,count(*)::int played,count(*) filter(where outcome='W')::int wins,count(*) filter(where outcome='D')::int draws,count(*) filter(where outcome='L')::int losses,sum(home)::int goals_for,sum(away)::int goals_against,sum(case when outcome='W' then 3 when outcome='D' then 1 else 0 end)::int points
 from (select m.club_id,m.season_id,r.home,r.away,case when r.decision='penalties' then r.penalty_outcome when r.home>r.away then 'W' when r.home<r.away then 'L' else 'D' end as outcome
 from public.matches m join public.match_results r on r.match_id=m.id where r.published and m.status='completed' and m.playoff_round is null) played_results group by club_id,season_id;
