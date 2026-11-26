import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  editableSeasonDetails,
  seasonSelectorLabel,
} from "../src/features/seasons/details";

test("season labels include the league once and automatic labels follow edited year and season", () => {
  const season = {
    id: "s",
    name: "Fall 2026",
    competition: "NYC Soccer",
    format: "7v7",
    term: "Fall" as const,
    year: 2026,
  };
  assert.equal(seasonSelectorLabel(season), "Fall 2026 · NYC Soccer");
  assert.equal(
    seasonSelectorLabel({ ...season, name: "Fall 2026 · NYC Soccer" }),
    "Fall 2026 · NYC Soccer",
  );
  assert.equal(editableSeasonDetails(season).name, "");
  assert.equal(
    editableSeasonDetails({ ...season, name: "The comeback season" }).name,
    "The comeback season",
  );
});

test("season editing and deletion preserve global player identities and enforce captain ownership", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    O = "11111111-1111-4111-8111-111111111112";
  const CAP = "33333333-3333-4333-8333-333333333333",
    MEM = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445";
  const P = "55555555-5555-4555-8555-555555555551",
    Q = "55555555-5555-4555-8555-555555555552",
    G = "55555555-5555-4555-8555-555555555553";
  const S = "66666666-6666-4666-8666-666666666661",
    B = "66666666-6666-4666-8666-666666666662";
  const M = "77777777-7777-4777-8777-777777777771",
    REMOVED = "77777777-7777-4777-8777-777777777772",
    KEEP = "77777777-7777-4777-8777-777777777773";
  const T = "88888888-8888-4888-8888-888888888881",
    U = "88888888-8888-4888-8888-888888888882";
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;`);
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
  await db.exec(`
    insert into clubs(id,name) values('${C}','Club'),('${O}','Other');
    insert into auth.users(id,email) values('${CAP}','captain@example.test'),('${MEM}','member@example.test'),('${OUT}','other@example.test');
    insert into players(id,club_id,name,number,position,initials,is_public) values
      ('${P}','${C}','Season-only Player',8,'Midfielder','SP',false),('${Q}','${C}','Shared Player',9,'Forward','QP',true),('${G}','${C}','Season-only Guest',0,'Defender','SG',false);
    insert into club_memberships(club_id,user_id,role,player_id) values('${C}','${CAP}','captain',null),('${C}','${MEM}','player','${P}'),('${O}','${OUT}','captain',null);
    insert into seasons(id,club_id,name,competition,format,year,term,team_name,manual_standings) values
      ('${S}','${C}','Fall 2026','NYC Soccer','7v7',2026,'Fall','Our FC',true),('${B}','${C}','Spring 2025','NYC Footy','5v5',2025,'Spring','Past FC',false);
    insert into season_roster values('${C}','${S}','${P}'),('${C}','${S}','${Q}'),('${C}','${B}','${Q}');
    insert into private.player_invites(club_id,player_id,email,created_by) values('${C}','${P}','season-only@example.test','${CAP}');
    insert into private.player_details(club_id,player_id,email,phone,relationship_note) values('${C}','${G}','guest@example.test','555 0101','Friend of the club');
    insert into private.season_teams(id,club_id,season_id,name,is_ours) values('${T}','${C}','${S}','Our FC',true),('${U}','${C}','${S}','Other FC',false);
    insert into private.manual_league_results(club_id,season_id,home_team_id,away_team_id,home,away,played_on) values('${C}','${S}','${T}','${U}',2,0,'2026-10-01');
    insert into matches(id,club_id,season_id,opponent,opponent_code,venue,round,kickoff,status) values
      ('${M}','${C}','${S}','Other FC','OF','Pitch',1,'2026-10-01T20:00:00Z','completed'),
      ('${REMOVED}','${C}','${S}','Removed FC','RF','Pitch',2,null,'scheduled'),
      ('${KEEP}','${C}','${B}','Past Other','PO','Pitch',1,'2025-04-01T20:00:00Z','completed');
    insert into match_results(club_id,match_id,home,away,on_field_home,on_field_away,basis,attendance,scorers,assists,own_goals,published) values
      ('${C}','${M}',3,1,3,1,'played','partial','partial','partial',0,true),('${C}','${KEEP}',2,0,2,0,'played','partial','partial','partial',0,true);
    insert into match_player_stats(club_id,match_id,player_id,appeared,goals,assists) values('${C}','${M}','${P}',true,2,1),('${C}','${M}','${G}',true,1,0),('${C}','${KEEP}','${Q}',true,2,1);
    insert into private.match_guests(club_id,match_id,player_id,added_by) values('${C}','${M}','${G}','${CAP}');
    insert into private.match_rsvps(club_id,match_id,player_id,response) values('${C}','${REMOVED}','${P}','in');
    insert into private.match_lineups(club_id,match_id,draft_payload) values('${C}','${REMOVED}','{}');
    insert into private.lineup_posts(club_id,match_id,kind,payload,author_id,author_name) values('${C}','${REMOVED}','suggestion','{}','${MEM}','Member');
    insert into match_drafts(club_id,match_id,editor_id,payload,base_revision) values('${C}','${REMOVED}','${CAP}','{}',0);
    insert into result_history(club_id,match_id,editor_id,after_value) values('${C}','${REMOVED}','${CAP}','{}');
    update matches set removed_at=now(),removed_by='${CAP}' where id='${REMOVED}';
    insert into private.league_sources(club_id,season_id,program_id,team_id,team_name) values('${C}','${B}','123','456','Past FC');
    insert into private.league_runs(club_id,season_id) values('${C}','${B}');
    insert into private.league_games(club_id,season_id,external_id,match_id,snapshot) values('${C}','${B}','123','${KEEP}','{}');
    insert into private.league_changes(match_id,after_value) values('${KEEP}','{}');
    insert into private.season_import_previews(club_id,created_by,config,snapshot,consumed_by) values('${C}','${CAP}','{}','{}','${B}');
  `);
  const as = async (role: string, user = "") =>
    db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`,
    );
  const rpc = async (name: string, args: unknown[]) =>
    (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  const input = {
    name: "",
    competition: "Updated league",
    teamName: "Renamed FC",
    format: "8v8 coed",
    location: "New York",
    leagueWebsite: "https://example.test/league",
    year: 2027,
    term: "Winter",
    timeZone: "America/Los_Angeles",
  };
  await t.test(
    "only the owning captain can edit or delete; input, revisions and confirmation are enforced",
    async () => {
      for (const [role, user] of [
        ["anon", ""],
        ["authenticated", MEM],
        ["authenticated", OUT],
      ]) {
        await as(role, user);
        await assert.rejects(rpc("update_season_details", [S, 0, input]));
        await assert.rejects(rpc("delete_club_season", [S, 0, "Fall 2026"]));
      }
      await as("authenticated", CAP);
      await assert.rejects(
        rpc("update_season_details", [
          S,
          0,
          { ...input, timeZone: "Not/A_Zone" },
        ]),
        /time zone/,
      );
      await assert.rejects(
        rpc("update_season_details", [S, 0, { ...input, year: 2101 }]),
      );
      await assert.rejects(
        rpc("update_season_details", [S, 0, { ...input, term: "Autumn" }]),
      );
      await assert.rejects(
        rpc("update_season_details", [
          S,
          0,
          { ...input, teamName: "Other FC" },
        ]),
        /already uses/,
      );
      await assert.rejects(
        rpc("delete_club_season", [S, 0, "wrong label"]),
        /confirm/,
      );
    },
  );
  await t.test(
    "editing keeps fixtures and stats, renames manual standings and updates future feed time zones",
    async () => {
      await rpc("update_season_details", [S, 0, input]);
      const snapshot = await rpc("get_captain_club", [C]);
      const updated = snapshot.seasons.find((s: any) => s.id === S);
      assert.equal(updated.name, "Winter 2027");
      assert.equal(updated.year, 2027);
      assert.equal(updated.term, "Winter");
      assert.equal(updated.format, "8v8 coed");
      assert.equal(updated.teamName, "Renamed FC");
      assert.equal(updated.competition, "Updated league");
      assert.equal(updated.location, "New York");
      assert.equal(updated.timeZone, "America/Los_Angeles");
      assert.equal(updated.settingsRevision, 1);
      assert.equal(
        updated.leagueTeams.find((v: any) => v.isOurs).name,
        "Renamed FC",
      );
      assert.equal(
        new Date(
          snapshot.matches.find((m: any) => m.id === M).kickoff,
        ).toISOString(),
        "2026-10-01T20:00:00.000Z",
      );
      await assert.rejects(
        rpc("update_season_details", [S, 0, input]),
        /changed/,
      );
      await assert.rejects(
        rpc("delete_club_season", [S, 0, "Winter 2027"]),
        /changed/,
      );
      await rpc("update_season_details", [
        B,
        0,
        { ...input, name: "Custom past season", year: 2025, term: "Spring" },
      ]);
      await as("postgres");
      assert.equal(
        (
          await db.query<any>(
            "select time_zone from private.league_sources where season_id=$1",
            [B],
          )
        ).rows[0].time_zone,
        input.timeZone,
      );
      assert.equal(
        (await db.query<any>("select count(*)::int n from match_player_stats"))
          .rows[0].n,
        3,
      );
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "deleting manual history removes active and removed fixtures and dependent data while preserving all players",
    async () => {
      await rpc("delete_club_season", [S, 1, "Winter 2027"]);
      const snapshot = await rpc("get_captain_club", [C]);
      assert.deepEqual(
        snapshot.seasons.map((s: any) => s.id),
        [B],
      );
      assert.deepEqual(
        snapshot.matches.map((m: any) => m.id),
        [KEEP],
      );
      assert.deepEqual(
        snapshot.roster.map((r: any) => r.playerId),
        [Q],
      );
      assert.equal(snapshot.players.length, 3);
      const directory = await rpc("get_player_directory", [C]);
      for (const id of [P, G]) {
        const player = directory.find((p: any) => p.id === id);
        assert.deepEqual(player.rosterSeasonIds, []);
        assert.equal(player.appearances, 0);
        assert.equal(player.guestGames, 0);
      }
      assert.equal(
        directory.find((p: any) => p.id === G).captainDetails.email,
        "guest@example.test",
      );
      await as("postgres");
      for (const table of [
        "private.lineup_posts",
        "private.match_lineups",
        "private.match_rsvps",
        "private.match_guests",
        "match_drafts",
        "result_history",
        "private.manual_league_results",
        "private.season_teams",
      ]) {
        assert.equal(
          (await db.query<any>(`select count(*)::int n from ${table}`)).rows[0]
            .n,
          0,
          table,
        );
      }
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from club_memberships where player_id=$1",
            [P],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from private.player_invites where player_id=$1",
            [P],
          )
        ).rows[0].n,
        1,
      );
      await as("authenticated", MEM);
      assert.deepEqual(
        (await rpc("get_member_player_profiles", [C])).matches.map(
          (m: any) => m.id,
        ),
        [KEEP],
      );
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "deleting the final feed season cancels its jobs and removes stats without deleting the directory",
    async () => {
      await rpc("delete_club_season", [B, 1, "Custom past season"]);
      const snapshot = await rpc("get_captain_club", [C]);
      assert.deepEqual(snapshot.seasons, []);
      assert.deepEqual(snapshot.matches, []);
      assert.deepEqual(snapshot.roster, []);
      assert.equal(snapshot.players.length, 3);
      assert.equal((await rpc("get_player_directory", [C])).length, 3);
      assert.deepEqual((await rpc("get_public_club", [C])).matches, []);
      await as("postgres");
      for (const table of [
        "private.league_sources",
        "private.league_runs",
        "private.league_games",
        "private.league_changes",
        "private.season_import_previews",
        "match_player_stats",
        "match_results",
      ]) {
        assert.equal(
          (await db.query<any>(`select count(*)::int n from ${table}`)).rows[0]
            .n,
          0,
          table,
        );
      }
      assert.equal(
        (await db.query<any>("select count(*)::int n from players")).rows[0].n,
        3,
      );
      assert.equal(
        (await db.query<any>("select count(*)::int n from auth.users")).rows[0]
          .n,
        3,
      );
    },
  );
  await db.close();
});
