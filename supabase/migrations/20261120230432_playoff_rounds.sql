set local lock_timeout='5s';
set local statement_timeout='30s';
-- Preserve any unexpected intervening changes to the existing write/projection.
do $$begin
  if (select md5(prosrc) from pg_proc where oid='public.save_fixture(uuid,jsonb)'::regprocedure)<>'d46c1eb75a4dbcc101f0c95f924b0cef'
    or (select md5(prosrc) from pg_proc where oid='public.club_snapshot(uuid,boolean)'::regprocedure)<>'b35e93e6f6df6121a1509c520980d8ed'
  then raise exception 'Fixture handling changed; review before adding playoff rounds';end if;
end;$$;
alter table public.matches add column playoff_round text
  check(playoff_round in ('playoffs','quarterfinals','semifinals','finals'));
comment on column public.matches.playoff_round is 'Captain-managed classification. NULL is regular season; LeagueApps imports never overwrite it.';
-- The existing invoker view must be able to read this public classification.
grant select(playoff_round) on public.matches to anon,authenticated;
create or replace view public.public_season_totals with(security_invoker=true) as
 select m.club_id,m.season_id,count(*)::int played,count(*) filter(where r.home>r.away)::int wins,count(*) filter(where r.home=r.away)::int draws,count(*) filter(where r.home<r.away)::int losses,sum(r.home)::int goals_for,sum(r.away)::int goals_against,sum(case when r.home>r.away then 3 when r.home=r.away then 1 else 0 end)::int points
 from public.matches m join public.match_results r on r.match_id=m.id where r.published and m.status='completed' and m.playoff_round is null group by m.club_id,m.season_id;

create or replace function public.save_fixture(p_club_id uuid,p_fixture jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare fixture_id uuid:=coalesce(nullif(p_fixture->>'id','')::uuid,gen_random_uuid());current_match public.matches;begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if coalesce(p_fixture->>'status','') not in ('scheduled','postponed','cancelled','completed') then raise exception 'Invalid fixture status';end if;
 if p_fixture ? 'playoffRound' and p_fixture->'playoffRound'<>'null'::jsonb and (jsonb_typeof(p_fixture->'playoffRound') is distinct from 'string' or p_fixture->>'playoffRound' not in ('playoffs','quarterfinals','semifinals','finals')) then raise exception 'Invalid playoff round';end if;
 select * into current_match from public.matches where id=fixture_id for update;
 if found then
  if current_match.club_id<>p_club_id then raise exception 'Club mismatch' using errcode='42501';end if;
  if current_match.revision<>coalesce((p_fixture->>'revision')::integer,-1) then raise exception 'Fixture changed' using errcode='40001';end if;
  if exists(select 1 from public.match_results where match_id=fixture_id and published) and (current_match.season_id<>(p_fixture->>'seasonId')::uuid or p_fixture->>'status'<>'completed') then raise exception 'A published result keeps its season and completed status';end if;
  update public.matches set opponent=btrim(p_fixture->>'opponent'),opponent_code=p_fixture->>'opponentCode',color=p_fixture->>'color',kickoff=nullif(p_fixture->>'kickoff','')::timestamptz,venue=btrim(p_fixture->>'venue'),round=(p_fixture->>'round')::integer,home=(p_fixture->>'home')::boolean,status=p_fixture->>'status',playoff_round=case when p_fixture ? 'playoffRound' then p_fixture->>'playoffRound' else current_match.playoff_round end,revision=revision+1 where id=fixture_id;
  -- A classification-only edit cannot change a saved result's score or roster.
  -- Rebase only the editing captain's current draft; others stay protected.
  if p_fixture ? 'playoffRound' and current_match.playoff_round is distinct from (p_fixture->>'playoffRound')
    and row(current_match.season_id,current_match.opponent,current_match.opponent_code,current_match.color,current_match.kickoff,current_match.venue,current_match.round,current_match.home,current_match.status)
      is not distinct from row((p_fixture->>'seasonId')::uuid,btrim(p_fixture->>'opponent'),p_fixture->>'opponentCode',p_fixture->>'color',nullif(p_fixture->>'kickoff','')::timestamptz,btrim(p_fixture->>'venue'),(p_fixture->>'round')::integer,(p_fixture->>'home')::boolean,p_fixture->>'status') then
    update public.match_drafts set base_revision=current_match.revision+1,payload=jsonb_set(payload,'{baseRevision}',to_jsonb(current_match.revision+1)),updated_at=now()
    where match_id=fixture_id and editor_id=auth.uid() and base_revision=current_match.revision;
  end if;
 else
  if p_fixture->>'status'='completed' then raise exception 'Publish a result to complete a new match';end if;
  insert into public.matches(id,club_id,season_id,opponent,opponent_code,color,kickoff,venue,round,home,status,playoff_round) values(fixture_id,p_club_id,(p_fixture->>'seasonId')::uuid,btrim(p_fixture->>'opponent'),p_fixture->>'opponentCode',p_fixture->>'color',nullif(p_fixture->>'kickoff','')::timestamptz,btrim(p_fixture->>'venue'),(p_fixture->>'round')::int,(p_fixture->>'home')::boolean,p_fixture->>'status',p_fixture->>'playoffRound');
 end if;
 return fixture_id;
end;$$;

create or replace function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format) order by s.name desc) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',sr.season_id,'playerId',sr.player_id)) from public.season_roster sr join public.players p on p.id=sr.player_id where sr.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round) || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'basis',r.basis,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'updatedAt',r.updated_at,'stats',coalesce((select jsonb_agg(jsonb_build_object('playerId',ps.player_id,'appeared',ps.appeared,'goals',ps.goals,'assists',ps.assists)) from public.match_player_stats ps join public.players p on p.id=ps.player_id where ps.match_id=m.id and (p_private or p.is_public)),'[]'::jsonb))) else '{}'::jsonb end order by m.round) from public.matches m left join public.match_results r on r.match_id=m.id where m.club_id=p_club_id),'[]'::jsonb)
 ) into response;
 return response;
end;$$;
