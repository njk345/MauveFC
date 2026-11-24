-- Replace the existing job in place. Archived seasons refresh only on request.
select cron.schedule('mauve-leagueapps-hourly','17 * * * *',$job$select private.dispatch_league_sync(l.club_id,l.season_id) from private.league_sources l join public.seasons s on s.id=l.season_id where l.enabled and not s.completed;$job$);
