"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { positionGroupLabel } from "@/lib/player-positions";
import { Check, LockKeyhole, LogOut, RefreshCw, Users } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import { date, time } from "@/lib/format";
import { LineupBoard } from "./lineup-board";
import { MatchGuests } from "./match-guests";
import { applyGuestToMatch, matchPlayers } from "@/lib/match-players";
import { orderMatches } from "@/features/matches/order";
import {
  readTeamClub,
  writeRsvp,
  type TeamSnapshot,
} from "@/lib/supabase/repository";
import type { Match, MatchRsvp, Player, RsvpResponse } from "@/lib/types";
const choices = [
  ["in", "In"],
  ["maybe", "Maybe"],
  ["out", "Out"],
] as const;
function rsvpsOpen(match: Match) {
  return (
    match.status === "scheduled" &&
    (!match.kickoff || Date.parse(match.kickoff) > Date.now())
  );
}
export function TeamPage() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <div className="section page-section" role="status">
        Checking team access…
      </div>
    );
  if (!auth.live || !auth.user || !auth.member)
    return (
      <div className="section page-section">
        <section className="access-panel">
          <LockKeyhole size={30} />
          <span className="eyebrow">MEMBERS ONLY</span>
          <h1>The dressing room.</h1>
          <p>
            {auth.user
              ? "Your account does not have team access. Ask your captain for an invitation or to restore your membership."
              : "Sign in with your invited team account to see the private roster, availability and shared lineups."}
          </p>
          {auth.user ? (
            <button
              className="button secondary"
              onClick={() => void auth.signOut()}
            >
              Sign out
            </button>
          ) : (
            <Link className="button" href="/login/">
              Team sign-in
            </Link>
          )}
        </section>
      </div>
    );
  return <TeamWorkspace key={`${auth.user.id}:${auth.captain}`} />;
}
function TeamWorkspace() {
  const auth = useAuth(),
    { seasonId, setNotice } = usePrototype(),
    [data, setData] = useState<TeamSnapshot | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("matches"),
    [selected, setSelected] = useState(""),
    [dirty, setDirty] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [guestBusy, setGuestBusy] = useState(false);
  const refreshAccess = auth.refreshAccess;
  const latestRefresh = useRef(0);
  const load = useCallback(
    async (showProgress: boolean) => {
      const request = ++latestRefresh.current;
      if (showProgress) setRefreshing(true);
      try {
        const next = await readTeamClub();
        if (request !== latestRefresh.current) return;
        setData(next);
        setError("");
      } catch (e) {
        if (request !== latestRefresh.current) return;
        setError(e instanceof Error ? e.message : "Could not load the team.");
        void refreshAccess().catch(() => {});
      } finally {
        if (request === latestRefresh.current) setRefreshing(false);
      }
    },
    [refreshAccess],
  );
  const refresh = () => load(true);
  useEffect(() => {
    void load(false);
    const focus = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    const timer = setInterval(focus, 60000);
    window.addEventListener("focus", focus);
    return () => {
      latestRefresh.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  function switchView(action: () => void) {
    if (guestBusy) return;
    if (dirty && !window.confirm("Discard unsaved lineup changes?")) return;
    setDirty(false);
    action();
  }
  const seasonFixtures =
    data?.matches.filter((m) => m.seasonId === seasonId) || [];
  const fixtures = orderMatches(seasonFixtures);
  const upcoming = fixtures.filter(rsvpsOpen);
  const match =
    fixtures.find((m) => m.id === selected) ||
    upcoming[0] ||
    orderMatches(seasonFixtures, "newest-first")[0];
  const matchId = match?.id;
  useEffect(() => {
    // Keep the initially displayed match selected if a refresh adds or
    // reorders fixtures while someone is working on its lineup.
    if (matchId) setSelected(matchId);
  }, [matchId]);
  if (!data)
    return (
      <div className="section page-section">
        <div className="access-panel" role="status">
          <h1>
            {error ? "Team data is unavailable." : "Loading the dressing room…"}
          </h1>
          {error && (
            <>
              <p>{error}</p>
              <button
                className="button secondary"
                onClick={() => void refresh()}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  const rosterPlayers = data.players.filter((p) =>
      data.roster.some((r) => r.seasonId === seasonId && r.playerId === p.id),
    ),
    eligible = matchPlayers(data.players, data.roster, match);
  return (
    <div className="section page-section team-page">
      <PageHeading
        eyebrow="MEMBERS ONLY / THE DRESSING ROOM"
        title="Our club. Our corner."
        description="Your squad, your availability, and the plan for Thursday."
      >
        <button
          className="text-link"
          onClick={() => void auth.signOut().catch((e) => setNotice(e.message))}
        >
          <LogOut size={14} />
          Sign out
        </button>
      </PageHeading>
      <div className="team-privacy">
        <LockKeyhole size={17} />
        <p>
          Only team members can see this area. Public player profiles are
          approved separately by the captain.
        </p>
      </div>
      <div className="team-toolbar">
        <div className="tabs" aria-label="Team views">
          <button
            className={tab === "matches" ? "selected" : ""}
            aria-pressed={tab === "matches"}
            onClick={() => switchView(() => setTab("matches"))}
          >
            Matches & lineups
          </button>
          <button
            className={tab === "roster" ? "selected" : ""}
            aria-pressed={tab === "roster"}
            onClick={() => switchView(() => setTab("roster"))}
          >
            Private roster ({rosterPlayers.length})
          </button>
        </div>
        <button
          className="text-link"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          {refreshing ? "Refreshing…" : "Refresh team"}
        </button>
      </div>
      {error && (
        <p className="form-errors" role="status">
          {error} Use Refresh team to try again.
        </p>
      )}
      {tab === "roster" ? (
        <div className="team-roster-grid">
          {rosterPlayers.map((p) => (
            <Link
              key={p.id}
              className="team-player-card team-profile-link"
              href={playerHref(p.id)}
            >
              <div className="team-shirt-number">{p.number}</div>
              <div>
                <h2>
                  {p.name}
                  {p.id === auth.playerId && <span className="pill">YOU</span>}
                </h2>
                <span className="eyebrow">{positionGroupLabel(p)}</span>
                {p.hometown && <p>{p.hometown}</p>}
                {p.bio && <p>{p.bio}</p>}
                <small>
                  {p.isPublic ? "Public profile approved" : "Team-only profile"}
                </small>
              </div>
            </Link>
          ))}
          {!rosterPlayers.length && (
            <p>No players have been added to this season.</p>
          )}
        </div>
      ) : (
        <>
          <section className="team-upcoming" aria-label="Upcoming fixtures">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE NEXT WHISTLE</span>
                <h2>Who’s coming?</h2>
              </div>
            </div>
            {!upcoming.length ? (
              <div className="team-empty">
                <Users size={24} />
                <h3>No upcoming fixtures yet.</h3>
                <p>
                  RSVPs will open when the next fixture is announced. You can
                  still view past match lineups below.
                </p>
              </div>
            ) : (
              upcoming.map((m) => (
                <article className="team-fixture" key={m.id}>
                  <div>
                    <span className="eyebrow">
                      MATCHDAY {m.round} · {date(m.kickoff, "long")}
                    </span>
                    <h3>{m.opponent}</h3>
                    <p>
                      {time(m.kickoff)} · {m.venue}
                    </p>
                    <button
                      className="text-link"
                      onClick={() => switchView(() => setSelected(m.id))}
                    >
                      See availability & lineup
                    </button>
                  </div>
                  <RsvpControl
                    match={m}
                    reply={data.rsvps.find(
                      (r) => r.matchId === m.id && r.playerId === auth.playerId,
                    )}
                    eligible={rosterPlayers.some((p) => p.id === auth.playerId)}
                    onRefresh={refresh}
                  />
                </article>
              ))
            )}
          </section>
          {match && (
            <section className="team-match-section">
              <div className="team-match-heading">
                <div>
                  <span className="eyebrow">THE MATCH PLAN</span>
                  <h2>Availability & lineup</h2>
                </div>
                <label className="form-field">
                  <span>Match</span>
                  <select
                    value={match.id}
                    disabled={guestBusy}
                    onChange={(e) =>
                      switchView(() => setSelected(e.target.value))
                    }
                  >
                    {fixtures.map((m) => (
                      <option value={m.id} key={m.id}>
                        MD {m.round} · {m.opponent}
                        {rsvpsOpen(m) ? "" : " · Past / closed"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                {date(match.kickoff, "long")} · {time(match.kickoff)} ·{" "}
                {match.venue}
              </p>
              <MatchGuests
                key={`guests-${match.id}`}
                match={match}
                players={data.players}
                canRemove={!dirty}
                onBusy={setGuestBusy}
                onChange={(change) => {
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          players: [
                            ...current.players.filter(
                              (p) => p.id !== change.player.id,
                            ),
                            change.player,
                          ],
                          matches: current.matches.map((m) =>
                            applyGuestToMatch(m, change),
                          ),
                        }
                      : current,
                  );
                }}
              />
              <div className="team-match-grid">
                <Availability
                  players={rosterPlayers}
                  rsvps={data.rsvps.filter((r) => r.matchId === match.id)}
                />
                <LineupBoard
                  key={match.id}
                  match={match}
                  lineup={data.lineups.find((l) => l.matchId === match.id)}
                  players={eligible}
                  posts={data.lineupPosts.filter((p) => p.matchId === match.id)}
                  onRefresh={refresh}
                  onDirty={setDirty}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function RsvpControl({
  match,
  reply,
  eligible,
  onRefresh,
}: {
  match: Match;
  reply?: MatchRsvp;
  eligible: boolean;
  onRefresh: () => Promise<void>;
}) {
  const auth = useAuth(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function respond(response: RsvpResponse | null) {
    setBusy(true);
    setError("");
    try {
      await writeRsvp(match.id, response);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save RSVP.");
    } finally {
      setBusy(false);
    }
  }
  if (!eligible)
    return (
      <div className="rsvp-control">
        <p>
          {auth.captain
            ? "Link your player profile to reply for yourself."
            : "Ask your captain to link you to this season’s roster."}
        </p>
        {auth.captain && (
          <Link className="text-link" href="/captain/access/">
            Link my profile
          </Link>
        )}
      </div>
    );
  return (
    <div className="rsvp-control">
      <span className="eyebrow">YOUR RSVP</span>
      {reply?.needsConfirmation && (
        <p className="rsvp-reconfirm">
          Kickoff changed. Please confirm your reply.
        </p>
      )}
      <div className="rsvp-buttons">
        {choices.map(([id, label]) => (
          <button
            key={id}
            className={`rsvp-${id} ${reply?.response === id && !reply.needsConfirmation ? "chosen" : ""}`}
            aria-pressed={reply?.response === id && !reply.needsConfirmation}
            disabled={busy}
            onClick={() => void respond(id)}
          >
            {reply?.response === id && !reply.needsConfirmation && (
              <Check size={13} />
            )}{" "}
            {label}
          </button>
        ))}
      </div>
      {reply && (
        <button
          className="text-link"
          disabled={busy}
          onClick={() => void respond(null)}
        >
          Clear reply
        </button>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <span className="help-text">Visible to team members.</span>
    </div>
  );
}
function Availability({
  players,
  rsvps,
}: {
  players: Player[];
  rsvps: MatchRsvp[];
}) {
  const group = (id: string) =>
    players.filter((p) => {
      const r = rsvps.find((r) => r.playerId === p.id);
      return id === "none"
        ? !r
        : id === "reconfirm"
          ? r?.needsConfirmation
          : r?.response === id && !r.needsConfirmation;
    });
  return (
    <article className="availability-panel">
      <span className="eyebrow">THE HEADCOUNT</span>
      <h3>Match availability</h3>
      <p className="help-text">
        Availability is a plan, not a record of who played.
      </p>
      <div className="availability-counts">
        {choices.map(([id, label]) => (
          <div key={id} className={`count-${id}`}>
            <strong>{group(id).length}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {(
        [
          ...choices,
          ["reconfirm", "Please reconfirm"],
          ["none", "No reply"],
        ] as const
      ).map(([id, label]) => (
        <div className="availability-group" key={id}>
          <h4>
            {label} <span>{group(id).length}</span>
          </h4>
          {group(id).length ? (
            <ul>
              {group(id).map((p) => (
                <li key={p.id}>
                  <span className="muted">#{p.number}</span>
                  {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">—</p>
          )}
        </div>
      ))}
    </article>
  );
}
