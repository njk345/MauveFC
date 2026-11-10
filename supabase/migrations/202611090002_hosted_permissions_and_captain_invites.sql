-- Supabase can grant API roles EXECUTE directly through default privileges.
-- Revoke those direct grants as well as PUBLIC, then grant only intended callers.
revoke all on function public.is_captain(uuid),public.get_captain_club(uuid),public.get_public_club(uuid),public.save_match_result(uuid,integer,jsonb),public.save_fixture(uuid,jsonb),public.save_roster_player(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_public_club(uuid) to anon,authenticated;
grant execute on function public.is_captain(uuid),public.get_captain_club(uuid),public.save_match_result(uuid,integer,jsonb),public.save_fixture(uuid,jsonb),public.save_roster_player(uuid,uuid,jsonb) to authenticated;

-- Invoker views use only explicitly granted, published data columns.
-- Editor identities, draft payloads, and correction history remain private.
grant select(id,club_id,season_id,status) on public.matches to anon,authenticated;
grant select(match_id,published,home,away) on public.match_results to anon,authenticated;
grant select(id,is_public) on public.players to anon,authenticated;
grant select(club_id,match_id,player_id,appeared,goals,assists) on public.match_player_stats to anon,authenticated;
create policy public_fixture_stats_columns on public.matches for select to anon,authenticated using(true);
create policy published_result_stats_columns on public.match_results for select to anon,authenticated using(published);
create policy approved_player_stats_columns on public.players for select to anon,authenticated using(is_public);
create policy published_approved_player_stats on public.match_player_stats for select to anon,authenticated using(
 exists(select 1 from public.match_results r where r.match_id=match_player_stats.match_id and r.published)
 and exists(select 1 from public.players p where p.id=match_player_stats.player_id and p.is_public)
);
alter view public.public_season_totals set (security_invoker=true);
alter view public.public_player_season_totals set (security_invoker=true);

-- Only an administrator can preauthorize an email. Membership is granted only
-- after Supabase Auth verifies that mailbox; the preauthorization is consumed.
create table public.pending_captain_invites (
 club_id uuid not null references public.clubs(id),
 email text not null check(email=lower(btrim(email))),
 created_at timestamptz not null default now(),
 primary key(club_id,email)
);
alter table public.pending_captain_invites enable row level security;
revoke all on public.pending_captain_invites from public,anon,authenticated;
create function public.accept_verified_captain_invite() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and new.email is not null then
  with accepted as (
   delete from public.pending_captain_invites where email=lower(btrim(new.email)) returning club_id
  ) insert into public.club_memberships(club_id,user_id,role)
    select club_id,new.id,'captain' from accepted
    on conflict(club_id,user_id) do update set role='captain';
 end if;
 return new;
end;$$;
revoke all on function public.accept_verified_captain_invite() from public,anon,authenticated;
create trigger accept_verified_captain_invite after insert or update of email,email_confirmed_at on auth.users
 for each row execute function public.accept_verified_captain_invite();
