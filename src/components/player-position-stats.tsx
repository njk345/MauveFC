"use client";

import { useEffect, useMemo, useState } from "react";
import { seasonSelectorLabel } from "@/features/seasons/details";
import { playerPositionStats } from "@/features/stats/positions";
import { readPlayerLineupRoles } from "@/lib/supabase/repository";
import {
  positionCodes,
  type Match,
  type PlayerLineupRole,
  type PreferredPosition,
  type Season,
} from "@/lib/types";

function positionCount(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function PlayerPositionStats({
  playerId,
  matches,
  seasons,
}: {
  playerId: string;
  matches: Match[];
  seasons: Season[];
}) {
  const [roles, setRoles] = useState<PlayerLineupRole[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [seasonId, setSeasonId] = useState("");
  const [position, setPosition] = useState<PreferredPosition>();
  const matchMap = useMemo(
    () => new Map(matches.map((match) => [match.id, match])),
    [matches],
  );
  const seasonIds = new Set(
    roles?.flatMap((role) => {
      const match = matchMap.get(role.matchId);
      return match && match.status !== "cancelled" ? [match.seasonId] : [];
    }),
  );
  const availableSeasons = seasons.filter((season) => seasonIds.has(season.id));
  const scope = seasonIds.has(seasonId) ? seasonId : "";
  const stats = playerPositionStats(roles ?? [], matchMap, playerId, scope);
  const active = stats.find((row) => row.position === position) ?? stats[0];
  const total = stats.reduce((sum, row) => sum + row.assignments, 0);
  const largest = stats[0]?.assignments ?? 1;
  const goalDifferencePerMatch = active?.played
    ? new Intl.NumberFormat("en", {
        signDisplay: "exceptZero",
        maximumFractionDigits: 1,
      }).format(active.goalDifference / active.played)
    : "";

  useEffect(() => {
    let active = true;
    void readPlayerLineupRoles(playerId).then(
      (data) => {
        if (active) setRoles(data);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [playerId, attempt]);

  return (
    <section className="position-stats" aria-labelledby="position-stats-heading">
      <div className="position-stats-header">
        <h2 id="position-stats-heading">Position breakdown</h2>
        {availableSeasons.length > 1 && (
          <label className="form-field career-history-filter">
            <span>Position stats season</span>
            <select value={scope} onChange={(e) => setSeasonId(e.target.value)}>
              <option value="">All seasons</option>
              {availableSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {seasonSelectorLabel(season)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {failed ? (
        <div className="position-stats-status" role="alert">
          <p>Position stats could not be loaded.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            Retry position stats
          </button>
        </div>
      ) : !roles ? (
        <p className="position-stats-status" role="status">Loading position stats…</p>
      ) : !active ? (
        <p className="position-stats-status">
          No position assignments in published official lineups yet.
        </p>
      ) : (
        <>
          <div className="position-stats-grid">
            <div className="position-frequency">
              <div className="position-frequency-heading">
                <h3>Lineup frequency</h3>
                <span>{positionCount(total, "assignment")}</span>
              </div>
              <div className="position-legend">
                <span><i className="position-start" /> Starter</span>
                <span><i className="position-sub" /> Position sub</span>
              </div>
              <ul className="position-bars">
                {stats.map((row) => {
                  const subs = row.assignments - row.starts;
                  return (
                    <li key={row.position}>
                      <button
                        type="button"
                        aria-pressed={row.position === active.position}
                        aria-controls="position-stats-detail"
                        aria-label={`${row.position}, ${positionCount(row.starts, "start")}, ${positionCount(subs, "position sub")}`}
                        onClick={() => setPosition(row.position)}
                      >
                        <span className="position-bar-code">{positionCodes[row.position]}</span>
                        <span className="position-bar-name">{row.position}</span>
                        <span className="position-bar-count">{row.assignments}</span>
                        <span className="position-bar-track" aria-hidden="true">
                          <i className="position-start" style={{ width: `${100 * row.starts / largest}%` }} />
                          <i className="position-sub" style={{ width: `${100 * subs / largest}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div id="position-stats-detail" className="position-detail" aria-live="polite">
              <h3>{active.position}</h3>
              <p className="position-detail-counts">
                {positionCount(active.starts, "start")} · {positionCount(active.assignments - active.starts, "position sub")}
              </p>
              {active.played > 0 ? (
                <>
                  <h4>Player contributions</h4>
                  <dl className="position-contributions">
                    {([["Goals", active.goals], ["Assists", active.assists]] as const).map(([label, metric]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          <strong>{metric.recorded ? metric.total : "—"}</strong>
                          <span>{metric.recorded} of {active.played} matches recorded</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <h4>Team results</h4>
                  <p className="position-result-count">
                    {positionCount(active.played, "published result")}
                  </p>
                  <div className="position-result-track" aria-hidden="true">
                    {(["W", "D", "L"] as const).map((result) => (
                      <i key={result} className={`position-result-${result}`} style={{ flex: active.results[result] }} />
                    ))}
                  </div>
                  <p className="position-result-record">
                    <span><i className="position-result-W" /><strong>{positionCount(active.results.W, "win")}</strong></span>
                    <span><i className="position-result-D" />{positionCount(active.results.D, "draw")}</span>
                    <span><i className="position-result-L" />{positionCount(active.results.L, "loss", "losses")}</span>
                  </p>
                  <p className="position-goal-difference">
                    <strong>{goalDifferencePerMatch}</strong> team goal difference per match
                  </p>
                </>
              ) : (
                <p className="position-no-result">No published results from played matches for this position yet.</p>
              )}
            </div>
          </div>
          <p className="position-stats-caption">
            Lineups show planned roles, including upcoming fixtures. Contributions and results are for the full match. Results include playoffs and exclude forfeits.
          </p>
        </>
      )}
    </section>
  );
}
