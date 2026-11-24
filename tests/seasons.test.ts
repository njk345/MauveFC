import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  leagueSourceFromLink,
  parseLeagueSnapshot,
  parseStandings,
} from "../supabase/functions/_shared/leagueapps";
import { blankResult } from "../src/features/matches/player-stats";
const schedule = readFileSync(
    new URL("./fixtures/leagueapps-schedule.html", import.meta.url),
    "utf8",
  ),
  standings = readFileSync(
    new URL("./fixtures/leagueapps-standings.html", import.meta.url),
    "utf8",
  );

test("LeagueApps links and parsers work across organizations and program/team IDs", () => {
  const config = leagueSourceFromLink(
    "https://nycfooty.leagueapps.com/leagues/9999999/teams/2222222",
    "",
    "America/Los_Angeles",
  );
  const changed = (value: string) =>
    value.replaceAll("5162244", "9999999").replaceAll("8032635", "2222222");
  const snapshot = parseLeagueSnapshot(
    changed(schedule),
    changed(standings),
    config,
  );
  assert.equal(snapshot.programId, "9999999");
  assert.equal(snapshot.teamId, "2222222");
  assert.equal(snapshot.games.length, 8);
  assert.equal(snapshot.games[0].kickoff, "2026-09-18T04:15:00.000Z");
  const aliases = changed(standings)
    .replace(/>T<\/th>/g, ">D</th>")
    .replace(/>PS<\/th>/g, ">GF</th>")
    .replace(/>PSA<\/th>/g, ">GA</th>")
    .replace(/>PSD<\/th>/g, ">GD</th>")
    .replace(/>DNP<\/th>/g, ">FF</th>")
    .replace(/>PF<\/th>/g, ">PTS</th>");
  assert.deepEqual(parseStandings(aliases, config), snapshot.standings);
  const choice = leagueSourceFromLink(
    "https://nycfooty.leagueapps.com/leagues/9999999/standings",
  );
  assert.equal(choice.teamId, "");
  assert.equal(parseStandings(changed(standings), choice).length, 9);
  assert.throws(() => parseLeagueSnapshot(schedule, standings, config));
  for (const link of [
    "http://nycfooty.leagueapps.com/leagues/1",
    "https://leagueapps.com.evil.test/leagues/1",
    "https://127.0.0.1/leagues/1",
    "https://user:pass@nycfooty.leagueapps.com/leagues/1",
    "https://nycfooty.leagueapps.com:8080/leagues/1",
    "https://nycfooty.leagueapps.com/other/1",
  ])
    assert.throws(() => leagueSourceFromLink(link));
  assert.throws(() =>
    leagueSourceFromLink(
      "https://nycfooty.leagueapps.com/leagues/1/teams/2",
      "3",
    ),
  );
});

test("actual NYC Footy public markup imports official standings and keeps a TBD fixture unscored", () => {
  const config = leagueSourceFromLink(
    "https://nycfooty.leagueapps.com/leagues/soccer-(outdoor)/5086038-2026-fall/teams/8071306",
  );
  const schedule = readFileSync(
      new URL("./fixtures/leagueapps-footy-schedule.html", import.meta.url),
      "utf8",
    ),
    standings = readFileSync(
      new URL("./fixtures/leagueapps-footy-standings.html", import.meta.url),
      "utf8",
    );
  const data = parseLeagueSnapshot(schedule, standings, config);
  assert.equal(data.standings.length, 5);
  assert.equal(data.games.length, 9);
  assert.equal(data.games.filter((g) => g.score).length, 8);
  const future = data.games.find((g) => g.opponent === "Opponent TBD")!;
  assert.ok(future);
  assert.equal(future.score, null);
  assert.equal(future.status, "scheduled");
  assert.equal(future.home, true);
  assert.equal(data.standings[0].points, 19);
  assert.equal(data.standings[0].difference, 8);
});

test("seasons isolate fixtures, manual standings, league sources and historical roster identities", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    CAP = "33333333-3333-4333-8333-333333333333",
    MEM = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445",
    P = "55555555-5555-4555-8555-555555555551",
    Q = "55555555-5555-4555-8555-555555555552",
    MAN = "66666666-6666-4666-8666-666666666661",
    A = "66666666-6666-4666-8666-666666666662",
    B = "66666666-6666-4666-8666-666666666663";
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
    `create schema net;create table net.sent(url text,body jsonb);create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.sent values(url,body);return 1;end;$$;insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id,email,email_confirmed_at) values('${CAP}','captain@example.test',now()),('${MEM}','member@example.test',now()),('${OUT}','outsider@example.test',now());insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${MEM}','player'),('${OTHER}','${OUT}','captain');insert into players(id,club_id,name,number,position,initials,is_public) values('${P}','${C}','Private Historical Player',8,'Midfielder','HP',false),('${Q}','${OTHER}','Other Club Player',9,'Forward','OP',false);`,
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
  const pub = () => rpc("get_public_club", [C]);
  const cap = () => rpc("get_captain_club", [C]);
  const input = (id: string, source = "manual", extra = {}) => ({
    id,
    source,
    year: 2024,
    term: "Fall",
    name: "",
    competition: "Historic League",
    teamName: "Sunday Side",
    location: "Queens, New York",
    leagueWebsite: "https://example.test/league",
    timeZone: "America/New_York",
    format: "7v7",
    completed: false,
    manualStandings: false,
    teams: [],
    rosterPlayerIds: [P],
    ...extra,
  });
  const create = (value: object, preview: string | null = null) =>
    rpc("create_club_season", [C, JSON.stringify(value), preview]);
  const feed = (id: string) =>
    pub().then((v) => v.leagues.find((l: any) => l.seasonId === id));
  const setup = input(MAN);
  let ownMatch: string, otherResult: any, teams: any[];
  const result = (home: number, away: number) => ({
    ...blankResult([]),
    home,
    away,
    onFieldHome: home,
    onFieldAway: away,
    published: true,
    attendance: "partial",
    scorers: "partial",
    assists: "unrecorded",
    stats: [{ playerId: P, appeared: true, goals: 1, assists: null }],
  });
  await as("authenticated", CAP);
  await t.test(
    "manual setup defaults to no standings, reuses roster identities and retries idempotently",
    async () => {
      assert.equal(await create(setup), MAN);
      assert.equal(await create(setup), MAN);
      const data = await cap();
      assert.equal(data.seasons.length, 1);
      assert.equal(data.seasons[0].manualStandings, false);
      assert.equal(data.seasons[0].teamName, "Sunday Side");
      assert.equal(data.leagues.length, 0);
      assert.deepEqual(data.roster, [{ seasonId: MAN, playerId: P }]);
      assert.equal(data.players.length, 1);
      await assert.rejects(
        create({ ...setup, teamName: "Different request" }),
        /already exists/,
      );
      await assert.rejects(
        create(
          input("66666666-6666-4666-8666-666666666664", "manual", {
            rosterPlayerIds: [Q],
          }),
        ),
        /belong/,
      );
      assert.equal((await cap()).seasons.length, 1);
      await assert.rejects(
        create(
          input("66666666-6666-4666-8666-666666666665", "manual", {
            manualStandings: true,
            teams: ["Sunday Side"],
          }),
        ),
        /distinct/,
      );
      assert.equal((await cap()).seasons.length, 1);
    },
  );
  await t.test(
    "manual table uses our published regular games and other-team results without adding club stats",
    async () => {
      await rpc("configure_manual_standings", [
        MAN,
        0,
        true,
        JSON.stringify(["Team A", "Team B"]),
      ]);
      teams = (await cap()).seasons[0].leagueTeams;
      ownMatch = await rpc("save_fixture", [
        C,
        JSON.stringify({
          seasonId: MAN,
          opponent: "Team A",
          opponentCode: "TA",
          venue: "Pitch",
          round: 1,
          home: true,
          status: "scheduled",
          color: "#657293",
          kickoff: "2024-10-01T20:00:00Z",
        }),
      ]);
      await rpc("save_match_result", [
        ownMatch,
        0,
        JSON.stringify(result(3, 1)),
      ]);
      otherResult = {
        id: "77777777-7777-4777-8777-777777777771",
        seasonId: MAN,
        homeTeamId: teams.find((t) => t.name === "Team A").id,
        awayTeamId: teams.find((t) => t.name === "Team B").id,
        home: 9,
        away: 0,
        playedOn: "2024-10-02",
        decision: "regulation",
        penaltyOutcome: null,
        revision: 0,
      };
      await rpc("write_manual_league_result", [
        MAN,
        0,
        JSON.stringify(otherResult),
        false,
      ]);
      const connection = await feed(MAN);
      assert.equal(connection.kind, "manual");
      assert.equal(connection.standings[0].name, "Team A");
      assert.equal(connection.standings[1].name, "Sunday Side");
      const data = await cap();
      assert.equal(data.matches.length, 1);
      assert.equal(data.matches[0].result.home, 3);
      assert.equal(data.matches[0].result.away, 1);
      assert.equal(data.matches[0].result.stats[0].goals, 1);
      assert.equal(
        (await rpc("get_season_stats", [C, MAN])).players.find(
          (p: any) => p.id === P,
        ).appearances,
        1,
      );
      await rpc("set_season_complete", [MAN, 0, true]);
      assert.equal((await pub()).seasons[0].finalPosition, 2);
      const saved = (await rpc("get_manual_league_results", [MAN]))[0];
      otherResult = saved;
      await assert.rejects(
        rpc("write_manual_league_result", [
          MAN,
          0,
          JSON.stringify(saved),
          false,
        ]),
        /changed/,
      );
      await assert.rejects(
        rpc("write_manual_league_result", [
          MAN,
          saved.revision,
          JSON.stringify({
            ...saved,
            homeTeamId: teams.find((t) => t.isOurs).id,
          }),
          false,
        ]),
        /two other/,
      );
      await assert.rejects(
        rpc("write_manual_league_result", [
          MAN,
          saved.revision,
          JSON.stringify({
            ...saved,
            decision: "penalties",
            penaltyOutcome: "W",
          }),
          false,
        ]),
      );
      await rpc("write_manual_league_result", [
        MAN,
        saved.revision,
        JSON.stringify(saved),
        true,
      ]);
      assert.equal((await pub()).seasons[0].finalPosition, 1);
      assert.equal((await cap()).matches.length, 1);
    },
  );
  await t.test(
    "playoffs, unpublished results and removed club fixtures never contribute to manual standings",
    async () => {
      const game = (await cap()).matches[0];
      await rpc("save_fixture", [
        C,
        JSON.stringify({ ...game, playoffRound: "semifinals" }),
      ]);
      assert.equal(
        (await feed(MAN)).standings.reduce(
          (n: number, r: any) => n + r.played,
          0,
        ),
        0,
      );
      const playoff = (await cap()).matches[0];
      await rpc("save_fixture", [
        C,
        JSON.stringify({ ...playoff, playoffRound: null }),
      ]);
      const current = (await cap()).matches[0];
      await rpc("set_fixture_removed", [current.id, current.revision, true]);
      assert.equal(
        (await feed(MAN)).standings.reduce(
          (n: number, r: any) => n + r.played,
          0,
        ),
        0,
      );
      assert.equal(
        (await rpc("get_season_stats", [C, MAN])).players[0].appearances,
        0,
      );
    },
  );
  const snapshot = parseLeagueSnapshot(schedule, standings),
    config = {
      origin: "https://nycsoccer.leagueapps.com",
      programId: snapshot.programId,
      teamId: snapshot.teamId,
      timeZone: "America/New_York",
    };
  async function stage(origin: string = config.origin) {
    await as("service_role");
    const id = await rpc("stage_season_import", [
      C,
      CAP,
      JSON.stringify({ ...config, origin }),
      JSON.stringify(snapshot),
    ]);
    await as("authenticated", CAP);
    return id;
  }
  await t.test(
    "LeagueApps previews are captain-owned, expiring and imported atomically",
    async () => {
      const preview = await stage();
      await as("authenticated", MEM);
      await assert.rejects(create(input(A, "leagueapps"), preview), /Captain/);
      await as("authenticated", OUT);
      await assert.rejects(create(input(A, "leagueapps"), preview), /Captain/);
      await as("authenticated", CAP);
      await as("postgres");
      await db.query(
        "update private.season_import_previews set expires_at=now()-interval '1 minute' where id=$1",
        [preview],
      );
      await as("authenticated", CAP);
      await assert.rejects(create(input(A, "leagueapps"), preview), /expired/);
      assert.equal((await cap()).seasons.length, 1);
      const valid = await stage();
      const request = input(A, "leagueapps", {
        year: 2026,
        teamName: "Current Club",
      });
      assert.equal(await create(request, valid), A);
      assert.equal(await create(request, valid), A);
      await assert.rejects(
        create(input(B, "leagueapps"), valid),
        /already used/,
      );
      const duplicate = await stage();
      await assert.rejects(
        create(input(B, "leagueapps"), duplicate),
        /already linked/,
      );
      assert.equal((await cap()).seasons.length, 2);
      const imported = (await cap()).matches.filter(
        (m: any) => m.seasonId === A,
      );
      assert.equal(imported.length, 8);
      assert.equal(imported.filter((m: any) => m.result).length, 6);
      for (const m of imported.filter((m: any) => m.result)) {
        assert.equal(m.result.attendance, "unrecorded");
        assert.equal(m.result.scorers, "unrecorded");
        assert.deepEqual(m.result.stats, []);
      }
    },
  );
  await t.test(
    "different LeagueApps hosts can reuse numeric game IDs without mixing seasons or standings",
    async () => {
      const preview = await stage("https://nycfooty.leagueapps.com");
      await create(
        input(B, "leagueapps", {
          year: 2023,
          teamName: "Past Club",
          competition: "NYC Footy",
          completed: true,
          rosterPlayerIds: [],
        }),
        preview,
      );
      const data = await cap();
      assert.equal(data.seasons[0].id, A);
      assert.equal(data.matches.filter((m: any) => m.seasonId === B).length, 8);
      assert.equal(
        new Set(data.matches.map((m: any) => m.id)).size,
        data.matches.length,
      );
      assert.equal(data.roster.filter((r: any) => r.seasonId === B).length, 0);
      assert.equal(data.players.length, 1);
      assert.equal(
        (await feed(A)).scheduleUrl,
        "https://nycsoccer.leagueapps.com/leagues/5162244/schedule",
      );
      assert.equal(
        (await feed(B)).scheduleUrl,
        "https://nycfooty.leagueapps.com/leagues/5162244/schedule",
      );
      assert.equal((await feed(B)).refreshesAutomatically, false);
      assert.equal((await feed(A)).refreshesAutomatically, true);
      const text = JSON.stringify(await pub());
      assert.doesNotMatch(
        text,
        /Private Historical Player|captainDetails|relationshipNote|created_by|token|snapshot|config/,
      );
    },
  );
  await t.test(
    "refresh jobs and captain cooldowns are scoped to their selected season",
    async () => {
      await as("postgres");
      await db.query(
        "update private.league_runs set requested_at=now()-interval '6 minutes' where season_id=$1",
        [A],
      );
      await as("authenticated", CAP);
      await rpc("request_league_sync", [C, A]);
      await rpc("request_league_sync", [C, B]);
      await as("postgres");
      const sent = await db.query<any>("select * from net.sent");
      assert.equal(sent.rows.length, 1);
      const token = sent.rows[0].body.token;
      await as("service_role");
      const started = await rpc("begin_league_sync", [token]);
      assert.equal(started.origin, config.origin);
      const changed = structuredClone(snapshot);
      changed.games[0].score = { home: 7, away: 0, basis: "played" };
      await rpc("apply_league_sync", [token, JSON.stringify(changed)]);
      await as("authenticated", CAP);
      const all = (await cap()).matches;
      assert.equal(
        all.find(
          (m: any) =>
            m.seasonId === A && m.externalId === snapshot.games[0].externalId,
        ).result.home,
        7,
      );
      assert.equal(
        all.find(
          (m: any) =>
            m.seasonId === B && m.externalId === snapshot.games[0].externalId,
        ).result.home,
        snapshot.games[0].score!.home,
      );
      await assert.rejects(rpc("request_league_sync", [C]), /Choose a season/);
      assert.equal((await feed(MAN)).kind, "manual");
    },
  );
  await t.test(
    "manual settings and other-team results remain captain-only and cannot affect feed seasons",
    async () => {
      await assert.rejects(
        rpc("configure_manual_standings", [A, 0, true, "[]"]),
        /feed/,
      );
      await assert.rejects(
        rpc("configure_manual_standings", [MAN, 0, false, "[]"]),
        /changed/,
      );
      await rpc("configure_manual_standings", [MAN, 1, false, "[]"]);
      assert.equal(
        (await pub()).leagues.some((l: any) => l.seasonId === MAN),
        false,
      );
      await rpc("configure_manual_standings", [MAN, 2, true, "[]"]);
      assert.equal((await feed(MAN)).kind, "manual");
      for (const user of [MEM, OUT]) {
        await as("authenticated", user);
        await assert.rejects(
          rpc("configure_manual_standings", [MAN, 3, false, "[]"]),
          /Captain/,
        );
        await assert.rejects(
          rpc("get_manual_league_results", [MAN]),
          /Captain/,
        );
        await assert.rejects(
          rpc("write_manual_league_result", [
            MAN,
            0,
            JSON.stringify(otherResult),
            false,
          ]),
          /Captain/,
        );
        await assert.rejects(
          db.query("select * from private.season_import_previews"),
          /permission denied/,
        );
      }
      await as("anon");
      await assert.rejects(
        create(input("66666666-6666-4666-8666-666666666666")),
        /permission denied/,
      );
      await assert.rejects(
        rpc("stage_season_import", [
          C,
          CAP,
          JSON.stringify(config),
          JSON.stringify(snapshot),
        ]),
        /permission denied/,
      );
      assert.equal((await pub()).seasons.length, 3);
    },
  );
  await db.close();
});
