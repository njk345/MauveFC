import type { Match, Season } from "@/lib/types";
import { championshipWin, playoffRounds } from "./playoffs";
import { outcome, publishedMatches } from "@/features/stats/queries";

export function ordinal(position: number) {
  const lastTwo = position % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : position % 10 === 1
        ? "st"
        : position % 10 === 2
          ? "nd"
          : position % 10 === 3
            ? "rd"
            : "th";
  return `${position}${suffix}`;
}

const roundRank = { playoffs: 0, quarterfinals: 1, semifinals: 2, finals: 3 };
export function seasonFinish(season: Season, matches: Match[]) {
  const fixtures = matches.filter((m) => m.seasonId === season.id);
  const champion = championshipWin(fixtures);
  if (champion)
    return {
      kind: "champions" as const,
      match: champion,
      title: "League champions",
      detail: "The league is ours.",
    };
  if (!season.completed) return null;
  const playoffs = fixtures.filter(
    (m) => m.playoffRound && m.status !== "cancelled",
  );
  if (playoffs.length) {
    const ranked = [...playoffs].sort(
      (a, b) =>
        roundRank[a.playoffRound!] - roundRank[b.playoffRound!] ||
        (a.kickoff || "").localeCompare(b.kickoff || "") ||
        a.round - b.round,
    );
    const last = ranked.at(-1)!;
    const published = publishedMatches([last]).length > 0;
    const label = playoffRounds[last.playoffRound!];
    const lost = published && outcome(last) === "L";
    const title =
      lost && last.playoffRound === "finals"
        ? "Runners-up."
        : lost && last.playoffRound === "semifinals"
          ? "Semifinalists."
          : lost && last.playoffRound === "quarterfinals"
            ? "Quarterfinalists."
            : published
              ? `Reached the ${label.toLowerCase()}.`
              : "A playoff chapter.";
    return {
      kind: "playoffs" as const,
      match: last,
      title,
      detail: lost
        ? `Playoff exit · ${label}`
        : published
          ? `Playoff finish · ${label}`
          : `${label} · Final result not recorded`,
    };
  }
  return {
    kind: "league" as const,
    title: season.finalPosition
      ? `${ordinal(season.finalPosition)} place.`
      : "Season complete.",
    detail: season.finalPosition
      ? "Final league standing"
      : "Final league placing unavailable",
  };
}
