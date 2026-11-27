import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SeasonStatsSnapshot } from "../src/lib/types";

test("archive totals count unique players, preserve unknowns and hide private identities", async () => {
  const db = new PGlite();
  const uuid = (n: number) =>
    `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
  const [
    club,
    other,
    captain,
    member,
    outsider,
    first,
    second,
    foreign,
    one,
    two,
    removed,
    draft,
    visible,
    hidden,
    guest,
    unknown,
  ] = Array.from({ length: 16 }, (_, i) => uuid(i + 1));
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
  `);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter(
      (f) =>
        f.endsWith(".sql") && !f.endsWith("_leagueapps_hourly_refresh.sql"),
    )
    .sort())
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  await db.exec(`
    insert into clubs(id,name) values ('${club}','Club'),('${other}','Other');
    insert into auth.users(id) values ('${captain}'),('${member}'),('${outsider}');
    insert into club_memberships(club_id,user_id,role) values
      ('${club}','${captain}','captain'),('${club}','${member}','player'),('${other}','${outsider}','captain');
    insert into seasons(id,club_id,name,competition,format) values
      ('${first}','${club}','First','League','7v7'),('${second}','${club}','Second','League','5v5'),
      ('${foreign}','${other}','Other','League','7v7');
    insert into players(id,club_id,name,number,position,initials,is_public) values
      ('${visible}','${club}','Visible',1,'Forward','V',true),
      ('${hidden}','${club}','Hidden',2,'Forward','H',false),
      ('${guest}','${club}','Guest',3,'Forward','G',false),
      ('${unknown}','${club}','Unknown',4,'Forward','U',true);
    insert into season_roster select '${club}', s.id, p.id
      from (values ('${first}'::uuid),('${second}'::uuid)) s(id)
      cross join (values ('${visible}'::uuid),('${hidden}'::uuid),('${unknown}'::uuid)) p(id);
    insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round,status,playoff_round) values
      ('${one}','${club}','${first}','FC','FC','Pitch',1,'completed',null),
      ('${two}','${club}','${second}','FC','FC','Pitch',1,'completed','finals'),
      ('${removed}','${club}','${second}','FC','FC','Pitch',2,'completed',null),
      ('${draft}','${club}','${second}','FC','FC','Pitch',3,'completed',null);
    insert into match_results(club_id,match_id,home,away,on_field_home,on_field_away,basis,attendance,scorers,assists,own_goals,published) values
      ('${club}','${one}',3,1,3,1,'played','partial','partial','partial',0,true),
      ('${club}','${two}',4,1,4,1,'played','partial','partial','unrecorded',0,true),
      ('${club}','${removed}',9,1,9,1,'played','partial','partial','partial',0,true),
      ('${club}','${draft}',9,1,9,1,'played','partial','partial','partial',0,false);
    insert into private.match_guests(club_id,match_id,player_id) values ('${club}','${two}','${guest}');
    insert into match_player_stats(club_id,match_id,player_id,appeared,goals,assists) values
      ('${club}','${one}','${visible}',true,1,0),('${club}','${one}','${hidden}',true,2,2),
      ('${club}','${two}','${visible}',true,3,null),('${club}','${two}','${guest}',true,1,null),
      ('${club}','${removed}','${visible}',true,9,9),('${club}','${draft}','${visible}',true,9,9);
    update matches set removed_at=now(),removed_by='${captain}' where id='${removed}';
  `);
  const as = (role: string, user = "") =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${user}',false); set role ${role};`,
    );
  const stats = async (ids: string[]) =>
    (
      await db.query<{ data: SeasonStatsSnapshot }>(
        "select get_archive_stats($1,$2) data",
        [club, ids],
      )
    ).rows[0].data;
  for (const [role, user] of [
    ["anon", ""],
    ["authenticated", outsider],
  ]) {
    await as(role, user);
    const result = await stats([first, second, second]);
    assert.deepEqual(
      result.players.map((p) => p.id),
      [visible, unknown],
    );
    assert.equal(result.privatePlayerCount, 2);
    assert.equal(result.players[0].goals, 4);
    assert.equal(result.players[0].appearances, 2);
    assert.equal(result.players[0].assists, 0);
    assert.equal(result.players[0].assistsKnown, true);
    assert.equal(result.players[1].goalsKnown, false);
    assert.equal(result.assistsTotal, 2);
    assert.equal(result.goalRecords, 2);
    assert.equal(result.assistsRecordedMatches, 1);
    assert.ok(!JSON.stringify(result).includes(guest));
    assert.ok(!JSON.stringify(result).includes(hidden));
    await assert.rejects(stats([first, foreign]), /valid club seasons/);
  }
  for (const user of [captain, member]) {
    await as("authenticated", user);
    const result = await stats([first, second]);
    assert.equal(result.privatePlayerCount, 0);
    assert.equal(result.players.length, 4);
    assert.equal(result.players.find((p) => p.id === hidden)?.assists, 2);
    assert.equal(result.players.find((p) => p.id === guest)?.isGuest, true);
    assert.equal(result.players.find((p) => p.id === guest)?.goals, 1);
  }
  await db.close();
});
