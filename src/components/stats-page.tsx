"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { useState } from "react";
import {
  ArrowUpRight,
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
export function StatsPage() {
  const { matches, seasonId, seasons } = usePrototype(),
    auth = useAuth(),
    { data, loading, error, reload } = useSeasonStats(),
    [metric, setMetric] = useState<"goals" | "assists" | "appearances">(
      "goals",
    ),
    fixtures = matches.filter((m) => m.seasonId === seasonId),
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
  const chart = played.map((m) => ({
    name: `MD ${m.round}`,
    opponent: m.opponent,
    "Goals for": m.result!.home,
    "Goals against": m.result!.away,
  }));
  return (
    <div className="section page-section stats-page">
      <PageHeading
        eyebrow={`${season?.name || "Season"} / BEHIND THE NUMBERS`}
        title="Our game, by the numbers."
        description="The big picture. The little contributions. The season we’re building together."
      >
        <span className="outline-label">Published results only</span>
      </PageHeading>
      <LeaguePageNote />
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
      <div className="chart-panel">
        <div className="panel-top">
          <div>
            <span className="eyebrow">THE FLOW OF THE SEASON</span>
            <h2>Goals, game by game.</h2>
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
              <caption className="sr-only">Goals per published match</caption>
              <thead>
                <tr>
                  <th>Matchday</th>
                  <th>Opponent</th>
                  <th>For</th>
                  <th>Against</th>
                </tr>
              </thead>
              <tbody>
                {chart.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>{m.opponent}</td>
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
                          #{p.number} · {p.position}
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
                          #{p.number} · {p.position}
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
                  <td colSpan={6}>No players in this season yet.</td>
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
          <p>
            Playoff matches are included in these totals. Home’s record and
            league standings cover the regular season. Matches, team goals and
            goal difference come exclusively from final match results. Assists
            are the sum of recorded player assists, including players with
            private profiles.{" "}
            {data
              ? `Assists fully recorded for ${data.assistsCompleteMatches} of ${stats.played} matches; at least partially recorded for ${data.assistsRecordedMatches}.`
              : "Assist recording coverage is currently unavailable."}{" "}
            Unknown counts stay unknown. Individual goal totals can differ from
            the team score when attribution is incomplete, own goals are
            recorded, or the result is adjusted.
          </p>
        </div>
      </div>
    </div>
  );
}
