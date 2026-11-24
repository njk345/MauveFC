"use client";
import { usePrototype } from "./prototype-provider";

export function useSeasonTeamName(seasonId?: string) {
  const club = usePrototype();
  return club.seasons.find((season) => season.id === (seasonId || club.seasonId))?.teamName || "Mauve FC";
}
