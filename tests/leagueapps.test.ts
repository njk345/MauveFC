import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  parseLeagueSnapshot,
  parseSchedule,
  parseStandings,
} from "../supabase/functions/_shared/leagueapps";
const schedule = readFileSync(
  new URL("./fixtures/leagueapps-schedule.html", import.meta.url),
  "utf8",
);
const standings = readFileSync(
  new URL("./fixtures/leagueapps-standings.html", import.meta.url),
  "utf8",
);
const snapshot = parseLeagueSnapshot(schedule, standings);
test("official public pages reconcile scores, league order, home/away and New York DST", () => {
  assert.equal(snapshot.games.length, 8);
  const finals = snapshot.games.filter((g) => g.score);
  assert.equal(finals.length, 6);
  assert.equal(
    finals.reduce((n, g) => n + g.score!.home, 0),
    23,
  );
  assert.equal(
    finals.reduce((n, g) => n + g.score!.away, 0),
    5,
  );
  assert.equal(snapshot.games[1].home, false);
  assert.equal(snapshot.games[0].kickoff, "2026-09-18T01:15:00.000Z");
  assert.equal(snapshot.games[7].kickoff, "2026-11-13T00:45:00.000Z");
  assert.equal(snapshot.games[6].score, null);
  assert.equal(snapshot.standings.length, 9);
  assert.equal(snapshot.standings[1].teamId, "8032635");
  assert.equal(snapshot.standings[1].points, 14);
  // League ranking is preserved even when goal difference would sort differently.
  assert.equal(snapshot.standings[0].difference, 14);
  assert.equal(snapshot.standings[1].difference, 18);
});
test("changed markup, missing scores, wrong program and duplicates fail closed", () => {
  assert.throws(() =>
    parseStandings(
      standings.replace(
        'Points Scored Differential">PSD',
        'Points Scored Differential">DIFF',
      ),
    ),
  );
  assert.throws(() =>
    parseSchedule(
      schedule.replace(/strong\s+class="score">0/, 'strong class="score">'),
    ),
  );
  assert.throws(() =>
    parseSchedule(schedule.replaceAll("/leagues/5162244/", "/leagues/999/")),
  );
  assert.throws(() => parseSchedule(schedule + schedule));
  assert.throws(() => parseStandings("<html>Log in</html>"));
});
test("blank finals are not zero draws; explicit forfeit/cancellation are recognized", () => {
  const forfeit = parseSchedule(
    schedule.replace("Played (regular time)", "Forfeit"),
  );
  assert.equal(forfeit[0].score?.basis, "forfeit");
  const cancelled = parseSchedule(
    schedule.replace(
      'class="schedule-game clr "',
      'class="schedule-game clr cancelled"',
    ),
  );
  assert.equal(cancelled[6].status, "cancelled");
  assert.equal(cancelled[6].score, null);
});

test("league import authorization, idempotency, corrections and captain ownership", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    S = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    P = "44444444-4444-4444-8444-444444444444";
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  for (const name of [
    "202611090001_club_workflow.sql",
    "202611090002_hosted_permissions_and_captain_invites.sql",
    "20261110053440_leagueapps_sync.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into auth.users(id) values('${CAP}');insert into clubs(id,name) values('${C}','Test');insert into club_memberships values('${C}','${CAP}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Fall','Test','7v7');insert into private.league_sources(club_id,season_id,program_id,team_id) values('${C}','${S}','5162244','8032635');insert into players(id,club_id,name,number,position,initials,is_public) values('${P}','${C}','Player',9,'Forward','PP',true);insert into season_roster values('${C}','${S}','${P}');`,
  );
  async function role(name: string, id = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role ${name};`,
    );
  }
  async function job() {
    await role("postgres");
    const { rows } = await db.query<{ token: string }>(
      "insert into private.league_runs(club_id) values($1) returning token",
      [C],
    );
    await role("service_role");
    await db.query("select begin_league_sync($1)", [rows[0].token]);
    return rows[0].token;
  }
  const apply = (token: string, data = snapshot) =>
    db.query("select apply_league_sync($1,$2)", [token, JSON.stringify(data)]);
  const get = async () =>
    (await db.query<any>("select get_public_club($1) data", [C])).rows[0].data;
  let firstId: string;
  await t.test(
    "only the server can consume a capability or apply a snapshot",
    async () => {
      await role("anon");
      await assert.rejects(
        db.query("select begin_league_sync(gen_random_uuid())"),
      );
      await assert.rejects(db.query("select request_league_sync($1)", [C]));
      await role("authenticated", CAP);
      await assert.rejects(
        db.query("select apply_league_sync(gen_random_uuid(),'{}')"),
      );
      await assert.rejects(db.query("select * from private.league_runs"));
      const token = await job();
      await apply(token);
      await assert.rejects(apply(token));
      await role("anon");
      const data = await get();
      assert.equal(data.matches.length, 8);
      assert.equal(data.league.standings.length, 9);
      assert.equal(data.matches[0].result.stats.length, 0);
      assert.equal(data.matches[0].result.attendance, "unrecorded");
      assert.equal(data.matches[0].leagueScore, undefined);
      assert.equal(JSON.stringify(data).includes("token"), false);
      firstId = data.matches[0].id;
    },
  );
  await t.test(
    "repeat imports are idempotent; stable external IDs survive rescheduling and score changes",
    async () => {
      const before = await get();
      const token = await job();
      await apply(token);
      await role("anon");
      assert.deepEqual((await get()).matches, before.matches);
      const changed = structuredClone(snapshot);
      changed.games[0].score!.home = 3;
      changed.games[7].kickoff = "2026-11-20T00:45:00.000Z";
      const token2 = await job();
      await apply(token2, changed);
      await role("anon");
      const data = await get();
      assert.equal(data.matches[0].id, firstId);
      assert.equal(data.matches[0].result.home, 3);
      assert.equal(data.matches[7].kickoff, "2026-11-20T00:45:00+00:00");
      assert.equal(data.matches.length, 8);
    },
  );
  await t.test(
    "captain corrections, player details, fixture overrides and stale drafts are protected",
    async () => {
      await role("authenticated", CAP);
      let data = await get();
      let m = data.matches[0];
      await db.query("select save_match_result($1,$2,$3)", [
        m.id,
        m.revision,
        JSON.stringify({
          ...m.result,
          home: 2,
          onFieldHome: 2,
          attendance: "partial",
          scorers: "complete",
          stats: [{ playerId: P, appeared: true, goals: 2, assists: null }],
        }),
      ]);
      const future = data.matches[7];
      await db.query("select save_fixture($1,$2)", [
        C,
        JSON.stringify({ ...future, venue: "Captain venue" }),
      ]);
      const token = await job();
      const changed = structuredClone(snapshot);
      changed.games[0].score!.home = 4;
      await apply(token, changed);
      await role("authenticated", CAP);
      data = (await db.query<any>("select get_captain_club($1) data", [C]))
        .rows[0].data;
      assert.equal(data.matches[0].result.home, 2);
      assert.equal(data.matches[0].result.stats[0].goals, 2);
      assert.equal(data.matches[0].needsReview, true);
      assert.equal(data.matches[0].leagueScore.home, 4);
      assert.equal(data.matches[7].venue, "Captain venue");
      assert.equal(data.matches[7].fixtureOverride, true);
      await assert.rejects(
        db.query("select save_match_result($1,$2,$3)", [
          m.id,
          m.revision,
          JSON.stringify(m.result),
        ]),
      );
    },
  );
  await t.test(
    "invalid or failed snapshots leave the last successful data intact; missing games are retained",
    async () => {
      await role("anon");
      const before = await get();
      const token = await job();
      await assert.rejects(apply(token, { ...snapshot, programId: "wrong" }));
      await db.query("select fail_league_sync($1)", [token]);
      await role("anon");
      const after = await get();
      assert.deepEqual(after.matches, before.matches);
      assert.equal(after.league.lastSuccess, before.league.lastSuccess);
      const token2 = await job();
      await apply(token2, { ...snapshot, games: snapshot.games.slice(1) });
      await role("anon");
      assert.equal((await get()).matches.length, 8);
    },
  );
  await t.test(
    "captain can resume automatic fixture updates without touching player results",
    async () => {
      await role("authenticated", CAP);
      const data = await get();
      const future = data.matches[7];
      await assert.rejects(
        db.query("select use_league_fixture($1,null)", [future.id]),
      );
      await db.query("select use_league_fixture($1,$2)", [
        future.id,
        future.revision,
      ]);
      const after = await get();
      assert.equal(after.matches[7].fixtureOverride, false);
      assert.equal(after.matches[7].venue, "Field 3");
      assert.equal(after.matches[0].result.stats[0].goals, 2);
    },
  );
  await db.close();
});
