# Seasons and historical imports

Use **Captain → Season → Add a season**. Both sources follow the same three
steps: season details, results/roster, then review/save. Creation selects the
new season in the existing header selector. Its selection persists in this
browser; visitors otherwise start with the latest season, sorted by year and
Winter/Spring/Summer/Fall rather than alphabetically.

Capture year, term, historical team name, league name/location, optional league
website, playing format and local time zone. A season label can override the
normal “Fall 2024 · League name” label. Mark a historical season complete during
setup or close it later. The club brand and player identities remain stable;
fixture/result displays use that season's team name.

## Manual entry

Manual standings default to **No**. Add our fixtures, results and player stats
through the existing captain tools. When standings are enabled, enter the other
league teams, one per line. Our team is included automatically. Season settings
can enable/disable the table later and add more teams without deleting results.

The table combines our published, active regular-season results with separately
recorded games between other league teams. Those other-team games never create
club fixtures, goals, appearances, assists or player stats. Captains can add,
correct or remove them under **Season → Other teams' results**; tied shootout
scores require a separate winner. Playoffs, removed fixtures and unpublished
club results do not enter the table. Fixture opponent choices use known league
teams; unmatched older opponents are reported and excluded until their team is
added using the same name.

Award 3 points for a win and 1 for a draw. Sort by points, goal difference, goals
scored, then name for a stable display. A manual table is always labelled a
**partial league record**, reflecting only available results. The table and a
completed season's computed placing update after corrections/removals. No
placing is invented when our team has no recorded league games.

## LeagueApps

Paste a public team, schedule, standings or league page URL on a LeagueApps
organization's HTTPS website. Canonical numeric links and the usual sport/slug
league links are accepted. Team links select a team directly; league-wide links
first load team choices. Multi-division leagues list teams from every division,
label each choice with its division, and select the standings table containing
the chosen team ID. Division ranks are preserved independently, and both imports
and later refreshes use that team's division. Cross-division games remain in the
team schedule without adding those opponents to the division table. The captain
previews the selected team's fixtures,
final scores and league table before saving. This uses public web widgets,
never a calendar subscription. The adapter has recorded regression fixtures
from both NYC Soccer and NYC Footy, including Footy's extra standings column
and unscored plain-text/TBD fixtures. Unsupported markup rejects the preview
instead of fabricating results.

Preview snapshots are staged privately for the requesting captain, expire after
30 minutes and can be consumed once. Creation atomically installs the season,
source connection, fixtures/results, selected roster and completion state.
Stable request IDs make a retry of the same create request idempotent; an
already-linked provider/program/team cannot be imported as a second season.
Player appearances, goals and assists remain unrecorded until entered, and
playoff designations remain captain-controlled.

Each season has its own source origin, program/team IDs, standings, refresh
jobs, cooldown and game links. Numeric game IDs from different organizations or
seasons cannot collide. Active seasons refresh hourly; completed seasons refresh
only when a captain requests it. Existing captain overrides, player stats,
removed-fixture queues and source audit history retain their behavior. League
standings remain feed-owned even when a captain removes a fixture or corrects a
club result. A completed feed season keeps its captured league placing.

## Roster and access

Optionally select existing club players during setup; these are stable player
IDs, so history is shared without creating duplicate people. Roster selection
and guests remain distinct: add a non-roster substitute to individual games as
usual. Creating a season does not create accounts or invitations and preserves
all player privacy settings and captain-only contact details.

In Captain → Roster, **Add from directory** searches known club players who
are not already on the selected season’s roster. Choose a player and select
**Add to season roster** to reuse their existing identity, profile and history.
**Add player** still creates a new person. Roster additions do not create an
account, send an invitation or change which profiles are public.

Only captains can create seasons, stage/import previews, configure manual
standings or write other-team results. Public projections expose season metadata,
league team names and standings, never staged previews, job capabilities or
private player contacts. Use fresh revisions to edit settings/results.

## Fixture and result ordering

Known dates and kickoff times determine chronology. Equal or missing times use
playoff progression: regular play, unspecified playoffs, quarterfinals,
semifinals, then finals. Remaining ties retain the incoming sequence; matchday
numbers, IDs and opponent names do not override it. Results and the Home latest
result use the same newest-first ordering, including player appearance history
and the completed season's playoff finish. Schedule views use oldest first.
Known chronology takes precedence if incomplete dates and round labels conflict.
