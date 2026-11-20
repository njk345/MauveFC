import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseLeagueSnapshot } from "../supabase/functions/_shared/leagueapps";
import {
  championshipWin,
  isFinalsWin,
  regularSeasonMatches,
} from "../src/features/matches/playoffs";
import { teamStats, sampleSeasonStats } from "../src/features/stats/queries";
import type { Match, Result } from "../src/lib/types";

const result = (home = 3, away = 1): Result => ({
  home,
  away,
  onFieldHome: home,
  onFieldAway: away,
  basis: "played",
  reason: "",
  attendance: "partial",
  scorers: "partial",
  assists: "partial",
  ownGoals: 0,
  published: true,
  stats: [{ playerId: "p", appeared: true, goals: 1, assists: 1 }],
});
const match = (
  id: string,
  playoffRound: Match["playoffRound"],
  home = 3,
  away = 1,
): Match => ({
  id,
  seasonId: "s",
  opponent: "FC",
  opponentCode: "FC",
  color: "#657293",
  kickoff: null,
  venue: "Pitch",
  round: 1,
  home: false,
  status: "completed",
  playoffRound,
  result: result(home, away),
});
test("Home uses regular-season records while Stats includes every published playoff round", () => {
  const games = [
    match("regular", null),
    match("qf", "quarterfinals", 2, 0),
    match("sf", "semifinals", 1, 0),
    match("final", "finals", 4, 2),
  ];
  const home = teamStats(regularSeasonMatches(games)),
    all = teamStats(games);
  assert.equal(home.played, 1);
  assert.equal(home.points, 3);
  assert.equal(home.goalsFor, 3);
  assert.equal(home.goalDifference, 2);
  assert.equal(all.played, 4);
  assert.equal(all.goalsFor, 10);
  assert.equal(all.goalDifference, 7);
  const roster = [
    {
      id: "p",
      name: "Player",
      number: 9,
      position: "Forward" as const,
      initials: "P",
      hometown: "",
      bio: "",
      isPublic: false,
    },
  ];
  assert.equal(sampleSeasonStats(games, roster).assistsTotal, 4);
  assert.equal(
    sampleSeasonStats(games, roster, true).players[0].appearances,
    4,
  );
  assert.equal(championshipWin(games)?.id, "final");
});
test("celebration requires a completed, published Finals win and follows corrections", () => {
  assert.equal(isFinalsWin(match("final", "finals")), true);
  for (const game of [
    match("qf", "quarterfinals"),
    match("sf", "semifinals"),
    match("generic", "playoffs"),
    match("regular", null),
    match("loss", "finals", 1, 3),
    match("draw", "finals", 1, 1),
    { ...match("draft", "finals"), result: { ...result(), published: false } },
    { ...match("cancel", "finals"), status: "cancelled" as const },
    { ...match("future", "finals"), status: "scheduled" as const },
  ])
    assert.equal(isFinalsWin(game), false, game.id);
  assert.equal(
    championshipWin([match("corrected", "finals", 1, 2)]),
    undefined,
  );
  assert.equal(championshipWin([match("untagged", null)]), undefined);
});

test("captain playoff classifications persist through league imports and preserve regular-season projections", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    S = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    SECOND = "33333333-3333-4333-8333-333333333334",
    MEMBER = "44444444-4444-4444-8444-444444444444",
    OUTSIDE = "44444444-4444-4444-8444-444444444445",
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
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id) values('${CAP}'),('${SECOND}'),('${MEMBER}'),('${OUTSIDE}');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${SECOND}','captain'),('${C}','${MEMBER}','player'),('${OTHER}','${OUTSIDE}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7');insert into players(id,club_id,name,number,position,initials,is_public) values('${P}','${C}','Private Player',9,'Forward','PP',false);insert into season_roster values('${C}','${S}','${P}');insert into private.league_sources(club_id,season_id,program_id,team_id) values('${C}','${S}','5162244','8032635');`,
  );
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
  async function as(role: string, user = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`,
    );
  }
  const scalar = async (name: string, args: unknown[]) =>
    (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  async function sync(snapshot: unknown) {
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
  const save = (game: any) => scalar("save_fixture", [C, JSON.stringify(game)]);
  const totals = async () =>
    (
      await db.query<any>(
        "select * from public_season_totals where club_id=$1",
        [C],
      )
    ).rows[0];
  await sync(league);
  await as("authenticated", CAP);
  let game = (await club()).matches.find((m: any) => m.result?.home > 0);
  const original = copy(game);
  const before = (await club()).league.standings;
  function copy<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }
  await t.test(
    "only club captains can set or clear rounds; stale and invalid writes fail",
    async () => {
      for (const [role, user] of [
        ["anon", ""],
        ["authenticated", MEMBER],
        ["authenticated", OUTSIDE],
      ]) {
        await as(role, user);
        await assert.rejects(save({ ...game, playoffRound: "finals" }));
      }
      await as("authenticated", CAP);
      await assert.rejects(save({ ...game, playoffRound: "group-stage" }));
      await assert.rejects(save({ ...game, playoffRound: true }));
      await save({ ...game, playoffRound: "quarterfinals" });
      await assert.rejects(save({ ...game, playoffRound: "finals" }));
      game = (await club()).matches.find((m: any) => m.id === game.id);
      assert.equal(game.playoffRound, "quarterfinals");
      assert.equal(game.fixtureOverride, false);
      assert.deepEqual(game.result, original.result);
      assert.deepEqual((await club()).league.standings, before);
      await assert.rejects(
        db.query("update matches set playoff_round='finals' where id=$1", [
          game.id,
        ]),
      );
    },
  );
  await t.test(
    "public Home totals exclude playoffs while private/public Stats assists and appearances include them",
    async () => {
      const r = {
        ...game.result,
        attendance: "partial",
        scorers: "partial",
        assists: "partial",
        stats: [{ playerId: P, appeared: true, goals: 1, assists: 1 }],
      };
      await scalar("save_match_result", [
        game.id,
        game.revision,
        JSON.stringify(r),
      ]);
      await as("anon");
      const record = await totals();
      assert.equal(record.played, 5);
      assert.equal(record.goals_for, 23 - original.result.home);
      const visible = await scalar("get_public_club", [C]);
      assert.equal(
        visible.matches.find((m: any) => m.id === game.id).playoffRound,
        "quarterfinals",
      );
      assert.equal(teamStats(visible.matches).played, 6);
      assert.equal(teamStats(visible.matches).goalsFor, 23);
      assert.equal(visible.players.length, 0);
      assert.equal((await scalar("get_season_stats", [C, S])).assistsTotal, 1);
      await as("authenticated", MEMBER);
      const stats = await scalar("get_season_stats", [C, S]);
      assert.equal(stats.players[0].appearances, 1);
      assert.equal(stats.players[0].assists, 1);
    },
  );
  await t.test(
    "league refreshes and restored fixture details retain manual playoff rounds",
    async () => {
      const next = copy(league);
      const source = next.games.find((g) => g.externalId === game.externalId)!;
      source.venue = "Updated league pitch";
      await sync(next);
      await as("authenticated", CAP);
      game = (await club()).matches.find((m: any) => m.id === game.id);
      assert.equal(game.venue, "Updated league pitch");
      assert.equal(game.playoffRound, "quarterfinals");
      assert.equal(game.fixtureOverride, false);
      assert.deepEqual((await club()).league.standings, before);
      await save({ ...game, venue: "Captain pitch" });
      game = (await club()).matches.find((m: any) => m.id === game.id);
      assert.equal(game.fixtureOverride, true);
      await scalar("use_league_fixture", [game.id, game.revision]);
      game = (await club()).matches.find((m: any) => m.id === game.id);
      assert.equal(game.playoffRound, "quarterfinals");
      assert.equal(game.venue, "Updated league pitch");
      assert.equal(game.fixtureOverride, false);
    },
  );
  await t.test(
    "classification-only edits retain the captain’s draft and keep other captains’ stale drafts protected",
    async () => {
      const draft = { ...game.result, published: false };
      await as("authenticated", SECOND);
      await scalar("save_match_result", [
        game.id,
        game.revision,
        JSON.stringify(draft),
      ]);
      await as("authenticated", CAP);
      await scalar("save_match_result", [
        game.id,
        game.revision,
        JSON.stringify(draft),
      ]);
      const oldRevision = game.revision;
      await save({ ...game, playoffRound: "semifinals" });
      game = (await club()).matches.find((m: any) => m.id === game.id);
      const own = (
        await db.query<any>(
          "select base_revision,payload from match_drafts where match_id=$1",
          [game.id],
        )
      ).rows[0];
      assert.equal(own.base_revision, oldRevision + 1);
      assert.deepEqual(own.payload.stats, draft.stats);
      await as("authenticated", SECOND);
      assert.equal(
        (
          await db.query<any>(
            "select base_revision from match_drafts where match_id=$1",
            [game.id],
          )
        ).rows[0].base_revision,
        oldRevision,
      );
      await as("authenticated", CAP);
      await scalar("save_match_result", [
        game.id,
        game.revision,
        JSON.stringify({ ...draft, published: true }),
      ]);
    },
  );
  await t.test(
    "manual Finals can be added, published and cleared without changing all-match Stats totals",
    async () => {
      const final = {
        id: "99999999-9999-4999-8999-999999999999",
        seasonId: S,
        opponent: "Finals FC",
        opponentCode: "FFC",
        color: "#657293",
        kickoff: "2099-01-01T20:00:00Z",
        venue: "Pitch",
        round: 99,
        home: true,
        status: "scheduled",
        revision: 0,
        playoffRound: "finals",
      };
      await save(final);
      let current = (await club()).matches.find((m: any) => m.id === final.id);
      assert.equal(isFinalsWin(current), false);
      await scalar("save_match_result", [
        final.id,
        0,
        JSON.stringify({
          ...result(4, 2),
          stats: [{ playerId: P, appeared: true, goals: 1, assists: 1 }],
        }),
      ]);
      current = (await club()).matches.find((m: any) => m.id === final.id);
      assert.equal(isFinalsWin(current), true);
      assert.equal(championshipWin((await club()).matches)?.id, final.id);
      assert.equal((await totals()).played, 5);
      assert.equal(teamStats((await club()).matches).played, 7);
      assert.equal(teamStats((await club()).matches).goalsFor, 27);
      const legacy = { ...current };
      delete legacy.playoffRound;
      await save(legacy);
      current = (await club()).matches.find((m: any) => m.id === final.id);
      assert.equal(current.playoffRound, "finals");
      await save({ ...current, playoffRound: null });
      current = (await club()).matches.find((m: any) => m.id === final.id);
      assert.equal(isFinalsWin(current), false);
      assert.equal((await totals()).played, 6);
      assert.equal(teamStats((await club()).matches).played, 7);
      assert.equal(championshipWin((await club()).matches), undefined);
    },
  );
  await db.close();
});
