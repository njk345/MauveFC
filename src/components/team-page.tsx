"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, LockKeyhole, LogOut, RefreshCw, Users } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import { date, time } from "@/lib/format";
import { formations } from "@/lib/formations";
import {
  readTeamClub,
  writeRsvp,
  writeLineup,
  unshareLineup,
  type TeamSnapshot,
} from "@/lib/supabase/repository";
import type {
  Formation,
  LineupPayload,
  Match,
  MatchLineup,
  MatchRsvp,
  Player,
  RsvpResponse,
} from "@/lib/types";
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
    [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      const next = await readTeamClub();
      setData(next);
      setError("");
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not load the team.");
      void auth.refreshAccess().catch(() => {});
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await readTeamClub();
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError(e instanceof Error ? e.message : "Could not load the team.");
          void auth.refreshAccess().catch(() => {});
        }
      }
    }
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(focus, 60000);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  function switchView(action: () => void) {
    if (dirty && !window.confirm("Discard unsaved lineup changes?")) return;
    setDirty(false);
    action();
  }
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
  const fixtures = data.matches
      .filter((m) => m.seasonId === seasonId)
      .sort((a, b) => (a.kickoff || "9999").localeCompare(b.kickoff || "9999")),
    upcoming = fixtures.filter(rsvpsOpen),
    match =
      fixtures.find((m) => m.id === selected) || upcoming[0] || fixtures.at(-1),
    eligible = data.players.filter((p) =>
      data.roster.some((r) => r.seasonId === seasonId && r.playerId === p.id),
    );
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
            Private roster ({eligible.length})
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
      {tab === "roster" ? (
        <div className="team-roster-grid">
          {eligible.map((p) => (
            <article key={p.id} className="team-player-card">
              <div className="team-shirt-number">{p.number}</div>
              <div>
                <h2>
                  {p.name}
                  {p.id === auth.playerId && <span className="pill">YOU</span>}
                </h2>
                <span className="eyebrow">{p.position}</span>
                {p.hometown && <p>{p.hometown}</p>}
                {p.bio && <p>{p.bio}</p>}
                <small>
                  {p.isPublic ? "Public profile approved" : "Team-only profile"}
                </small>
              </div>
            </article>
          ))}
          {!eligible.length && (
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
                    eligible={eligible.some((p) => p.id === auth.playerId)}
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
              <div className="team-match-grid">
                <Availability
                  players={eligible}
                  rsvps={data.rsvps.filter((r) => r.matchId === match.id)}
                />
                <LineupBoard
                  key={match.id}
                  match={match}
                  lineup={data.lineups.find((l) => l.matchId === match.id)}
                  players={eligible}
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
function LineupBoard({
  match,
  lineup,
  players,
  onRefresh,
  onDirty,
}: {
  match: Match;
  lineup?: MatchLineup;
  players: Player[];
  onRefresh: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const auth = useAuth(),
    [payload, setPayload] = useState<LineupPayload>(
      lineup?.payload || {
        formation: "2-3-1",
        starters: Array(7).fill(null),
        bench: [],
      },
    ),
    [revision, setRevision] = useState(lineup?.revision || 0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) {
      setPayload(
        lineup?.payload || {
          formation: "2-3-1",
          starters: Array(7).fill(null),
          bench: [],
        },
      );
      setRevision(lineup?.revision || 0);
    }
  }, [lineup, dirty]);
  function change(next: LineupPayload) {
    setPayload(next);
    setDirty(true);
    onDirty(true);
    setError("");
  }
  async function save(publish: boolean) {
    setBusy(true);
    setError("");
    try {
      await writeLineup(match.id, revision, payload, publish);
      setDirty(false);
      onDirty(false);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save lineup.");
    } finally {
      setBusy(false);
    }
  }
  async function unshare() {
    setBusy(true);
    setError("");
    try {
      await unshareLineup(match.id, revision);
      setDirty(false);
      onDirty(false);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unshare lineup.");
    } finally {
      setBusy(false);
    }
  }
  if (!auth.captain && !lineup)
    return (
      <article className="lineup-panel team-empty">
        <LockKeyhole size={25} />
        <h3>The match plan is taking shape.</h3>
        <p>Your captain hasn’t shared a lineup for this match yet.</p>
      </article>
    );
  return (
    <article className="lineup-panel">
      <div className="lineup-heading">
        <div>
          <span className="eyebrow">SEVEN ON THE PITCH</span>
          <h3>
            {auth.captain
              ? "Set the shape."
              : `Our formation · ${payload.formation}`}
          </h3>
        </div>
        <span className="pill">
          {dirty
            ? "UNSAVED"
            : lineup?.hasDraft
              ? "PRIVATE DRAFT"
              : lineup?.shared
                ? "SHARED WITH TEAM"
                : "PRIVATE DRAFT"}
        </span>
      </div>
      {auth.captain && (
        <>
          <label className="form-field">
            <span>Formation</span>
            <select
              value={payload.formation}
              onChange={(e) =>
                change({ ...payload, formation: e.target.value as Formation })
              }
            >
              {Object.keys(formations).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <p className="help-text">
            {lineup?.shared && lineup.hasDraft
              ? "The team still sees the previous shared lineup."
              : "Drafts stay captain-only. Share when all seven starters are chosen."}
          </p>
        </>
      )}
      <div
        className="formation-pitch"
        aria-label={`${payload.formation} formation`}
      >
        <div className="pitch-boundary" />
        <div className="pitch-halfway" />
        <div className="pitch-circle" />
        <div className="pitch-goal-area top" />
        <div className="pitch-goal-area bottom" />
        {formations[payload.formation].map((slot, i) => {
          const player = players.find((p) => p.id === payload.starters[i]);
          return (
            <div
              className="formation-slot"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              key={i}
            >
              <span className="formation-position">{slot.label}</span>
              <span className="formation-player-number">
                {player?.number ?? "—"}
              </span>
              {auth.captain ? (
                <select
                  aria-label={`Starter ${slot.label}`}
                  disabled={busy}
                  value={payload.starters[i] || ""}
                  onChange={(e) => {
                    const starters = [...payload.starters];
                    starters[i] = e.target.value || null;
                    change({
                      ...payload,
                      starters,
                      bench: payload.bench.filter(
                        (id) => id !== e.target.value,
                      ),
                    });
                  }}
                >
                  <option value="">Choose player</option>
                  {players
                    .filter(
                      (p) =>
                        p.id === payload.starters[i] ||
                        !payload.starters.includes(p.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              ) : (
                <strong>{player?.name || "Unassigned"}</strong>
              )}
            </div>
          );
        })}
      </div>
      <div className="lineup-bench">
        <h4>Substitutes</h4>
        {auth.captain ? (
          <div className="bench-options">
            {players
              .filter((p) => !payload.starters.includes(p.id))
              .map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={payload.bench.includes(p.id)}
                    disabled={busy}
                    onChange={(e) =>
                      change({
                        ...payload,
                        bench: e.target.checked
                          ? [...payload.bench, p.id]
                          : payload.bench.filter((id) => id !== p.id),
                      })
                    }
                  />
                  #{p.number} {p.name}
                </label>
              ))}
          </div>
        ) : (
          <p>
            {payload.bench
              .map((id) => players.find((p) => p.id === id)?.name)
              .filter(Boolean)
              .join(" · ") || "No substitutes named."}
          </p>
        )}
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {auth.captain && (
        <div className="button-row">
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => void save(false)}
          >
            {busy ? "Saving…" : "Save lineup draft"}
          </button>
          <button
            className="button small"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Share lineup
          </button>
          {lineup?.shared && (
            <button
              className="text-link"
              disabled={busy}
              onClick={() => void unshare()}
            >
              Unshare lineup
            </button>
          )}
        </div>
      )}
    </article>
  );
}
