import { load } from "cheerio";

// Public LeagueApps web widgets, not a calendar subscription or member API.
export const source = {
  programId: "5162244",
  teamId: "8032635",
  standingsUrl:
    "https://nycsoccer.leagueapps.com/widgets/standingsContent?lid=5162244",
  scheduleUrl:
    "https://nycsoccer.leagueapps.com/ajax/loadSchedule?origin=site&scope=program&programId=5162244&publishedOnly=true&itemType=games_only&teamId=8032635",
};
export type Standing = {
  position: number;
  teamId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  difference: number;
  forfeits: number;
  points: number;
};
export type LeagueGame = {
  externalId: string;
  opponent: string;
  opponentCode: string;
  kickoff: string | null;
  venue: string;
  round: number;
  home: boolean;
  status: "scheduled" | "completed" | "postponed" | "cancelled";
  score: { home: number; away: number; basis: "played" | "forfeit" } | null;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
function number(s: string, signed = false) {
  if (!(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(s))
    throw new Error("Invalid numeric column");
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > 100000)
    throw new Error("Invalid numeric range");
  return n;
}
export function parseStandings(html: string): Standing[] {
  const $ = load(html),
    table = $("table.standings");
  if (table.length !== 1) throw new Error("Standings table missing");
  const headers = table
    .find("thead th")
    .map((_, e) => clean($(e).text()))
    .get();
  if (headers.join(",") !== "Team,GP,W,L,T,PS,PSA,PSD,DNP,PF")
    throw new Error("Standings columns changed");
  const rows = table
    .find("tbody tr")
    .map((i, e) => {
      const cells = $(e).children("td"),
        a = cells.first().find("a"),
        href = a.attr("href") || "";
      const teamId = href.match(/^\/leagues\/5162244\/teams\/(\d+)$/)?.[1];
      if (cells.length !== 10 || !teamId || !clean(a.text()))
        throw new Error("Invalid standings row");
      const values = cells
        .slice(1)
        .map((_, c) => number(clean($(c).text()), true))
        .get();
      const [
        played,
        wins,
        losses,
        draws,
        goalsFor,
        goalsAgainst,
        difference,
        forfeits,
        points,
      ] = values;
      if (
        [played, wins, losses, draws, goalsFor, goalsAgainst, forfeits].some(
          (n) => !Number.isInteger(n) || n < 0,
        ) ||
        wins + losses + draws !== played ||
        goalsFor - goalsAgainst !== difference
      )
        throw new Error("Standings totals do not reconcile");
      return {
        position: i + 1,
        teamId,
        name: clean(a.text()),
        played,
        wins,
        losses,
        draws,
        goalsFor,
        goalsAgainst,
        difference,
        forfeits,
        points,
      };
    })
    .get();
  if (
    rows.length < 2 ||
    rows.length > 100 ||
    new Set(rows.map((r) => r.teamId)).size !== rows.length ||
    !rows.some((r) => r.teamId === source.teamId)
  )
    throw new Error("Incomplete league standings");
  return rows;
}
function kickoff(date: string, time: string, year: number) {
  if (/^(TBD|TBA|Unscheduled)$/i.test(date) || /^(TBD|TBA)$/i.test(time))
    return null;
  const d = date.match(
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/,
  );
  const t = time.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!d || !t || year < 2000 || year > 2100)
    throw new Error("Unknown fixture date format");
  const month =
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(d[1]) + 1;
  const hour = (Number(t[1]) % 12) + (t[3] === "PM" ? 12 : 0);
  if (Number(t[1]) < 1 || Number(t[1]) > 12 || Number(t[2]) > 59)
    throw new Error("Invalid fixture time");
  const local = `${year}-${String(month).padStart(2, "0")}-${d[2].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${t[2]}`;
  const naive = Date.parse(local + "Z");
  const candidates = [4, 5]
    .map((offset) => new Date(naive + offset * 3600000))
    .filter((instant) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(instant);
      const get = (name: string) => parts.find((p) => p.type === name)!.value;
      return (
        `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}` ===
        local
      );
    });
  if (candidates.length !== 1)
    throw new Error("Ambiguous or invalid fixture date");
  return candidates[0].toISOString();
}
export function parseSchedule(html: string): LeagueGame[] {
  const $ = load(html),
    games: LeagueGame[] = [];
  let year = 0,
    round = 0;
  $("h4.schedule-week,li.schedule-game").each((_, e) => {
    const el = $(e);
    if (el.is("h4")) {
      year = Number(clean(el.text()).match(/(20\d{2})$/)?.[1]);
      round = Number(clean(el.find(".tag").text()).match(/^Week (\d+)$/)?.[1]);
      return;
    }
    const externalId = el.attr("id")?.match(/^game-(\d+)$/)?.[1];
    const sides = el.find(".event-title .team-score");
    if (!externalId || !year || !round || sides.length !== 2)
      throw new Error("Invalid fixture identity");
    const teams = sides
      .map((_, s) => {
        const side = $(s),
          a = side.find("a"),
          id = a.attr("href")?.match(/^\/leagues\/5162244\/teams\/(\d+)$/)?.[1];
        const tag = clean(side.find(".tag").text()),
          scoreText = clean(side.find("strong.score").text());
        if (!id || !["(A)", "(H)"].includes(tag) || !clean(a.text()))
          throw new Error("Invalid fixture teams");
        return {
          id,
          name: clean(a.text()),
          home: tag === "(H)",
          score: scoreText ? number(scoreText) : null,
        };
      })
      .get();
    const own = teams.find((t) => t.id === source.teamId),
      other = teams.find((t) => t.id !== source.teamId);
    if (!own || !other || own.home === other.home)
      throw new Error("Wrong team in schedule");
    const state = clean(el.find(".game-meta .game-type").text()).toLowerCase();
    const final = /^(played \((regular time|overtime)\)|forfeit)$/.test(state);
    let status: LeagueGame["status"];
    if (final) status = "completed";
    else if (
      /cancel(l)?ed/.test(state) ||
      el.hasClass("cancelled") ||
      el.hasClass("canceled")
    )
      status = "cancelled";
    else if (state === "unscheduled") status = "postponed";
    else if (
      ["", "scheduled", "rescheduled"].includes(state) &&
      !el.hasClass("completed")
    )
      status = "scheduled";
    else throw new Error("Unknown fixture status");
    if (
      final &&
      [own.score, other.score].some(
        (n) => n === null || !Number.isInteger(n) || n! > 99,
      )
    )
      throw new Error("Final score missing");
    // A blank or even 0–0 score alone is never evidence that a game finished.
    const venue =
      clean(el.find(".event-details").text()).replace(/^Location:\s*/, "") ||
      "Venue to be confirmed";
    games.push({
      externalId,
      opponent: other.name,
      opponentCode: other.name
        .replace(/\([^)]*\)/g, "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((s) => s[0])
        .join("")
        .toUpperCase(),
      kickoff: kickoff(
        clean(el.find(".date").text()),
        clean(el.find(".time").text()),
        year,
      ),
      venue,
      round,
      home: own.home,
      status,
      score: final
        ? {
            home: own.score!,
            away: other.score!,
            basis: state === "forfeit" ? "forfeit" : "played",
          }
        : null,
    });
  });
  if (
    !games.length ||
    games.length > 200 ||
    new Set(games.map((g) => g.externalId)).size !== games.length
  )
    throw new Error("Empty or duplicated schedule");
  return games;
}
export function parseLeagueSnapshot(
  scheduleHtml: string,
  standingsHtml: string,
) {
  const games = parseSchedule(scheduleHtml),
    standings = parseStandings(standingsHtml);
  if (games.some((g) => !standings.some((s) => s.name === g.opponent)))
    throw new Error("Schedule and standings disagree on team names");
  return {
    programId: source.programId,
    teamId: source.teamId,
    games,
    standings,
  };
}
