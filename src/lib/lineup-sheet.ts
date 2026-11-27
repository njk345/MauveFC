import { formations } from "./formations";
import {
  positionCodes,
  preferredPositions,
  type Formation,
  type LineupPayload,
  type Player,
  type PreferredPosition,
} from "./types";

const positionNames = new Map(
  preferredPositions.map((name) => [positionCodes[name], name]),
);

export function slotPosition(
  payload: Pick<LineupPayload, "formation" | "slotPositions">,
  index: number,
) {
  const slot = formations[payload.formation][index];
  const name = payload.slotPositions?.[index] ?? positionNames.get(slot.label)!;
  return { name, code: positionCodes[name] };
}

export function sheetName(player: Player, firstNamesOnly = false) {
  const name = player.name.trim();
  return firstNamesOnly ? name.split(/\s+/)[0] : name;
}
export function formationRows(formation: Formation) {
  const slots = formations[formation].map((slot, index) => ({
    ...slot,
    index,
  }));
  return [...new Set(slots.map((slot) => slot.y))]
    .sort((a, b) => a - b)
    .map((y) => slots.filter((slot) => slot.y === y));
}
export function positionSubstitutes(
  payload: LineupPayload,
  index: number,
  players: Player[],
) {
  return payload.bench
    .filter((id) => payload.benchPositions?.[id] === index)
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p));
}
export function withoutBenchPosition(payload: LineupPayload, id: string) {
  return Object.fromEntries(
    Object.entries(payload.benchPositions || {}).filter(
      ([playerId]) => playerId !== id,
    ),
  );
}
// Slot indices can change meaning between formations. Preserve only exact roles,
// returning a substitute to the general bench when that role no longer exists.
export function changeFormation(
  payload: LineupPayload,
  formation: Formation,
): LineupPayload {
  const before = formations[payload.formation],
    after = formations[formation];
  const benchPositions: Record<string, number> = {};
  const slotPositions: Partial<Record<number, PreferredPosition>> = {};
  for (const [id, index] of Object.entries(payload.benchPositions || {})) {
    const next = after.findIndex((slot) => slot.label === before[index]?.label);
    if (next !== -1) benchPositions[id] = next;
  }
  for (const [index, position] of Object.entries(payload.slotPositions || {})) {
    const next = after.findIndex(
      (slot) => slot.label === before[Number(index)]?.label,
    );
    if (next !== -1) slotPositions[next] = position;
  }
  return {
    ...payload,
    formation,
    benchPositions,
    ...(payload.slotPositions ? { slotPositions } : {}),
  };
}
