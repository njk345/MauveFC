import { players } from "@/lib/sample-data";
import type { Match, Player } from "@/lib/types";
export function publishedMatches(matches: Match[]) {
  return matches.filter((m) => m.status === "completed" && m.result?.published);
}
export function outcome(m: Match) {
  const r = m.result;
  return !r ? null : r.home > r.away ? "W" : r.home < r.away ? "L" : "D";
}
export function teamStats(matches: Match[]) {
  const played = publishedMatches(matches);
  const wins = played.filter((m) => outcome(m) === "W").length,
    draws = played.filter((m) => outcome(m) === "D").length,
    losses = played.length - wins - draws;
  const goalsFor = played.reduce((n, m) => n + m.result!.home, 0),
    goalsAgainst = played.reduce((n, m) => n + m.result!.away, 0);
  return {
    played: played.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points: wins * 3 + draws,
    assistsCovered: played.filter((m) => m.result!.assists === "complete")
      .length,
  };
}
export function playerStats(matches: Match[], roster: Player[] = players) {
  const played = publishedMatches(matches);
  return roster
    .map((p) => {
      const rows = played.flatMap((m) =>
        m.result!.stats.filter((s) => s.playerId === p.id),
      );
      const appearances = rows.filter((s) => s.appeared).length;
      return {
        ...p,
        appearances,
        goals: rows.reduce((n, s) => n + s.goals, 0),
        assists: rows.reduce((n, s) => n + (s.assists ?? 0), 0),
        assistsKnown: played.some(
          (m) =>
            m.result!.assists !== "unrecorded" &&
            m.result!.stats.some((s) => s.playerId === p.id),
        ),
      };
    })
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        b.assists - a.assists ||
        a.name.localeCompare(b.name),
    );
}
