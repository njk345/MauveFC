"use client";
import { useState } from "react";
import { Modal } from "./modal";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePrototype } from "./prototype-provider";
import {
  outcome,
  playerStats,
  publishedMatches,
  teamStats,
} from "@/features/stats/queries";
import { CalendarButton, FormBadge, MatchRow } from "./matches";
import { Crest, Jersey, OpponentBadge } from "./brand";
import { date, time } from "@/lib/format";
import type { Match } from "@/lib/types";
import { LeaguePageNote } from "./league-connection";
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function MatchDetails({
  match,
  onClose,
}: {
  match: Match;
  onClose: () => void;
}) {
  const { players, live } = usePrototype();
  const r = match.result?.published ? match.result : undefined;
  return (
    <Modal onClose={onClose}>
      <section
        className="dialog match-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          autoFocus
          className="dialog-close icon-button"
          onClick={onClose}
          aria-label="Close match details"
        >
          <X />
        </button>
        <span className="eyebrow">
          {live ? "FIXTURE" : "SAMPLE FIXTURE"} · MATCHDAY {match.round}
        </span>
        <h2 id="match-title">Mauve FC vs {match.opponent}</h2>
        <p>
          {date(match.kickoff, "long")} · {time(match.kickoff)}
        </p>
        <p>
          <MapPin size={14} /> {match.venue}
        </p>
        {r ? (
          <>
            <div className="dialog-score">
              <Crest />
              <strong>
                {r.home} – {r.away}
              </strong>
              <OpponentBadge code={match.opponentCode} color={match.color} />
            </div>
            <div className="detail-stats">
              <h3>On the scoresheet</h3>
              {r.stats
                .filter((s) => s.goals > 0)
                .map((s) => (
                  <div key={s.playerId}>
                    <Link href={playerHref(s.playerId)}>
                      {players.find((p) => p.id === s.playerId)?.name}
                    </Link>
                    <strong>
                      {s.goals} {s.goals === 1 ? "goal" : "goals"}
                    </strong>
                  </div>
                ))}
              {r.ownGoals > 0 && (
                <div>
                  Opposition own goals <strong>{r.ownGoals}</strong>
                </div>
              )}
              {r.scorers !== "complete" && (
                <p>
                  Scorer attribution is{" "}
                  {r.scorers === "unrecorded" ? "not recorded" : "partial"}.
                </p>
              )}
              {r.assists === "unrecorded" && (
                <p>Assists were not recorded for this match.</p>
              )}
              {r.basis !== "played" && (
                <p>
                  Official score adjusted: {r.reason}. On-field: {r.onFieldHome}
                  –{r.onFieldAway}.
                </p>
              )}
              <div>
                Attendance{" "}
                <strong>
                  {r.attendance === "unrecorded"
                    ? "Not recorded"
                    : `${r.stats.filter((s) => s.appeared).length} recorded · ${r.attendance}`}
                </strong>
              </div>
            </div>
            <Link
              className="button secondary"
              href={`/captain/?match=${match.id}`}
            >
              {live ? "Captain: add player details" : "Try editing this result"}{" "}
              <ArrowUpRight size={16} />
            </Link>
          </>
        ) : (
          <>
            <div className="fixture-status">
              {match.status === "scheduled"
                ? "See you at kickoff."
                : match.status === "postponed"
                  ? "New date to be confirmed."
                  : "This match was cancelled."}
            </div>
            <CalendarButton match={match} compact />
          </>
        )}
        <span className="dialog-sample">
          {live
            ? "All times America/New_York"
            : "Fictional sample data · all times America/New_York"}
        </span>
      </section>
    </Modal>
  );
}
export function SchedulePage() {
  const { matches, seasonId, seasons, players, live } = usePrototype(),
    [filter, setFilter] = useState("upcoming"),
    [selected, setSelected] = useState<Match | null>(null),
    season = seasons.find((s) => s.id === seasonId)!;
  const fixtures = matches.filter((m) => m.seasonId === seasonId),
    awaiting = fixtures.filter(
      (m) =>
        live &&
        !m.result?.published &&
        m.status === "scheduled" &&
        m.kickoff &&
        Date.parse(m.kickoff) < Date.now(),
    ),
    upcoming = fixtures.filter(
      (m) =>
        !m.result?.published &&
        m.status !== "cancelled" &&
        !awaiting.includes(m),
    ),
    visible =
      filter === "upcoming"
        ? upcoming
        : filter === "awaiting"
          ? awaiting
          : fixtures;
  return (
    <div className="section page-section">
      <PageHeading
        eyebrow={`${season.name} / THE FIXTURE LIST`}
        title="See you on Thursday."
        description="The next whistle, the next challenge, the next reason to get together."
      >
        <span className="outline-label">
          {season.competition} · {season.format}
        </span>
      </PageHeading>
      <LeaguePageNote />
      <div className="schedule-layout">
        <div>
          <div className="list-toolbar">
            <div className="tabs" aria-label="Schedule filter">
              {[
                ["upcoming", `Upcoming (${upcoming.length})`],
                ["all", `All matches (${fixtures.length})`],
                ...(awaiting.length
                  ? [["awaiting", `Awaiting results (${awaiting.length})`]]
                  : []),
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={filter === id}
                  className={filter === id ? "selected" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="muted small-text">All times New York</span>
          </div>
          <div className="match-list">
            {visible.length ? (
              visible.map((m) => (
                <MatchRow key={m.id} match={m} onOpen={setSelected} />
              ))
            ) : (
              <div className="empty-state">
                <Crest />
                <h2>
                  {live && !fixtures.length
                    ? "The next kickoff is on its way."
                    : "All played out."}
                </h2>
                <p>
                  {live
                    ? "No upcoming fixtures have been announced."
                    : "No upcoming fixtures in this sample season."}
                </p>
                <button
                  className="button secondary"
                  onClick={() => setFilter("all")}
                >
                  See all matches
                </button>
              </div>
            )}
          </div>
        </div>
        {live ? (
          <aside className="schedule-aside">
            <span className="eyebrow">THE NEXT KICKOFF</span>
            <h3>
              Same club.
              <br />
              New chapter.
            </h3>
            <p>
              Fixtures and scores come from the LeagueApps schedule. Times are
              shown in New York time. Check the league page for match-day
              changes.
            </p>
          </aside>
        ) : (
          <aside className="schedule-aside">
            <span className="eyebrow">OUR THURSDAY HOME</span>
            <div className="pitch-illustration" aria-hidden="true">
              <div />
              <span>5</span>
            </div>
            <h3>
              Under the lights.
              <br />
              By the water.
            </h3>
            <p>Our sample fixtures are set at Brooklyn Bridge Park, Pier 5.</p>
            <a
              href="https://www.google.com/maps/search/?api=1&query=Brooklyn+Bridge+Park+Pier+5"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Find the pitch <ArrowUpRight size={15} />
            </a>
            <div className="aside-note">
              Prototype fixtures are fictional. Confirm real match details with
              your captain.
            </div>
          </aside>
        )}
      </div>
      {selected && (
        <MatchDetails match={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
export function ResultsPage() {
  const { matches, seasonId, seasons, players, live } = usePrototype(),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Match | null>(null),
    season = seasons.find((s) => s.id === seasonId)!;
  const completed = publishedMatches(
      matches.filter((m) => m.seasonId === seasonId),
    ).reverse(),
    stats = teamStats(completed),
    visible = completed.filter(
      (m) => filter === "all" || outcome(m) === filter,
    );
  return (
    <div className="section page-section">
      <PageHeading
        eyebrow={`${season.name} / THE FINAL WHISTLE`}
        title="The results are in."
        description="Every win earned. Every lesson taken. Every chapter in mauve."
      />
      <LeaguePageNote />
      <div className="results-summary">
        <div>
          <strong>
            {stats.wins}
            <span>W</span> <i>—</i> {stats.draws}
            <span>D</span> <i>—</i> {stats.losses}
            <span>L</span>
          </strong>
          <span>SEASON RECORD</span>
        </div>
        <div>
          <strong>
            {stats.goalsFor}
            <small>:{stats.goalsAgainst}</small>
          </strong>
          <span>GOALS FOR : AGAINST</span>
        </div>
        <div className="summary-form">
          <span>RECENT FORM</span>
          <div className="form-group">
            {[...completed]
              .reverse()
              .slice(-5)
              .map((m) => (
                <FormBadge key={m.id} value={outcome(m)} />
              ))}
          </div>
        </div>
      </div>
      <div className="list-toolbar">
        <div className="tabs" aria-label="Filter results">
          {[
            ["all", "All results"],
            ["W", "Wins"],
            ["D", "Draws"],
            ["L", "Losses"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small-text">
          {visible.length} {visible.length === 1 ? "match" : "matches"}
        </span>
      </div>
      <div className="match-list">
        {visible.length ? (
          visible.map((m) => (
            <MatchRow key={m.id} match={m} onOpen={setSelected} />
          ))
        ) : (
          <div className="empty-state">
            <h3>No results here yet.</h3>
            <p>Try another filter or publish a result in the captain’s area.</p>
          </div>
        )}
      </div>
      <div className="data-note">
        <Check size={15} />
        <p>
          Only published results count toward the season record. Scores shown
          are official; on-field adjustments appear in match details.
        </p>
      </div>
      {selected && (
        <MatchDetails match={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
export function PlayersPage() {
  const {
      matches,
      seasonId,
      seasons,
      players,
      live,
      roster: seasonRoster,
    } = usePrototype(),
    [search, setSearch] = useState(""),
    [position, setPosition] = useState("All positions"),
    roster = playerStats(
      matches.filter((m) => m.seasonId === seasonId),
      players.filter(
        (p) =>
          p.isPublic !== false &&
          seasonRoster.some(
            (sr) => sr.seasonId === seasonId && sr.playerId === p.id,
          ),
      ),
    ).sort((a, b) => a.number - b.number),
    filtered = roster.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) &&
        (position === "All positions" || p.position === position),
    );
  return (
    <div className="section page-section">
      <PageHeading
        eyebrow="OUR COLOURS. OUR PEOPLE."
        title="Meet the Mauve."
        description="Twelve different stories. One very good reason to show up."
      />
      <div className="roster-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a teammate"
            aria-label="Search players"
          />
          {search && (
            <button
              className="icon-button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="position-filter">
          <SlidersHorizontal size={15} />
          <span className="sr-only">Filter by position</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            {[
              "All positions",
              "Forward",
              "Midfielder",
              "Defender",
              "Goalkeeper",
            ].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <span className="muted small-text">{filtered.length} players</span>
      </div>
      <div className="player-grid">
        {filtered.map((p, i) => (
          <Link className="player-card" href={playerHref(p.id)} key={p.id}>
            <div className={`player-shirt jersey-tone-${i % 3}`}>
              <span className="shirt-number">
                {String(p.number).padStart(2, "0")}
              </span>
              <Jersey number={p.number} />
              <span className="player-initials">{p.initials}</span>
              <ArrowUpRight size={20} />
            </div>
            <div className="player-info">
              <span className="eyebrow">{p.position}</span>
              <h2>{p.name}</h2>
              <div className="player-mini-stats">
                <span>
                  <b>{p.appearances}</b> APPS
                </span>
                <span>
                  <b>{p.goals}</b> GOALS
                </span>
                <span>
                  <b>{p.assistsKnown ? p.assists : "—"}</b> ASSISTS
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h2>No teammates found.</h2>
          <p>Try a different name or position.</p>
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              setPosition("All positions");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <p className="muted coverage-note">
        {live
          ? "Player profiles and shirt illustrations."
          : "Sample profiles and shirt illustrations."}{" "}
        Player totals reflect the selected season’s published results.
      </p>
    </div>
  );
}
export function PlayerProfile({ id }: { id: string }) {
  const { matches, seasonId, seasons, players, live } = usePrototype(),
    fixtures = matches.filter((m) => m.seasonId === seasonId),
    p = playerStats(
      fixtures,
      players.filter((p) => p.isPublic !== false),
    ).find((p) => p.id === id);
  if (!p)
    return (
      <div className="section page-section">
        <h1>Player not found.</h1>
        <Link href="/players/">Back to the squad</Link>
      </div>
    );
  const appearances = publishedMatches(fixtures)
    .filter((m) => m.result!.stats.some((s) => s.playerId === id && s.appeared))
    .reverse();
  return (
    <div className="section page-section">
      <Link href="/players/" className="text-link back-link">
        The squad <ChevronRight size={14} /> {p.name}
      </Link>
      <div className="player-profile">
        <div className="profile-shirt jersey-tone-1">
          <Jersey number={p.number} />
          <span>#{p.number} · MAUVE FC</span>
        </div>
        <div className="profile-bio">
          <span className="eyebrow">
            {p.position} / {live ? "MAUVE FC" : "SAMPLE PLAYER"}
          </span>
          <h1>{p.name}</h1>
          <p>{p.bio}</p>
          <span className="muted hometown">
            <MapPin size={15} />
            {p.hometown}
          </span>
          <div className="profile-totals">
            <div>
              <strong>{p.appearances}</strong>
              <span>APPEARANCES</span>
            </div>
            <div>
              <strong>{p.goals}</strong>
              <span>GOALS</span>
            </div>
            <div>
              <strong>{p.assistsKnown ? p.assists : "—"}</strong>
              <span>ASSISTS</span>
            </div>
          </div>
          <p className="small-text muted">
            Recorded totals · {seasons.find((s) => s.id === seasonId)?.name}.
            Unknown assists are excluded.
          </p>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">IN THE MAUVE SHIRT</span>
          <h2>Match by match.</h2>
        </div>
      </div>
      <div className="match-list">
        {appearances.length ? (
          appearances.map((m) => (
            <div className="appearance-row" key={m.id}>
              <span>{date(m.kickoff)}</span>
              <strong>{m.opponent}</strong>
              <span>
                {m.result!.stats.find((s) => s.playerId === id)?.goals} goals
              </span>
              <FormBadge value={outcome(m)} />
            </div>
          ))
        ) : (
          <div className="empty-state">
            <p>No recorded appearances this season.</p>
          </div>
        )}
      </div>
    </div>
  );
}
