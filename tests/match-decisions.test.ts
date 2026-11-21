import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseLeagueSnapshot } from "../supabase/functions/_shared/leagueapps";
import { blankResult } from "../src/features/matches/player-stats";
import {
  validateResult,
  validateDraft,
} from "../src/features/matches/validation";
import {
  resultOutcome,
  decisionLabel,
} from "../src/features/matches/decisions";
import { seasonFinish, ordinal } from "../src/features/matches/season-finish";
import {
  isFinalsWin,
  regularSeasonMatches,
} from "../src/features/matches/playoffs";
import { teamStats } from "../src/features/stats/queries";
import type { Match, Result, Season } from "../src/lib/types";

const r = (home = 1, away = 1, extra: Partial<Result> = {}): Result => ({
  ...blankResult([]),
  home,
  away,
  onFieldHome: home,
  onFieldAway: away,
  published: true,
  ...extra,
});
const game = (
  result: Result,
  playoffRound: Match["playoffRound"] = "finals",
): Match => ({
  id: "m",
  seasonId: "s",
  round: 1,
  opponent: "FC",
  opponentCode: "FC",
  color: "#657293",
  kickoff: null,
  venue: "Pitch",
  home: false,
  status: "completed",
  result,
  playoffRound,
});
const season: Season = {
  id: "s",
  name: "Season",
  competition: "League",
  format: "7v7",
  completed: true,
  finalPosition: 5,
};

test("regulation, overtime W/D/L and penalty W/L use the correct outcome without adding shootout goals", () => {
  const cases: [Result, string, string | null][] = [
    [r(2, 1), "W", null],
    [r(1, 2), "L", null],
    [r(), "D", null],
    [r(2, 1, { decision: "overtime" }), "W", "Won after overtime"],
    [r(1, 2, { decision: "overtime" }), "L", "Lost after overtime"],
    [r(1, 1, { decision: "overtime" }), "D", "Drew after overtime"],
    [
      r(1, 1, { decision: "penalties", penaltyOutcome: "W" }),
      "W",
      "Won on penalties",
    ],
    [
      r(1, 1, { decision: "penalties", penaltyOutcome: "L" }),
      "L",
      "Lost on penalties",
    ],
  ];
  for (const [result, outcome, label] of cases) {
    assert.equal(resultOutcome(result), outcome);
    assert.equal(decisionLabel(result), label);
    assert.deepEqual(validateResult(result, []), []);
  }
  const penalties = cases.slice(-2).map(([result]) => game(result, null));
  const totals = teamStats(penalties);
  assert.equal(totals.wins, 1);
  assert.equal(totals.losses, 1);
  assert.equal(totals.draws, 0);
  assert.equal(totals.goalsFor, 2);
  assert.equal(totals.goalsAgainst, 2);
  assert.equal(totals.goalDifference, 0);
  assert.equal(isFinalsWin(game(cases[6][0])), true);
  assert.equal(isFinalsWin(game(cases[7][0])), false);
  assert.equal(teamStats(regularSeasonMatches([game(cases[6][0])])).played, 0);
});
test("penalties cannot be drawn, include unequal match goals, or apply to a forfeit", () => {
  for (const result of [
    r(1, 1, { decision: "penalties" }),
    r(1, 1, { decision: "penalties", penaltyOutcome: "D" as any }),
    r(2, 1, { decision: "penalties", penaltyOutcome: "W" }),
    r(1, 1, { decision: "overtime", penaltyOutcome: "W" }),
    r(1, 1, { decision: "overtime", basis: "forfeit", reason: "Forfeit" }),
  ])
    assert.ok(validateResult(result, []).length);
  assert.deepEqual(
    validateDraft(r(2, 1, { decision: "penalties", penaltyOutcome: "W" }), []),
    [],
  );
  assert.ok(
    validateDraft(
      r(1, 1, { decision: "penalties", penaltyOutcome: "D" as any }),
      [],
    ).length,
  );
});
test("completed seasons show the championship, exact playoff exit or saved league position", () => {
  assert.equal(seasonFinish({ ...season, completed: false }, []), null);
  assert.equal(seasonFinish(season, [])?.title, "5th place.");
  assert.equal(
    seasonFinish({ ...season, finalPosition: null }, [])?.title,
    "Season complete.",
  );
  for (const [round, title] of [
    ["finals", "Runners-up."],
    ["semifinals", "Semifinalists."],
    ["quarterfinals", "Quarterfinalists."],
  ] as const) {
    const finish = seasonFinish(season, [
      game(r(1, 1, { decision: "penalties", penaltyOutcome: "L" }), round),
    ]);
    assert.equal(finish?.title, title);
    assert.equal(finish?.kind, "playoffs");
  }
  assert.equal(
    seasonFinish(season, [
      game(r(1, 1, { decision: "penalties", penaltyOutcome: "W" })),
    ])?.kind,
    "champions",
  );
  assert.equal(
    seasonFinish({ ...season, completed: false }, [game(r(2, 1))])?.kind,
    "champions",
  );
  assert.match(
    seasonFinish(season, [
      game(r(1, 1, { decision: "overtime" }), "semifinals"),
    ])!.detail,
    /Playoff finish/,
  );
  const upcoming = {
    ...game(r()),
    status: "scheduled" as const,
    result: undefined,
  };
  assert.match(seasonFinish(season, [upcoming])!.detail, /not recorded/);
  assert.equal(
    seasonFinish(season, [{ ...game(r()), status: "cancelled" }])?.title,
    "5th place.",
  );
  assert.equal(
    seasonFinish(season, [{ ...game(r(3, 0)), seasonId: "other" }])?.title,
    "5th place.",
  );
  assert.equal(seasonFinish(season, [game(r(0, 1))])?.kind, "playoffs");
  for (const [n, suffix] of [
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [5, "5th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
  ] as const)
    assert.equal(ordinal(n), suffix);
});

test("match decisions and season completion are authorized, transactional and survive imports", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    S = "22222222-2222-4222-8222-222222222222",
    EMPTY = "22222222-2222-4222-8222-222222222223",
    CAP = "33333333-3333-4333-8333-333333333333",
    SECOND = "33333333-3333-4333-8333-333333333334",
    MEMBER = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445",
    P = "55555555-5555-4555-8555-555555555555";
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter(
      (n) =>
        n.endsWith(".sql") && !n.endsWith("_leagueapps_hourly_refresh.sql"),
    )
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id) values('${CAP}'),('${SECOND}'),('${MEMBER}'),('${OUT}');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${SECOND}','captain'),('${C}','${MEMBER}','player'),('${OTHER}','${OUT}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7'),('${EMPTY}','${C}','Empty season','League','7v7');insert into players(id,club_id,name,number,position,initials,is_public) values('${P}','${C}','Private Player',9,'Forward','PP',false);insert into season_roster values('${C}','${S}','${P}');insert into private.league_sources(club_id,season_id,program_id,team_id) values('${C}','${S}','5162244','8032635');`,
  );
  const scalar = async (name: string, args: unknown[]) =>
    (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  const as = async (role: string, user = "") => {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`,
    );
  };
  const league = parseLeagueSnapshot(
    await readFile(
      new URL("./fixtures/leagueapps-schedule.html", import.meta.url),
      "utf8",
    ),
    await readFile(
      new URL("./fixtures/leagueapps-standings.html", import.meta.url),
      "utf8",
    ),
  );
  async function sync(snapshot = league) {
    await as("postgres");
    const token = (
      await db.query<any>(
        "insert into private.league_runs(club_id) values($1) returning token",
        [C],
      )
    ).rows[0].token;
    await as("service_role");
    await scalar("begin_league_sync", [token]);
    await scalar("apply_league_sync", [token, JSON.stringify(snapshot)]);
  }
  const club = () => scalar("get_captain_club", [C]);
  const complete = (id = S, revision = 0, value = true) =>
    scalar("set_season_complete", [id, revision, value]);
  await sync();
  await as("authenticated", CAP);
  let m = (await club()).matches.find((m: any) => m.result?.home > 0);
  const save = (payload: any, revision = m.revision) =>
    scalar("save_match_result", [m.id, revision, JSON.stringify(payload)]);
  const refresh = async () => {
    m = (await club()).matches.find((g: any) => g.id === m.id);
  };
  const penalty = {
    ...r(1, 1, { decision: "penalties", penaltyOutcome: "W" }),
    attendance: "partial",
    scorers: "partial",
    assists: "partial",
    stats: [{ playerId: P, appeared: true, goals: 1, assists: 1 }],
  };
  await t.test(
    "only club captains can change results or complete a season",
    async () => {
      for (const [role, user] of [
        ["anon", ""],
        ["authenticated", MEMBER],
        ["authenticated", OUT],
      ]) {
        await as(role, user);
        await assert.rejects(save(penalty));
        await assert.rejects(complete());
      }
      await as("authenticated", CAP);
      await assert.rejects(
        db.query("update seasons set completed=true where id=$1", [S]),
      );
      await assert.rejects(
        db.query(
          "update match_results set decision='penalties',penalty_outcome='W' where match_id=$1",
          [m.id],
        ),
      );
    },
  );
  await t.test(
    "invalid shootouts reject without changing scores, stats or revision",
    async () => {
      for (const payload of [
        { ...penalty, penaltyOutcome: "D" },
        { ...penalty, penaltyOutcome: null },
        { ...penalty, home: 2, onFieldHome: 2 },
        { ...penalty, decision: "regulation" },
        { ...penalty, decision: "overtime" },
        { ...penalty, decision: null },
        { ...penalty, decision: true },
      ])
        await assert.rejects(save(payload));
      const before = m;
      await refresh();
      assert.deepEqual(m, before);
    },
  );
  await t.test(
    "shootout win publishes tied goals, appearances and assists atomically with private identities protected",
    async () => {
      await save(penalty);
      await refresh();
      assert.equal(m.result.decision, "penalties");
      assert.equal(m.result.penaltyOutcome, "W");
      assert.equal(m.result.home, 1);
      assert.equal(m.result.away, 1);
      assert.equal(m.result.stats[0].assists, 1);
      await assert.rejects(save(penalty, m.revision - 1));
      const team = await scalar("get_season_stats", [C, S]);
      assert.equal(team.players.find((p: any) => p.id === P).appearances, 1);
      assert.equal(team.assistsTotal, 1);
      await as("anon");
      const pub = await scalar("get_public_club", [C]);
      assert.equal(pub.players.length, 0);
      const visible = pub.matches.find((v: any) => v.id === m.id);
      assert.equal(visible.result.penaltyOutcome, "W");
      assert.deepEqual(visible.result.stats, []);
      const home = (
        await db.query<any>(
          "select * from public_season_totals where season_id=$1",
          [S],
        )
      ).rows[0];
      assert.equal(home.wins, teamStats(pub.matches).wins);
      assert.equal(home.draws, teamStats(pub.matches).draws);
      assert.equal(home.goals_for, teamStats(pub.matches).goalsFor);
      await as("authenticated", MEMBER);
      const member = await scalar("get_team_club", [C]);
      assert.equal(
        member.matches.find((v: any) => v.id === m.id).result.penaltyOutcome,
        "W",
      );
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "legacy stats updates and source refreshes preserve the captain shootout decision",
    async () => {
      const legacy = { ...penalty } as any;
      delete legacy.decision;
      delete legacy.penaltyOutcome;
      await save(legacy);
      await refresh();
      assert.equal(m.result.penaltyOutcome, "W");
      await sync();
      await as("authenticated", CAP);
      await refresh();
      assert.equal(m.result.decision, "penalties");
      assert.equal(m.result.penaltyOutcome, "W");
      assert.equal(m.result.stats[0].goals, 1);
      await scalar("save_fixture", [
        C,
        JSON.stringify({ ...m, playoffRound: "finals" }),
      ]);
      await refresh();
      assert.equal(isFinalsWin(m), true);
    },
  );
  await t.test(
    "season completion captures verified placing, protects stale edits, and leaves results editable",
    async () => {
      await complete();
      let s = (await club()).seasons.find((s: any) => s.id === S);
      assert.equal(s.completed, true);
      assert.equal(s.revision, 1);
      assert.ok(s.completedAt);
      assert.equal(
        s.finalPosition,
        league.standings.find((s) => s.teamId === "8032635")!.position,
      );
      await as("authenticated", SECOND);
      await assert.rejects(complete(S, 0, false));
      await as("authenticated", CAP);
      const changed = structuredClone(league);
      const team = changed.standings.find((s) => s.teamId === "8032635")!;
      const fifth = changed.standings.find((s) => s.position === 5)!;
      fifth.position = team.position;
      team.position = 5;
      await sync(changed);
      await as("authenticated", CAP);
      assert.equal(
        (await club()).seasons.find((s: any) => s.id === S).finalPosition,
        s.finalPosition,
      );
      await complete(S, 1, true);
      assert.equal(
        (await club()).seasons.find((s: any) => s.id === S).revision,
        1,
      );
      await save({ ...penalty, penaltyOutcome: "L" });
      await refresh();
      assert.equal(isFinalsWin(m), false);
      assert.equal(seasonFinish(s, [m])?.title, "Runners-up.");
      await complete(S, 1, false);
      s = (await club()).seasons.find((s: any) => s.id === S);
      assert.equal(s.completed, false);
      assert.equal(s.finalPosition, null);
      assert.equal(s.completedAt, null);
      assert.equal(s.revision, 2);
      await complete(S, 2, true);
      assert.equal(
        (await club()).seasons.find((s: any) => s.id === S).finalPosition,
        5,
      );
      await complete(EMPTY, 0, true);
      assert.equal(
        (await club()).seasons.find((s: any) => s.id === EMPTY).finalPosition,
        null,
      );
    },
  );
  await t.test(
    "overtime supports wins, losses and draws; drafts retain decisions",
    async () => {
      await save({ ...penalty, published: false });
      const draft = (
        await db.query<any>(
          "select payload from match_drafts where match_id=$1",
          [m.id],
        )
      ).rows[0].payload;
      assert.equal(draft.penaltyOutcome, "W");
      for (const [home, away] of [
        [2, 1],
        [1, 2],
        [1, 1],
      ]) {
        await save({ ...r(home, away, { decision: "overtime" }) });
        await refresh();
        assert.equal(m.result.decision, "overtime");
        assert.equal(m.result.penaltyOutcome, null);
        assert.equal(m.result.home, home);
        assert.equal(m.result.away, away);
      }
      await save({ ...r(2, 1, { decision: "regulation" }) });
      await refresh();
      assert.equal(m.result.decision, "regulation");
      await as("postgres");
      await assert.rejects(
        db.query(
          "update match_results set decision='penalties',penalty_outcome=null where match_id=$1",
          [m.id],
        ),
      );
    },
  );
  await db.close();
});
