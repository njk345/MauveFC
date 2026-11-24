import Link from "next/link";
import { Flag, Medal } from "lucide-react";
import type { Match, Season } from "@/lib/types";
import { seasonFinish } from "@/features/matches/season-finish";
import { HomeChampions } from "./playoff-celebration";
import { ResultDecision } from "./result-decision";

export function HomeSeasonFinish({
  season,
  matches,
}: {
  season: Season;
  matches: Match[];
}) {
  const finish = seasonFinish(season, matches);
  if (!finish) return null;
  if (finish.kind === "champions")
    return <HomeChampions season={season.name} match={finish.match} />;
  return (
    <section className="section home-season-finish" aria-label="Season finish">
      <div className="season-finish-banner">
        <span className="season-finish-icon" aria-hidden="true">
          {finish.kind === "playoffs" ? (
            <Medal size={34} />
          ) : (
            <Flag size={34} />
          )}
        </span>
        <div className="season-finish-copy">
          <span className="eyebrow">{season.name} · SEASON COMPLETE</span>
          <h2>{finish.title}</h2>
          <p>{finish.detail}</p>
          {finish.kind === "playoffs" &&
            finish.match.result?.published &&
            finish.match.status === "completed" && (
              <div className="season-finish-result">
                <span>
                  {season.teamName || "Mauve FC"} {finish.match.result.home}–
                  {finish.match.result.away} {finish.match.opponent}
                </span>
                <ResultDecision result={finish.match.result} />
              </div>
            )}
        </div>
        <Link className="button secondary" href="/results/">
          The season in results
        </Link>
      </div>
    </section>
  );
}
