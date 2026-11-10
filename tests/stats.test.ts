import test from "node:test";
import assert from "node:assert/strict";
import { initialMatches } from "../src/lib/sample-data";
import { playerStats, teamStats } from "../src/features/stats/queries";
import { validateResult } from "../src/features/matches/validation";
import type { Match, Result } from "../src/lib/types";
const fall = initialMatches.filter((m) => m.seasonId === "fall-2026");
function basic(fields: Partial<Result> = {}): Result {
  return {
    home: 3,
    away: 0,
    onFieldHome: 0,
    onFieldAway: 0,
    basis: "forfeit",
    reason: "Opponent did not field a team",
    attendance: "unrecorded",
    scorers: "unrecorded",
    assists: "unrecorded",
    ownGoals: 0,
    stats: [],
    published: true,
    ...fields,
  };
}
function fixture(result: Result): Match {
  return { ...fall[6], status: "completed", result };
}
test("fictional season has internally consistent published results", () => {
  for (const m of initialMatches.filter((m) => m.result))
    assert.deepEqual(validateResult(m.result!), [], m.id);
  const totals = teamStats(fall);
  assert.equal(totals.played, 6);
  assert.equal(totals.wins, 4);
  assert.equal(totals.draws, 1);
  assert.equal(totals.losses, 1);
  assert.equal(totals.goalsFor, 15);
  assert.equal(totals.goalsAgainst, 8);
  assert.equal(totals.assistsCovered, 5);
});
test("an unplayed forfeit counts official goals without inventing player stats", () => {
  const result = basic();
  assert.deepEqual(validateResult(result), []);
  const m = fixture(result);
  assert.equal(teamStats([m]).goalsFor, 3);
  assert.ok(
    playerStats([m]).every(
      (p) => p.goals === 0 && p.appearances === 0 && !p.assistsKnown,
    ),
  );
});
test("draft scores and attribution never affect public totals", () => {
  const m = fixture(basic({ published: false }));
  assert.equal(teamStats([m]).played, 0);
  assert.equal(teamStats([m]).goalsFor, 0);
  assert.ok(playerStats([m]).every((p) => p.goals === 0));
});
test("corrections replace one match and recompute team and player totals", () => {
  const corrected = fall.map((m) =>
    m.id === "fall-1"
      ? {
          ...m,
          result: {
            ...m.result!,
            home: 2,
            onFieldHome: 2,
            stats: m.result!.stats.map((s) =>
              s.playerId === "alex" ? { ...s, goals: 1 } : s,
            ),
          },
        }
      : m,
  );
  assert.equal(teamStats(corrected).played, 6);
  assert.equal(teamStats(corrected).goalsFor, 14);
  assert.equal(playerStats(corrected).find((p) => p.id === "alex")!.goals, 5);
});
test("partial attribution is accepted while complete attribution must reconcile", () => {
  const partial = basic({
    basis: "played",
    onFieldHome: 3,
    scorers: "partial",
    attendance: "partial",
    stats: [{ playerId: "alex", appeared: true, goals: 1, assists: null }],
  });
  assert.deepEqual(validateResult(partial), []);
  assert.ok(
    validateResult({ ...partial, scorers: "complete" }).some((e) =>
      e.includes("all on-field goals"),
    ),
  );
  assert.ok(
    validateResult({ ...partial, onFieldHome: 0 }).some((e) =>
      e.includes("exceed"),
    ),
  );
});
test("unknown assists remain distinct from a recorded zero", () => {
  const unknown = fixture(
    basic({
      basis: "played",
      home: 0,
      attendance: "complete",
      stats: [{ playerId: "alex", appeared: true, goals: 0, assists: null }],
    }),
  );
  assert.equal(
    playerStats([unknown]).find((p) => p.id === "alex")!.assistsKnown,
    false,
  );
  const known = {
    ...unknown,
    result: {
      ...unknown.result!,
      assists: "complete" as const,
      stats: [{ playerId: "alex", appeared: true, goals: 0, assists: 0 }],
    },
  };
  assert.equal(
    playerStats([known]).find((p) => p.id === "alex")!.assistsKnown,
    true,
  );
});
test("invalid totals and ineligible players cannot publish", () => {
  assert.ok(validateResult(basic({ home: -1 })).length);
  assert.ok(
    validateResult(
      basic({
        stats: [
          { playerId: "unknown", appeared: true, goals: 0, assists: null },
        ],
      }),
    ).some((e) => e.includes("roster")),
  );
});
test("incomplete corrections can be saved as drafts but cannot publish", async () => {
  const { validateDraft } = await import("../src/features/matches/validation");
  const correction = { ...fall[0].result!, home: 1, onFieldHome: 1 };
  assert.deepEqual(validateDraft(correction), []);
  assert.ok(validateResult(correction).some((e) => e.includes("exceed")));
});
