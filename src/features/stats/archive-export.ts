import { outcome } from "./queries";
import type { Match, Player, Season } from "@/lib/types";

type ExportKind = "results" | "player-stats";
type Cell = string | number | boolean | null | undefined;

function csvCell(cell: Cell) {
  if (typeof cell !== "string") return cell == null ? "" : String(cell);
  // Neutralize user-entered text that a spreadsheet could execute as a formula.
  const text = /^[\t\r\n]|^\s*[=+\-@]/.test(cell) ? "'" + cell : cell;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function archiveCsv(
  kind: ExportKind,
  matches: Match[],
  seasons: Season[],
  players: Player[],
) {
  const bySeason = new Map(seasons.map((season) => [season.id, season]));
  const byPlayer = new Map(players.map((player) => [player.id, player]));
  const matchFields = [
    "Season ID",
    "Season",
    "League",
    "Team",
    "Match ID",
    "Kickoff",
    "Opponent",
    "Venue",
    "Playoff round",
  ];
  const rows: Cell[][] = [
    kind === "results"
      ? [
          ...matchFields,
          "Goals for",
          "Goals against",
          "Outcome",
          "Decision",
          "Basis",
          "Attendance coverage",
          "Scorer coverage",
          "Assist coverage",
        ]
      : [...matchFields, "Player ID", "Player", "Appeared", "Goals", "Assists"],
  ];
  for (const match of matches) {
    const result = match.result;
    const season = bySeason.get(match.seasonId);
    if (!season || match.status !== "completed" || !result?.published) continue;
    const fields = [
      season.id,
      season.name,
      season.competition,
      season.teamName,
      match.id,
      match.kickoff,
      match.opponent,
      match.venue,
      match.playoffRound,
    ];
    if (kind === "results") {
      rows.push([
        ...fields,
        result.home,
        result.away,
        outcome(match),
        result.decision ?? "regulation",
        result.basis,
        result.attendance,
        result.scorers,
        result.assists,
      ]);
    } else {
      for (const stat of result.stats) {
        rows.push([
          ...fields,
          stat.playerId,
          byPlayer.get(stat.playerId)?.name,
          stat.appeared || result.attendance === "complete"
            ? stat.appeared
            : null,
          result.scorers !== "unrecorded" &&
          (result.scorers === "complete" || stat.goals > 0)
            ? stat.goals
            : null,
          result.assists !== "unrecorded" ? stat.assists : null,
        ]);
      }
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadArchiveCsv(
  kind: ExportKind,
  matches: Match[],
  seasons: Season[],
  players: Player[],
) {
  const url = URL.createObjectURL(
    new Blob(["\ufeff", archiveCsv(kind, matches, seasons, players)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `mauve-fc-${kind}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
