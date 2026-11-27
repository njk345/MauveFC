import { players } from "@/lib/sample-data";
import type { Match, Player, SeasonStatsSnapshot } from "@/lib/types";
import { resultOutcome } from "@/features/matches/decisions";
import { orderMatches, type MatchOrder } from "@/features/matches/order";
export function publishedMatches(
  matches: Match[],
  order: MatchOrder = "oldest-first",
) {
  return orderMatches(
    matches.filter((m) => m.status === "completed" && m.result?.published),
    order,
  );
}
export function outcome(m: Match) {
  const r = m.result;
  return r ? resultOutcome(r) : null;
}
export function teamStats(matches: Match[]) {
  const played = publishedMatches(matches);
  const wins = played.filter((m) => outcome(m) === "W").length,
    draws = played.filter((m) => outcome(m) === "D").length,
    losses = played.length - wins - draws;
  const goalsFor = played.reduce((n, m) => n + m.result!.home, 0),
    goalsAgainst = played.reduce((n, m) => n + m.result!.away, 0);
  return {
    played: played.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points: wins * 3 + draws,
    assistsCovered: played.filter((m) => m.result!.assists === "complete")
      .length,
  };
}
export function playerStats(matches: Match[], roster: Player[] = players) {
  const played = publishedMatches(matches);
  return roster
    .map((p) => {
      const rows = played.flatMap((m) => {
        const result = m.result!;
        return result.stats
          .filter((s) => s.playerId === p.id)
          .map((stat) => ({ stat, result }));
      });
      const appearances = rows.filter(({ stat }) => stat.appeared).length;
      return {
        ...p,
        appearances,
        goals: rows.reduce(
          (n, { stat, result }) =>
            n + (result.scorers === "unrecorded" ? 0 : stat.goals),
          0,
        ),
        assists: rows.reduce(
          (n, { stat, result }) =>
            n + (result.assists === "unrecorded" ? 0 : (stat.assists ?? 0)),
          0,
        ),
        assistsKnown: rows.some(
          ({ stat, result }) =>
            result.assists !== "unrecorded" && stat.assists !== null,
        ),
        appearancesKnown: rows.some(
          ({ stat, result }) =>
            stat.appeared || result.attendance === "complete",
        ),
        goalsKnown: rows.some(
          ({ stat, result }) =>
            result.scorers !== "unrecorded" &&
            (stat.goals > 0 || result.scorers === "complete"),
        ),
      };
    })
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        b.assists - a.assists ||
        a.name.localeCompare(b.name),
    );
}

// Browser-local prototype equivalent of the server projection. Live private
// rows are filtered by Postgres, never by this client-side helper.
export function sampleSeasonStats(
  matches: Match[],
  roster: Player[],
  teamView = false,
): SeasonStatsSnapshot {
  const played = publishedMatches(matches);
  const knownAssists = played.some(
    (m) =>
      m.result!.assists === "complete" ||
      (m.result!.assists !== "unrecorded" &&
        m.result!.stats.some((s) => s.assists !== null)),
  );
  return {
    teamView,
    privatePlayerCount: teamView
      ? 0
      : roster.filter((p) => p.isPublic === false).length,
    appearanceRecords: played.filter(
      (m) => m.result!.attendance !== "unrecorded",
    ).length,
    goalRecords: played.filter((m) => m.result!.scorers !== "unrecorded")
      .length,
    assistsTotal: knownAssists
      ? played.reduce(
          (n, m) =>
            n +
            (m.result!.assists === "unrecorded"
              ? 0
              : m.result!.stats.reduce(
                  (total, s) => total + (s.assists ?? 0),
                  0,
                )),
          0,
        )
      : null,
    assistsRecordedMatches: played.filter(
      (m) => m.result!.assists !== "unrecorded",
    ).length,
    assistsCompleteMatches: played.filter(
      (m) => m.result!.assists === "complete",
    ).length,
    players: playerStats(
      matches,
      roster.filter((p) => teamView || p.isPublic !== false),
    ),
  };
}
