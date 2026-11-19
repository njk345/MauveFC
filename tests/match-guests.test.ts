import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { matchPlayers, applyGuestToMatch } from "../src/lib/match-players";
import type { Match, Player } from "../src/lib/types";

test("game guests retain one club identity across roster seasons, stats and lineups", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "22222222-2222-4222-8222-222222222222";
  const CAP = "33333333-3333-4333-8333-333333333333",
    MEMBER = "44444444-4444-4444-8444-444444444444",
    OUTSIDE = "55555555-5555-4555-8555-555555555555",
    SECOND = "33333333-3333-4333-8333-333333333334";
  const S = "66666666-6666-4666-8666-666666666666",
    OLD = "66666666-6666-4666-8666-666666666667";
  const A = "77777777-7777-4777-8777-777777777771",
    B = "77777777-7777-4777-8777-777777777772",
    HIST = "77777777-7777-4777-8777-777777777773",
    CANCEL = "77777777-7777-4777-8777-777777777774";
  const ids = Array.from(
    { length: 10 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  for (const name of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    // Hosted pg_net/pg_cron dispatch is covered separately, not by PGlite.
    .filter((n) => n.endsWith(".sql") && !n.endsWith("_leagueapps_hourly_refresh.sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id) values('${CAP}'),('${MEMBER}'),('${OUTSIDE}'),('${SECOND}');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${SECOND}','captain'),('${C}','${MEMBER}','player'),('${OTHER}','${OUTSIDE}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Current','League','7v7'),('${OLD}','${C}','Earlier','League','7v7');`,
  );
  for (const [i, id] of ids.entries())
    await db.query(
      "insert into players(id,club_id,name,number,position,initials,is_public) values($1,$2,$3,$4,'Midfielder','PM',false)",
      [id, i === 9 ? OTHER : C, `Player ${i}`, i],
    );
  for (const id of ids.slice(0, 8))
    await db.query("insert into season_roster values($1,$2,$3)", [C, S, id]);
  await db.query("insert into season_roster values($1,$2,$3)", [
    C,
    OLD,
    ids[8],
  ]);
  for (const [id, season, status] of [
    [A, S, "scheduled"],
    [B, S, "scheduled"],
    [HIST, OLD, "scheduled"],
    [CANCEL, S, "cancelled"],
  ])
    await db.query(
      "insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round,kickoff,status) values($1,$2,$3,'Opposition','OP','Pitch',1,'2099-01-01T20:00:00Z',$4)",
      [id, C, season, status],
    );
  async function as(role: string, user = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`,
    );
  }
  async function scalar(name: string, args: unknown[]) {
    return (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  }
  const directory = () => scalar("get_player_directory", [C]);
  const add = (
    match: string,
    revision: number,
    playerId: string | null = null,
    player: unknown = null,
    allow = false,
  ) =>
    scalar("add_match_guest", [
      match,
      revision,
      playerId,
      player === null ? null : JSON.stringify(player),
      allow,
    ]);
  const remove = (match: string, revision: number, playerId: string) =>
    scalar("remove_match_guest", [match, revision, playerId]);
  const result = {
    home: 3,
    away: 1,
    onFieldHome: 3,
    onFieldAway: 1,
    basis: "played",
    reason: "",
    attendance: "partial",
    scorers: "partial",
    assists: "unrecorded",
    ownGoals: 0,
    published: false,
    stats: [{ playerId: ids[0], appeared: true, goals: 1, assists: null }],
  };
  let guest = "",
    sameNameGuest = "";
  await t.test(
    "only captains can register guests; the club directory is private to members",
    async () => {
      await as("anon");
      await assert.rejects(directory());
      await assert.rejects(add(A, 0, ids[8]));
      await assert.rejects(db.query("select * from private.match_guests"));
      await as("authenticated", OUTSIDE);
      await assert.rejects(directory());
      await assert.rejects(add(A, 0, ids[8]));
      await as("authenticated", MEMBER);
      assert.equal((await directory()).length, 9);
      await assert.rejects(add(A, 0, ids[8]));
      await assert.rejects(remove(A, 0, ids[8]));
      await assert.rejects(db.query("select * from private.match_guests"));
    },
  );
  await t.test(
    "a former roster player is reused without becoming a current roster player or inventing attendance",
    async () => {
      await as("authenticated", SECOND);
      await scalar("save_match_result", [A, 0, JSON.stringify(result)]);
      await as("authenticated", CAP);
      await scalar("save_match_result", [A, 0, JSON.stringify(result)]);
      const first = await add(A, 0, ids[8]);
      assert.equal(first.player.id, ids[8]);
      assert.equal(first.revision, 1);
      const again = await add(A, 1, ids[8]);
      assert.equal(again.revision, 1);
      await add(B, 0, ids[8]);
      assert.equal((await directory()).length, 9);
      const person = (await directory()).find((p: any) => p.id === ids[8]);
      assert.deepEqual(person.rosterSeasonIds, [OLD]);
      assert.equal(person.guestGames, 2);
      assert.equal(person.appearances, 0);
      const own = (
        await db.query<any>(
          "select base_revision,payload from match_drafts where match_id=$1",
          [A],
        )
      ).rows[0];
      assert.equal(own.base_revision, 1);
      assert.equal(own.payload.stats[0].goals, 1);
      await as("authenticated", SECOND);
      assert.equal(
        (
          await db.query<any>(
            "select base_revision from match_drafts where match_id=$1",
            [A],
          )
        ).rows[0].base_revision,
        0,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from match_player_stats where match_id=$1",
            [A],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from season_roster where season_id=$1 and player_id=$2",
            [S, ids[8]],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "new guests get private identities; duplicate names require an explicit distinct-person choice",
    async () => {
      await as("authenticated", CAP);
      const added = await add(A, 1, null, {
        name: "  Jamie   Guest ",
        number: 19,
        position: "Forward",
        isPublic: true,
        id: ids[9],
      });
      guest = added.player.id;
      assert.notEqual(guest, ids[9]);
      assert.equal(added.player.name, "Jamie Guest");
      assert.equal(added.player.isPublic, false);
      assert.equal(added.revision, 2);
      await assert.rejects(
        add(B, 1, null, {
          name: "jamie guest",
          number: 19,
          position: "Forward",
        }),
      );
      const distinct = await add(
        B,
        1,
        null,
        { name: "Jamie Guest", number: 20, position: "Defender" },
        true,
      );
      sameNameGuest = distinct.player.id;
      assert.notEqual(sameNameGuest, guest);
      assert.equal(
        (await directory()).filter((p: any) => p.name === "Jamie Guest").length,
        2,
      );
      await assert.rejects(
        add(A, 0, null, {
          name: "Stale Person",
          number: 5,
          position: "Midfielder",
        }),
      );
      await assert.rejects(add(A, 2, ids[9]));
      await assert.rejects(add(A, 2, ids[0]));
      await assert.rejects(add(CANCEL, 0, guest));
      await assert.rejects(
        add(A, 2, null, {
          name: "Bad Number",
          number: 1.5,
          position: "Forward",
        }),
      );
      assert.equal(
        (await directory()).some((p: any) =>
          ["Stale Person", "Bad Number"].includes(p.name),
        ),
        false,
      );
    },
  );
  const lineup = () => ({
    formation: "2-3-1",
    starters: [...ids.slice(0, 6), guest],
    bench: [ids[8]],
    benchPositions: { [ids[8]]: 6 },
    firstNamesOnly: true,
    hideNumbers: true,
  });
  await t.test(
    "registered guests are eligible for official lineups and member suggestions only in assigned games",
    async () => {
      await as("authenticated", CAP);
      await scalar("save_match_lineup", [A, 0, JSON.stringify(lineup()), true]);
      await assert.rejects(
        scalar("save_match_lineup", [B, 0, JSON.stringify(lineup()), true]),
      );
      await as("authenticated", MEMBER);
      await scalar("post_lineup_suggestion", [A, JSON.stringify(lineup())]);
      await assert.rejects(
        scalar("post_lineup_suggestion", [B, JSON.stringify(lineup())]),
      );
      await assert.rejects(
        scalar("save_match_lineup", [A, 1, JSON.stringify(lineup()), true]),
      );
    },
  );
  const published = () => ({
    ...result,
    published: true,
    scorers: "complete",
    assists: "complete",
    stats: [
      { playerId: ids[0], appeared: true, goals: 1, assists: 1 },
      { playerId: guest, appeared: true, goals: 2, assists: 1 },
    ],
  });
  await t.test(
    "guest stats publish transactionally and appear once in season totals with normal privacy rules",
    async () => {
      await as("authenticated", CAP);
      await assert.rejects(
        scalar("save_match_result", [B, 2, JSON.stringify(published())]),
      );
      await scalar("save_match_result", [A, 2, JSON.stringify(published())]);
      const captain = await scalar("get_captain_club", [C]);
      assert.ok(
        captain.matches
          .find((m: any) => m.id === A)
          .guestPlayerIds.includes(guest),
      );
      await as("authenticated", MEMBER);
      const team = await scalar("get_team_club", [C]);
      assert.ok(
        team.matches
          .find((m: any) => m.id === A)
          .guestPlayerIds.includes(guest),
      );
      const stats = await scalar("get_season_stats", [C, S]);
      const row = stats.players.find((p: any) => p.id === guest);
      assert.equal(row.goals, 2);
      assert.equal(row.assists, 1);
      assert.equal(row.appearances, 1);
      assert.equal(row.isGuest, true);
      assert.equal(stats.assistsTotal, 2);
      const dir = (await directory()).find((p: any) => p.id === guest);
      assert.equal(dir.appearances, 1);
      assert.equal(dir.guestGames, 1);
      assert.deepEqual(dir.rosterSeasonIds, []);
      await as("anon");
      const visible = await scalar("get_public_club", [C]);
      assert.equal(visible.players.length, 0);
      assert.equal(
        visible.matches.some((m: any) => "guestPlayerIds" in m),
        false,
      );
      const publicStats = await scalar("get_season_stats", [C, S]);
      assert.equal(publicStats.assistsTotal, 2);
      assert.equal(publicStats.players.length, 0);
      assert.equal(JSON.stringify(publicStats).includes(guest), false);
      assert.equal(JSON.stringify(publicStats).includes("Jamie"), false);
      await db.exec("reset role");
      await db.query("update players set is_public=true where id=$1", [guest]);
      await as("anon");
      const approved = await scalar("get_season_stats", [C, S]);
      assert.equal(approved.players.length, 1);
      assert.equal(approved.players[0].id, guest);
      assert.equal(approved.players[0].isGuest, true);
      assert.equal(approved.players[0].goals, 2);
    },
  );
  await t.test(
    "unused guests can be removed without deleting people; used lineup and appearance history is protected",
    async () => {
      await as("authenticated", CAP);
      await assert.rejects(remove(A, 3, guest));
      await assert.rejects(remove(A, 3, ids[8]));
      const removed = await remove(B, 2, sameNameGuest);
      assert.equal(removed.revision, 3);
      assert.equal(
        (await directory()).some((p: any) => p.id === sameNameGuest),
        true,
      );
      assert.equal((await remove(B, 3, sameNameGuest)).revision, 3);
      const unused = await add(A, 3, null, {
        name: "Unused Guest",
        number: 25,
        position: "Midfielder",
      });
      await scalar("save_match_result", [
        A,
        4,
        JSON.stringify({
          ...published(),
          stats: [
            ...published().stats,
            {
              playerId: unused.player.id,
              appeared: false,
              goals: 0,
              assists: 0,
            },
          ],
        }),
      ]);
      const change = await remove(A, 5, unused.player.id);
      assert.equal(change.revision, 6);
      const after = await scalar("get_captain_club", [C]);
      const game = after.matches.find((m: any) => m.id === A);
      assert.equal(game.result.home, 3);
      assert.equal(
        game.result.stats.some((s: any) => s.playerId === unused.player.id),
        false,
      );
      assert.equal(game.guestPlayerIds.includes(unused.player.id), false);
      assert.equal(
        (await directory()).some((p: any) => p.id === unused.player.id),
        true,
      );
    },
  );
  await t.test(
    "later roster membership reuses the guest identity without doubling stats",
    async () => {
      await as("authenticated", CAP);
      const person = (await directory()).find((p: any) => p.id === guest);
      assert.equal(await scalar("save_roster_player", [C, S, JSON.stringify(person)]), guest);
      await as("authenticated", MEMBER);
      const stats = await scalar("get_season_stats", [C, S]);
      assert.equal(stats.players.filter((p: any) => p.id === guest).length, 1);
      assert.equal(
        stats.players.find((p: any) => p.id === guest).isGuest,
        false,
      );
      assert.equal(stats.assistsTotal, 2);
      await db.exec("reset role");
      await db.query(
        "delete from club_memberships where club_id=$1 and user_id=$2",
        [C, MEMBER],
      );
      await as("authenticated", MEMBER);
      await assert.rejects(directory());
    },
  );
  await db.close();
});

test("match eligibility combines roster and game guests without duplicate or cross-game players", () => {
  const player = (id: string) =>
    ({
      id,
      name: id,
      number: 1,
      position: "Midfielder",
      initials: "P",
      hometown: "",
      bio: "",
    }) as Player;
  const match = {
    id: "a",
    seasonId: "s",
    guestPlayerIds: ["roster", "guest"],
  } as Match;
  const players = [player("roster"), player("guest"), player("other")];
  assert.deepEqual(
    matchPlayers(players, [{ seasonId: "s", playerId: "roster" }], match).map(
      (p) => p.id,
    ),
    ["roster", "guest"],
  );
  assert.deepEqual(
    matchPlayers(players, [{ seasonId: "s", playerId: "roster" }], {
      ...match,
      id: "b",
      guestPlayerIds: [],
    }).map((p) => p.id),
    ["roster"],
  );
  assert.deepEqual(
    applyGuestToMatch(match, {
      matchId: "a",
      revision: 1,
      action: "add",
      player: players[1],
    }).guestPlayerIds,
    ["roster", "guest"],
  );
});
