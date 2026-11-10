# Mauve FC

A mobile-first club website prototype, built from [the architecture sketch](docs/architecture.md) with Next.js App Router, React, and TypeScript.

## Run locally

Requires Node.js 20.9+ (tested on Node 24).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. `npm run build:preview` generates the static prototype in `out/`; serve it with `python -m http.server 3000 --directory out`.

## Explore the prototype

- **Home:** compact club banner, next fixture, points and season record, illustrative standings snapshot, recent form, latest result, and top scorers. The standings are a fixed fictional matchday-six snapshot; the club record continues to reflect browser-local result edits.
- **Schedule:** upcoming/all filters, postponed fixture handling, match details, and `.ics` calendar downloads with New York display times.
- **Results:** win/draw/loss filters and individual result details.
- **Players:** searchable, position-filtered roster and twelve individual profiles.
- **Stats:** derived totals, a Recharts match-by-match goals chart, accessible chart table, and sortable player rankings.
- **Captain’s area:** three-step score → attendance/goals/assists → preview/publish workflow. Drafts and corrections persist in browser storage. Publishing updates every public view; saving a draft preserves the published result.

Use the header to switch between fictional Fall and Summer 2026 seasons. All fixtures, identities, venues, and statistics are sample content, not imported league data. The top-bar **Reset demo** action restores the initial dataset.

## Data and boundaries

The hosted site is connected to the real Supabase club, and its first captain has verified sign-in. Local demo mode keeps the openly accessible sample workspace. The application now also includes a Supabase-backed live mode with email-link sign-in, captain authorization, persistent fixtures/roster, private drafts, and transactional result publishing. See [backend setup](docs/backend-setup.md) for provisioning and activation. Browser-local edits are not shared with other visitors or devices. Demo mode requires no Supabase configuration. Live mode requires the public project settings documented in the setup guide.

Sample data lives in `src/lib/sample-data.ts`. Shared queries in `src/features/stats/queries.ts` derive statistics only from published results. The editor distinguishes official/on-field scores, handles forfeits without inventing appearances, tracks capture completeness, and validates attribution. Publication and correction replace the full match result in a single state update; a local before/after edit history is retained for the demo.

The hosted site imports real fixtures, final scores and the full league standings
for **It’s Coming Home (Lilac)**, program `5162244`, team `8032635`. Public
LeagueApps schedule/results widgets supply all match data; calendar subscriptions
are not used. Updates run hourly with a protected captain refresh action. Captain
results, player details and fixture overrides survive imports; conflicting league
scores appear for review. See [the architecture](docs/architecture.md#leagueapps-integration)
for source verification and ownership rules. The default local mode still uses
fictional sample data. `npm run build` produces a server deployment and
`npm run build:preview` explicitly produces the static export used by Sites.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Domain, adapter and database tests cover sample consistency, drafts, corrections, forfeits, partial attribution, unknown assists, authorization, source failure, DST, rescheduling, repeat imports and protected captain data.

For browser checks, install Python Playwright and point `CHROMIUM_PATH` at Chromium, then run against a served production export:

```sh
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py
```

The browser smoke test exercises all public routes at desktop/mobile widths, calendar downloads, draft persistence, publishing, corrections, derived totals, roster filters, season switching, and demo reset. Screenshots are written to the ignored `artifacts/` directory.

## Visual assets

The club crest and jersey illustrations are original SVGs. Barlow Condensed and DM Sans are bundled locally under their SIL Open Font Licenses, included in `public/fonts/`.
