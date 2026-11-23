import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { blankResult } from "../src/features/matches/player-stats";
import { playerStats } from "../src/features/stats/queries";

test("member player profiles expose the full roster and published history only to current club members", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    S = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    MEM = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445",
    P = "55555555-5555-4555-8555-555555555551",
    Q = "55555555-5555-4555-8555-555555555552";
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
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id,email) values('${CAP}','captain@example.test'),('${MEM}','member@example.test'),('${OUT}','outsider@example.test');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${MEM}','player'),('${OTHER}','${OUT}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7');insert into players(id,club_id,name,number,position,initials,is_public,bio) values('${P}','${C}','Public Player',9,'Forward','PP',true,'Public bio'),('${Q}','${C}','Private Teammate',10,'Midfielder','PT',false,'Private player bio');insert into season_roster values('${C}','${S}','${P}'),('${C}','${S}','${Q}');`,
  );
  const as = async (role: string, user = "") => {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`,
    );
  };
  const rpc = async (name: string, args: unknown[]) =>
    (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  const profiles = () => rpc("get_member_player_profiles", [C]);
  await as("authenticated", CAP);
  const mid = await rpc("save_fixture", [
    C,
    JSON.stringify({
      seasonId: S,
      opponent: "FC",
      opponentCode: "FC",
      color: "#657293",
      kickoff: "2026-11-01T20:00:00Z",
      venue: "Pitch",
      round: 1,
      home: true,
      status: "scheduled",
    }),
  ]);
  const added = await rpc("add_match_guest", [
    mid,
    0,
    null,
    JSON.stringify({
      name: "Private Historical Guest",
      number: 0,
      position: "Forward",
      initials: "PG",
      hometown: "",
      bio: "Guest bio",
      isPublic: false,
    }),
    false,
  ]);
  const G = added.player.id;
  const result = {
    ...blankResult([]),
    home: 3,
    away: 1,
    onFieldHome: 3,
    onFieldAway: 1,
    published: true,
    attendance: "partial",
    scorers: "partial",
    assists: "partial",
    stats: [
      { playerId: P, appeared: true, goals: 1, assists: 0 },
      { playerId: Q, appeared: true, goals: 2, assists: 2 },
      { playerId: G, appeared: true, goals: 0, assists: 0 },
    ],
  };
  await rpc("save_match_result", [mid, added.revision, JSON.stringify(result)]);
  const current = (await rpc("get_captain_club", [C])).matches.find(
    (m: any) => m.id === mid,
  );
  await rpc("save_match_result", [
    mid,
    current.revision,
    JSON.stringify({ ...result, published: false, home: 9, onFieldHome: 9 }),
  ]);
  await t.test(
    "anonymous users, outsiders and other-club requests cannot read private profiles",
    async () => {
      await as("anon");
      await assert.rejects(profiles());
      await as("authenticated", OUT);
      await assert.rejects(profiles());
      await as("authenticated", MEM);
      await assert.rejects(rpc("get_member_player_profiles", [OTHER]));
    },
  );
  await t.test(
    "players and captains see private profiles, guest identities and accurate published stats",
    async () => {
      for (const user of [MEM, CAP]) {
        await as("authenticated", user);
        const data = await profiles();
        assert.equal(data.players.length, 3);
        assert.ok(data.players.some((p: any) => p.id === Q && !p.isPublic));
        assert.ok(data.players.some((p: any) => p.id === G));
        assert.equal(data.roster.length, 2);
        const m = data.matches.find((m: any) => m.id === mid);
        assert.equal(m.result.home, 3);
        assert.equal(m.result.stats.length, 3);
        const p = playerStats(data.matches, data.players).find(
          (p) => p.id === Q,
        )!;
        assert.equal(p.appearances, 1);
        assert.equal(p.goals, 2);
        assert.equal(p.assists, 2);
        assert.equal(p.bio, "Private player bio");
        const serialized = JSON.stringify(data);
        for (const key of [
          "drafts",
          "removedFixtures",
          "lineups",
          "rsvps",
          "editorId",
          "editor_id",
          "leagueScore",
          "needsReview",
        ])
          assert.equal(serialized.includes('"' + key + '"'), false, key);
        assert.equal(serialized.includes("captain@example.test"), false);
        assert.equal(serialized.includes(CAP), false);
        const directory = await rpc("get_player_directory", [C]);
        assert.equal(directory.length, 3);
        assert.ok(directory.some((p: any) => p.id === G && p.guestGames === 1));
      }
    },
  );
  await t.test(
    "public profiles remain approved-only even when requested by a signed-in member",
    async () => {
      for (const [role, user] of [
        ["anon", ""],
        ["authenticated", MEM],
        ["authenticated", CAP],
      ]) {
        await as(role, user);
        const data = await rpc("get_public_club", [C]);
        assert.deepEqual(
          data.players.map((p: any) => p.id),
          [P],
        );
        assert.equal(
          data.matches.find((m: any) => m.id === mid).result.stats.length,
          1,
        );
        const text = JSON.stringify(data);
        assert.equal(text.includes(Q), false);
        assert.equal(text.includes(G), false);
        assert.equal(text.includes("Private Teammate"), false);
        assert.equal(text.includes("Private player bio"), false);
      }
    },
  );
  await t.test(
    "removed fixtures do not reappear in private profile stats or appearance history",
    async () => {
      await as("authenticated", CAP);
      await rpc("set_fixture_removed", [mid, current.revision, true]);
      await as("authenticated", MEM);
      const data = await profiles();
      assert.equal(
        data.matches.some((m: any) => m.id === mid),
        false,
      );
      assert.equal(data.players.length, 3);
      assert.equal(
        playerStats(data.matches, data.players).find((p) => p.id === Q)!.goals,
        0,
      );
      assert.equal(
        (await rpc("get_player_directory", [C])).find((p: any) => p.id === G)
          .appearances,
        0,
      );
    },
  );
  await t.test(
    "revocation takes effect for profiles and directory with the same signed-in identity",
    async () => {
      await as("postgres");
      await db.query(
        "delete from club_memberships where club_id=$1 and user_id=$2",
        [C, MEM],
      );
      await as("authenticated", MEM);
      await assert.rejects(profiles());
      await assert.rejects(rpc("get_player_directory", [C]));
    },
  );
  await db.close();
});
