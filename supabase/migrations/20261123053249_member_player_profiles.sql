set local lock_timeout='5s';
set local statement_timeout='30s';

-- Only the Players routes request this member-only projection. Public club
-- snapshots remain unchanged, including their public-profile approval filter.
create function private.member_player_profiles(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;begin
 if auth.uid() is null or not private.is_team_member(p_club_id) then
  raise exception 'Team membership required' using errcode='42501';
 end if;
 data:=public.get_public_club(p_club_id);
 data:=data||jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio,'isPublic',p.is_public) order by p.number,p.name,p.id) from public.players p where p.club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',r.season_id,'playerId',r.player_id)) from public.season_roster r where r.club_id=p_club_id),'[]'::jsonb)
 );
 -- Active, published match-player rows provide accurate profile totals and
 -- appearance histories. No drafts, editor identities or captain tools enter
 -- this response; removed fixtures were already excluded by get_public_club.
 return jsonb_set(data,'{matches}',coalesce((select jsonb_agg(
  case when m.value ? 'result' then jsonb_set(m.value,'{result,stats}',coalesce((select jsonb_agg(jsonb_build_object('playerId',s.player_id,'appeared',s.appeared,'goals',s.goals,'assists',s.assists) order by s.player_id) from public.match_player_stats s where s.club_id=p_club_id and s.match_id=(m.value->>'id')::uuid),'[]'::jsonb)) else m.value end order by m.ordinality
 ) from jsonb_array_elements(data->'matches') with ordinality m),'[]'::jsonb));
end;$$;
revoke all on function private.member_player_profiles(uuid) from public,anon,authenticated;
grant execute on function private.member_player_profiles(uuid) to authenticated;
create function public.get_member_player_profiles(p_club_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.member_player_profiles(p_club_id);$$;
revoke all on function public.get_member_player_profiles(uuid) from public,anon,authenticated;
grant execute on function public.get_member_player_profiles(uuid) to authenticated;
