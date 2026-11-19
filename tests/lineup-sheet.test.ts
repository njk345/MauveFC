import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changeFormation,
  sheetName,
  withoutBenchPosition,
} from "../src/lib/lineup-sheet";
import type { LineupPayload, Player } from "../src/lib/types";

test("changing formation retains matching substitute roles and frees removed roles", () => {
  const sheet: LineupPayload = {
    formation: "3-2-1",
    starters: Array(7).fill(null),
    bench: ["a", "b", "c"],
    benchPositions: { a: 4, b: 2, c: 0 },
  };
  const next = changeFormation(sheet, "2-3-1");
  assert.deepEqual(next.benchPositions, { a: 3, c: 0 });
  assert.deepEqual(next.bench, ["a", "b", "c"]);
  assert.deepEqual(sheet.benchPositions, { a: 4, b: 2, c: 0 });
  assert.deepEqual(withoutBenchPosition(next, "a"), { c: 0 });
});
test("first-name display keeps compound given names and leaves roster names intact", () => {
  const player = { name: "  María-José de la Cruz " } as Player;
  assert.equal(sheetName(player, true), "María-José");
  assert.equal(sheetName(player), "María-José de la Cruz");
  assert.equal(player.name, "  María-José de la Cruz ");
  assert.equal(sheetName({ name: "Alex" } as Player, true), "Alex");
});
