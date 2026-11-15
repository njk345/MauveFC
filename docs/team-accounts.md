# Private team accounts and availability

The public club pages and private team workspace use separate projections.
Signing in is not sufficient for team access: the verified Auth identity must
have a club membership. A player account links to exactly one roster profile in
that club. All players can see the private roster, match availability and lineups
the captain has shared. Only captains can manage access or edit lineups/results.

## Captain workflow

1. Open **Captain → Player accounts**, choose a roster entry and enter that
   person’s email. Create and copy the private invitation; share it directly with
   that player. The application does not send an email.
2. The player opens the link, presses **Accept invitation** and chooses a
   password. Subsequent visits use **Password** sign-in. Existing captain email
   links and code entry remain available under **Email link**.
3. Use **Link my profile** to connect the current captain account to their own
   roster entry, so the captain can RSVP without creating a second account.
4. To remove access, revoke the player’s membership. Their roster profile, match
   statistics and historical RSVPs remain. Pending invitations are cancelled.

Email addresses and account status are captain-only. Authentication links remain
in the captain’s current browser state, are returned with `Cache-Control:
no-store`, and are never stored in public club responses. Token hashes travel in
the invitation fragment rather than request URLs; previewing the URL does not
consume it. Acceptance requires an explicit button press.

The `player-invite` Edge Function verifies the user JWT and captain membership
before generating a one-use Auth link. Its elevated credential comes only from
the function environment. It generates no recovery credential for a captain,
another club’s account or an existing unlinked identity: those identities must
sign in normally. A pending invite is claimed by `get_team_access` only for its
verified email, before expiry, and is consumed once. User-editable metadata has
no role in authorization. Captain roles are preserved when linking a profile.

Pending membership invitations expire after seven days. The generated Auth link
can expire sooner according to the project’s Auth settings; create a fresh link
if needed. Public sign-ups remain disabled. This flow does not require SMTP.

## Matches and lineups

Players can change only their own **In / Maybe / Out** response for a scheduled,
future fixture on their season roster. A kickoff change marks existing replies
as needing confirmation. Cancelled, completed and past fixtures are closed.
RSVPs and lineup selections never create appearances, goals or assists.

Captains can save 2-3-1, 3-2-1 or 2-2-2 lineups, choose seven starters and list
substitutes. Drafts are captain-only. Saving changes as a draft preserves the
previous shared lineup; sharing replaces it atomically. Duplicate and ineligible
players are rejected, and all seven starters are required before sharing. Revision
checks reject stale edits. Captains can unshare a lineup without losing its draft.

The team area refreshes on focus and periodically while visible. Signing out or
losing membership clears the private workspace. Private data is never embedded
in the static export or written to demo browser storage.

## Deployment

Apply the complete `20261113162329_player_accounts_and_rsvps.sql` migration with
the supported Supabase migration mechanism. It includes tables, scoped functions,
explicit execute grants and RLS. Its schema setup can resume safely from the
empty tables created during the interrupted deployment. Do not manually insert
records into the Supabase migration ledger.

Deploy `supabase/functions/player-invite/index.ts` with its `deno.json`, keeping
`verify_jwt = true`. Then build and publish the existing Site. Preserve its audience:
Sites access is a separate outer gate from Supabase membership. The owner approved
public access on November 15, 2026, so teammates can reach the club pages and
sign-in without the owner-only Sites gate. The private roster, RSVPs and lineups
still require invited Supabase membership; captain tools still require captain
authorization.

`npm test` executes the migration in PGlite with simulated Auth roles. The
`tests/team_browser.py` contract test intercepts all service calls and uses a
synthetic roster and future fixture. It covers explicit invite acceptance,
password setup/login, private roster access, RSVP changes/reconfirmation, lineup
drafts/sharing, private invite creation, revocation and mobile/desktop layouts.
These browser tests create no production accounts, fixtures, invitations or emails.
