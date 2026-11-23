import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseLeagueSnapshot } from "../supabase/functions/_shared/leagueapps";
import { blankResult } from "../src/features/matches/player-stats";
import { seasonFinish } from "../src/features/matches/season-finish";
import { teamStats } from "../src/features/stats/queries";
import type { Match, Season } from "../src/lib/types";

test("closed season falls back through remaining playoff results and then the saved league place", () => {
  const s: Season = {
    id: "s",
    name: "Season",
    competition: "League",
    format: "7v7",
    completed: true,
    finalPosition: 5,
  };
  const game = (
    id: string,
    stage: Match["playoffRound"],
    round: number,
    home = 2,
    away = 1,
  ): Match => ({
    id,
    seasonId: "s",
    round,
    opponent: "FC",
    opponentCode: "FC",
    color: "#657293",
    kickoff: `2026-11-${String(round + 10).padStart(2, "0")}T20:00:00Z`,
    venue: "Pitch",
    home: true,
    status: "completed",
    playoffRound: stage,
    result: {
      ...blankResult([]),
      home,
      away,
      onFieldHome: home,
      onFieldAway: away,
      published: true,
    },
  });
  const q = game("q", "quarterfinals", 1),
    sf = game("sf", "semifinals", 2),
    f = game("f", "finals", 3),
    future = {
      ...game("future", "finals", 4),
      status: "scheduled" as const,
      result: undefined,
    };
  assert.equal(seasonFinish(s, [q, sf, f])?.kind, "champions");
  assert.equal(seasonFinish(s, [q, sf])?.detail, "Playoff finish · Semifinals");
  assert.equal(
    seasonFinish(s, [q, future])?.detail,
    "Playoff finish · Quarterfinals",
  );
  assert.equal(seasonFinish(s, [q])?.detail, "Playoff finish · Quarterfinals");
  assert.equal(seasonFinish(s, [])?.title, "5th place.");
  assert.equal(seasonFinish({ ...s, completed: false }, [q, sf]), null);
});

test("captain fixture removal updates every read path and survives feed refreshes", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    S = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    MEM = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445";
  const P = Array.from(
      { length: 8 },
      (_, i) => `55555555-5555-4555-8555-${String(i + 1).padStart(12, "0")}`,
    ),
    G = "55555555-5555-4555-8555-555555555559";
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
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id) values('${CAP}'),('${MEM}'),('${OUT}');insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${C}','${MEM}','player'),('${OTHER}','${OUT}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7');insert into private.league_sources(club_id,season_id,program_id,team_id) values('${C}','${S}','5162244','8032635');`,
  );
  for (let i = 0; i < P.length; i++)
    await db.query(
      "insert into players(id,club_id,name,number,position,initials,is_public) values($1,$2,$3,$4,'Forward','PP',$5)",
      [P[i], C, "Player " + i, i + 1, i === 0],
    );
  for (const p of P)
    await db.query("insert into season_roster values($1,$2,$3)", [C, S, p]);
  await db.query("update club_memberships set player_id=$1 where user_id=$2", [
    P[0],
    MEM,
  ]);
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
  async function sync(snapshot = league) {
    await as("postgres");
    const token = (
      await db.query<any>(
        "insert into private.league_runs(club_id) values($1) returning token",
        [C],
      )
    ).rows[0].token;
    await as("service_role");
    await rpc("begin_league_sync", [token]);
    await rpc("apply_league_sync", [token, JSON.stringify(snapshot)]);
    await as("authenticated", CAP);
  }
  const club = () => rpc("get_captain_club", [C]);
  const toggle = (m: any, removed = true) =>
    rpc("set_fixture_removed", [m.id, m.revision, removed]);
  const stat = () => rpc("get_season_stats", [C, S]);
  const totals = async () =>
    (
      await db.query<any>(
        "select * from public_season_totals where season_id=$1",
        [S],
      )
    ).rows[0];
  const result = {
    ...blankResult([]),
    home: 2,
    away: 1,
    onFieldHome: 2,
    onFieldAway: 1,
    published: true,
    attendance: "partial",
    scorers: "partial",
    assists: "partial",
    stats: [
      { playerId: P[0], appeared: true, goals: 1, assists: 1 },
      { playerId: P[7], appeared: true, goals: 0, assists: 1 },
    ],
  };
  const saveResult = (m: any, payload = result) =>
    rpc("save_match_result", [m.id, m.revision, JSON.stringify(payload)]);
  const lineup = { formation: "2-3-1", starters: P.slice(0, 7), bench: [P[7]] };
  await sync();
  let snapshot = await club();
  let games = snapshot.matches.slice(-3);
  for (let i = 0; i < games.length; i++) {
    let m = (await club()).matches.find((m: any) => m.id === games[i].id);
    await rpc("save_fixture", [
      C,
      JSON.stringify({
        ...m,
        playoffRound: ["quarterfinals", "semifinals", "finals"][i],
      }),
    ]);
    m = (await club()).matches.find((m: any) => m.id === games[i].id);
    await saveResult(m);
  }
  snapshot = await club();
  games = games.map((g: any) =>
    snapshot.matches.find((m: any) => m.id === g.id),
  );
  let final = games[2];
  const original = JSON.parse(JSON.stringify(final));
  await rpc("add_match_guest", [
    final.id,
    final.revision,
    null,
    JSON.stringify({
      name: "Known Guest",
      number: 0,
      position: "Forward",
      initials: "KG",
      hometown: "",
      bio: "",
      isPublic: false,
    }),
    false,
  ]);
  final = (await club()).matches.find((m: any) => m.id === final.id);
  const guest = final.guestPlayerIds[0];
  await saveResult(final, {
    ...result,
    stats: [
      ...result.stats,
      { playerId: guest, appeared: true, goals: 0, assists: 0 },
    ],
  });
  final = (await club()).matches.find((m: any) => m.id === final.id);
  await rpc("save_match_lineup", [final.id, 0, JSON.stringify(lineup), true]);
  await as("authenticated", MEM);
  await rpc("post_lineup_suggestion", [final.id, JSON.stringify(lineup)]);
  await as("authenticated", CAP);
  await saveResult(final, { ...result, published: false });
  await as("postgres");
  await db.query(
    "insert into private.match_rsvps(club_id,match_id,player_id,response,kickoff_at_response) values($1,$2,$3,'in',null)",
    [C, final.id, P[0]],
  );
  await as("authenticated", CAP);
  await rpc("set_season_complete", [S, 0, true]);
  snapshot = await club();
  const standings = JSON.parse(JSON.stringify(snapshot.league.standings)),
    before = await stat(),
    homeBefore = await totals();
  const savedSeason = snapshot.seasons.find((s: any) => s.id === S);
  await t.test(
    "authorization, direct writes, invalid actions and stale removal are enforced",
    async () => {
      for (const [role, user] of [
        ["anon", ""],
        ["authenticated", MEM],
        ["authenticated", OUT],
      ]) {
        await as(role, user);
        await assert.rejects(toggle(final));
        await assert.rejects(rpc("get_captain_club", [C]));
      }
      await as("authenticated", CAP);
      await assert.rejects(toggle({ ...final, revision: final.revision - 1 }));
      await assert.rejects(
        rpc("set_fixture_removed", [final.id, final.revision, null]),
      );
      await assert.rejects(
        db.query("update matches set removed_at=now() where id=$1", [final.id]),
      );
    },
  );
  await t.test(
    "removal hides the game and all statistics while preserving league standings and season completion",
    async () => {
      await toggle(final);
      snapshot = await club();
      assert.equal(
        snapshot.matches.some((m: any) => m.id === final.id),
        false,
      );
      assert.equal(snapshot.removedFixtures.length, 1);
      const queued = snapshot.removedFixtures[0];
      assert.equal(queued.id, final.id);
      assert.equal(queued.source, "leagueapps");
      assert.equal(queued.feedAvailable, true);
      assert.equal(queued.result.home, 2);
      assert.deepEqual(snapshot.league.standings, standings);
      assert.deepEqual(
        snapshot.seasons.find((s: any) => s.id === S),
        savedSeason,
      );
      assert.equal(
        seasonFinish(savedSeason, snapshot.matches)?.detail,
        "Playoff finish · Semifinals",
      );
      const after = await stat();
      assert.equal(after.assistsTotal, before.assistsTotal - 2);
      assert.equal(
        after.players.find((p: any) => p.id === P[0]).goals,
        before.players.find((p: any) => p.id === P[0]).goals - 1,
      );
      assert.equal(
        after.players.find((p: any) => p.id === P[0]).appearances,
        2,
      );
      assert.equal(
        after.players.some((p: any) => p.id === guest),
        false,
      );
      assert.deepEqual(await totals(), homeBefore);
      const dir = await rpc("get_player_directory", [C]);
      assert.equal(dir.find((p: any) => p.id === guest).guestGames, 0);
      assert.equal(dir.find((p: any) => p.id === guest).appearances, 0);
    },
  );
  await t.test(
    "public and member projections cannot expose the removed game, totals, lineups or RSVP",
    async () => {
      await as("anon");
      const pub = await rpc("get_public_club", [C]);
      assert.equal(
        pub.matches.some((m: any) => m.id === final.id),
        false,
      );
      assert.equal("removedFixtures" in pub, false);
      assert.equal(
        (
          await db.query(
            "select match_id,home,away from match_results where match_id=$1",
            [final.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select player_id,goals from match_player_stats where match_id=$1",
            [final.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query<any>(
            "select * from public_player_season_totals where season_id=$1 and player_id=$2",
            [S, P[0]],
          )
        ).rows[0].goals,
        2,
      );
      assert.equal((await stat()).assistsTotal, before.assistsTotal - 2);
      await as("authenticated", MEM);
      const team = await rpc("get_team_club", [C]);
      assert.equal(
        team.matches.some((m: any) => m.id === final.id),
        false,
      );
      assert.equal(
        team.lineups.some((m: any) => m.matchId === final.id),
        false,
      );
      assert.equal(
        team.rsvps.some((m: any) => m.matchId === final.id),
        false,
      );
      assert.equal(
        (await rpc("get_lineup_posts", [C])).some(
          (p: any) => p.matchId === final.id,
        ),
        false,
      );
      assert.equal("removedFixtures" in team, false);
      await assert.rejects(
        rpc("post_lineup_suggestion", [final.id, JSON.stringify(lineup)]),
      );
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "stale editors cannot change archived fixture details, scores, stats, lineups or guests",
    async () => {
      const queued = (await club()).removedFixtures[0];
      await assert.rejects(
        rpc("save_fixture", [
          C,
          JSON.stringify({
            ...final,
            revision: queued.revision,
            venue: "Stale edit",
          }),
        ]),
      );
      await assert.rejects(
        rpc("use_league_fixture", [final.id, queued.revision]),
      );
      await assert.rejects(saveResult(queued));
      await assert.rejects(
        rpc("save_match_lineup", [final.id, 1, JSON.stringify(lineup), false]),
      );
      await assert.rejects(
        rpc("add_match_guest", [final.id, queued.revision, guest, null, false]),
      );
    },
  );
  await t.test(
    "adding back restores one stable game, published stats, team data and current saved drafts",
    async () => {
      const queued = (await club()).removedFixtures[0];
      await toggle(queued, false);
      snapshot = await club();
      final = snapshot.matches.find((m: any) => m.id === final.id);
      assert.equal(snapshot.removedFixtures.length, 0);
      assert.equal(final.result.stats.length, 3);
      assert.equal((await stat()).assistsTotal, before.assistsTotal);
      assert.equal(
        seasonFinish(savedSeason, snapshot.matches)?.kind,
        "champions",
      );
      assert.deepEqual(snapshot.league.standings, standings);
      const draft = (
        await db.query<any>(
          "select base_revision,payload from match_drafts where match_id=$1",
          [final.id],
        )
      ).rows[0];
      assert.equal(draft.base_revision, final.revision);
      assert.equal(draft.payload.baseRevision, final.revision);
      const team = await rpc("get_team_club", [C]);
      assert.equal(
        team.lineups.some((m: any) => m.matchId === final.id),
        true,
      );
      assert.equal(
        team.rsvps.some((m: any) => m.matchId === final.id),
        true,
      );
      assert.ok(
        (await rpc("get_lineup_posts", [C])).filter(
          (p: any) => p.matchId === final.id,
        ).length >= 2,
      );
      const dir = await rpc("get_player_directory", [C]);
      assert.equal(dir.find((p: any) => p.id === guest).guestGames, 1);
      assert.equal(dir.find((p: any) => p.id === guest).appearances, 1);
    },
  );
  await t.test(
    "feed refreshes update queued metadata but never re-add a removed game or duplicate its source link",
    async () => {
      await toggle(final);
      let queued = (await club()).removedFixtures[0];
      const removedAt = queued.removedAt;
      const changed = structuredClone(league);
      changed.games.find((g) => g.externalId === final.externalId)!.venue =
        "Updated feed venue";
      await sync(changed);
      snapshot = await club();
      queued = snapshot.removedFixtures[0];
      assert.equal(
        snapshot.matches.some((m: any) => m.id === final.id),
        false,
      );
      assert.equal(queued.removedAt, removedAt);
      assert.equal(queued.venue, "Updated feed venue");
      assert.equal(queued.result.home, 2);
      assert.equal(queued.feedAvailable, true);
      assert.deepEqual(snapshot.league.standings, standings);
      const missing = structuredClone(changed);
      missing.games = missing.games.filter(
        (g) => g.externalId !== final.externalId,
      );
      await sync(missing);
      queued = (await club()).removedFixtures[0];
      assert.equal(queued.feedAvailable, false);
      await toggle(queued, false);
      final = (await club()).matches.find((m: any) => m.id === final.id);
      assert.equal(final.venue, "Updated feed venue");
      assert.equal(final.result.stats.length, 3);
      await as("postgres");
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from private.league_games where match_id=$1",
            [final.id],
          )
        ).rows[0].n,
        1,
      );
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "manual games disappear without a feed queue entry and regular-season aggregates update",
    async () => {
      const id = await rpc("save_fixture", [
        C,
        JSON.stringify({
          ...original,
          id: "77777777-7777-4777-8777-777777777771",
          status: "scheduled",
          revision: 0,
          playoffRound: null,
          source: undefined,
          result: undefined,
        }),
      ]);
      let manual = (await club()).matches.find((m: any) => m.id === id);
      await saveResult(manual);
      manual = (await club()).matches.find((m: any) => m.id === id);
      const home = await totals();
      await toggle(manual);
      snapshot = await club();
      assert.equal(
        snapshot.matches.some((m: any) => m.id === id),
        false,
      );
      assert.equal(
        snapshot.removedFixtures.some((m: any) => m.id === id),
        false,
      );
      assert.equal((await totals()).played, home.played - 1);
      assert.equal((await totals()).goals_for, home.goals_for - 2);
      assert.deepEqual(snapshot.league.standings, standings);
      await assert.rejects(
        toggle({ ...manual, revision: manual.revision + 1 }, false),
      );
    },
  );
  await t.test(
    "future feed providers use the same removal queue and restore behavior",
    async () => {
      const id = await rpc("save_fixture", [
        C,
        JSON.stringify({
          ...original,
          id: "77777777-7777-4777-8777-777777777772",
          status: "scheduled",
          kickoff: "2099-01-01T20:00:00Z",
          revision: 0,
          playoffRound: null,
        }),
      ]);
      await as("postgres");
      await db.query(
        "update matches set feed_source='another-feed' where id=$1",
        [id],
      );
      await as("authenticated", CAP);
      let m = (await club()).matches.find((m: any) => m.id === id);
      assert.equal(m.source, "another-feed");
      await toggle(m);
      const queued = (await club()).removedFixtures.find(
        (m: any) => m.id === id,
      );
      assert.equal(queued.source, "another-feed");
      assert.equal(queued.feedAvailable, null);
      await as("authenticated", MEM);
      await assert.rejects(rpc("save_match_rsvp", [id, "in"]), /removed/i);
      await as("authenticated", CAP);
      await toggle(queued, false);
      assert.ok((await club()).matches.some((m: any) => m.id === id));
    },
  );
  await t.test(
    "removing the remaining playoff results falls back to the closed season league position",
    async () => {
      for (const g of games) {
        const current = (await club()).matches.find((m: any) => m.id === g.id);
        if (current) await toggle(current);
      }
      snapshot = await club();
      assert.equal(seasonFinish(savedSeason, snapshot.matches)?.kind, "league");
      assert.equal(
        seasonFinish(savedSeason, snapshot.matches)?.title,
        `${savedSeason.finalPosition}${savedSeason.finalPosition === 2 ? "nd" : "th"} place.`,
      );
      assert.deepEqual(snapshot.league.standings, standings);
      assert.equal(
        snapshot.seasons.find((s: any) => s.id === S).completed,
        true,
      );
    },
  );
  await db.close();
});
