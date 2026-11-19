import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { teamStats, sampleSeasonStats } from "../src/features/stats/queries";
import type { SeasonStatsSnapshot, Match } from "../src/lib/types";

test("Stats projection protects private players while publishing full team assist totals", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "22222222-2222-4222-8222-222222222222";
  const CAP = "33333333-3333-4333-8333-333333333333",
    MEMBER = "44444444-4444-4444-8444-444444444444",
    OUTSIDE = "55555555-5555-4555-8555-555555555555";
  const S = "66666666-6666-4666-8666-666666666666",
    OLD = "66666666-6666-4666-8666-666666666667",
    M = "77777777-7777-4777-8777-777777777777";
  const ids = [
    "88888888-8888-4888-8888-888888888881",
    "88888888-8888-4888-8888-888888888882",
    "88888888-8888-4888-8888-888888888883",
  ];
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  for (const name of [
    "202611090001_club_workflow.sql",
    "202611090002_hosted_permissions_and_captain_invites.sql",
    "20261110053440_leagueapps_sync.sql",
    "20261113162329_player_accounts_and_rsvps.sql",
    "20261115215504_lineup_suggestions_and_official_history.sql",
    "20261119222306_team_stats_visibility.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id) values('${CAP}'),('${MEMBER}'),('${OUTSIDE}');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${MEMBER}','player'),('${OTHER}','${OUTSIDE}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7'),('${OLD}','${C}','Old','League','7v7');`,
  );
  for (const [i, id] of ids.entries()) {
    await db.query(
      "insert into players(id,club_id,name,number,position,initials,is_public) values($1,$2,$3,$4,'Midfielder',$5,$6)",
      [
        id,
        C,
        i === 0 ? "Public Player" : `Hidden Identity ${i}`,
        20 + i,
        i === 0 ? "PP" : "XY",
        i === 0,
      ],
    );
    await db.query("insert into season_roster values($1,$2,$3)", [C, S, id]);
  }
  const result = {
    home: 5,
    away: 2,
    onFieldHome: 5,
    onFieldAway: 2,
    basis: "played",
    reason: "",
    attendance: "complete",
    scorers: "partial",
    assists: "partial",
    ownGoals: 0,
    published: true,
    stats: [
      { playerId: ids[0], appeared: true, goals: 1, assists: 1 },
      { playerId: ids[1], appeared: true, goals: 2, assists: 2 },
      { playerId: ids[2], appeared: false, goals: 0, assists: null },
    ],
  };
  await db.query(
    "insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round,kickoff) values($1,$2,$3,'Past FC','PFC','Pitch',1,'2025-01-01T20:00:00Z')",
    [M, C, S],
  );
  async function role(name: string, id = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role ${name};`,
    );
  }
  const snapshot = async (season = S) =>
    (
      await db.query<{ data: SeasonStatsSnapshot }>(
        "select get_season_stats($1,$2) data",
        [C, season],
      )
    ).rows[0].data;
  await role("authenticated", CAP);
  await db.query("select save_match_result($1,0,$2)", [
    M,
    JSON.stringify(result),
  ]);
  await t.test(
    "anonymous responses contain approved stats and anonymous row count, never private identities or totals",
    async () => {
      await role("anon");
      const data = await snapshot();
      assert.equal(data.teamView, false);
      assert.equal(data.privatePlayerCount, 2);
      assert.equal(data.players.length, 1);
      assert.equal(data.players[0].name, "Public Player");
      assert.equal(data.players[0].goals, 1);
      assert.equal(data.players[0].assists, 1);
      assert.equal(data.assistsTotal, 3);
      assert.equal(data.assistsRecordedMatches, 1);
      assert.equal(data.assistsCompleteMatches, 0);
      for (const secret of [ids[1], ids[2], "Hidden Identity", "XY"])
        assert.equal(JSON.stringify(data).includes(secret), false, secret);
      const direct = (
        await db.query<any>("select player_id,goals from match_player_stats")
      ).rows;
      assert.deepEqual(direct, [{ player_id: ids[0], goals: 1 }]);
      await assert.rejects(db.query("select * from private.player_invites"));
      await assert.rejects(
        db.query("select private.league_club_snapshot($1,true)", [C]),
      );
      await assert.rejects(db.query("select get_team_club($1)", [C]));
    },
  );
  await t.test(
    "members and captains receive all player stats without write permission for members",
    async () => {
      for (const user of [MEMBER, CAP]) {
        await role("authenticated", user);
        const data = await snapshot();
        assert.equal(data.teamView, true);
        assert.equal(data.privatePlayerCount, 0);
        assert.equal(data.players.length, 3);
        const hidden = data.players.find((p) => p.id === ids[1])!;
        assert.equal(hidden.name, "Hidden Identity 1");
        assert.equal(hidden.goals, 2);
        assert.equal(hidden.assists, 2);
        assert.equal(hidden.appearances, 1);
        assert.equal(data.assistsTotal, 3);
      }
      await role("authenticated", MEMBER);
      await assert.rejects(
        db.query("select save_match_result($1,1,$2)", [
          M,
          JSON.stringify(result),
        ]),
      );
    },
  );
  await t.test(
    "nonmembers, other-club captains, and revoked members receive only the public projection",
    async () => {
      await role("authenticated", OUTSIDE);
      assert.equal((await snapshot()).teamView, false);
      await db.exec("reset role");
      await db.query(
        "delete from club_memberships where club_id=$1 and user_id=$2",
        [C, MEMBER],
      );
      await role("authenticated", MEMBER);
      assert.equal((await snapshot()).players.length, 1);
      assert.equal((await snapshot()).privatePlayerCount, 2);
      await assert.rejects(
        db.query("select get_season_stats($1,$2)", [OTHER, S]),
      );
    },
  );
  await t.test(
    "unknown assists differ from zero, corrections replace totals, drafts and other seasons are excluded",
    async () => {
      await role("authenticated", CAP);
      await db.query("select save_match_result($1,1,$2)", [
        M,
        JSON.stringify({
          ...result,
          published: false,
          stats: result.stats.map((s) => ({ ...s, assists: 9 })),
        }),
      ]);
      assert.equal((await snapshot()).assistsTotal, 3);
      await db.query("select save_match_result($1,1,$2)", [
        M,
        JSON.stringify({
          ...result,
          assists: "unrecorded",
          stats: result.stats.map((s) => ({ ...s, assists: null })),
        }),
      ]);
      assert.equal((await snapshot()).assistsTotal, null);
      await db.query("select save_match_result($1,2,$2)", [
        M,
        JSON.stringify({
          ...result,
          assists: "complete",
          stats: result.stats.map((s) => ({ ...s, assists: 0 })),
        }),
      ]);
      assert.equal((await snapshot()).assistsTotal, 0);
      assert.equal((await snapshot()).assistsCompleteMatches, 1);
      const old = await snapshot(OLD);
      assert.equal(old.assistsTotal, null);
      assert.deepEqual(old.players, []);
      assert.equal(old.privatePlayerCount, 0);
      await db.exec("reset role");
      await db.query("update players set is_public=false where id=$1", [
        ids[0],
      ]);
      await role("anon");
      const hidden = await snapshot();
      assert.equal(hidden.players.length, 0);
      assert.equal(hidden.privatePlayerCount, 3);
      assert.equal(hidden.assistsTotal, 0);
    },
  );
  await db.close();
});

test("official match totals stay independent of incomplete player attribution and hidden players", () => {
  const stats = {
    home: 5,
    away: 2,
    onFieldHome: 5,
    onFieldAway: 2,
    basis: "played" as const,
    reason: "",
    attendance: "partial" as const,
    scorers: "partial" as const,
    assists: "partial" as const,
    ownGoals: 0,
    published: true,
    stats: [{ playerId: "p", appeared: true, goals: 1, assists: 2 }],
  };
  const match: Match = {
    id: "m",
    seasonId: "s",
    opponent: "FC",
    opponentCode: "FC",
    color: "#657293",
    kickoff: null,
    venue: "Pitch",
    round: 1,
    home: true,
    status: "completed",
    result: stats,
  };
  const roster = [
    {
      id: "p",
      name: "Private",
      number: 7,
      initials: "P",
      position: "Midfielder" as const,
      hometown: "",
      bio: "",
      isPublic: false,
    },
  ];
  const official = teamStats([match]);
  assert.equal(official.played, 1);
  assert.equal(official.goalsFor, 5);
  assert.equal(official.goalDifference, 3);
  const publicStats = sampleSeasonStats([match], roster);
  assert.equal(publicStats.assistsTotal, 2);
  assert.equal(publicStats.privatePlayerCount, 1);
  assert.deepEqual(publicStats.players, []);
  const team = sampleSeasonStats([match], roster, true);
  assert.equal(team.players[0].goals, 1);
  assert.equal(team.assistsTotal, 2);
  const changed = {
    ...match,
    result: {
      ...stats,
      stats: [{ playerId: "p", appeared: true, goals: 4, assists: 3 }],
    },
  };
  assert.deepEqual(teamStats([changed]), official);
  assert.equal(sampleSeasonStats([changed], roster).assistsTotal, 3);
});
