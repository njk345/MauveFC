# Private team accounts and availability

The public club pages and private team workspace use separate projections.
Signing in is not sufficient for team access: the verified Auth identity must
have a club membership. A player account links to exactly one roster profile in
that club. All players can see the private roster, match availability and lineups
the captain has shared. Only captains can manage access, save private lineup drafts, or publish official lineups/results. Members can build and post suggested lineups.

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

Captains can assign non-roster guest substitutes to individual games from the
match’s stats editor or Team & lineups. Guests use the same club player directory
as roster players, so former teammates keep their existing identity and history.
Only assigned games accept their stats and lineup selections. New guest profiles
are private and create no team account; guest assignment itself records no RSVP
or appearance. Members can use assigned guests in lineup suggestions and exports.
Players → Club directory lists all known club players for signed-in members.

Captains can save 2-3-1, 3-2-1 or 2-2-2 lineups, choose seven starters and list
substitutes. Drafts are captain-only. Saving changes as a draft preserves the
previous shared lineup; sharing replaces it atomically. Duplicate and ineligible
players are rejected, and all seven starters are required before sharing. Revision
checks reject stale edits. Each official publication is retained as a selectable version,
with the latest official version shown by default. Unsharing removes all official
versions for that match from the team area and keeps the captain draft.

Separate **Official lineups** and **Team suggestions** selectors browse posted
versions for the selected match. Any member can create a lineup from a selected
version (or start empty), then post a complete seven-player suggestion. Suggestions
never overwrite the captain's official lineup or draft. An author can remove their
own suggestion; captains can remove any suggestion. Author labels use roster names,
never account emails. Only captains can save and reopen an unposted draft. Member
work stays in memory until posted; it is not stored in localStorage.

Position substitutes can be assigned from each selected bench player's **Position
on sheet** selector. Choose a role to place their name below that starter, or keep
**General substitutes** to leave them off the pitch. All selected substitutes also
remain in the list below the diagram. Multiple subs can share a position; pitch
rows and the PNG export grow to fit their names. Changing formations preserves
assignments for matching roles and returns removed roles to the general bench.
Promoting or removing a substitute clears their old assignment.

**First names only on team sheet** shortens starter and substitute names in the
pitch, bench list and PNG. Shirt numbers remain visible to distinguish teammates
with the same first name. In the editor, this preference is saved with the draft
or post. When viewing a posted sheet, anyone can change their local display/export
without editing the saved lineup or roster names. Existing lineups default to
full names and a general bench. These display options do not publish player data.

**Hide jersey numbers** removes the starter number blocks and all substitute
number labels from the team sheet and PNG. Starter names move into the lime main
boxes, with position substitutes directly below. The option follows the same
saved-versus-local-view behavior as the first-name setting. Existing sheets keep
showing numbers until the option is selected; roster numbers are unchanged.

**Save image** prepares the current PNG in the signed-in browser as lineup changes
settle, so the click can open native save controls immediately. On supporting
phones it opens a file-only image share sheet; on iPhone/iPad choose **Save Image**
to add it to Photos. Android destinations depend on installed photo apps. No
Downloads-folder step is required for this mobile flow.

On supporting desktop browsers, Save image opens a location picker starting in
Pictures. On other browsers it opens the image preview for right-click → Save
Image As, or touch-and-hold on mobile. A website cannot silently write into the
camera roll or a desktop Photos library: the device controls its save actions.
**Preview image** is always available; Download PNG remains an optional fallback.
Cancelling native save/share is quiet and never starts a download. If a native
operation fails, the same image is shown in the preview for manual saving.

The image includes the current formation, names/numbers and substitutes, including
incomplete or unposted formations. The prepared file and object URL stay only in
browser memory, regenerate when the sheet changes, and are cleared on unmount or
sign-out. Saving never posts a lineup, sends notifications or uploads player data.

Backend: `private.lineup_posts` holds immutable official/suggested snapshots with
RLS enabled and all direct client table access revoked. Three narrowly granted
invoker RPCs delegate to membership-checked private functions. Captain-only official
publishing retains the existing server-side authorization and revision checks.
The official-publication trigger never records private draft edits. The additive
migration preserves any currently shared official lineup as its first snapshot.
The `lineup_position_substitutes` migration validates the optional `benchPositions`
and `firstNamesOnly` fields for captain and suggestion writes; suggestion
projections retain both fields. No existing lineup records are rewritten.

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

`tests/image_save_browser.py` also checks the direct mobile image action,
transient user activation, image regeneration after edits, native cancellation,
desktop Pictures-folder saving, write-failure cleanup and unsupported-browser
previews. Native share/file-picker APIs are mocked, so no OS app receives an image
and no real desktop file is written by the test. Available photo-library actions
still depend on the device and browser.
