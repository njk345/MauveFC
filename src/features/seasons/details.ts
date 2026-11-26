import type { Season, SeasonDetails } from "@/lib/types";

export function seasonSelectorLabel(season: Season) {
  const league = season.competition.trim();
  return !league ||
    season.name.toLocaleLowerCase().includes(league.toLocaleLowerCase())
    ? season.name
    : `${season.name} · ${league}`;
}

export function editableSeasonDetails(season: Season): SeasonDetails {
  const year =
    season.year ||
    Number(
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        timeZone: "America/New_York",
      }).format(new Date()),
    );
  const term = season.term || "Fall";
  const automatic = `${term} ${year}`;
  return {
    name: [automatic, `${automatic} · ${season.competition}`].includes(
      season.name,
    )
      ? ""
      : season.name,
    competition: season.competition,
    teamName: season.teamName || "Mauve FC",
    location: season.location || "",
    leagueWebsite: season.leagueWebsite || "",
    timeZone: season.timeZone || "America/New_York",
    format: season.format,
    year,
    term,
  };
}
