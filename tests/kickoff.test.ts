import { test } from "node:test";
import assert from "node:assert/strict";
import { fromNewYorkInput, toNewYorkInput } from "../src/lib/kickoff";
test("New York kickoff preserves winter and summer offsets", () => {
  assert.equal(
    fromNewYorkInput("2026-11-12T19:00"),
    "2026-11-13T00:00:00.000Z",
  );
  assert.equal(
    fromNewYorkInput("2026-07-09T19:00"),
    "2026-07-09T23:00:00.000Z",
  );
  assert.equal(toNewYorkInput("2026-11-13T00:00:00Z"), "2026-11-12T19:00");
  assert.equal(fromNewYorkInput(""), null);
});
test("daylight-saving gaps and ambiguous times never invent a kickoff", () => {
  assert.throws(() => fromNewYorkInput("2026-03-08T02:30"));
  assert.throws(() => fromNewYorkInput("2026-11-01T01:30"));
  assert.throws(() => fromNewYorkInput("2026-02-31T19:00"));
});
