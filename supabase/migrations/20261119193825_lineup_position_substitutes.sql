set local lock_timeout='5s';
set local statement_timeout='30s';
-- Optional presentation fields are checked on every official/draft/suggestion write.
-- Existing payloads need no rewrite; missing fields mean general bench/full names.
create function private.validate_lineup_sheet(p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare entry record;begin
 if p_payload ? 'firstNamesOnly' and jsonb_typeof(p_payload->'firstNamesOnly') is distinct from 'boolean' then raise exception 'Invalid team-sheet name option';end if;
 if p_payload ? 'benchPositions' then
  if jsonb_typeof(p_payload->'benchPositions') is distinct from 'object' then raise exception 'Invalid substitute positions';end if;
  for entry in select key,value from jsonb_each(p_payload->'benchPositions') loop
   if not (p_payload->'bench' @> jsonb_build_array(entry.key)) or jsonb_typeof(entry.value) is distinct from 'number' or entry.value::text !~ '^[0-6]$' then raise exception 'A position substitute must be on the bench with a valid position';end if;
  end loop;
 end if;
end;$$;
revoke all on function private.validate_lineup_sheet(jsonb) from public,anon,authenticated;

create or replace function public.save_match_lineup(p_match_id uuid,p_expected_revision integer,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;l private.match_lineups;player text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select * into l from private.match_lineups where match_id=m.id for update;
 if coalesce(l.revision,0) is distinct from p_expected_revision then raise exception 'The lineup changed. Reload before saving.' using errcode='40001';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'formation','') not in ('2-3-1','3-2-1','2-2-2') or jsonb_typeof(p_payload->'starters') is distinct from 'array' or jsonb_array_length(p_payload->'starters')<>7 or jsonb_typeof(p_payload->'bench') is distinct from 'array' or jsonb_array_length(p_payload->'bench')>100 or p_publish is null then raise exception 'Invalid lineup';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'starters') s where jsonb_typeof(s) not in ('string','null')) or exists(select 1 from jsonb_array_elements(p_payload->'bench') s where jsonb_typeof(s)<>'string') then raise exception 'Invalid lineup player';end if;
 if p_publish and exists(select 1 from jsonb_array_elements(p_payload->'starters') s where s='null'::jsonb) then raise exception 'Choose all seven starters before sharing';end if;
 if (select count(*)<>count(distinct value) from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null) then raise exception 'A player cannot appear twice';end if;
 for player in select value from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null loop
  if not exists(select 1 from public.season_roster where club_id=m.club_id and season_id=m.season_id and player_id=player::uuid) then raise exception 'Player is not eligible for this fixture';end if;
 end loop;
 perform private.validate_lineup_sheet(p_payload);
 insert into private.match_lineups(club_id,match_id,published_payload,draft_payload,revision,published_at)
 values(m.club_id,m.id,case when p_publish then p_payload end,case when not p_publish then p_payload end,1,case when p_publish then now() end)
 on conflict(match_id) do update set published_payload=case when p_publish then p_payload else match_lineups.published_payload end,draft_payload=case when p_publish then null else p_payload end,revision=match_lineups.revision+1,published_at=case when p_publish then now() else match_lineups.published_at end,updated_at=now();
end;$$;

create or replace function private.validate_suggested_lineup(p_match_id uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare m public.matches;player text;begin
 select * into strict m from public.matches where id=p_match_id;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'formation','') not in ('2-3-1','3-2-1','2-2-2') or jsonb_typeof(p_payload->'starters') is distinct from 'array' or jsonb_typeof(p_payload->'bench') is distinct from 'array' then raise exception 'Invalid lineup';end if;
 if jsonb_array_length(p_payload->'starters')<>7 or jsonb_array_length(p_payload->'bench')>100 then raise exception 'Choose all seven starters before posting';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'starters') s where jsonb_typeof(s)<>'string') or exists(select 1 from jsonb_array_elements(p_payload->'bench') s where jsonb_typeof(s)<>'string') then raise exception 'Choose all seven starters before posting';end if;
 if (select count(*)<>count(distinct value) from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench'))) then raise exception 'A player cannot appear twice';end if;
 for player in select value from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) loop
  if not exists(select 1 from public.season_roster where club_id=m.club_id and season_id=m.season_id and player_id=player::uuid) then raise exception 'Player is not eligible for this fixture';end if;
 end loop;
 perform private.validate_lineup_sheet(p_payload);
end;$$;

create or replace function private.post_lineup_suggestion(p_match_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.matches;post_id uuid;author text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if auth.uid() is null or not private.is_team_member(m.club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 perform private.validate_suggested_lineup(p_match_id,p_payload);
 select p.name into author from public.club_memberships cm join public.players p on p.id=cm.player_id and p.club_id=cm.club_id where cm.club_id=m.club_id and cm.user_id=auth.uid();
 insert into private.lineup_posts(club_id,match_id,kind,payload,author_id,author_name)
 values(m.club_id,m.id,'suggestion',jsonb_build_object('formation',p_payload->'formation','starters',p_payload->'starters','bench',p_payload->'bench','benchPositions',coalesce(p_payload->'benchPositions','{}'::jsonb),'firstNamesOnly',coalesce(p_payload->'firstNamesOnly','false'::jsonb)),auth.uid(),coalesce(author,case when public.is_captain(m.club_id) then 'Captain' else 'Team member' end)) returning id into post_id;
 return post_id;
end;$$;
