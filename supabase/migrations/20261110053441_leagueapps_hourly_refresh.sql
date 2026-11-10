create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- A fresh single-use job capability avoids a long-lived credential in cron SQL.
create function private.dispatch_league_sync(p_club_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare capability uuid;begin
 perform 1 from private.league_sources where club_id=p_club_id and enabled for update;
 if not found then raise exception 'League source is not configured';end if;
 if exists(select 1 from private.league_runs where club_id=p_club_id and requested_at>now()-interval '5 minutes') then return;end if;
 update private.league_runs set state='failed',finished_at=now() where club_id=p_club_id and state in ('queued','running') and requested_at<now()-interval '10 minutes';
 if exists(select 1 from private.league_runs where club_id=p_club_id and state in ('queued','running')) then return;end if;
 insert into private.league_runs(club_id) values(p_club_id) returning token into capability;
 update private.league_sources set last_attempt=now() where club_id=p_club_id;
 perform net.http_post(url:='https://maupvkabgveqvwkivtyh.supabase.co/functions/v1/leagueapps-sync',body:=jsonb_build_object('token',capability),headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=60000);
 -- Keep a bounded operational history. No token is included in public responses.
 delete from private.league_runs where club_id=p_club_id and requested_at<now()-interval '30 days';
end;$$;
revoke all on function private.dispatch_league_sync(uuid) from public,anon,authenticated;
select cron.schedule('mauve-leagueapps-hourly','17 * * * *',$job$select private.dispatch_league_sync(club_id) from private.league_sources where enabled;$job$);
