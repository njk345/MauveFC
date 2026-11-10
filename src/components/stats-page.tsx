"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Info, TrendingUp } from "lucide-react";
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
import {
  playerStats,
  publishedMatches,
  teamStats,
} from "@/features/stats/queries";
import { PageHeading } from "./season-pages";
import { LeaguePageNote } from "./league-connection";
export function StatsPage() {
  const { matches, seasonId, seasons, players, live } = usePrototype(),
    [metric, setMetric] = useState<"goals" | "assists" | "appearances">(
      "goals",
    ),
    fixtures = matches.filter((m) => m.seasonId === seasonId),
    stats = teamStats(fixtures),
    leaders = playerStats(
      fixtures,
      players.filter((p) => p.isPublic !== false),
    ).sort((a, b) => b[metric] - a[metric] || b.goals - a.goals),
    played = publishedMatches(fixtures),
    season = seasons.find((s) => s.id === seasonId)!;
  const chart = played.map((m) => ({
    name: `MD ${m.round}`,
    opponent: m.opponent,
    "Goals for": m.result!.home,
    "Goals against": m.result!.away,
  }));
  return (
    <div className="section page-section">
      <PageHeading
        eyebrow={`${season.name} / BEHIND THE NUMBERS`}
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
      <div className="table-scroll leaderboard-table">
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
                  <Link className="table-player" href={playerHref(p.id)}>
                    <span className="initial-avatar">{p.initials}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        #{p.number} · {p.position}
                      </small>
                    </span>
                  </Link>
                </td>
                <td>{p.appearances}</td>
                <td className={metric === "goals" ? "metric-highlight" : ""}>
                  {p.goals}
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
          </tbody>
        </table>
      </div>
      <div className="coverage-panel">
        <Info size={22} />
        <div>
          <h3>The numbers need context.</h3>
          <p>
            Assists fully recorded for {stats.assistsCovered} of {stats.played}{" "}
            matches. Unknown totals stay unknown; recorded goals and assists are
            shown even when a match’s attribution is partial. Team totals use
            official scores. League position remains unverified.
          </p>
        </div>
      </div>
    </div>
  );
}
