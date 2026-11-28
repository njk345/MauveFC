import assert from "node:assert/strict";
import test from "node:test";
import { blankResult, prefillStarterAttendance } from "../src/features/matches/player-stats";
import type { LineupPayload, Player, Result } from "../src/lib/types";

test("prefilling starters preserves recorded contributions and leaves substitutes for confirmation", () => {
  const players: Player[] = ["starter", "scorer", "sub"].map((id, index) => ({
    id,
    name: id,
    number: index,
    position: "Forward",
    initials: "P",
    hometown: "",
    bio: "",
  }));
  const original: Result = {
    ...blankResult(players),
    attendance: "partial",
    scorers: "partial",
    stats: [{ playerId: "scorer", appeared: true, goals: 1, assists: null }],
  };
  const lineup: LineupPayload = {
    formation: "2-3-1",
    starters: ["starter", "removed", null, null, null, null, null],
    bench: ["sub"],
  };
  const applied = prefillStarterAttendance(original, players, lineup);
  assert.equal(applied.attendance, "partial");
  assert.deepEqual(applied.stats, [
    { playerId: "starter", appeared: true, goals: 0, assists: null },
    original.stats[0],
    { playerId: "sub", appeared: false, goals: 0, assists: null },
  ]);
  assert.equal(original.stats.length, 1);
  assert.equal(prefillStarterAttendance(blankResult(players), players, lineup).attendance, "partial");
});
