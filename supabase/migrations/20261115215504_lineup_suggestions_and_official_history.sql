set local lock_timeout='5s';
set local statement_timeout='30s';
-- Shared snapshots are separate from the captain's mutable, private draft.
create table private.lineup_posts (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null,match_id uuid not null,
 kind text not null check(kind in ('official','suggestion')),
 payload jsonb not null,
 author_id uuid references auth.users(id) on delete set null,
 author_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(match_id,club_id) references public.matches(id,club_id)
);
create index lineup_posts_match_idx on private.lineup_posts(club_id,match_id,created_at desc);
create index lineup_posts_author_idx on private.lineup_posts(author_id);
alter table private.lineup_posts enable row level security;
revoke all on private.lineup_posts from public,anon,authenticated;

create function private.validate_suggested_lineup(p_match_id uuid,p_payload jsonb) returns void
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
end;$$;
revoke all on function private.validate_suggested_lineup(uuid,jsonb) from public,anon,authenticated;

create function private.post_lineup_suggestion(p_match_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.matches;post_id uuid;author text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if auth.uid() is null or not private.is_team_member(m.club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 perform private.validate_suggested_lineup(p_match_id,p_payload);
 select p.name into author from public.club_memberships cm join public.players p on p.id=cm.player_id and p.club_id=cm.club_id where cm.club_id=m.club_id and cm.user_id=auth.uid();
 insert into private.lineup_posts(club_id,match_id,kind,payload,author_id,author_name)
 values(m.club_id,m.id,'suggestion',jsonb_build_object('formation',p_payload->'formation','starters',p_payload->'starters','bench',p_payload->'bench'),auth.uid(),coalesce(author,case when public.is_captain(m.club_id) then 'Captain' else 'Team member' end)) returning id into post_id;
 return post_id;
end;$$;

create function private.get_lineup_posts(p_club_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'matchId',match_id,'kind',kind,'payload',payload,'authorName',author_name,'createdAt',created_at,'canDelete',kind='suggestion' and (coalesce(author_id=auth.uid(),false) or public.is_captain(p_club_id))) order by created_at desc,id desc) from private.lineup_posts where club_id=p_club_id),'[]'::jsonb);
end;$$;

create function private.delete_lineup_suggestion(p_post_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p private.lineup_posts;begin
 select * into strict p from private.lineup_posts where id=p_post_id for update;
 if auth.uid() is null or not private.is_team_member(p.club_id) or p.kind<>'suggestion' or (p.author_id is distinct from auth.uid() and not public.is_captain(p.club_id)) then raise exception 'You cannot remove this lineup' using errcode='42501';end if;
 delete from private.lineup_posts where id=p.id;
end;$$;

-- Keep privileged logic outside exposed schemas. Wrappers grant only these APIs.
grant usage on schema private to authenticated;
revoke all on function private.post_lineup_suggestion(uuid,jsonb),private.get_lineup_posts(uuid),private.delete_lineup_suggestion(uuid) from public,anon,authenticated;
grant execute on function private.post_lineup_suggestion(uuid,jsonb),private.get_lineup_posts(uuid),private.delete_lineup_suggestion(uuid) to authenticated;
create function public.post_lineup_suggestion(p_match_id uuid,p_payload jsonb) returns uuid language sql security invoker set search_path='' as $$select private.post_lineup_suggestion(p_match_id,p_payload);$$;
create function public.get_lineup_posts(p_club_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_lineup_posts(p_club_id);$$;
create function public.delete_lineup_suggestion(p_post_id uuid) returns void language sql security invoker set search_path='' as $$select private.delete_lineup_suggestion(p_post_id);$$;
revoke all on function public.post_lineup_suggestion(uuid,jsonb),public.get_lineup_posts(uuid),public.delete_lineup_suggestion(uuid) from public,anon,authenticated;
grant execute on function public.post_lineup_suggestion(uuid,jsonb),public.get_lineup_posts(uuid),public.delete_lineup_suggestion(uuid) to authenticated;

-- Official publishing still goes through the existing captain/revision checks.
create function private.record_official_lineup() returns trigger language plpgsql security definer set search_path='' as $$
declare author text;begin
 if new.published_payload is null then
  delete from private.lineup_posts where match_id=new.match_id and kind='official';
 elsif tg_op='INSERT' or new.published_at is distinct from old.published_at or new.published_payload is distinct from old.published_payload then
  if auth.uid() is null or not public.is_captain(new.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
  select p.name into author from public.club_memberships cm join public.players p on p.id=cm.player_id and p.club_id=cm.club_id where cm.club_id=new.club_id and cm.user_id=auth.uid();
  insert into private.lineup_posts(club_id,match_id,kind,payload,author_id,author_name) values(new.club_id,new.match_id,'official',new.published_payload,auth.uid(),coalesce(author,'Captain'));
 end if;
 return new;
end;$$;
revoke all on function private.record_official_lineup() from public,anon,authenticated;
create trigger record_official_lineup after insert or update on private.match_lineups for each row execute function private.record_official_lineup();
-- Preserve any lineup already shared before this feature was installed.
insert into private.lineup_posts(club_id,match_id,kind,payload,author_name,created_at)
 select club_id,match_id,'official',published_payload,'Captain',coalesce(published_at,updated_at) from private.match_lineups where published_payload is not null;
