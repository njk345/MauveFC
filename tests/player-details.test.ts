import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("player details follow historical identities with captain-only contacts and notes", async (t) => {
  const db = new PGlite();
  const C = "11111111-1111-4111-8111-111111111111",
    OTHER = "11111111-1111-4111-8111-111111111112",
    S = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    MEM = "44444444-4444-4444-8444-444444444444",
    OUT = "44444444-4444-4444-8444-444444444445",
    P = "55555555-5555-4555-8555-555555555551",
    Q = "55555555-5555-4555-8555-555555555552",
    G = "55555555-5555-4555-8555-555555555553",
    X = "55555555-5555-4555-8555-555555555554";
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  const files = (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter(
      (n) =>
        n.endsWith(".sql") && !n.endsWith("_leagueapps_hourly_refresh.sql"),
    )
    .sort();
  const detailsMigration = files.find((n) =>
    n.endsWith("_player_contact_details.sql"),
  )!;
  for (const file of files.filter((n) => n < detailsMigration))
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id,email,email_confirmed_at) values('${CAP}','captain@example.test',now()),('${MEM}','member@example.test',now()),('${OUT}','outsider@example.test',now());insert into players(id,club_id,name,number,position,initials,is_public) values('${P}','${C}','Public Player',9,'Forward','PP',true),('${Q}','${C}','Private Player',8,'Defender','PT',false),('${G}','${C}','Historical Guest',0,'Goalkeeper','HG',false),('${X}','${OTHER}','Other Player',1,'Forward','OP',false);insert into club_memberships(club_id,user_id,role,player_id) values('${C}','${CAP}','captain',null),('${C}','${MEM}','player','${P}'),('${OTHER}','${OUT}','captain','${X}');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7');insert into season_roster values('${C}','${S}','${P}'),('${C}','${S}','${Q}');insert into private.player_invites(club_id,player_id,email,created_by) values('${C}','${Q}','pending@example.test','${CAP}'),('${C}','${P}','older@example.test','${CAP}');`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/" + detailsMigration, import.meta.url),
      "utf8",
    ),
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
  const directory = () => rpc("get_player_directory", [C]);
  const person = async (id: string) =>
    (await directory()).find((p: any) => p.id === id);
  const save = async (id: string, fields: object, revision?: number) =>
    rpc("save_player_details", [
      C,
      id,
      revision ?? (await person(id)).captainDetails.revision,
      JSON.stringify(fields),
    ]);
  await as("authenticated", CAP);

  await t.test(
    "backfill prefers explicit verified account links and retains pending invitation addresses",
    async () => {
      assert.equal(
        (await person(P)).captainDetails.email,
        "member@example.test",
      );
      assert.equal(
        (await person(Q)).captainDetails.email,
        "pending@example.test",
      );
      assert.equal((await person(G)).captainDetails.email, "");
      assert.equal((await person(G)).captainDetails.revision, 0);
    },
  );
  await t.test(
    "captain edits an optional historical record without creating roster membership or attendance",
    async () => {
      const saved = await save(G, {
        email: " Sub@Example.Test ",
        phone: "+1 (212) 555-0100",
        relationshipNote: " Met through a teammate.\nGood keeper. ",
        preferredPositions: ["Goalkeeper", "Right back", "Goalkeeper"],
      });
      assert.equal(saved.captainDetails.email, "sub@example.test");
      assert.equal(
        saved.captainDetails.relationshipNote,
        "Met through a teammate.\nGood keeper.",
      );
      assert.deepEqual(saved.preferredPositions, ["Goalkeeper", "Right back"]);
      const guest = await person(G);
      assert.deepEqual(guest.rosterSeasonIds, []);
      assert.equal(guest.appearances, 0);
      assert.equal(guest.guestGames, 0);
      assert.deepEqual(
        (await rpc("get_captain_club", [C])).players.find(
          (p: any) => p.id === G,
        ).captainDetails,
        saved.captainDetails,
      );
      await save(P, {
        phone: "212-555-0199",
        relationshipNote: "Public profile, private note",
        preferredPositions: ["Striker"],
      });
      await save(Q, { preferredPositions: ["Center back", "Right back"] });
    },
  );
  await t.test(
    "validation rejects malformed/oversized contacts and invalid preference values",
    async () => {
      for (const fields of [
        { email: "invalid" },
        { phone: "x".repeat(51) },
        { relationshipNote: "x".repeat(2001) },
        { email: null },
        { phone: 123 },
        { preferredPositions: ["Manager"] },
        { preferredPositions: [null] },
        { preferredPositions: {} },
        { preferredPositions: null },
        { preferredPositions: Array(11).fill("Goalkeeper") },
      ])
        await assert.rejects(save(G, fields));
      assert.equal((await person(G)).captainDetails.email, "sub@example.test");
      await assert.rejects(
        rpc("save_player_details", [C, X, 0, "{}"]),
        /belong/,
      );
    },
  );
  await t.test(
    "stale saves fail atomically, omitted fields survive, and contact edits do not alter Auth",
    async () => {
      const guest = await person(G),
        rev = guest.captainDetails.revision;
      await save(G, { phone: "" }, rev);
      await assert.rejects(
        save(G, { relationshipNote: "stale" }, rev),
        /changed/,
      );
      await assert.rejects(
        rpc("save_roster_player", [
          C,
          S,
          JSON.stringify({ ...guest, name: "Should roll back" }),
        ]),
        /changed/,
      );
      assert.equal((await person(G)).name, "Historical Guest");
      assert.deepEqual((await person(G)).rosterSeasonIds, []);
      const latest = await person(G);
      assert.equal(latest.captainDetails.phone, "");
      assert.equal(latest.captainDetails.email, "sub@example.test");
      assert.deepEqual(latest.preferredPositions, ["Goalkeeper", "Right back"]);
      await save(P, { email: "contact-only@example.test" });
      await as("postgres");
      assert.equal(
        (await db.query<any>("select email from auth.users where id=$1", [MEM]))
          .rows[0].email,
        "member@example.test",
      );
      await as("authenticated", CAP);
      const before = await person(Q);
      const { captainDetails, preferredPositions, ...oldClient } = before;
      await rpc("save_roster_player", [
        C,
        S,
        JSON.stringify({ ...oldClient, bio: "Changed bio" }),
      ]);
      assert.deepEqual((await person(Q)).captainDetails, captainDetails);
      assert.deepEqual(
        (await person(Q)).preferredPositions,
        preferredPositions,
      );
      const current = await person(G);
      await rpc("save_roster_player", [
        C,
        S,
        JSON.stringify({
          ...current,
          captainDetails: { ...current.captainDetails, phone: "212 555 0101" },
        }),
      ]);
      assert.deepEqual((await person(G)).rosterSeasonIds, [S]);
      assert.equal((await person(G)).captainDetails.phone, "212 555 0101");
    },
  );
  await t.test(
    "members receive preferences but never contacts or notes, even for public profiles",
    async () => {
      await as("authenticated", MEM);
      const dir = await directory(),
        profiles = await rpc("get_member_player_profiles", [C]);
      for (const p of [...dir, ...profiles.players]) {
        assert.ok(!("captainDetails" in p));
        assert.ok(!("email" in p));
        assert.ok(!("phone" in p));
        assert.ok(!("relationshipNote" in p));
      }
      assert.deepEqual(dir.find((p: any) => p.id === Q).preferredPositions, [
        "Center back",
        "Right back",
      ]);
      for (const data of [
        dir,
        profiles,
        await rpc("get_team_club", [C]),
        await rpc("get_season_stats", [C, S]),
      ])
        assert.doesNotMatch(
          JSON.stringify(data),
          /contact-only@example|sub@example|private note|Good keeper|212 555/,
        );
      await assert.rejects(
        rpc("save_player_details", [C, P, 0, "{}"]),
        /Captain/,
      );
      await assert.rejects(
        db.query("select * from private.player_details"),
        /permission denied/,
      );
      await assert.rejects(
        rpc("private.player_profile_details", [C, P, true]),
        /permission denied/,
      );
      await assert.rejects(rpc("get_captain_club", [C]), /Captain/);
      await as("anon");
      const pub = await rpc("get_public_club", [C]);
      assert.equal(pub.players.length, 1);
      assert.equal(pub.players[0].id, P);
      assert.ok(!("preferredPositions" in pub.players[0]));
      assert.doesNotMatch(
        JSON.stringify(pub),
        /captainDetails|contact-only@example|sub@example|relationshipNote|private note/,
      );
      await assert.rejects(
        rpc("save_player_details", [C, P, 0, "{}"]),
        /permission denied/,
      );
      await assert.rejects(directory(), /permission denied/);
      await as("authenticated", OUT);
      await assert.rejects(directory(), /membership/);
      await assert.rejects(save(P, {}, 0), /Captain/);
      await as("authenticated", CAP);
    },
  );
  await t.test(
    "invitations save normalized email while preserving phone, notes and positions after cancellation/revocation",
    async () => {
      const before = await person(Q);
      await rpc("prepare_player_invite", [C, Q, " New.Invite@Example.Test "]);
      const invited = await person(Q);
      assert.equal(invited.captainDetails.email, "new.invite@example.test");
      assert.equal(
        invited.captainDetails.revision,
        before.captainDetails.revision + 1,
      );
      assert.deepEqual(invited.preferredPositions, before.preferredPositions);
      await assert.rejects(rpc("prepare_player_invite", [C, Q, "invalid"]));
      assert.equal(
        (await person(Q)).captainDetails.revision,
        invited.captainDetails.revision,
      );
      const next = await rpc("prepare_player_invite", [
        C,
        Q,
        "new.invite@example.test",
      ]);
      assert.equal(
        (await person(Q)).captainDetails.revision,
        invited.captainDetails.revision,
      );
      await rpc("cancel_player_invite", [C, Q, next.generation]);
      await rpc("revoke_player_access", [C, Q]);
      assert.deepEqual(
        (await person(Q)).captainDetails,
        invited.captainDetails,
      );
      await rpc("revoke_player_access", [C, G]);
      assert.equal((await person(G)).captainDetails.email, "sub@example.test");
    },
  );
  await t.test(
    "captain access revocation also removes the ability to read or edit notes",
    async () => {
      await as("postgres");
      await db.exec(
        `delete from club_memberships where club_id='${C}' and user_id='${CAP}'`,
      );
      await as("authenticated", CAP);
      await assert.rejects(directory(), /membership/);
      await assert.rejects(
        rpc("save_player_details", [C, G, 0, "{}"]),
        /Captain/,
      );
    },
  );
  await db.close();
});
