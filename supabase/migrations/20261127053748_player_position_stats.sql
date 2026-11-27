-- Return only one player's assignments. Published results and player stats
-- already come from the member profile snapshot.
create function private.player_lineup_roles(p_club_id uuid, p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_team_member(p_club_id) then
    raise exception 'Team membership required' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'matchId', l.match_id,
      'position', l.position,
      'assignment', l.assignment
    ) order by l.match_id)
    from private.latest_official_lineup_positions l
    where l.club_id=p_club_id and l.player_id=p_player_id and l.position is not null
  ), '[]'::jsonb);
end;
$$;
revoke all on function private.player_lineup_roles(uuid,uuid) from public,anon,authenticated;
grant execute on function private.player_lineup_roles(uuid,uuid) to authenticated;

create function public.get_player_lineup_roles(p_club_id uuid, p_player_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.player_lineup_roles(p_club_id,p_player_id);
$$;
revoke all on function public.get_player_lineup_roles(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_player_lineup_roles(uuid,uuid) to authenticated;
