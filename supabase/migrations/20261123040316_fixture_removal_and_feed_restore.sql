set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='public.club_snapshot(uuid,boolean)'::regprocedure)<>'7f4c69ba3b2e46c1df758dc48fbaab16'
 or (select md5(prosrc) from pg_proc where oid='public.get_team_club(uuid)'::regprocedure)<>'5030d253664e22c7443aa58077b8a446'
 or (select md5(prosrc) from pg_proc where oid='private.season_stats(uuid,uuid)'::regprocedure)<>'00be17df2c6a5dd0c0988a241fa6d76a'
 or (select md5(prosrc) from pg_proc where oid='private.player_directory(uuid)'::regprocedure)<>'a084a3ec0dc74b6097fa3f91ee75357b'
 or (select md5(prosrc) from pg_proc where oid='public.get_captain_club(uuid)'::regprocedure)<>'d199b455f13a2d7b87c3fc2e8296eb04'
 or (select md5(prosrc) from pg_proc where oid='private.match_player_eligible(uuid,uuid)'::regprocedure)<>'c5bb17efb89253a7c888b17d1ef3f8a8'
 or (select md5(prosrc) from pg_proc where oid='private.get_lineup_posts(uuid)'::regprocedure)<>'d4372e1ac8efac7de499f53a5c213a97' then raise exception 'Fixture projections changed; review before adding removal';end if;
end;$$;

-- Visibility is independent of schedule status and source ownership. Retain
-- linked data so a feed fixture can be restored without losing captain work.
alter table public.matches
 add column removed_at timestamptz,
 add column removed_by uuid references auth.users(id) on delete set null,
 add column feed_source text check(feed_source ~ '^[a-z0-9][a-z0-9_-]{0,63}$');
comment on column public.matches.removed_at is 'Captain removal. Imports may refresh retained data but never clear this marker.';
comment on column public.matches.feed_source is 'Server-owned provider key for the generic removed-feed queue; future importers register their own key.';
update public.matches m set feed_source='leagueapps' where exists(select 1 from private.league_games g where g.match_id=m.id);
create function private.register_league_fixture_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.matches set feed_source='leagueapps' where id=new.match_id and feed_source is distinct from 'leagueapps';
 return new;
end;$$;
revoke all on function private.register_league_fixture_source() from public,anon,authenticated;
create trigger register_league_fixture_source after insert or update on private.league_games for each row execute function private.register_league_fixture_source();

-- Removed rows, results and public player stats are inaccessible even through
-- the existing column-restricted table API and invoker aggregate views.
grant select(removed_at) on public.matches to anon,authenticated;
alter policy public_fixture_stats_columns on public.matches using(removed_at is null);
alter policy published_result_stats_columns on public.match_results using(published and exists(select 1 from public.matches m where m.id=match_id and m.removed_at is null));

create function private.guard_removed_fixture_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and old.removed_at is not null and new.removed_at is not distinct from old.removed_at then
  raise exception 'This fixture was removed. Restore it before editing.' using errcode='40001';
 end if;
 return new;
end;$$;
revoke all on function private.guard_removed_fixture_edit() from public,anon,authenticated;
create trigger guard_removed_fixture_edit before update on public.matches for each row execute function private.guard_removed_fixture_edit();

-- Serialize all interactive child writes with removal. This also protects
-- stale clients and member actions. Server imports can refresh archived games.
create function private.guard_removed_match_data() returns trigger language plpgsql security definer set search_path='' as $$
declare mid uuid;removed timestamptz;begin
 if auth.uid() is not null then
  mid:=case when tg_op='DELETE' then old.match_id else new.match_id end;
  select removed_at into removed from public.matches where id=mid for update;
  if removed is not null then raise exception 'This fixture was removed. Restore it before editing.' using errcode='40001';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function private.guard_removed_match_data() from public,anon,authenticated;
create trigger guard_removed_match_data before insert or update or delete on public.match_results for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on public.match_player_stats for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on public.match_drafts for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on public.result_history for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on private.match_guests for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on private.match_rsvps for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on private.match_lineups for each row execute function private.guard_removed_match_data();
create trigger guard_removed_match_data before insert or update or delete on private.lineup_posts for each row execute function private.guard_removed_match_data();

create function private.set_fixture_removed(p_match_id uuid,p_expected_revision integer,p_removed boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if auth.uid() is null or not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if m.revision is distinct from p_expected_revision then raise exception 'Fixture changed; reload before removing or restoring' using errcode='40001';end if;
 if p_removed is null then raise exception 'Choose a removal action';end if;
 if not p_removed and m.feed_source is null then raise exception 'Only feed fixtures can be restored';end if;
 if (m.removed_at is not null)=p_removed then return;end if;
 -- Visibility-only changes preserve current saved drafts. Source changes while
 -- archived still leave genuinely stale drafts protected by revision checks.
 if p_removed then
  update public.match_drafts set base_revision=m.revision+1,payload=jsonb_set(payload,'{baseRevision}',to_jsonb(m.revision+1)),updated_at=now() where match_id=m.id and base_revision=m.revision;
 end if;
 update public.matches set removed_at=case when p_removed then now() end,removed_by=case when p_removed then auth.uid() end,revision=revision+1 where id=m.id;
 if not p_removed then
  update public.match_drafts set base_revision=m.revision+1,payload=jsonb_set(payload,'{baseRevision}',to_jsonb(m.revision+1)),updated_at=now() where match_id=m.id and base_revision=m.revision;
 end if;
end;$$;
revoke all on function private.set_fixture_removed(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function private.set_fixture_removed(uuid,integer,boolean) to authenticated;
create function public.set_fixture_removed(p_match_id uuid,p_expected_revision integer,p_removed boolean) returns void language sql security invoker set search_path='' as $$select private.set_fixture_removed(p_match_id,p_expected_revision,p_removed);$$;
revoke all on function public.set_fixture_removed(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.set_fixture_removed(uuid,integer,boolean) to authenticated;

create function private.removed_feed_fixtures(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision,'playoffRound',m.playoff_round,
  'source',m.feed_source,'removedAt',m.removed_at,'feedAvailable',case when m.feed_source='leagueapps' then coalesce(g.last_seen>=src.last_success,false) end
 ) || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'basis',r.basis,'decision',r.decision,'penaltyOutcome',r.penalty_outcome,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'stats','[]'::jsonb)) else '{}'::jsonb end order by m.removed_at desc,m.id)
 from public.matches m left join public.match_results r on r.match_id=m.id left join private.league_games g on g.match_id=m.id left join private.league_sources src on src.club_id=g.club_id
 where m.club_id=p_club_id and m.removed_at is not null and m.feed_source is not null),'[]'::jsonb);
end;$$;
revoke all on function private.removed_feed_fixtures(uuid) from public,anon,authenticated;

create or replace function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format,'completed',s.completed,'completedAt',s.completed_at,'finalPosition',s.final_position,'revision',s.completion_revision) order by s.name desc) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
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
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'number',number,'position',position,'initials',initials,'hometown',hometown,'bio',bio,'isPublic',is_public) order by number,name) from public.players where club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',season_id,'playerId',player_id)) from public.season_roster where club_id=p_club_id),'[]'::jsonb),
  'rsvps',coalesce((select jsonb_agg(jsonb_build_object('matchId',r.match_id,'playerId',r.player_id,'response',r.response,'updatedAt',r.updated_at,'needsConfirmation',r.kickoff_at_response is distinct from m.kickoff)) from private.match_rsvps r join public.matches m on m.id=r.match_id where r.club_id=p_club_id and m.removed_at is null),'[]'::jsonb),
  'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchId',match_id,'payload',case when captain then coalesce(draft_payload,published_payload) else published_payload end,'shared',published_payload is not null,'updatedAt',case when captain then updated_at else published_at end) || case when captain then jsonb_build_object('revision',revision,'hasDraft',draft_payload is not null) else '{}'::jsonb end) from private.match_lineups where club_id=p_club_id and exists(select 1 from public.matches m where m.id=match_id and m.removed_at is null) and (captain or published_payload is not null)),'[]'::jsonb)
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
    where m.club_id=p_club_id and m.season_id=p_season_id and m.status='completed' and r.published and m.removed_at is null
  ), recorded as (
    select s.*, r.attendance as attendance_capture, r.scorers as goals_capture, r.assists as assists_capture
    from finals r join public.match_player_stats s on s.match_id=r.match_id and s.club_id=r.club_id
  ), eligible as (
    select p.*, not exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=p_season_id and sr.player_id=p.id) as is_guest
    from public.players p where p.club_id=p_club_id and (
      exists(select 1 from public.season_roster sr where sr.club_id=p_club_id and sr.season_id=p_season_id and sr.player_id=p.id)
      or exists(select 1 from private.match_guests g join public.matches m on m.id=g.match_id and m.club_id=g.club_id where g.club_id=p_club_id and m.season_id=p_season_id and m.removed_at is null and g.player_id=p.id)
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

create or replace function private.player_directory(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,
    'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public,
    'rosterSeasonIds',coalesce((select jsonb_agg(sr.season_id) from public.season_roster sr where sr.club_id=p_club_id and sr.player_id=p.id),'[]'::jsonb),
    'guestGames',(select count(*) from private.match_guests g join public.matches m on m.id=g.match_id where g.club_id=p_club_id and g.player_id=p.id and m.removed_at is null),
    'appearances',(select count(*) from public.match_player_stats ps join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id where ps.club_id=p_club_id and ps.player_id=p.id and ps.appeared and m.status='completed' and r.published and m.removed_at is null)
  ) order by lower(p.name),p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb);
end;$$;

create or replace function private.get_lineup_posts(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'matchId',match_id,'kind',kind,'payload',payload,'authorName',author_name,'createdAt',created_at,'canDelete',kind='suggestion' and (coalesce(author_id=auth.uid(),false) or public.is_captain(p_club_id))) order by created_at desc,id desc) from private.lineup_posts where club_id=p_club_id and exists(select 1 from public.matches m where m.id=match_id and m.removed_at is null)),'[]'::jsonb);
end;$$;


create or replace function private.match_player_eligible(p_match_id uuid,p_player_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.matches m where m.id=p_match_id and m.removed_at is null and (
  exists(select 1 from public.season_roster sr where sr.club_id=m.club_id and sr.season_id=m.season_id and sr.player_id=p_player_id)
  or exists(select 1 from private.match_guests g where g.club_id=m.club_id and g.match_id=m.id and g.player_id=p_player_id)
 ));
$$;



create or replace function public.get_captain_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select private.with_match_guests(private.league_club_snapshot(p_club_id,true),p_club_id)||jsonb_build_object('removedFixtures',private.removed_feed_fixtures(p_club_id));$$;


create or replace view public.public_season_totals with(security_invoker=true) as
 select club_id,season_id,count(*)::int played,count(*) filter(where outcome='W')::int wins,count(*) filter(where outcome='D')::int draws,count(*) filter(where outcome='L')::int losses,sum(home)::int goals_for,sum(away)::int goals_against,sum(case when outcome='W' then 3 when outcome='D' then 1 else 0 end)::int points
 from (select m.club_id,m.season_id,r.home,r.away,case when r.decision='penalties' then r.penalty_outcome when r.home>r.away then 'W' when r.home<r.away then 'L' else 'D' end as outcome
 from public.matches m join public.match_results r on r.match_id=m.id where r.published and m.status='completed' and m.playoff_round is null and m.removed_at is null) played_results group by club_id,season_id;



create or replace view public.public_player_season_totals with(security_invoker=true) as
 select ps.club_id,m.season_id,ps.player_id,count(*) filter(where ps.appeared)::int appearances,sum(ps.goals)::int goals,sum(ps.assists)::int assists,count(ps.assists)::int assists_recorded_matches
 from public.match_player_stats ps join public.players p on p.id=ps.player_id join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id
 where p.is_public and r.published and m.status='completed' and m.removed_at is null group by ps.club_id,m.season_id,ps.player_id;
