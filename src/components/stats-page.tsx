"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { positionGroupLabel } from "@/lib/player-positions";
import { useState } from "react";
import {
  ArrowUpRight,
  Download,
  Info,
  LockKeyhole,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrototype } from "./prototype-provider";
import { publishedMatches, teamStats } from "@/features/stats/queries";
import { PageHeading } from "./season-pages";
import { LeaguePageNote } from "./league-connection";
import { useSeasonStats } from "./use-season-stats";
import { useAuth } from "./auth/auth-provider";
import { seasonSelectorLabel } from "@/features/seasons/details";
import { SeasonComparison } from "./season-comparison";
import { downloadArchiveCsv } from "@/features/stats/archive-export";
export function StatsPage() {
  const { matches, seasonId, seasons, players } = usePrototype();
  const auth = useAuth();
  const [scope, setScope] = useState<"current" | "all" | "custom">("current");
  const [chosen, setChosen] = useState<string[]>(() => [seasonId]);
  const scopedSeasons = seasons.filter(
    (s) =>
      scope === "all" ||
      (scope === "custom" ? chosen.includes(s.id) : s.id === seasonId),
  );
  const seasonIds = scopedSeasons.map((s) => s.id);
  const { data, loading, error, reload } = useSeasonStats(seasonIds);
  const [metric, setMetric] = useState<"goals" | "assists" | "appearances">(
      "goals",
    ),
    fixtures = matches.filter((m) => seasonIds.includes(m.seasonId)),
    stats = teamStats(fixtures),
    leaders = [...(data?.players || [])].sort((a, b) => {
      const known =
        metric === "goals"
          ? "goalsKnown"
          : metric === "assists"
            ? "assistsKnown"
            : "appearancesKnown";
      return (
        Number(b[known]) - Number(a[known]) ||
        b[metric] - a[metric] ||
        b.goals - a.goals ||
        a.name.localeCompare(b.name)
      );
    }),
    played = publishedMatches(fixtures),
    season = seasons.find((s) => s.id === seasonId);
  const compare = seasonIds.length > 1;
  const records = compare
    ? scopedSeasons.map((season) => ({
        season,
        ...teamStats(fixtures.filter((m) => m.seasonId === season.id)),
      }))
    : [];
  const chart = compare
    ? [...records].reverse().map((r) => ({
        id: r.season.id,
        name:
          r.season.term && r.season.year
            ? `${r.season.term} ${r.season.year}`
            : r.season.name,
        label: seasonSelectorLabel(r.season),
        "Goals for": r.goalsFor,
        "Goals against": r.goalsAgainst,
      }))
    : played.map((m) => ({
        id: m.id,
        name: `MD ${m.round}`,
        label: m.opponent,
        "Goals for": m.result!.home,
        "Goals against": m.result!.away,
      }));
  return (
    <div className="section page-section stats-page">
      <PageHeading
        eyebrow={
          scope === "current" ? season?.name || "Season" : "CLUB ARCHIVE"
        }
        title="Our game, by the numbers."
        description="Compare club results and player contributions across seasons."
      >
        <span className="outline-label">Published results only</span>
      </PageHeading>
      <div className="archive-scope">
        <div className="tabs" aria-label="Stats season range">
          {(
            [
              ["current", "This season"],
              ["all", "All seasons"],
              ["custom", "Choose seasons"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              className={scope === value ? "selected" : ""}
              onClick={() => {
                if (
                  value === "custom" &&
                  !seasons.some((s) => chosen.includes(s.id))
                )
                  setChosen([seasonId]);
                setScope(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span>
          {scope === "current" && season
            ? seasonSelectorLabel(season)
            : `${scopedSeasons.length} ${scopedSeasons.length === 1 ? "season" : "seasons"} selected`}
        </span>
      </div>
      {scope === "custom" && (
        <fieldset className="archive-season-options">
          <legend>Seasons to include</legend>
          {seasons.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={chosen.includes(s.id)}
                disabled={scopedSeasons.length === 1 && chosen.includes(s.id)}
                onChange={(e) =>
                  setChosen((old) =>
                    e.target.checked
                      ? [...old, s.id]
                      : old.filter((id) => id !== s.id),
                  )
                }
              />
              <span>{seasonSelectorLabel(s)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {scope === "current" && <LeaguePageNote />}
      <div className="stat-cards">
        {[
          [stats.played, "MATCHES PLAYED", "Every chapter so far"],
          [stats.goalsFor, "GOALS SCORED", "Official team total"],
          [
            `${stats.goalDifference > 0 ? "+" : ""}${stats.goalDifference}`,
            "GOAL DIFFERENCE",
            `${stats.goalsAgainst} conceded`,
          ],
          [
            data?.assistsTotal ?? "—",
            "ASSISTS RECORDED",
            loading
              ? "Loading recorded assists…"
              : error
                ? "Temporarily unavailable"
                : data?.assistsTotal === null
                  ? "Not recorded yet"
                  : "Sum of all recorded player assists",
          ],
          [
            stats.played
              ? `${Math.round((stats.wins / stats.played) * 100)}%`
              : "—",
            "WIN RATE",
            `${stats.wins} wins from ${stats.played} matches`,
          ],
        ].map(([value, label, note], i) => (
          <article
            className={`stat-card ${i === 1 ? "featured" : ""}`}
            key={label}
          >
            <span className="eyebrow">{label}</span>
            <strong>{value}</strong>
            <span>{note}</span>
            {i === 1 ? (
              <ArrowUpRight size={24} />
            ) : i === 2 ? (
              <TrendingUp size={22} />
            ) : null}
          </article>
        ))}
      </div>
      {compare && <SeasonComparison records={records} />}
      <div className="chart-panel">
        <div className="panel-top">
          <div>
            <h2>
              {compare ? "Scoring across seasons" : "Goals, game by game."}
            </h2>
          </div>
          <div className="chart-legend">
            <span>
              <i />
              Goals for
            </span>
            <span>
              <i />
              Goals against
            </span>
          </div>
        </div>
        <div
          className="goals-chart"
          role="img"
          aria-label={`Goals scored and conceded across ${stats.played} published matches. Scored ${stats.goalsFor}, conceded ${stats.goalsAgainst}.`}
        >
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <BarChart
              data={chart}
              barGap={5}
              margin={{ top: 20, right: 5, left: -30, bottom: 5 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="#e9e5e7"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#7d747d" }}
                dy={10}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#7d747d" }}
              />
              <Tooltip
                labelFormatter={(label, items) =>
                  items[0]?.payload.label || label
                }
                cursor={{ fill: "#f5f1f4" }}
                contentStyle={{
                  border: "1px solid #e6dfe5",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="Goals for"
                fill="#8d6389"
                radius={[4, 4, 0, 0]}
                maxBarSize={37}
              />
              <Bar
                dataKey="Goals against"
                fill="#d4c5d0"
                radius={[4, 4, 0, 0]}
                maxBarSize={37}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="chart-data">
          <summary>View chart as a table</summary>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                {compare ? "Goals by season" : "Goals per published match"}
              </caption>
              <thead>
                <tr>
                  {!compare && <th>Matchday</th>}
                  <th>{compare ? "Season" : "Opponent"}</th>
                  <th>For</th>
                  <th>Against</th>
                </tr>
              </thead>
              <tbody>
                {chart.map((m) => (
                  <tr key={m.id}>
                    {!compare && <td>{m.name}</td>}
                    <td>{m.label}</td>
                    <td>{m["Goals for"]}</td>
                    <td>{m["Goals against"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="section-heading leaderboard-heading">
        <div>
          <span className="eyebrow">INDIVIDUAL IMPACT</span>
          <h2>The difference makers.</h2>
        </div>
        <div className="tabs" aria-label="Rank players by">
          {(["goals", "assists", "appearances"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              className={metric === m ? "selected" : ""}
              onClick={() => setMetric(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="stats-visibility-note">
        <p>
          <LockKeyhole size={17} />
          {data?.teamView
            ? "Team view · All players’ individual stats are visible to signed-in teammates."
            : "Public view · Private players’ identities and individual stats are hidden."}
        </p>
        <div className="button-row">
          {!auth.user && (
            <Link className="text-link" href="/login/">
              Team sign-in
            </Link>
          )}
          <button
            type="button"
            className="text-link"
            disabled={loading}
            onClick={reload}
          >
            <RefreshCw size={15} />
            Refresh stats
          </button>
        </div>
      </div>
      {loading && (
        <p role="status" className="stats-loading">
          Loading player stats…
        </p>
      )}
      {error && (
        <div role="alert" className="form-errors">
          <p>{error}</p>
          <button type="button" className="text-link" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      <p className="stats-table-hint">Swipe the table to see all stats.</p>
      <div className="table-scroll leaderboard-table" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th>RANK</th>
              <th>PLAYER</th>
              <th>APPS</th>
              <th>GOALS</th>
              <th>ASSISTS</th>
              <th className="bar-column">{metric.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((p, i) => (
              <tr key={p.id}>
                <td>
                  <span className={i === 0 ? "rank first" : "rank"}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </td>
                <td>
                  {p.isPublic === false ? (
                    <div className="table-player">
                      <span className="initial-avatar">{p.initials}</span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          #{p.number} · {positionGroupLabel(p)}
                          {p.isGuest ? " · Guest" : ""}
                        </small>
                      </span>
                    </div>
                  ) : (
                    <Link className="table-player" href={playerHref(p.id)}>
                      <span className="initial-avatar">{p.initials}</span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          #{p.number} · {positionGroupLabel(p)}
                          {p.isGuest ? " · Guest" : ""}
                        </small>
                      </span>
                    </Link>
                  )}
                </td>
                <td>{p.appearancesKnown ? p.appearances : "—"}</td>
                <td className={metric === "goals" ? "metric-highlight" : ""}>
                  {p.goalsKnown ? p.goals : "—"}
                </td>
                <td className={metric === "assists" ? "metric-highlight" : ""}>
                  {p.assistsKnown ? p.assists : "—"}
                </td>
                <td className="bar-column">
                  <span className="leader-bar">
                    <span
                      style={{
                        width: `${leaders[0][metric] ? (p[metric] / leaders[0][metric]) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
            {Array.from({ length: data?.privatePlayerCount || 0 }, (_, i) => (
              <tr
                className="private-stats-row"
                key={`private-${i}`}
                aria-label="Private player · individual stats hidden"
              >
                <td>
                  <span className="rank">—</span>
                </td>
                <td>
                  <div className="table-player">
                    <span className="initial-avatar">
                      <LockKeyhole size={17} />
                    </span>
                    <span>
                      <strong>Private player</strong>
                      <small>Team members only</small>
                    </span>
                  </div>
                </td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td className="bar-column">
                  <span className="leader-bar" />
                </td>
              </tr>
            ))}
            {!loading &&
              !error &&
              !leaders.length &&
              !data?.privatePlayerCount && (
                <tr>
                  <td colSpan={6}>No players in the selected seasons yet.</td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
      {!!data?.privatePlayerCount && (
        <p className="stats-ranking-note">
          Rankings show public players only. Private players are excluded from
          public rankings.
        </p>
      )}
      <div className="coverage-panel">
        <Info size={22} />
        <div>
          <h3>The numbers need context.</h3>
          {data?.appearanceRecords != null && data.goalRecords != null && (
            <ul className="archive-coverage">
              <li>
                <strong>
                  {data.appearanceRecords}/{stats.played}
                </strong>{" "}
                attendance recorded
              </li>
              <li>
                <strong>
                  {data.goalRecords}/{stats.played}
                </strong>{" "}
                scorers recorded
              </li>
              <li>
                <strong>
                  {data.assistsRecordedMatches}/{stats.played}
                </strong>{" "}
                assists recorded
              </li>
            </ul>
          )}
          <p>
            Playoff matches are included in these totals. Home’s record and
            league standings cover the regular season. Matches, team goals and
            goal difference come exclusively from final match results. Assists
            are the sum of recorded player assists, including players with
            private profiles.{" "}
            {data
              ? `Coverage includes partial records. Assists were fully recorded for ${data.assistsCompleteMatches} of ${stats.played} matches.`
              : "Assist recording coverage is currently unavailable."}{" "}
            Unknown counts stay unknown. Individual goal totals can differ from
            the team score when attribution is incomplete, own goals are
            recorded, or the result is adjusted.
          </p>
        </div>
      </div>
      {auth.captain && played.length > 0 && (
        <section
          className="archive-exports"
          aria-label="Captain archive exports"
        >
          <h2>Export the selected seasons</h2>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() =>
                downloadArchiveCsv("results", played, scopedSeasons, players)
              }
            >
              <Download size={16} /> Results CSV
            </button>
            <button
              className="button secondary"
              onClick={() =>
                downloadArchiveCsv(
                  "player-stats",
                  played,
                  scopedSeasons,
                  players,
                )
              }
            >
              <Download size={16} /> Player stats CSV
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
