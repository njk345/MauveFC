import type { LineupPayload, Match, Player, Result } from "@/lib/types";

export function blankResult(players: Player[]): Result {
  return {
    home: 0,
    away: 0,
    onFieldHome: 0,
    onFieldAway: 0,
    basis: "played",
    reason: "",
    attendance: "unrecorded",
    scorers: "unrecorded",
    assists: "unrecorded",
    ownGoals: 0,
    stats: players.map((p) => ({
      playerId: p.id,
      appeared: false,
      goals: 0,
      assists: null,
    })),
    published: false,
  };
}

export function expandResult(result: Result, players: Player[]): Result {
  return {
    ...result,
    stats: players.map(
      (p) =>
        result.stats.find((s) => s.playerId === p.id) || {
          playerId: p.id,
          appeared: false,
          goals: 0,
          assists: result.assists === "complete" ? 0 : null,
        },
    ),
  };
}

export function prefillStarterAttendance(
  result: Result,
  players: Player[],
  lineup: LineupPayload,
): Partial<Result> {
  const starters = new Set(lineup.starters);
  return {
    attendance: result.attendance === "unrecorded" ? "partial" : result.attendance,
    stats: expandResult(result, players).stats.map((stat) =>
      starters.has(stat.playerId) ? { ...stat, appeared: true } : stat,
    ),
  };
}

export function captureSummary(match: Match) {
  if (!match.result?.published) return "Result needed";
  const captures = [
    match.result.attendance,
    match.result.scorers,
    match.result.assists,
  ];
  if (captures.every((c) => c === "unrecorded")) return "Not recorded";
  return captures.every((c) => c === "complete")
    ? "Complete"
    : "Partially recorded";
}
