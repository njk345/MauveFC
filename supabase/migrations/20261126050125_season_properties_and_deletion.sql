set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.update_season_details(p_season_id uuid, p_expected_revision integer, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
<<season_details>>
declare
 s public.seasons;
 label text := btrim(coalesce(p_details->>'name', ''));
 competition text := btrim(coalesce(p_details->>'competition', ''));
 team text := btrim(coalesce(p_details->>'teamName', ''));
 location text := btrim(coalesce(p_details->>'location', ''));
 website text := btrim(coalesce(p_details->>'leagueWebsite', ''));
 zone text := coalesce(p_details->>'timeZone', '');
 format text := btrim(coalesce(p_details->>'format', ''));
 term text := coalesce(p_details->>'term', '');
 year integer := (p_details->>'year')::integer;
begin
 select * into strict s from public.seasons where id = p_season_id for update;
 if auth.uid() is null or not public.is_captain(s.club_id) then
  raise exception 'Captain access required' using errcode = '42501';
 end if;
 if s.settings_revision is distinct from p_expected_revision then
  raise exception 'Season details changed. Reload before saving.' using errcode = '40001';
 end if;
 if jsonb_typeof(p_details) is distinct from 'object' or year is null or year not between 1900 and 2100
  or term not in ('Winter','Spring','Summer','Fall')
  or length(competition) not between 1 and 150 or length(team) not between 1 and 100
  or length(format) not between 1 and 60 or length(location) > 150
  or length(website) > 500 or (website <> '' and website !~ '^https?://[^/[:space:]@]+(/[^[:space:]]*)?$') then
  raise exception 'Enter valid season, league and team details';
 end if;
 if not exists (select 1 from pg_catalog.pg_timezone_names where name = zone) then
  raise exception 'Choose a valid IANA time zone';
 end if;
 if label = '' then label := term || ' ' || year::text; end if;
 if length(label) not between 1 and 180 then raise exception 'Season labels support up to 180 characters'; end if;
 if exists (select 1 from private.season_teams where season_id = s.id and not is_ours and lower(btrim(name)) = lower(team)) then
  raise exception 'Another league team already uses that team name';
 end if;
 if zone is distinct from s.source_timezone and exists (
  select 1 from private.league_runs where season_id = s.id and state = 'running'
 ) then raise exception 'Wait for the current league refresh to finish before changing time zone'; end if;
 update public.seasons set name = label, competition = season_details.competition,
  team_name = team, location = season_details.location, league_website = website,
  source_timezone = zone, format = season_details.format, year = season_details.year,
  term = season_details.term, settings_revision = settings_revision + 1 where id = s.id;
 update private.league_sources set time_zone = zone where season_id = s.id;
 update private.season_teams set name = team where season_id = s.id and is_ours;
end; $$;
revoke all on function private.update_season_details(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function private.update_season_details(uuid,integer,jsonb) to authenticated;
create function public.update_season_details(p_season_id uuid, p_expected_revision integer, p_details jsonb)
returns void language sql security invoker set search_path = '' as $$
 select private.update_season_details(p_season_id,p_expected_revision,p_details);
$$;
revoke all on function public.update_season_details(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.update_season_details(uuid,integer,jsonb) to authenticated;

create function private.delete_club_season(p_season_id uuid, p_expected_revision integer, p_confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.seasons; mids uuid[];
begin
 select * into strict s from public.seasons where id = p_season_id for no key update;
 if auth.uid() is null or not public.is_captain(s.club_id) then
  raise exception 'Captain access required' using errcode = '42501';
 end if;
 if s.settings_revision is distinct from p_expected_revision then
  raise exception 'Season details changed. Reload before deleting.' using errcode = '40001';
 end if;
 if btrim(p_confirmation) is distinct from s.name then
  raise exception 'Type the season label to confirm deletion';
 end if;
 -- Let an applying feed finish before taking the stronger season lock; its
 -- inserts may still need a foreign-key key-share lock on this season.
 perform 1 from private.league_sources where season_id = s.id for update;
 perform 1 from public.seasons where id = s.id for update;
 -- All child-write guards lock their match. Serialize them before cleanup so
 -- concurrent RSVPs, lineups or stats cannot arrive between delete statements.
 perform 1 from public.matches where season_id = s.id order by id for update;
 select coalesce(array_agg(id),array[]::uuid[]) into mids from public.matches where season_id = s.id;
 -- Removed fixtures stay invisible to other transactions. Clear their removal
 -- flags here so the normal child-write guards allow the atomic cleanup.
 update public.matches set removed_at = null, removed_by = null where season_id = s.id and removed_at is not null;
 delete from private.league_runs where season_id = s.id;
 delete from private.league_games where season_id = s.id;
 delete from private.league_changes where match_id = any(mids);
 delete from private.lineup_posts where match_id = any(mids);
 delete from private.match_lineups where match_id = any(mids);
 delete from private.match_rsvps where match_id = any(mids);
 delete from private.match_guests where match_id = any(mids);
 delete from public.match_drafts where match_id = any(mids);
 delete from public.result_history where match_id = any(mids);
 delete from public.match_player_stats where match_id = any(mids);
 delete from public.match_results where match_id = any(mids);
 delete from public.matches where season_id = s.id;
 delete from public.season_roster where season_id = s.id;
 delete from private.manual_league_results where season_id = s.id;
 delete from private.season_teams where season_id = s.id;
 delete from private.season_import_previews where consumed_by = s.id;
 delete from private.league_sources where season_id = s.id;
 delete from public.seasons where id = s.id;
 -- Player identities, details, invitations and club memberships are independent
 -- of seasons and are intentionally retained, including season-only guests.
end; $$;
revoke all on function private.delete_club_season(uuid,integer,text) from public,anon,authenticated;
grant execute on function private.delete_club_season(uuid,integer,text) to authenticated;
create function public.delete_club_season(p_season_id uuid, p_expected_revision integer, p_confirmation text)
returns void language sql security invoker set search_path = '' as $$
 select private.delete_club_season(p_season_id,p_expected_revision,p_confirmation);
$$;
revoke all on function public.delete_club_season(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.delete_club_season(uuid,integer,text) to authenticated;
