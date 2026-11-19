set local lock_timeout='5s';
set local statement_timeout='30s';
-- Existing sheets retain their numbers; this optional field only changes presentation.
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
end;$$;
revoke all on function private.validate_lineup_sheet(jsonb) from public,anon,authenticated;

create or replace function private.post_lineup_suggestion(p_match_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.matches;post_id uuid;author text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if auth.uid() is null or not private.is_team_member(m.club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 perform private.validate_suggested_lineup(p_match_id,p_payload);
 select p.name into author from public.club_memberships cm join public.players p on p.id=cm.player_id and p.club_id=cm.club_id where cm.club_id=m.club_id and cm.user_id=auth.uid();
 insert into private.lineup_posts(club_id,match_id,kind,payload,author_id,author_name)
 values(m.club_id,m.id,'suggestion',jsonb_build_object('formation',p_payload->'formation','starters',p_payload->'starters','bench',p_payload->'bench','benchPositions',coalesce(p_payload->'benchPositions','{}'::jsonb),'firstNamesOnly',coalesce(p_payload->'firstNamesOnly','false'::jsonb),'hideNumbers',coalesce(p_payload->'hideNumbers','false'::jsonb)),auth.uid(),coalesce(author,case when public.is_captain(m.club_id) then 'Captain' else 'Team member' end)) returning id into post_id;
 return post_id;
end;$$;
