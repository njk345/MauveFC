import type { Match, PlayoffRound } from "@/lib/types";
import { outcome, publishedMatches } from "@/features/stats/queries";

export const playoffRounds: Record<PlayoffRound, string> = {
  playoffs: "Playoffs",
  quarterfinals: "Quarterfinals",
  semifinals: "Semifinals",
  finals: "Finals",
};
export function regularSeasonMatches(matches: Match[]) {
  return matches.filter((m) => !m.playoffRound);
}
export function isFinalsWin(match: Match) {
  return (
    match.playoffRound === "finals" &&
    match.status === "completed" &&
    !!match.result?.published &&
    outcome(match) === "W"
  );
}
export function championshipWin(matches: Match[]) {
  return publishedMatches(matches, "newest-first").find(isFinalsWin);
}
