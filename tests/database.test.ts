import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const C = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  CAP = "33333333-3333-4333-8333-333333333333",
  SECOND = "44444444-4444-4444-8444-444444444444",
  STRANGER = "55555555-5555-4555-8555-555555555555",
  SEASON = "66666666-6666-4666-8666-666666666666",
  PLAYER = "77777777-7777-4777-8777-777777777777",
  MATCH = "88888888-8888-4888-8888-888888888888",
  PRIVATE = "99999999-9999-4999-8999-999999999999";
test("database authorization and transactional workflow", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202611090001_club_workflow.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202611090002_hosted_permissions_and_captain_invites.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    `insert into auth.users(id) values('${CAP}'),('${SECOND}'),('${STRANGER}');insert into clubs(id,name) values('${C}','Test club'),('${OTHER}','Other club');insert into club_memberships values('${C}','${CAP}','captain'),('${C}','${SECOND}','captain'),('${OTHER}','${STRANGER}','captain');insert into seasons(id,club_id,name,competition,format) values('${SEASON}','${C}','Fall','Test','7v7');insert into players(id,club_id,name,number,position,initials,is_public) values('${PLAYER}','${C}','Public Player',9,'Forward','PP',true),('${PRIVATE}','${C}','Private Player',8,'Defender','XX',false);insert into season_roster values('${C}','${SEASON}','${PLAYER}'),('${C}','${SEASON}','${PRIVATE}');insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round) values('${MATCH}','${C}','${SEASON}','Opposition','OP','Test pitch',1);`,
  );
  async function as(role: "anon" | "authenticated", id = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role ${role};`,
    );
  }
  const result = {
    home: 2,
    away: 1,
    onFieldHome: 2,
    onFieldAway: 1,
    basis: "played",
    reason: "",
    attendance: "complete",
    scorers: "complete",
    assists: "unrecorded",
    ownGoals: 0,
    stats: [{ playerId: PLAYER, appeared: true, goals: 2, assists: null }],
    published: true,
  };
  const save = (r: unknown, revision: number | null = 0) =>
    db.query("select save_match_result($1,$2,$3::jsonb)", [
      MATCH,
      revision,
      JSON.stringify(r),
    ]);
  const snapshot = async () =>
    (await db.query<{ data: any }>("select get_public_club($1) data", [C]))
      .rows[0].data;
  await t.test(
    "public projection hides private profiles, drafts, memberships and base tables",
    async () => {
      await as("anon");
      const data = await snapshot();
      assert.equal(data.players.length, 1);
      assert.equal(data.players[0].name, "Public Player");
      assert.equal(data.matches[0].result, undefined);
      await assert.rejects(db.query("select * from club_memberships"));
      await assert.rejects(db.query("select * from match_drafts"));
      await assert.rejects(db.query("select * from match_results"));
      await assert.rejects(db.query("select club_snapshot($1,true)", [C]));
      await assert.rejects(save(result));
    },
  );
  await t.test(
    "a captain in another club cannot read private data, write fixtures, or grant access",
    async () => {
      await as("authenticated", STRANGER);
      await assert.rejects(db.query("select get_captain_club($1)", [C]));
      await assert.rejects(save(result));
      await assert.rejects(
        db.query("insert into club_memberships values($1,$2,$3)", [
          C,
          STRANGER,
          "captain",
        ]),
      );
      await assert.rejects(
        db.query("select save_fixture($1,$2)", [C, JSON.stringify({})]),
      );
    },
  );
  await t.test(
    "draft persists privately without changing public scores",
    async () => {
      await as("authenticated", CAP);
      await save({ ...result, published: false });
      assert.equal(
        (await db.query("select * from match_drafts")).rows.length,
        1,
      );
      await as("authenticated", SECOND);
      assert.equal(
        (await db.query("select * from match_drafts")).rows.length,
        0,
      );
      assert.equal((await snapshot()).matches[0].result, undefined);
    },
  );
  await t.test(
    "publishing writes result, player totals, revision and edit history together",
    async () => {
      await as("authenticated", CAP);
      await save(result);
      assert.equal(
        (await db.query("select * from match_drafts")).rows.length,
        0,
      );
      const data = await snapshot();
      assert.equal(data.matches[0].revision, 1);
      assert.equal(data.matches[0].result.stats[0].assists, null);
      assert.equal(data.matches[0].result.home, 2);
      await db.exec("reset role");
      assert.equal(
        (await db.query("select * from result_history")).rows.length,
        1,
      );
      await as("anon");
      assert.equal(
        (await db.query<any>("select * from public_season_totals")).rows[0]
          .goals_for,
        2,
      );
      assert.equal(
        (await db.query<any>("select * from public_player_season_totals"))
          .rows[0].assists,
        null,
      );
    },
  );
  await t.test(
    "invalid correction rolls back and a valid correction replaces totals",
    async () => {
      await as("authenticated", CAP);
      await assert.rejects(save({ ...result, home: 1, onFieldHome: 1 }, 1));
      assert.equal((await snapshot()).matches[0].result.home, 2);
      await save(
        {
          ...result,
          home: 1,
          onFieldHome: 1,
          stats: [{ ...result.stats[0], goals: 1 }],
        },
        1,
      );
      await as("anon");
      assert.equal(
        (await db.query<any>("select * from public_season_totals")).rows[0]
          .played,
        1,
      );
      assert.equal(
        (await db.query<any>("select * from public_season_totals")).rows[0]
          .goals_for,
        1,
      );
      assert.equal(
        (await db.query<any>("select * from public_player_season_totals"))
          .rows[0].goals,
        1,
      );
    },
  );
  await t.test(
    "stale corrections and cross-season scorers are rejected",
    async () => {
      await as("authenticated", SECOND);
      await assert.rejects(save(result, 1));
      await assert.rejects(save(result, null));
      await assert.rejects(
        save(
          { ...result, stats: [{ ...result.stats[0], playerId: STRANGER }] },
          2,
        ),
      );
      assert.equal((await snapshot()).matches[0].revision, 2);
    },
  );
  await t.test(
    "unplayed forfeit changes official totals without creating player stats",
    async () => {
      await as("authenticated", CAP);
      await save(
        {
          ...result,
          home: 3,
          away: 0,
          onFieldHome: 0,
          onFieldAway: 0,
          basis: "forfeit",
          reason: "Opponent did not field a team",
          attendance: "unrecorded",
          scorers: "unrecorded",
          stats: [],
        },
        2,
      );
      await as("anon");
      assert.equal(
        (await db.query<any>("select * from public_season_totals")).rows[0]
          .goals_for,
        3,
      );
      assert.equal(
        (await db.query("select * from public_player_season_totals")).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    "roster approval and fixture changes enforce club ownership",
    async () => {
      await as("authenticated", CAP);
      await db.query("select save_roster_player($1,$2,$3)", [
        C,
        SEASON,
        JSON.stringify({
          id: PRIVATE,
          name: "Now approved",
          number: 8,
          position: "Defender",
          initials: "NA",
          isPublic: true,
        }),
      ]);
      assert.equal((await snapshot()).players.length, 2);
      await assert.rejects(
        db.query("select save_fixture($1,$2)", [
          C,
          JSON.stringify({
            id: MATCH,
            revision: 3,
            seasonId: SEASON,
            status: "cancelled",
          }),
        ]),
      );
    },
  );
  await t.test(
    "revoking captain access takes effect at the next mutation",
    async () => {
      await db.exec(
        `reset role;delete from club_memberships where user_id='${CAP}'`,
      );
      await as("authenticated", CAP);
      await assert.rejects(save(result, 3));
    },
  );
  await t.test(
    "captain preauthorization requires mailbox verification and is consumed once",
    async () => {
      await db.exec("reset role");
      const invited = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await db.query(
        "insert into pending_captain_invites(club_id,email) values($1,$2)",
        [C, "invited@example.test"],
      );
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        invited,
        "invited@example.test",
      ]);
      assert.equal(
        (
          await db.query("select * from club_memberships where user_id=$1", [
            invited,
          ])
        ).rows.length,
        0,
      );
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [invited],
      );
      assert.equal(
        (
          await db.query<any>(
            "select * from club_memberships where user_id=$1",
            [invited],
          )
        ).rows[0].role,
        "captain",
      );
      await db.query("delete from club_memberships where user_id=$1", [
        invited,
      ]);
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [invited],
      );
      assert.equal(
        (
          await db.query("select * from club_memberships where user_id=$1", [
            invited,
          ])
        ).rows.length,
        0,
      );
      await as("anon");
      await assert.rejects(db.query("select * from pending_captain_invites"));
    },
  );
  await db.close();
});
