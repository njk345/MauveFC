These are public LeagueApps HTML responses captured on 2026-11-10 for the
adapter contract tests. No login, calendar subscription or private feed is used.

- `leagueapps-schedule.html`: https://nycsoccer.leagueapps.com/ajax/loadSchedule?origin=site&scope=program&programId=5162244&publishedOnly=true&itemType=games_only&teamId=8032635
- `leagueapps-standings.html`: https://nycsoccer.leagueapps.com/widgets/standingsContent?lid=5162244

The source is authoritative for provider IDs, score status, league order and
fixture dates. Player attribution remains unrecorded. Fixtures are frozen test
evidence; production always fetches the public source through the server adapter.
