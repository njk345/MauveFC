import { seasonSelectorLabel } from "@/features/seasons/details";
import type { teamStats } from "@/features/stats/queries";
import type { Season } from "@/lib/types";

export type SeasonRecord = ReturnType<typeof teamStats> & { season: Season };

export function SeasonComparison({ records }: { records: SeasonRecord[] }) {
  const largest = Math.max(1, ...records.map((record) => record.played));
  return (
    <section
      className="archive-records"
      aria-labelledby="archive-records-title"
    >
      <div className="panel-top">
        <h2 id="archive-records-title">The record by season</h2>
        <div className="record-legend" aria-label="Match outcomes">
          <span className="record-win">Wins</span>
          <span className="record-draw">Draws</span>
          <span className="record-loss">Losses</span>
        </div>
      </div>
      <ul>
        {records.map(
          ({ season, played, wins, draws, losses, goalDifference }) => (
            <li key={season.id}>
              <div className="archive-record-name">
                <strong>{seasonSelectorLabel(season)}</strong>
                {season.teamName && <small>{season.teamName}</small>}
              </div>
              <div aria-hidden="true" className="record-track">
                {(
                  [
                    ["win", wins],
                    ["draw", draws],
                    ["loss", losses],
                  ] as const
                )
                  .filter(([, count]) => count > 0)
                  .map(([result, count]) => (
                    <span
                      key={result}
                      className={`record-${result}`}
                      style={{ width: `${(100 * count) / largest}%` }}
                    >
                      {count}
                    </span>
                  ))}
              </div>
              <span className="archive-record-totals">
                {played
                  ? `${wins} W · ${draws} D · ${losses} L · ${goalDifference > 0 ? "+" : ""}${goalDifference} GD`
                  : "No published results"}
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
