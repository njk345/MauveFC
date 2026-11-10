import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { initialMatches, players, seasons } from "../src/lib/sample-data";
const id = (s: string) => {
  const h = createHash("sha256")
    .update("mauve-fictional-demo:" + s)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const literal = (s: unknown) =>
  s === null
    ? "null"
    : typeof s === "boolean" || typeof s === "number"
      ? String(s)
      : `'${String(s).replaceAll("'", "''")}'`;
const club = id("club");
const sql = [
  "-- FICTIONAL DEVELOPMENT DATA ONLY. Never seed a production club with these identities.",
  "begin;",
  `insert into public.clubs(id,name) values('${club}','Mauve FC — FICTIONAL DEMO');`,
];
function insert(table: string, columns: string[], values: unknown[]) {
  sql.push(
    `insert into public.${table}(${columns.join(",")}) values(${values.map(literal).join(",")});`,
  );
}
for (const s of seasons)
  insert(
    "seasons",
    ["id", "club_id", "name", "competition", "format"],
    [id(s.id), club, s.name, s.competition, s.format],
  );
for (const p of players) {
  insert(
    "players",
    [
      "id",
      "club_id",
      "name",
      "number",
      "position",
      "initials",
      "hometown",
      "bio",
      "is_public",
    ],
    [
      id(p.id),
      club,
      p.name,
      p.number,
      p.position,
      p.initials,
      p.hometown,
      p.bio,
      true,
    ],
  );
  for (const s of seasons)
    insert(
      "season_roster",
      ["club_id", "season_id", "player_id"],
      [club, id(s.id), id(p.id)],
    );
}
for (const m of initialMatches) {
  insert(
    "matches",
    [
      "id",
      "club_id",
      "season_id",
      "opponent",
      "opponent_code",
      "color",
      "kickoff",
      "venue",
      "round",
      "home",
      "status",
    ],
    [
      id(m.id),
      club,
      id(m.seasonId),
      m.opponent,
      m.opponentCode,
      m.color,
      m.kickoff,
      m.venue,
      m.round,
      m.home,
      m.status,
    ],
  );
  if (m.result) {
    const r = m.result;
    insert(
      "match_results",
      [
        "match_id",
        "club_id",
        "home",
        "away",
        "on_field_home",
        "on_field_away",
        "basis",
        "reason",
        "attendance",
        "scorers",
        "assists",
        "own_goals",
        "published",
      ],
      [
        id(m.id),
        club,
        r.home,
        r.away,
        r.onFieldHome,
        r.onFieldAway,
        r.basis,
        r.reason,
        r.attendance,
        r.scorers,
        r.assists,
        r.ownGoals,
        true,
      ],
    );
    for (const s of r.stats)
      insert(
        "match_player_stats",
        ["club_id", "match_id", "player_id", "appeared", "goals", "assists"],
        [club, id(m.id), id(s.playerId), s.appeared, s.goals, s.assists],
      );
  }
}
sql.push("commit;", `-- Development club ID: ${club}`);
void writeFile(
  new URL("../supabase/seed.sql", import.meta.url),
  sql.join("\n") + "\n",
);
