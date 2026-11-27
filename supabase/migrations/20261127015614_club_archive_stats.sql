set local lock_timeout='5s';
set local statement_timeout='30s';

-- Aggregate the selected seasons before applying identity visibility. The
-- public response has only a count for private players, across the whole scope.
create function private.archive_season_stats(p_club_id uuid, p_season_ids uuid[])
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
    select p.id,p.name,p.number,p.position,p.initials,p.is_public,p.is_guest,
      count(*) filter(where s.appeared)::integer as appearances,
      coalesce(sum(s.goals) filter(where s.goals_capture<>'unrecorded'),0)::integer as goals,
      coalesce(sum(s.assists) filter(where s.assists_capture<>'unrecorded'),0)::integer as assists,
      coalesce(bool_or(s.appeared or s.attendance_capture='complete'),false) as appearances_known,
      coalesce(bool_or(s.goals_capture<>'unrecorded' and (s.goals>0 or s.goals_capture='complete')),false) as goals_known,
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
    'appearanceRecords',(select count(*) from finals where attendance<>'unrecorded'),
    'goalRecords',(select count(*) from finals where scorers<>'unrecorded'),
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

revoke all on function private.archive_season_stats(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.archive_season_stats(uuid,uuid[]) to anon,authenticated;

-- The original entry point and privacy contract continue to serve single seasons.
create or replace function private.season_stats(p_club_id uuid, p_season_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.archive_season_stats(p_club_id,array[p_season_id]);
$$;

create function public.get_archive_stats(p_club_id uuid, p_season_ids uuid[])
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.archive_season_stats(p_club_id,p_season_ids);
$$;
revoke all on function public.get_archive_stats(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_archive_stats(uuid,uuid[]) to anon,authenticated;
