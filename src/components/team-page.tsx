"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { playerHref } from "@/lib/player-link";
import { positionGroupLabel } from "@/lib/player-positions";
import {
  CalendarDays, Check, Clock3, LockKeyhole, LogOut, MapPin, RefreshCw, Users,
} from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import { date, time } from "@/lib/format";
import { LineupBoard } from "./lineup-board";
import { CaptainPage } from "./captain-page";
import { Crest, OpponentBadge } from "./brand";
import { PlayoffBadge } from "./playoff-celebration";
import { ResultDecision } from "./result-decision";
import { MatchGuests } from "./match-guests";
import { matchdayHref } from "@/lib/matchday-link";
import { applyGuestToMatch, matchPlayers } from "@/lib/match-players";
import { orderMatches } from "@/features/matches/order";
import { captureSummary } from "@/features/matches/player-stats";
import {
  readTeamClub,
  writeRsvp,
  type TeamSnapshot,
} from "@/lib/supabase/repository";
import type { GuestChange, Match, MatchRsvp, Player, RsvpResponse } from "@/lib/types";
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
function canReport(match: Match) {
  return match.status !== "cancelled" && (
    match.status === "completed" ||
    !!match.result?.published ||
    (match.status === "scheduled" && !rsvpsOpen(match))
  );
}
function fixtureStatus(match: Match) {
  if (match.status === "cancelled") return "Cancelled";
  if (match.result?.published) return "Full time";
  if (match.status === "postponed") return "Postponed";
  return canReport(match) ? "Awaiting result" : "Upcoming";
}
export function TeamPage() {
  const auth = useAuth();
  const params = useSearchParams();
  const matchRequest = params.get("match");
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
            <Link
              className="button"
              href={matchRequest
                ? matchdayHref(matchRequest, params.get("view") === "report", "/login/")
                : "/login/"}
            >
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
    { seasonId, setSeasonId, setNotice, matches: clubMatches, refresh: refreshClub } = usePrototype(),
    [data, setData] = useState<TeamSnapshot | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("matches"),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<"lineup" | "report">("lineup"),
    [lineupDirty, setLineupDirty] = useState(false),
    [reportDirty, setReportDirty] = useState(false),
    [reportBusy, setReportBusy] = useState(false),
    [openingReport, setOpeningReport] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [guestBusy, setGuestBusy] = useState(false);
  const params = useSearchParams();
  const requested = params.toString();
  const requestedMatch = params.get("match");
  const handledRequest = useRef<string | undefined>(undefined);
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
    if (guestBusy || reportBusy || openingReport) return;
    if (lineupDirty && !window.confirm("Discard unsaved lineup changes?")) return;
    if (reportDirty && !window.confirm("Discard unsaved match report changes?")) return;
    action();
  }
  function clearEdits() {
    setLineupDirty(false);
    setReportDirty(false);
  }
  function openTab(next: string) {
    if (tab === next) return;
    switchView(() => {
      clearEdits();
      setTab(next);
    });
  }
  function openMatch(id: string, nextView: "lineup" | "report") {
    switchView(() => {
      function select() {
        clearEdits();
        const href = matchdayHref(id, nextView === "report");
        handledRequest.current = href.split("?")[1];
        window.history.replaceState(null, "", href);
        setSelected(id);
        setView(nextView);
      }
      if (nextView === "lineup") {
        select();
        return;
      }
      setOpeningReport(true);
      void refreshClub()
        .then(select, () => setNotice("Could not load the latest match report. Try again."))
        .finally(() => setOpeningReport(false));
    });
  }
  function changeGuest(change: GuestChange) {
    setData((current) =>
      current
        ? {
            ...current,
            players: [
              ...current.players.filter((p) => p.id !== change.player.id),
              change.player,
            ],
            matches: current.matches.map((m) => applyGuestToMatch(m, change)),
          }
        : current,
    );
  }
  const seasonFixtures =
    data?.matches.filter((m) => m.seasonId === seasonId) || [];
  const fixtures = orderMatches(seasonFixtures);
  const match =
    fixtures.find((m) => m.id === selected) ||
    fixtures.find(rsvpsOpen) ||
    orderMatches(seasonFixtures, "newest-first")[0];
  const matchId = match?.id;
  useEffect(() => {
    if (!data || !seasonId) return;
    // Read the actual URL after hydration so links work on the static site.
    const query = new URLSearchParams(window.location.search);
    if (query.toString() !== handledRequest.current) {
      handledRequest.current = query.toString();
      const linked = data.matches.find((m) => m.id === query.get("match"));
      if (linked) {
        if (linked.seasonId !== seasonId) setSeasonId(linked.seasonId);
        setSelected(linked.id);
        setTab("matches");
        setView(auth.captain && query.get("view") === "report" && canReport(linked) ? "report" : "lineup");
        return;
      }
    }
    // Keep the initially displayed match selected if a refresh adds or
    // reorders fixtures while someone is working on its lineup.
    if (matchId !== selected) {
      setSelected(matchId || "");
      setView("lineup");
      setReportDirty(false);
      setReportBusy(false);
      if (matchId && query.has("match") && data.matches.some((m) => m.id === query.get("match"))) {
        const href = matchdayHref(matchId);
        handledRequest.current = href.split("?")[1];
        window.history.replaceState(null, "", href);
      }
    }
  }, [auth.captain, data, matchId, requested, seasonId, selected, setSeasonId]);
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
  const season = data.seasons.find((s) => s.id === seasonId);
  const posts = data.lineupPosts.filter((p) => p.matchId === match?.id);
  const latestOfficial = posts.find((p) => p.kind === "official");
  const captainMatch = auth.captain ? clubMatches.find((m) => m.id === match?.id) : undefined;
  const showReport = !!match && auth.captain && canReport(match);
  const reportOpen = showReport && view === "report" && selected === match.id;
  const busy = guestBusy || reportBusy || openingReport;
  const missingMatch = requestedMatch && !data.matches.some((m) => m.id === requestedMatch);
  return (
    <div className="section page-section team-page">
      <PageHeading
        eyebrow="MEMBERS ONLY / THE DRESSING ROOM"
        title="Our club. Our corner."
        description="Your fixtures, RSVP, and the captain’s match plan."
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
            onClick={() => openTab("matches")}
          >
            Matchday
          </button>
          <button
            className={tab === "roster" ? "selected" : ""}
            aria-pressed={tab === "roster"}
            onClick={() => openTab("roster")}
          >
            Private roster ({rosterPlayers.length})
          </button>
        </div>
        <button
          className="text-link"
          disabled={refreshing || busy}
          onClick={() => {
            void refresh();
            if (auth.captain) void refreshClub().catch((e) => setNotice(e.message));
          }}
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
        <section className="team-match-section" aria-labelledby="matchday-title">
          <div className="team-match-heading">
            <div>
              <h2 id="matchday-title">Matchday hub</h2>
              {season && <p>{season.name} · {season.competition}</p>}
            </div>
            {match && (
              <label className="form-field">
                <span>Match</span>
                <select
                  value={match.id}
                  disabled={busy}
                  onChange={(e) => openMatch(e.target.value, "lineup")}
                >
                  {fixtures.map((m) => (
                    <option value={m.id} key={m.id}>
                      {date(m.kickoff, "short", season?.timeZone)} · {m.opponent}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {missingMatch && (
            <p className="form-errors" role="status">That fixture is unavailable. Choose a match from the current season.</p>
          )}
          {!match ? (
            <div className="team-empty">
              <Users size={24} />
              <h3>No fixtures for this season.</h3>
              <p>Choose another season to see its matchdays.</p>
            </div>
          ) : (
            <>
              <article className="matchday-fixture" aria-labelledby="matchday-fixture-title">
                <div className="matchday-fixture-main">
                  <div className="matchday-fixture-status">
                    <span className="pill">{fixtureStatus(match)}</span>
                    <span>Matchday {match.round}</span>
                    <PlayoffBadge match={match} />
                  </div>
                  <div className="matchday-teams">
                    <Crest small />
                    <h3 id="matchday-fixture-title">
                      {season?.teamName || "Mauve FC"}
                      <span className="matchday-score">
                        {match.result?.published ? `${match.result.home} – ${match.result.away}` : "vs"}
                      </span>
                      {match.opponent}
                    </h3>
                    <OpponentBadge small code={match.opponentCode} color={match.color} />
                  </div>
                  {match.result?.published && <ResultDecision result={match.result} />}
                  <ul className="matchday-details">
                    <li><CalendarDays size={16} /> {date(match.kickoff, "long", season?.timeZone)}</li>
                    <li><Clock3 size={16} /> {time(match.kickoff, season?.timeZone)}</li>
                    <li><MapPin size={16} /> {match.venue || "Venue to be confirmed"}</li>
                  </ul>
                </div>
                {rsvpsOpen(match) && (
                  <RsvpControl
                    key={match.id}
                    match={match}
                    reply={data.rsvps.find(
                      (r) => r.matchId === match.id && r.playerId === auth.playerId,
                    )}
                    eligible={rosterPlayers.some((p) => p.id === auth.playerId)}
                    onRefresh={refresh}
                  />
                )}
              </article>
              {showReport && (
                <div className="matchday-controls">
                  <div className="tabs" aria-label="Matchday views">
                    <button
                      type="button"
                      className={!reportOpen ? "selected" : ""}
                      aria-pressed={!reportOpen}
                      disabled={busy}
                      onClick={() => {
                        if (reportOpen) openMatch(match.id, "lineup");
                      }}
                    >
                      Availability & lineup
                    </button>
                    <button
                      type="button"
                      className={reportOpen ? "selected" : ""}
                      aria-pressed={reportOpen}
                      disabled={busy}
                      onClick={() => {
                        if (!reportOpen) openMatch(match.id, "report");
                      }}
                    >
                      {openingReport ? "Opening report…" : "Result & player stats"}
                    </button>
                  </div>
                  <span role="status">
                    {captainMatch?.needsReview ? "LeagueApps score needs review" : `Player stats: ${captureSummary(match).toLowerCase()}`}
                  </span>
                </div>
              )}
              {reportOpen ? (
                <CaptainPage
                  key={match.id}
                  matchday={{
                    matchId: match.id,
                    officialLineup: latestOfficial?.payload,
                    onDirty: setReportDirty,
                    onBusy: setReportBusy,
                    onGuestChange: changeGuest,
                    onPublished: refresh,
                  }}
                />
              ) : (
                <div inert={openingReport}>
                  <MatchGuests
                    key={`guests-${match.id}`}
                    match={match}
                    players={data.players}
                    canRemove={!lineupDirty}
                    onBusy={setGuestBusy}
                    onChange={changeGuest}
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
                      posts={posts}
                      onRefresh={refresh}
                      onDirty={setLineupDirty}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </section>
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
      <p className="help-text">RSVPs show who plans to come.</p>
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
