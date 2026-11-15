import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("private player accounts, RSVP ownership and shared lineup boundaries", async (t) => {
  const db = new PGlite(),
    C = "11111111-1111-4111-8111-111111111111",
    OTHER = "22222222-2222-4222-8222-222222222222",
    CAP = "33333333-3333-4333-8333-333333333333",
    A = "44444444-4444-4444-8444-444444444444",
    B = "55555555-5555-4555-8555-555555555555",
    S = "66666666-6666-4666-8666-666666666666",
    M = "77777777-7777-4777-8777-777777777777",
    PAST = "88888888-8888-4888-8888-888888888888",
    CANCELLED = "99999999-9999-4999-8999-999999999999",
    CAP2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    EXPIRED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const ids = Array.from(
    { length: 8 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
  );
  for (const name of [
    "202611090001_club_workflow.sql",
    "202611090002_hosted_permissions_and_captain_invites.sql",
    "20261110053440_leagueapps_sync.sql",
    "20261113162329_player_accounts_and_rsvps.sql",
    "20261115215504_lineup_suggestions_and_official_history.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    `insert into clubs(id,name) values('${C}','Club'),('${OTHER}','Other');insert into auth.users(id,email,email_confirmed_at) values('${CAP}','captain@example.com',now()),('${B}','existing@example.com',now()),('${CAP2}','other@example.com',now());insert into club_memberships(club_id,user_id,role) values('${C}','${CAP}','captain'),('${OTHER}','${CAP2}','captain');insert into seasons(id,club_id,name,competition,format) values('${S}','${C}','Season','League','7v7');insert into matches(id,club_id,season_id,opponent,opponent_code,kickoff,venue,round,status) values('${M}','${C}','${S}','Future FC','FFC','2099-01-01T20:00:00Z','Pitch',1,'scheduled'),('${PAST}','${C}','${S}','Past FC','PFC','2020-01-01T20:00:00Z','Pitch',2,'scheduled'),('${CANCELLED}','${C}','${S}','Cancelled FC','CFC','2099-01-01T20:00:00Z','Pitch',3,'cancelled');`,
  );
  for (const [id, index] of ids.map((id, i) => [id, i] as const))
    await db.query(
      "insert into players(id,club_id,name,number,position,initials,is_public) values($1,$2,$3,$4,'Midfielder','PM',false);",
      [id, C, `Private Member ${index}`, index],
    );
  for (const id of ids)
    await db.query("insert into season_roster values($1,$2,$3)", [C, S, id]);
  async function role(name: string, id = "") {
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role ${name};`,
    );
  }
  async function scalar(name: string, args: unknown[] = []) {
    return (
      await db.query<any>(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) data`,
        args,
      )
    ).rows[0].data;
  }
  const team = () => scalar("get_team_club", [C]),
    access = () => scalar("get_team_access", [C]);
  let lineupRevision = 0;
  const payload = {
    formation: "2-3-1",
    starters: ids.slice(0, 7),
    bench: [ids[7]],
  };
  await t.test(
    "anonymous, nonmember and other-club accounts cannot read private roster or manage accounts",
    async () => {
      await role("anon");
      assert.equal((await scalar("get_public_club", [C])).players.length, 0);
      for (const [name, args] of [
        ["get_team_club", [C]],
        ["get_player_accounts", [C]],
        ["prepare_player_invite", [C, ids[1], "a@example.com"]],
        ["save_match_rsvp", [M, "in"]],
      ] as const)
        await assert.rejects(scalar(name, [...args]));
      await role("authenticated", CAP2);
      await assert.rejects(team());
      await assert.rejects(
        scalar("prepare_player_invite", [C, ids[1], "a@example.com"]),
      );
      await assert.rejects(db.query("select * from private.player_invites"));
      await role("authenticated", B);
      assert.equal((await access()).member, false);
      await assert.rejects(team());
    },
  );
  await t.test(
    "invites bind a verified identity once; existing accounts receive no cross-account recovery credential",
    async () => {
      await role("authenticated", CAP);
      const invite = await scalar("prepare_player_invite", [
        C,
        ids[1],
        " New.Player@Example.com ",
      ]);
      assert.equal(invite.type, "invite");
      const existing = await scalar("prepare_player_invite", [
        C,
        ids[2],
        "existing@example.com",
      ]);
      assert.equal(existing.type, "existing");
      const otherCaptain = await scalar("prepare_player_invite", [
        C,
        ids[3],
        "other@example.com",
      ]);
      assert.equal(otherCaptain.type, "existing");
      await scalar("cancel_player_invite", [
        C,
        ids[3],
        otherCaptain.generation,
      ]);
      await role("postgres");
      await db.query(
        "insert into auth.users(id,email) values($1,'new.player@example.com')",
        [A],
      );
      await role("authenticated", A);
      assert.equal((await access()).member, false);
      await assert.rejects(team());
      await role("postgres");
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [A],
      );
      await role("authenticated", A);
      assert.equal((await access()).playerId, ids[1]);
      assert.equal((await access()).role, "player");
      assert.equal((await team()).players.length, 8);
      await role("authenticated", B);
      assert.equal((await access()).playerId, ids[2]);
      await role("authenticated", CAP);
      await scalar("link_captain_profile", [C, ids[0]]);
      assert.equal((await access()).role, "captain");
      assert.equal((await access()).playerId, ids[0]);
      await assert.rejects(scalar("link_captain_profile", [C, ids[1]]));
      await assert.rejects(
        scalar("prepare_player_invite", [C, ids[3], "new.player@example.com"]),
      );
      assert.equal(
        (
          await scalar("prepare_player_invite", [
            C,
            ids[1],
            "new.player@example.com",
          ])
        ).type,
        "recovery",
      );
    },
  );
  await t.test(
    "members can read private team data but not emails, captain tools, direct tables or other players' writes",
    async () => {
      await role("authenticated", A);
      const data = await team();
      assert.equal(data.players.length, 8);
      assert.equal(JSON.stringify(data).includes("@example.com"), false);
      assert.equal(JSON.stringify(data).includes("editor_id"), false);
      await assert.rejects(scalar("get_player_accounts", [C]));
      await assert.rejects(scalar("get_captain_club", [C]));
      await assert.rejects(scalar("revoke_player_access", [C, ids[2]]));
      await assert.rejects(scalar("link_captain_profile", [C, ids[0]]));
      await assert.rejects(
        db.query(
          "insert into private.match_rsvps(club_id,match_id,player_id,response) values($1,$2,$3,'in')",
          [C, M, ids[2]],
        ),
      );
      await assert.rejects(
        scalar("save_match_lineup", [M, 0, JSON.stringify(payload), true]),
      );
    },
  );
  await t.test(
    "one own RSVP updates atomically; past/cancelled/invalid responses are rejected",
    async () => {
      await role("authenticated", A);
      await scalar("save_match_rsvp", [M, "in"]);
      await scalar("save_match_rsvp", [M, "maybe"]);
      let replies = (await team()).rsvps;
      assert.equal(replies.length, 1);
      assert.equal(replies[0].playerId, ids[1]);
      assert.equal(replies[0].response, "maybe");
      await assert.rejects(scalar("save_match_rsvp", [M, "captain"]));
      await assert.rejects(scalar("save_match_rsvp", [PAST, "in"]));
      await assert.rejects(scalar("save_match_rsvp", [CANCELLED, "in"]));
      await role("authenticated", B);
      await scalar("save_match_rsvp", [M, "out"]);
      assert.equal((await team()).rsvps.length, 2);
      await role("authenticated", A);
      await scalar("save_match_rsvp", [M, null]);
      assert.equal((await team()).rsvps.length, 1);
      await scalar("save_match_rsvp", [M, "in"]);
    },
  );
  await t.test(
    "reschedules require reconfirmation and RSVP never invents appearances or stats",
    async () => {
      await role("postgres");
      await db.query(
        "update matches set kickoff='2099-01-08T20:00:00Z' where id=$1",
        [M],
      );
      await role("authenticated", A);
      assert.equal(
        (await team()).rsvps.find((r: any) => r.playerId === ids[1])
          .needsConfirmation,
        true,
      );
      await scalar("save_match_rsvp", [M, "in"]);
      assert.equal(
        (await team()).rsvps.find((r: any) => r.playerId === ids[1])
          .needsConfirmation,
        false,
      );
      await role("postgres");
      assert.equal(
        (await db.query<any>("select count(*)::int n from match_player_stats"))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "captain drafts stay private, sharing validates roster and seven starters, stale updates fail",
    async () => {
      await role("authenticated", CAP);
      await scalar("save_match_lineup", [
        M,
        0,
        JSON.stringify({ ...payload, starters: [...ids.slice(0, 6), null] }),
        false,
      ]);
      lineupRevision = 1;
      assert.equal((await team()).lineups[0].hasDraft, true);
      await role("authenticated", A);
      assert.equal((await team()).lineups.length, 0);
      await role("authenticated", CAP);
      await assert.rejects(
        scalar("save_match_lineup", [
          M,
          1,
          JSON.stringify({ ...payload, starters: [...ids.slice(0, 6), null] }),
          true,
        ]),
      );
      await assert.rejects(
        scalar("save_match_lineup", [
          M,
          1,
          JSON.stringify({ ...payload, bench: [ids[0]] }),
          true,
        ]),
      );
      await assert.rejects(
        scalar("save_match_lineup", [
          M,
          1,
          JSON.stringify({ ...payload, starters: [...ids.slice(0, 6), CAP2] }),
          true,
        ]),
      );
      await scalar("save_match_lineup", [M, 1, JSON.stringify(payload), true]);
      lineupRevision = 2;
      await role("authenticated", A);
      let data = await team();
      assert.equal(data.lineups.length, 1);
      assert.equal(data.lineups[0].payload.formation, "2-3-1");
      assert.equal(data.lineups[0].revision, undefined);
      await role("authenticated", CAP);
      await scalar("save_match_lineup", [
        M,
        2,
        JSON.stringify({ ...payload, formation: "3-2-1" }),
        false,
      ]);
      lineupRevision = 3;
      await role("authenticated", A);
      assert.equal((await team()).lineups[0].payload.formation, "2-3-1");
      await role("authenticated", CAP);
      await assert.rejects(
        scalar("save_match_lineup", [M, 2, JSON.stringify(payload), true]),
      );
      await scalar("unshare_match_lineup", [M, lineupRevision]);
      await role("authenticated", A);
      assert.equal((await team()).lineups.length, 0);
    },
  );
  await t.test(
    "member suggestions are private posts with ownership; official history stays captain-only",
    async () => {
      const posts = () => scalar("get_lineup_posts", [C]);
      await role("authenticated", CAP);
      let current = (await team()).lineups[0].revision;
      await scalar("save_match_lineup", [
        M,
        current++,
        JSON.stringify(payload),
        true,
      ]);
      await scalar("save_match_lineup", [
        M,
        current++,
        JSON.stringify({ ...payload, formation: "3-2-1" }),
        true,
      ]);
      assert.equal(
        (await posts()).filter((p: any) => p.kind === "official").length,
        2,
      );
      assert.equal((await posts())[0].payload.formation, "3-2-1");
      await scalar("save_match_lineup", [
        M,
        current++,
        JSON.stringify({ ...payload, formation: "2-2-2" }),
        false,
      ]);
      assert.equal((await posts()).length, 2);
      await role("authenticated", A);
      const id = await scalar("post_lineup_suggestion", [
        M,
        JSON.stringify({
          ...payload,
          formation: "2-2-2",
          authorName: "Spoofed",
          kind: "official",
        }),
      ]);
      let data = await posts();
      assert.equal(data.length, 3);
      assert.equal(data[0].kind, "suggestion");
      assert.equal(data[0].authorName, "Private Member 1");
      assert.equal(data[0].canDelete, true);
      assert.equal(data[0].payload.kind, undefined);
      assert.equal((await team()).lineups[0].payload.formation, "3-2-1");
      for (const publish of [true, false])
        await assert.rejects(
          scalar("save_match_lineup", [
            M,
            current,
            JSON.stringify(payload),
            publish,
          ]),
        );
      for (const invalid of [
        null,
        {},
        { ...payload, starters: [...ids.slice(0, 6), null] },
        { ...payload, bench: [ids[0]] },
        { ...payload, starters: [...ids.slice(0, 6), CAP2] },
      ]) {
        await assert.rejects(
          scalar("post_lineup_suggestion", [M, JSON.stringify(invalid)]),
        );
      }
      await assert.rejects(db.query("select * from private.lineup_posts"));
      await role("authenticated", B);
      assert.equal(
        (await posts()).find((p: any) => p.id === id).canDelete,
        false,
      );
      await assert.rejects(scalar("delete_lineup_suggestion", [id]));
      await assert.rejects(
        scalar("delete_lineup_suggestion", [
          data.find((p: any) => p.kind === "official").id,
        ]),
      );
      await role("authenticated", A);
      await scalar("delete_lineup_suggestion", [id]);
      assert.equal((await posts()).length, 2);
      const own = await scalar("post_lineup_suggestion", [
        M,
        JSON.stringify(payload),
      ]);
      await role("authenticated", CAP);
      assert.equal(
        (await posts()).find((p: any) => p.id === own).canDelete,
        true,
      );
      await scalar("delete_lineup_suggestion", [own]);
      await scalar("unshare_match_lineup", [M, current]);
      assert.equal((await posts()).length, 0);
      await role("authenticated", CAP2);
      await assert.rejects(posts());
      await assert.rejects(
        scalar("post_lineup_suggestion", [M, JSON.stringify(payload)]),
      );
      await role("anon");
      await assert.rejects(posts());
      await assert.rejects(
        scalar("post_lineup_suggestion", [M, JSON.stringify(payload)]),
      );
      const publicData = await scalar("get_public_club", [C]);
      assert.equal(publicData.players.length, 0);
      assert.equal(publicData.lineupPosts, undefined);
    },
  );
  await t.test(
    "revocation takes effect with the same identity; expired invites cannot recreate membership",
    async () => {
      await role("authenticated", CAP);
      await scalar("revoke_player_access", [C, ids[1]]);
      await role("authenticated", A);
      assert.equal((await access()).member, false);
      await assert.rejects(team());
      await assert.rejects(scalar("get_lineup_posts", [C]));
      await assert.rejects(
        scalar("post_lineup_suggestion", [M, JSON.stringify(payload)]),
      );
      await assert.rejects(scalar("save_match_rsvp", [M, "in"]));
      await role("postgres");
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [A],
      );
      await role("authenticated", A);
      assert.equal((await access()).member, false);
      await role("authenticated", CAP);
      await scalar("prepare_player_invite", [C, ids[4], "expired@example.com"]);
      await role("postgres");
      await db.query(
        "update private.player_invites set expires_at=now()-interval '1 minute' where player_id=$1",
        [ids[4]],
      );
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'expired@example.com',now())",
        [EXPIRED],
      );
      await role("authenticated", EXPIRED);
      assert.equal((await access()).member, false);
      await assert.rejects(team());
    },
  );
  await t.test(
    "the complete migration safely resumes without changing team data",
    async () => {
      await role("postgres");
      const counts = () =>
        db.query(
          "select (select count(*) from players) players,(select count(*) from club_memberships) members,(select count(*) from private.match_rsvps) replies,(select count(*) from private.match_lineups) lineups",
        );
      const before = (await counts()).rows;
      await db.exec(
        await readFile(
          new URL(
            "../supabase/migrations/20261113162329_player_accounts_and_rsvps.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      assert.deepEqual((await counts()).rows, before);
      await role("authenticated", CAP);
      assert.equal((await access()).role, "captain");
      assert.equal((await team()).players.length, 8);
    },
  );
  await db.close();
});
