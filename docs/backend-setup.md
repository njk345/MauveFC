# Captain auth and the first complete workflow

The application supports two explicit modes. `demo` is the default and preserves the fictional, browser-local workspace. `live` uses Supabase Auth and Postgres. Live mode never falls back to sample data or browser-local writes, including when configuration or the database is unavailable.

## Current hosted status

- Supabase project: `maupvkabgveqvwkivtyh` (**Mauve FC**), organization **njk345**, region **us-east-1**, quoted **$0/month** on the Free plan.
- Club ID: `f400610f-fa22-48cf-bc81-837743bab2a3`; season ID: `acd5a8e5-79ca-4d54-bbee-de5c0d7bd652`.
- Auth and LeagueApps migrations are applied. Production contains only verified league fixtures/results; the fictional seed is never used.
- The first captain has verified email and active membership. New captain preauthorizations are private and consumed once after email verification. Revoking membership does not recreate it later.
- The owner completed the dashboard setup and confirmed captain auth works. Keep the Site URL on `/login/` and public sign-ups disabled. These Auth controls are not exposed by the current connection.
- [Auth URL settings](https://supabase.com/dashboard/project/maupvkabgveqvwkivtyh/auth/url-configuration), [email templates](https://supabase.com/dashboard/project/maupvkabgveqvwkivtyh/auth/templates), [Auth users](https://supabase.com/dashboard/project/maupvkabgveqvwkivtyh/auth/users).

## Recreating a Supabase project

1. Create a Supabase project named **Mauve FC** in the intended organization and region. Use a development project first. The existing hosted project is recorded above; do not create a second project when resuming setup.
2. Apply the files in `supabase/migrations/` in version order through Supabase migrations. Do **not** run the fictional `supabase/seed.sql` in production.
3. Create the real club and initial season with the SQL below. Copy the returned club UUID.
4. In Auth settings, disable public sign-ups. Set the site URL to the application’s final HTTPS origin. Keep the default **Magic Link** template. The app consumes invitation/sign-in links on `/login/`. On the Free plan, editing templates requires custom SMTP (or a Pro upgrade); neither is required to use default sign-in links. Optional code entry remains available if custom email templates are configured later.
5. Add or invite the first captain using the Auth dashboard. Grant that exact Auth user UUID the captain membership using the second SQL example. The app never allows clients to grant themselves membership.
6. Set the environment values in `.env.example` through the deployment provider. Use only the project URL and **publishable** key (or legacy anon key) in `NEXT_PUBLIC_*`. No service-role key is needed by the app. Set `NEXT_PUBLIC_MAUVE_MODE=live` and the returned `NEXT_PUBLIC_MAUVE_CLUB_ID`.
7. Deploy the normal Next.js build to Vercel (`npm run build`, `npm run start`). Live public content is fetched server-side per request; captain sessions are verified by Supabase in the browser and every database mutation verifies membership again. Identity-dependent data is not put in a public cache.
8. Test an invited captain, a signed-in non-captain, and a signed-out visitor before entering real data. Set up database backups and verify the export path before accumulating real results.

```sql
with club as (
  insert into public.clubs(name) values ('Mauve FC') returning id
)
insert into public.seasons(club_id,name,competition,format)
select id,'Fall 2026','NYC Soccer','7v7 coed' from club
returning club_id,id as season_id;
```

After creating the Auth user, substitute the actual UUIDs below in the SQL editor. Do not use a shared password or add a membership to a user chosen solely by an unverified display name.

```sql
insert into public.club_memberships(club_id,user_id,role)
values ('CLUB_UUID','INVITED_AUTH_USER_UUID','captain');
```

The current private Sites deployment uses static hosting with **live Supabase data**, built with `npm run build:preview` and the saved public project settings. Initial public HTML is generated from a fresh public-only snapshot, then refreshed from Supabase in the browser. The preview build script clears the previous build’s fetch cache before exporting, so a new publication cannot reuse old club data. No captain session or draft is embedded in that snapshot. New player profiles use a stable query route on static hosting. Demo mode remains available locally when `NEXT_PUBLIC_MAUVE_MODE=demo`. Its hosting manifest declares static assets. For the planned server deployment, use Vercel and leave `MAUVE_STATIC_EXPORT` unset; build-time `NEXT_PUBLIC_*` settings require a rebuild after changes. Keep the existing demo URL private until an audience change is explicitly requested.

## Data and authorization

- Public reads use `get_public_club`: explicit profile fields, approved public players, season roster links, fixtures, and published results. Drafts, account IDs, memberships, editor IDs, and correction history are excluded. Public team totals and approved player totals also have SQL views.
- Captain reads use `get_captain_club`, whose security-definer function checks `auth.uid()` against club membership. Base-table column grants expose only the published statistics columns needed by invoker views. All profile, editor, draft, and history fields remain inaccessible directly; self membership and the captain’s own drafts have RLS-protected reads.
- `save_match_result` locks the fixture, verifies membership and the expected revision, validates roster eligibility, and writes the score, player totals, fixture revision and correction history atomically. A failure rolls back the whole operation.
- Each captain has a private draft per fixture. Saving one preserves the published result. A draft retains its base revision; publishing a stale correction is rejected instead of overwriting newer work.
- `save_fixture` and `save_roster_player` enforce the same club scope. New profiles are private by default and are published only after captain approval. Adding an existing player to another season creates an explicit roster entry.
- Forfeits store official and on-field scores separately. An unplayed forfeit can publish an official score without inventing player goals, appearances, or assists. Optional metrics distinguish unknown from zero.
- Kickoffs are stored as UTC instants and edited/displayed in New York time. Missing dates remain null; ambiguous/nonexistent daylight-saving times require a correction.
- Normal signed-in requests use the user’s access token. There is no elevated service-role credential in the application or client bundle.

## Development and verification

`supabase/config.toml` supports a local Supabase stack. The seed contains fictional identities only, and grants no captain memberships. Regenerate it with `npx tsx scripts/generate-demo-seed.ts`.

```sh
npm test
npm run typecheck
npm run build
npm run build:preview
```

The database tests execute the actual migration in an embedded Postgres engine (PGlite), with simulated Supabase Auth roles and JWT identity. They verify authorization, private drafts, transactional correction behavior, stale revisions, roster eligibility, forfeit behavior, and immediate access revocation. The hosted project also passed real API checks for public reads and rejection of anonymous captain mutations/private reads. The owner confirmed real email sign-in and captain access. Vercel deployment remains a future hosting option.

For a backup, use Supabase’s managed database backups plus a restricted administrative `pg_dump` export. Test restoring migrations and result/player-stat data in a separate development project. Do not expose backup endpoints publicly or put privileged database credentials in the web app.


## Hosted security review

Supabase’s security advisor reported no remaining error-level findings after the hosted permission migration. The intentionally public `get_public_club` security-definer function returns only the explicit public projection. Signed-in security-definer mutation functions each verify club captain membership; their execute grants are intentional. Tables without read policies are deliberately closed. See the [public definer function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [RLS policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the checks and expected interpretations.

The Free-plan default mailer only sends to Supabase organization team addresses. Custom SMTP is needed for general teammate email delivery; do not enable it without a real sending provider and credentials.

## LeagueApps worker

Deploy `supabase/functions/leagueapps-sync` with its `deno.json` and shared adapter.
Its `verify_jwt=false` setting is intentional: Postgres dispatches a private,
short-lived, single-use job capability; the worker validates it via the
service-only begin RPC before doing any work. Anonymous requests cannot queue
jobs or invoke import RPCs. The service credential exists only in the Supabase
Edge Function environment. Prefer the injected `SUPABASE_SECRET_KEYS.default`,
with the legacy injected service-role key as compatibility fallback.

Configure `private.league_sources` with the actual club/season UUIDs, program
`5162244` and team `8032635`. Do not duplicate existing configuration. The hourly
migration installs `pg_cron`, `pg_net`, the protected dispatcher and the job at
minute 17 every hour. The dispatch URL is project-specific and must be changed
when reproducing in another project. Initial import uses the same dispatcher.
Inspect `private.league_runs` for state/counts and `private.league_changes` for
source before/after history. Never export job capabilities to public diagnostics.

Public freshness is in `get_public_club(...).league`; source conflicts are only
included in the captain projection. Requests within five minutes of the latest
job are coalesced. Stuck jobs expire after ten minutes. The next refresh can
recover; prior successful data remains visible.
