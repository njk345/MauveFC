import { players } from "@/lib/sample-data";
import type { Match, Player, SeasonStatsSnapshot } from "@/lib/types";
import { resultOutcome } from "@/features/matches/decisions";
export function publishedMatches(matches: Match[]) {
  return matches.filter((m) => m.status === "completed" && m.result?.published);
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
      const rows = played.flatMap((m) =>
        m.result!.stats.filter((s) => s.playerId === p.id),
      );
      const appearances = rows.filter((s) => s.appeared).length;
      return {
        ...p,
        appearances,
        goals: rows.reduce((n, s) => n + s.goals, 0),
        assists: rows.reduce((n, s) => n + (s.assists ?? 0), 0),
        assistsKnown: played.some(
          (m) =>
            m.result!.assists !== "unrecorded" &&
            m.result!.stats.some(
              (s) => s.playerId === p.id && s.assists !== null,
            ),
        ),
        appearancesKnown: played.some((m) =>
          m.result!.stats.some(
            (s) =>
              s.playerId === p.id &&
              (s.appeared || m.result!.attendance === "complete"),
          ),
        ),
        goalsKnown: played.some((m) =>
          m.result!.stats.some(
            (s) =>
              s.playerId === p.id &&
              (s.goals > 0 || m.result!.scorers === "complete"),
          ),
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
