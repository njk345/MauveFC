import assert from "node:assert/strict";
import test from "node:test";
import { playerPositionStats } from "../src/features/stats/positions";
import type { Match, PlayerLineupRole, Result } from "../src/lib/types";

test("player position stats use whole-match results and distinguish missing records from zero", () => {
  const result: Result = {
    home: 4,
    away: 1,
    onFieldHome: 4,
    onFieldAway: 1,
    basis: "played",
    reason: "",
    attendance: "partial",
    scorers: "partial",
    assists: "partial",
    ownGoals: 0,
    published: true,
    stats: [{ playerId: "player", goals: 2, assists: 1, appeared: true }],
  };
  const match: Match = {
    id: "win",
    seasonId: "current",
    opponent: "Opponent",
    opponentCode: "OPP",
    color: "",
    kickoff: null,
    venue: "",
    round: 1,
    home: true,
    status: "completed",
    result,
  };
  const fixtures: Match[] = [
    match,
    {
      ...match,
      id: "penalties",
      seasonId: "old",
      playoffRound: "finals",
      result: {
        ...result,
        home: 1,
        away: 1,
        onFieldHome: 1,
        onFieldAway: 1,
        decision: "penalties",
        penaltyOutcome: "L",
        scorers: "complete",
        assists: "unrecorded",
        stats: [],
      },
    },
    {
      ...match,
      id: "draw",
      result: {
        ...result,
        home: 1,
        away: 1,
        onFieldHome: 1,
        onFieldAway: 1,
        stats: [{ playerId: "player", goals: 0, assists: 0, appeared: true }],
      },
    },
    { ...match, id: "scheduled", status: "scheduled", result: undefined },
    { ...match, id: "unpublished", result: { ...result, published: false } },
    { ...match, id: "forfeit", result: { ...result, basis: "forfeit" } },
    { ...match, id: "cancelled", status: "cancelled" },
  ];
  const roles: PlayerLineupRole[] = [
    ...["win", "penalties", "draw"].map((matchId) => ({
      matchId,
      position: "Central midfield" as const,
      assignment: matchId === "penalties" ? "substitute" as const : "starter" as const,
    })),
    ...["scheduled", "unpublished", "forfeit", "cancelled", "removed"].map((matchId) => ({
      matchId, position: "Striker" as const, assignment: "starter" as const,
    })),
  ];
  const matches = new Map(fixtures.map((game) => [game.id, game]));
  const [midfield, striker] = playerPositionStats(roles, matches, "player", "");
  assert.deepEqual(midfield, {
    position: "Central midfield",
    starts: 2,
    assignments: 3,
    played: 3,
    results: { W: 1, D: 1, L: 1 },
    goalDifference: 3,
    goals: { total: 2, recorded: 2 },
    assists: { total: 1, recorded: 2 },
  });
  assert.equal(striker.assignments, 3);
  assert.equal(striker.played, 0);
  const [old] = playerPositionStats(roles, matches, "player", "old");
  assert.deepEqual(old.goals, { total: 0, recorded: 1 });
  assert.deepEqual(old.assists, { total: 0, recorded: 0 });
  assert.equal(old.starts, 0);
  assert.equal(old.results.L, 1);
});
