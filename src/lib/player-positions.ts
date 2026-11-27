import type { Player } from "./types";

export function positionGroupLabel(
  player: Pick<Player, "position" | "secondaryPosition">,
) {
  return player.secondaryPosition
    ? `${player.position} / ${player.secondaryPosition}`
    : player.position;
}
