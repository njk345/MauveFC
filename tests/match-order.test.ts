import test from "node:test";
import assert from "node:assert/strict";
import { orderMatches } from "../src/features/matches/order";
import { publishedMatches } from "../src/features/stats/queries";
import { seasonFinish } from "../src/features/matches/season-finish";
import type { Match, PlayoffRound } from "../src/lib/types";
const fixture = (
  id: string,
  kickoff: string | null,
  playoffRound?: PlayoffRound,
  round = 1,
): Match => ({
  id,
  seasonId: "season",
  opponent: id,
  opponentCode: "FC",
  color: "#657293",
  kickoff,
  playoffRound,
  round,
  venue: "Pitch",
  home: true,
  status: "completed",
  result: {
    home: 0,
    away: 1,
    onFieldHome: 0,
    onFieldAway: 1,
    basis: "played",
    reason: "",
    attendance: "unrecorded",
    scorers: "unrecorded",
    assists: "unrecorded",
    ownGoals: 0,
    published: true,
    stats: [],
  },
});
const ids = (matches: Match[]) => matches.map((m) => m.id);

test("same-day matches use actual kickoff time ahead of matchday or playoff round", () => {
  const games = [
    fixture("later", "2026-11-20T23:00:00Z", "quarterfinals", 1),
    fixture("earlier", "2026-11-20T22:00:00Z", "finals", 99),
  ];
  assert.deepEqual(ids(orderMatches(games)), ["earlier", "later"]);
  assert.deepEqual(ids(orderMatches(games, "newest-first")), [
    "later",
    "earlier",
  ]);
  assert.deepEqual(ids(publishedMatches(games, "newest-first")), [
    "later",
    "earlier",
  ]);
});
test("equal kickoff times order regular play, playoffs, quarters, semis and finals", () => {
  const games = [
    fixture("final", "2026-11-20T22:00:00Z", "finals"),
    fixture("semi", "2026-11-20T22:00:00Z", "semifinals"),
    fixture("regular", "2026-11-20T22:00:00Z"),
    fixture("quarter", "2026-11-20T22:00:00Z", "quarterfinals"),
    fixture("playoff", "2026-11-20T22:00:00Z", "playoffs"),
  ];
  assert.deepEqual(ids(orderMatches(games)), [
    "regular",
    "playoff",
    "quarter",
    "semi",
    "final",
  ]);
  assert.deepEqual(ids(orderMatches(games, "newest-first")), [
    "final",
    "semi",
    "quarter",
    "playoff",
    "regular",
  ]);
});
test("when one or both times are missing, later playoff rounds are more recent", () => {
  for (const games of [
    [
      fixture("final", null, "finals"),
      fixture("semi", "2026-11-20T22:00:00Z", "semifinals"),
    ],
    [
      fixture("semi", null, "semifinals"),
      fixture("quarter", null, "quarterfinals"),
      fixture("final", null, "finals"),
    ],
    [
      fixture("regular", "2026-11-20T22:00:00Z"),
      fixture("final", null, "finals"),
    ],
  ]) {
    assert.equal(orderMatches(games, "newest-first")[0].id, "final");
  }
});
test("natural incoming order wins remaining ties without using matchday, ID or name", () => {
  for (const kickoff of [null, "2026-11-20T22:00:00Z"]) {
    const games = [
      fixture("zebra", kickoff, undefined, 99),
      fixture("aardvark", kickoff, undefined, 1),
      fixture("middle", kickoff, undefined, 30),
    ];
    for (const direction of ["oldest-first", "newest-first"] as const)
      assert.deepEqual(ids(orderMatches(games, direction)), [
        "zebra",
        "aardvark",
        "middle",
      ]);
  }
  const equalPlayoffs = [
    fixture("second-named", null, "finals", 9),
    fixture("first-named", null, "finals", 1),
  ];
  assert.deepEqual(ids(orderMatches(equalPlayoffs, "newest-first")), [
    "second-named",
    "first-named",
  ]);
});
test("date-only fixtures compare calendar days and use rounds when their time is unknown", () => {
  const games = [
    fixture("semi", "2026-11-20T22:00:00Z", "semifinals"),
    fixture("final", "2026-11-20", "finals"),
    fixture("older", "2026-11-19T23:00:00Z", "finals"),
  ];
  assert.deepEqual(ids(orderMatches(games)), ["older", "semi", "final"]);
  assert.deepEqual(ids(orderMatches(games, "newest-first")), [
    "final",
    "semi",
    "older",
  ]);
});
test("UTC offsets and games across UTC midnight retain true chronological order", () => {
  const games = [
    fixture("later", "2026-11-21T00:15:00Z"),
    fixture("earlier", "2026-11-20T18:00:00-05:00"),
  ];
  assert.deepEqual(ids(orderMatches(games, "newest-first")), [
    "later",
    "earlier",
  ]);
  const sameInstant = [
    fixture("semi", "2026-11-20T19:00:00-05:00", "semifinals"),
    fixture("final", "2026-11-21T00:00:00Z", "finals"),
  ];
  assert.equal(orderMatches(sameInstant, "newest-first")[0].id, "final");
});
test("missing-time fallback cannot reverse known kickoff order even with contradictory stage metadata", () => {
  const games = [
    fixture("earlier-final", "2026-11-20T21:00:00Z", "finals"),
    fixture("undated-semi", null, "semifinals"),
    fixture("later-quarter", "2026-11-20T22:00:00Z", "quarterfinals"),
  ];
  for (const direction of ["oldest-first", "newest-first"] as const) {
    const result = orderMatches(games, direction);
    assert.equal(new Set(result).size, 3);
    const known = result.filter((m) => m.kickoff);
    assert.deepEqual(
      ids(known),
      direction === "oldest-first"
        ? ["earlier-final", "later-quarter"]
        : ["later-quarter", "earlier-final"],
    );
  }
});
test("published filtering and completed season finishes use the same most recent result", () => {
  const games = [
    fixture("final", null, "finals", 1),
    fixture("semi", null, "semifinals", 99),
    {
      ...fixture("draft", "2026-11-22T22:00:00Z", "finals"),
      result: { ...fixture("draft", null).result!, published: false },
    },
  ];
  assert.deepEqual(ids(publishedMatches(games, "newest-first")), [
    "final",
    "semi",
  ]);
  const finish = seasonFinish(
    {
      id: "season",
      name: "Fall",
      competition: "League",
      format: "7v7",
      completed: true,
    },
    games,
  );
  assert.equal(finish?.kind, "playoffs");
  if (finish?.kind === "playoffs") assert.equal(finish.match.id, "final");
  assert.equal(finish?.title, "Runners-up.");
});
test("ordering never mutates source fixtures and tolerates absent or invalid times", () => {
  const games = [fixture("invalid", "not-a-date"), fixture("unknown", null)];
  Object.freeze(games);
  games.forEach(Object.freeze);
  assert.deepEqual(ids(orderMatches(games, "newest-first")), [
    "invalid",
    "unknown",
  ]);
  assert.deepEqual(ids(games), ["invalid", "unknown"]);
  assert.deepEqual(orderMatches([]), []);
});
