"use client";
import { useState } from "react";
import type { Season } from "@/lib/types";
import { seasonSelectorLabel } from "@/features/seasons/details";
import type { playerStats } from "@/features/stats/queries";

const metrics = [
  ["appearances", "appearancesKnown", "Appearances"],
  ["goals", "goalsKnown", "Goals"],
  ["assists", "assistsKnown", "Assists"],
] as const;

export type CareerSeason = {
  season: Season;
  stats: ReturnType<typeof playerStats>[number];
  rostered: boolean;
};

export function PlayerCareer({ records }: { records: CareerSeason[] }) {
  const [activeMetric, setActiveMetric] = useState(0);
  const [field, known, metric] = metrics[activeMetric];
  const largest = Math.max(
    1,
    ...records.map(({ stats }) => (stats[known] ? stats[field] : 0)),
  );
  return (
    <section
      className="career-seasons"
      aria-labelledby="career-seasons-heading"
    >
      <div className="panel-top">
        <h2 id="career-seasons-heading">Season by season</h2>
        {records.length > 0 && (
          <div className="tabs" aria-label="Chart player seasons by">
            {metrics.map(([, , label], index) => (
              <button
                type="button"
                key={label}
                aria-pressed={index === activeMetric}
                className={index === activeMetric ? "selected" : ""}
                onClick={() => setActiveMetric(index)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {records.length ? (
        <>
          <ol>
            {records.map(({ season, stats, rostered }) => (
              <li key={season.id}>
                <div className="career-season-name">
                  <h3>{seasonSelectorLabel(season)}</h3>
                  <p>
                    {[
                      season.teamName,
                      rostered ? "Season roster" : "Match history",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="career-season-stats">
                  {metrics.map(([value, recorded, label]) => (
                    <div
                      className={
                        value === field ? "career-active-metric" : undefined
                      }
                      key={value}
                    >
                      <strong>{stats[recorded] ? stats[value] : "—"}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div
                  className="career-track"
                  aria-hidden="true"
                  title={`${metric}: ${stats[known] ? stats[field] : "not recorded"}`}
                >
                  {stats[known] && (
                    <span
                      style={{ width: `${(100 * stats[field]) / largest}%` }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="career-caption">
            Totals reflect published match records. A dash means there’s no
            recorded value.
          </p>
        </>
      ) : (
        <p className="career-caption">
          No season roster memberships or published match records yet.
        </p>
      )}
    </section>
  );
}
