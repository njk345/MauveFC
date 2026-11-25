import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import {
  leagueSourceFromLink,
  parseLeagueTeams,
  parseLeagueSnapshot,
  parseStandings,
} from "../supabase/functions/_shared/leagueapps";
const link =
  "https://nycfooty.leagueapps.com/leagues/soccer-(indoor)/4786186-2026-winter--thursdays--prospect-heights-chelsea-piers-field-house--5v5-coed--p4";
const standings = readFileSync(
    new URL("./fixtures/leagueapps-divisions-standings.html", import.meta.url),
    "utf8",
  ),
  schedule = readFileSync(
    new URL("./fixtures/leagueapps-divisions-schedule.html", import.meta.url),
    "utf8",
  );
const source = leagueSourceFromLink(link),
  teamA = "7647530",
  teamB = "7639924";
const forTeam = (teamId: string) => ({ ...source, teamId });

test("the supplied winter league link discovers teams in both divisions before team selection", () => {
  assert.equal(source.programId, "4786186");
  assert.equal(source.teamId, "");
  const choices = parseLeagueTeams(standings, source);
  assert.equal(choices.length, 20);
  assert.deepEqual(
    choices.find((t) => t.teamId === teamA),
    { teamId: teamA, name: "It's Coming Home", divisionName: "Division A" },
  );
  assert.deepEqual(
    choices.find((t) => t.teamId === teamB),
    { teamId: teamB, name: "Gabaghoul FC", divisionName: "Division B" },
  );
  assert.throws(() => parseStandings(standings, source), /Choose a team/);
});
test("team selection returns its division only and keeps the official division ranking", () => {
  for (const [id, division, excluded] of [
    [teamA, "Division A", teamB],
    [teamB, "Division B", teamA],
  ]) {
    const table = parseStandings(standings, forTeam(id));
    assert.equal(table.length, 10);
    assert.equal(table[0].teamId, id);
    assert.equal(table[0].position, 1);
    assert.deepEqual(
      table.map((t) => t.position),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.ok(table.every((t) => t.divisionName === division));
    assert.ok(!table.some((t) => t.teamId === excluded));
  }
  assert.throws(
    () => parseStandings(standings, forTeam("9999999")),
    /Team missing/,
  );
});
test("the actual team schedule imports all finals alongside the selected division table", () => {
  const snapshot = parseLeagueSnapshot(schedule, standings, forTeam(teamA));
  assert.equal(snapshot.games.length, 10);
  assert.equal(snapshot.games.filter((g) => g.score).length, 10);
  assert.equal(snapshot.standings.length, 10);
  assert.ok(snapshot.standings.every((t) => t.divisionName === "Division A"));
  assert.equal(snapshot.teamId, teamA);
  assert.equal(snapshot.programId, "4786186");
  const direct = leagueSourceFromLink(
    "https://nycfooty.leagueapps.com/leagues/4786186/teams/7647530",
  );
  assert.deepEqual(parseStandings(standings, direct), snapshot.standings);
});
test("unrelated division numeric/column changes do not block a valid selected division", () => {
  const $ = load(standings);
  $("table.standings").eq(1).find("thead th").eq(5).text("Unsupported column");
  assert.equal(parseLeagueTeams($.html(), source).length, 20);
  assert.equal(parseStandings($.html(), forTeam(teamA)).length, 10);
  assert.throws(
    () => parseStandings($.html(), forTeam(teamB)),
    /columns changed/,
  );
});
test("equal display names in different divisions are disambiguated by team ID and division", () => {
  const $ = load(standings);
  $("table.standings")
    .eq(1)
    .find("tbody tr")
    .first()
    .find("td")
    .first()
    .find("a")
    .text("It's Coming Home");
  const choices = parseLeagueTeams($.html(), source).filter(
    (t) => t.name === "It's Coming Home",
  );
  assert.equal(choices.length, 2);
  assert.deepEqual(
    choices.map((t) => t.divisionName),
    ["Division A", "Division B"],
  );
  assert.equal(
    parseStandings($.html(), forTeam(teamB))[0].divisionName,
    "Division B",
  );
});
test("duplicate team IDs or unlabelled multiple tables are rejected rather than mixing divisions", () => {
  const $ = load(standings);
  $("table.standings")
    .eq(1)
    .find("tbody tr")
    .first()
    .find("a")
    .attr("href", `/leagues/4786186/teams/${teamA}`);
  assert.throws(() => parseLeagueTeams($.html(), source), /Duplicate/);
  assert.throws(
    () =>
      parseStandings(
        standings.replace("<h4>Division B</h4>", ""),
        forTeam(teamA),
      ),
    /Ambiguous/,
  );
});
test("known cross-division opponents stay in the schedule without entering our division standings", () => {
  const $ = load(schedule);
  const side = $("li.schedule-game")
    .first()
    .find(".event-title .team-score a")
    .filter((_, a) => !$(a).attr("href")?.endsWith(teamA))
    .first();
  side.attr("href", `/leagues/4786186/teams/${teamB}`).text("Gabaghoul FC");
  const snapshot = parseLeagueSnapshot($.html(), standings, forTeam(teamA));
  assert.equal(snapshot.games[0].opponent, "Gabaghoul FC");
  assert.ok(!snapshot.standings.some((t) => t.teamId === teamB));
});
