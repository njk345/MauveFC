import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { formations } from "../src/lib/formations";
import { changeFormation, slotPosition } from "../src/lib/lineup-sheet";
import { preferredPositions, type LineupPayload } from "../src/lib/types";

test("position names match the lineup editor and the database, and overrides follow retained slots", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
  `);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        !name.endsWith("_leagueapps_hourly_refresh.sql"),
    )
    .sort())
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  const uuid = (id: number) =>
    `11111111-1111-4111-8111-${String(id).padStart(12, "0")}`;
  const [club, season, match, cap, member] = [1, 2, 3, 4, 5].map(uuid);
  const outsider = uuid(6);
  const ids = Array.from({ length: 9 }, (_, j) => uuid(j + 10));
  await db.exec(`
    insert into clubs(id,name) values ('${club}','Club');
    insert into auth.users(id) values ('${cap}'),('${member}'),('${outsider}');
    insert into club_memberships(club_id,user_id,role) values ('${club}','${cap}','captain'),('${club}','${member}','player');
    insert into seasons(id,club_id,name,competition,format) values ('${season}','${club}','Fall','League','7v7');
    insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round) values ('${match}','${club}','${season}','Other FC','OFC','Field',1);
  `);
  for (const [index, id] of ids.entries()) {
    await db.query(
      "insert into players(id,club_id,name,number,position,initials,is_public) values ($1,$2,$3,$4,'Defender','PD',$5)",
      [id, club, `Player ${index}`, index, index === 0],
    );
    await db.query("insert into season_roster values ($1,$2,$3)", [
      club,
      season,
      id,
    ]);
  }
  async function as(role: string, user = "") {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${user}',false); set role ${role};`,
    );
  }
  const call = async (name: string, args: unknown[]) =>
    (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as data`,
        args,
      )
    ).rows[0].data;
  const assignments = () =>
    db.query<{ player_id: string; position: string; assignment: string }>(
      "select player_id,position,assignment from private.latest_official_lineup_positions where match_id=$1 order by player_id",
      [match],
    );

  await as("postgres");
  const names = await call("private.detailed_position_names", []);
  assert.deepEqual(names, preferredPositions);
  for (const formation of Object.keys(
    formations,
  ) as LineupPayload["formation"][]) {
    const local = formations[formation].map(
      (_, i) => slotPosition({ formation }, i).name,
    );
    const remote = await db.query<{ position: string }>(
      "select private.lineup_slot_position($1,i) position from generate_series(0,6) i order by i",
      [{ formation }],
    );
    assert.deepEqual(
      remote.rows.map((row) => row.position),
      local,
    );
  }

  const player = {
    id: ids[0],
    name: "Player 0",
    number: 0,
    position: "Defender",
    secondaryPosition: "Goalkeeper",
    initials: "PD",
    isPublic: true,
  };
  await as("authenticated", cap);
  await call("save_roster_player", [club, season, player]);
  const details = await call("save_player_details", [
    club,
    ids[0],
    0,
    {
      position: "Forward",
      secondaryPosition: "Midfielder",
      preferredPositions,
    },
  ]);
  assert.equal(details.position, "Forward");
  assert.equal(details.secondaryPosition, "Midfielder");
  assert.deepEqual(
    [...details.preferredPositions].sort(),
    [...preferredPositions].sort(),
  );
  await assert.rejects(
    call("save_player_details", [
      club,
      ids[0],
      1,
      {
        position: "Goalkeeper",
        secondaryPosition: "Goalkeeper",
      },
    ]),
    /players_secondary_position_check/,
  );
  const { secondaryPosition, ...oldClient } = {
    ...player,
    position: "Forward",
  };
  await call("save_roster_player", [club, season, oldClient]);
  assert.equal(
    (await call("get_captain_club", [club])).players[0].secondaryPosition,
    "Midfielder",
  );
  const publicPlayer = (await call("get_public_club", [club])).players[0];
  assert.equal(publicPlayer.secondaryPosition, "Midfielder");
  assert.equal(publicPlayer.preferredPositions, undefined);
  await as("authenticated", member);
  assert.equal(
    (await call("get_team_club", [club])).players[0].secondaryPosition,
    "Midfielder",
  );
  assert.equal(
    (await call("get_member_player_profiles", [club])).players[0]
      .secondaryPosition,
    "Midfielder",
  );
  await assert.rejects(
    call("save_player_details", [club, ids[0], 1, { secondaryPosition: null }]),
    /Captain/,
  );
  await assert.rejects(assignments(), /permission denied/);

  const legacy: LineupPayload = {
    formation: "2-3-1",
    starters: ids.slice(0, 7),
    bench: ids.slice(7),
    benchPositions: { [ids[7]]: 4 },
  };
  const custom: LineupPayload = {
    ...legacy,
    slotPositions: { 4: "Defensive midfield" },
  };
  assert.equal(
    changeFormation({ ...custom, slotPositions: { 3: "Left wing" } }, "3-2-1")
      .slotPositions?.[4],
    "Left wing",
  );
  await as("authenticated", cap);
  await assert.rejects(
    call("save_match_lineup", [
      match,
      0,
      { ...custom, slotPositions: { 0: "Striker" } },
      true,
    ]),
    /outfield position/,
  );
  await assert.rejects(
    call("save_match_lineup", [
      match,
      0,
      { ...custom, slotPositions: { 4: "Invented role" } },
      false,
    ]),
    /outfield position/,
  );
  await call("save_match_lineup", [match, 0, legacy, true]);
  await call("save_match_lineup", [match, 1, custom, false]);
  await as("authenticated", member);
  await call("post_lineup_suggestion", [match, custom]);
  assert.deepEqual(await call("get_player_lineup_roles", [club, ids[4]]), [
    { matchId: match, position: "Central midfield", assignment: "starter" },
  ]);
  assert.deepEqual(await call("get_player_lineup_roles", [club, ids[8]]), []);
  await as("authenticated", outsider);
  await assert.rejects(call("get_player_lineup_roles", [club, ids[4]]), /Team membership required/);
  await as("anon");
  await assert.rejects(call("get_player_lineup_roles", [club, ids[0]]), /permission denied/);
  await as("authenticated", member);
  await assert.rejects(
    call("post_lineup_suggestion", [
      match,
      { ...custom, slotPositions: { 4: "Invalid" } },
    ]),
    /outfield position/,
  );
  await as("postgres");
  const old = (await assignments()).rows;
  assert.equal(old.length, 8);
  assert.equal(
    old.find((row) => row.player_id === ids[4])?.position,
    "Central midfield",
  );
  assert.equal(
    old.find((row) => row.player_id === ids[7])?.assignment,
    "substitute",
  );
  assert.ok(!old.some((row) => row.player_id === ids[8]));

  await as("authenticated", cap);
  await call("save_match_lineup", [
    match,
    2,
    {
      ...custom,
      starters: [...ids.slice(0, 6), ids[8]],
      bench: ids.slice(6, 8),
    },
    true,
  ]);
  assert.deepEqual(await call("get_player_lineup_roles", [club, ids[7]]), [
    { matchId: match, position: "Defensive midfield", assignment: "substitute" },
  ]);
  await as("postgres");
  const latest = (await assignments()).rows;
  assert.equal(latest.length, 8);
  assert.ok(!latest.some((row) => row.player_id === ids[6]));
  assert.equal(
    latest.find((row) => row.player_id === ids[4])?.position,
    "Defensive midfield",
  );
  assert.equal(
    latest.find((row) => row.player_id === ids[7])?.position,
    "Defensive midfield",
  );
  assert.equal(
    (await db.query("select * from match_player_stats")).rows.length,
    0,
  );
  await as("authenticated", cap);
  await call("unshare_match_lineup", [match, 3]);
  assert.deepEqual(await call("get_player_lineup_roles", [club, ids[4]]), []);
  await as("postgres");
  assert.equal((await assignments()).rows.length, 0);
  await db.close();
});
