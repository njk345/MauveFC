import { load } from "cheerio";

// Public LeagueApps web widgets, not a calendar subscription or member API.
export type LeagueSource = {
  origin: string;
  programId: string;
  teamId: string;
  timeZone?: string;
  scheduleUrl: string;
  standingsUrl: string;
};
export const source: LeagueSource = {
  origin: "https://nycsoccer.leagueapps.com",
  programId: "5162244",
  teamId: "8032635",
  standingsUrl:
    "https://nycsoccer.leagueapps.com/widgets/standingsContent?lid=5162244",
  scheduleUrl:
    "https://nycsoccer.leagueapps.com/ajax/loadSchedule?origin=site&scope=program&programId=5162244&publishedOnly=true&itemType=games_only&teamId=8032635",
};
export type Standing = {
  divisionName?: string;
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

function standingsDocument(html: string, config: LeagueSource) {
  const $ = load(html),
    tables = $("table.standings");
  if (!tables.length || tables.length > 100)
    throw new Error("Standings tables missing or excessive");
  const groups = tables.toArray().map((element) => {
    const table = $(element);
    // LeagueApps emits an invalid tr/td outside a table for the heading.
    // HTML normalization drops those tags, but keeps the h4 in its division.
    const divisionName =
      clean(table.closest(".division_standings").find("h4").first().text()) ||
      undefined;
    const teams = table
      .find("tbody tr")
      .toArray()
      .map((row) => {
        const anchor = $(row).children("td").first().find("a");
        const teamId = teamFromHref(anchor.attr("href") || "", config),
          name = clean(anchor.text());
        if (anchor.length !== 1 || !teamId || !name)
          throw new Error("Invalid standings team");
        return { teamId, name, ...(divisionName ? { divisionName } : {}) };
      });
    if (teams.length < 2 || teams.length > 100)
      throw new Error("Incomplete league division");
    return { table, divisionName, teams };
  });
  if (
    groups.length > 1 &&
    (groups.some((group) => !group.divisionName) ||
      new Set(groups.map((group) => group.divisionName)).size !== groups.length)
  )
    throw new Error("Ambiguous league divisions");
  const teams = groups.flatMap((group) => group.teams);
  if (
    teams.length > 1000 ||
    new Set(teams.map((team) => team.teamId)).size !== teams.length
  )
    throw new Error("Duplicate or excessive league teams");
  return { $, groups };
}

export function parseLeagueTeams(html: string, config: LeagueSource = source) {
  return standingsDocument(html, config).groups.flatMap((group) => group.teams);
}

export function parseStandings(
  html: string,
  config: LeagueSource = source,
): Standing[] {
  const { $, groups } = standingsDocument(html, config);
  const matching = config.teamId
    ? groups.filter((group) =>
        group.teams.some((team) => team.teamId === config.teamId),
      )
    : groups;
  if (matching.length !== 1)
    throw new Error(
      config.teamId
        ? "Team missing from league standings"
        : "Choose a team to select its division standings",
    );
  const { table, divisionName } = matching[0];
  const headers = table
    .find("thead th")
    .map((_, e) => clean($(e).text()))
    .get();
  const aliases: Record<string, string> = {
    Team: "Team",
    GP: "GP",
    W: "W",
    L: "L",
    T: "D",
    D: "D",
    PS: "GF",
    GF: "GF",
    PSA: "GA",
    GA: "GA",
    PSD: "GD",
    GD: "GD",
    DNP: "FF",
    FF: "FF",
    PF: "PTS",
    PTS: "PTS",
    Pts: "PTS",
    "+/-": "ADJ",
  };
  const columns = headers.map((header) => aliases[header] || "");
  if (
    [
      "Team,GP,W,L,D,GF,GA,GD,FF,PTS",
      "Team,GP,W,L,D,GF,GA,GD,PTS",
      "Team,GP,W,L,D,GF,GA,GD,PTS,ADJ",
      "Team,GP,W,L,D,GF,GA,GD,FF,PTS,ADJ",
    ].indexOf(columns.join(",")) < 0
  )
    throw new Error("Standings columns changed");
  const rows = table
    .find("tbody tr")
    .map((i, e) => {
      const cells = $(e).children("td"),
        a = cells.first().find("a"),
        href = a.attr("href") || "";
      const teamId = teamFromHref(href, config);
      if (cells.length !== columns.length || !teamId || !clean(a.text()))
        throw new Error("Invalid standings row");
      const value = (column: string) => {
        const index = columns.indexOf(column);
        return index < 0 ? 0 : number(clean(cells.eq(index).text()), true);
      };
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
      ] = ["GP", "W", "L", "D", "GF", "GA", "GD", "FF", "PTS"].map(value);
      if (
        [played, wins, losses, draws, goalsFor, goalsAgainst, forfeits].some(
          (n) => !Number.isInteger(n) || n < 0,
        ) ||
        wins + losses + draws !== played ||
        goalsFor - goalsAgainst !== difference
      )
        throw new Error("Standings totals do not reconcile");
      return {
        ...(divisionName ? { divisionName } : {}),
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
    (!!config.teamId && !rows.some((r) => r.teamId === config.teamId))
  )
    throw new Error("Incomplete league standings");
  return rows;
}
function kickoff(
  date: string,
  time: string,
  year: number,
  timeZone = "America/New_York",
) {
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
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const localString = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const get = (name: string) => parts.find((p) => p.type === name)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };
  const offsets = new Set(
    [-2, 0, 2].map((day) => {
      const instant = naive + day * 86400000;
      return Date.parse(localString(new Date(instant)) + "Z") - instant;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((instant) => localString(instant) === local);
  if (candidates.length !== 1)
    throw new Error("Ambiguous or invalid fixture date");
  return candidates[0].toISOString();
}
export function parseSchedule(
  html: string,
  config: LeagueSource = source,
): LeagueGame[] {
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
    if (!externalId || !year || !round)
      throw new Error("Invalid fixture identity");
    const teams =
      sides.length === 2
        ? sides
            .map((_, s) => {
              const side = $(s),
                a = side.find("a"),
                id = teamFromHref(a.attr("href") || "", config);
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
            .get()
        : (() => {
            // Some LeagueApps sites render unplayed games as plain “Away at Home”,
            // including a genuine TBD opponent. Never infer a final score here.
            const title = el.find(".event-title"),
              text = clean(title.text());
            const anchors = title
              .find("a")
              .map((_, a) => ({
                id: teamFromHref($(a).attr("href") || "", config),
                name: clean($(a).text()),
              }))
              .get();
            const own = anchors.find((team) => team.id === config.teamId);
            if (!own) throw new Error("Wrong team in schedule");
            const home = text.endsWith(` at ${own.name}`);
            const away = text.startsWith(`${own.name} at `);
            if (home === away) throw new Error("Unknown fixture sides");
            const otherName = home
              ? text.slice(0, -` at ${own.name}`.length)
              : text.slice(`${own.name} at `.length);
            const other = anchors.find(
              (team) =>
                team.id && team.id !== config.teamId && team.name === otherName,
            );
            if (!other && !/^(TBD|TBA|To be determined)$/i.test(otherName))
              throw new Error("Unknown fixture opponent");
            return [
              { ...own, home, score: null },
              {
                id: other?.id || "tbd",
                name: other?.name || "Opponent TBD",
                home: !home,
                score: null,
              },
            ];
          })();
    const own = teams.find((t) => t.id === config.teamId),
      other = teams.find((t) => t.id !== config.teamId);
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
        config.timeZone,
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
  config: LeagueSource = source,
) {
  const games = parseSchedule(scheduleHtml, config),
    standings = parseStandings(standingsHtml, config);
  const programTeams = parseLeagueTeams(standingsHtml, config);
  if (
    games.some(
      (g) =>
        g.opponent !== "Opponent TBD" &&
        !programTeams.some((team) => team.name === g.opponent),
    )
  )
    throw new Error("Schedule and standings disagree on team names");
  return {
    programId: config.programId,
    teamId: config.teamId,
    games,
    standings,
  };
}

export function leagueSourceFromLink(
  link: string,
  teamId = "",
  timeZone = "America/New_York",
): LeagueSource {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error(
      "Enter a complete LeagueApps team, schedule or standings URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.leagueapps\.com$/.test(url.hostname)
  )
    throw new Error("Use an HTTPS link on a LeagueApps league website.");
  const path = url.pathname.match(
    /^\/leagues\/(?:[a-z][^/]*\/)?(\d+)(?:-[^/]+)?(?:\/teams\/(\d+)|\/(?:schedule|standings))?\/?$/,
  );
  if (!path)
    throw new Error("Use the league’s team, schedule or standings page link.");
  if (teamId && !/^\d+$/.test(teamId)) throw new Error("Choose a league team.");
  if (path[2] && teamId && path[2] !== teamId)
    throw new Error("The chosen team does not match this team-page link.");
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  const programId = path[1],
    selected = path[2] || teamId;
  return {
    origin: url.origin,
    programId,
    teamId: selected,
    timeZone,
    standingsUrl: `${url.origin}/widgets/standingsContent?lid=${programId}`,
    scheduleUrl: `${url.origin}/ajax/loadSchedule?origin=site&scope=program&programId=${programId}&publishedOnly=true&itemType=games_only&teamId=${selected}`,
  };
}
function teamFromHref(href: string, config: LeagueSource) {
  try {
    const u = new URL(href, config.origin);
    if (u.origin !== config.origin) return;
    const match = u.pathname.match(/^\/leagues\/(\d+)\/teams\/(\d+)\/?$/);
    return match?.[1] === config.programId ? match[2] : undefined;
  } catch {
    return;
  }
}

export async function fetchLeaguePage(url: string) {
  // All URLs are generated by leagueSourceFromLink; redirects cannot escape that origin.
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "text/html", "User-Agent": "MauveFC-LeagueSync/2.0" },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error("The league page is unavailable or requires sign-in.");
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("League page is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
