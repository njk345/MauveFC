import { resultOutcome } from "@/features/matches/decisions";
import type { Match, PlayerLineupRole, PreferredPosition } from "@/lib/types";

export type PositionStats = {
  position: PreferredPosition;
  assignments: number;
  starts: number;
  results: { W: number; D: number; L: number };
  played: number;
  goalDifference: number;
  goals: { total: number; recorded: number };
  assists: { total: number; recorded: number };
};

export function playerPositionStats(
  roles: PlayerLineupRole[],
  matches: Map<string, Match>,
  playerId: string,
  seasonId: string,
) {
  const positions = new Map<PreferredPosition, PositionStats>();

  for (const role of roles) {
    const match = matches.get(role.matchId);
    if (!match || match.status === "cancelled") continue;
    if (seasonId && match.seasonId !== seasonId) continue;

    let stats = positions.get(role.position);
    if (!stats) {
      stats = {
        position: role.position,
        assignments: 0,
        starts: 0,
        results: { W: 0, D: 0, L: 0 },
        played: 0,
        goalDifference: 0,
        goals: { total: 0, recorded: 0 },
        assists: { total: 0, recorded: 0 },
      };
      positions.set(role.position, stats);
    }
    stats.assignments++;
    if (role.assignment === "starter") stats.starts++;

    const result = match.result;
    if (match.status !== "completed" || !result?.published || result.basis === "forfeit") {
      continue;
    }

    stats.played++;
    stats.results[resultOutcome(result)]++;
    stats.goalDifference += result.home - result.away;
    const player = result.stats.find((stat) => stat.playerId === playerId);
    if (result.scorers === "complete" || (result.scorers === "partial" && player?.goals)) {
      stats.goals.total += player?.goals ?? 0;
      stats.goals.recorded++;
    }
    if (result.assists === "complete" || (result.assists === "partial" && player?.assists != null)) {
      stats.assists.total += player?.assists ?? 0;
      stats.assists.recorded++;
    }
  }

  return [...positions.values()].sort(
    (a, b) => b.assignments - a.assignments || a.position.localeCompare(b.position),
  );
}
