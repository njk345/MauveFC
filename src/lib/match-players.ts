import type { GuestChange, Match, Player } from "./types";

export type SeasonRoster = { seasonId: string; playerId: string }[];
export function matchPlayers(
  players: Player[],
  roster: SeasonRoster,
  match?: Match,
) {
  if (!match) return [];
  const ids = new Set([
    ...roster
      .filter((r) => r.seasonId === match.seasonId)
      .map((r) => r.playerId),
    ...(match.guestPlayerIds || []),
  ]);
  return players.filter((p) => ids.has(p.id));
}
export function applyGuestToMatch(match: Match, change: GuestChange): Match {
  if (match.id !== change.matchId) return match;
  const guests = new Set(match.guestPlayerIds || []);
  if (change.action === "add") guests.add(change.player.id);
  else guests.delete(change.player.id);
  return {
    ...match,
    revision: change.revision,
    guestPlayerIds: [...guests],
    ...(change.action === "remove" && match.result
      ? {
          result: {
            ...match.result,
            stats: match.result.stats.filter(
              (s) => s.playerId !== change.player.id,
            ),
          },
        }
      : {}),
  };
}
