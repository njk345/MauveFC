import type { Match, PlayoffRound } from "@/lib/types";

export type MatchOrder = "oldest-first" | "newest-first";
const playoffOrder: Record<PlayoffRound, number> = {
  playoffs: 1,
  quarterfinals: 2,
  semifinals: 3,
  finals: 4,
};
const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function timing(kickoff: string | null) {
  if (!kickoff) return {};
  const instant = Date.parse(kickoff);
  if (!Number.isFinite(instant)) return {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(kickoff)) {
    return new Date(instant).toISOString().slice(0, 10) === kickoff
      ? { day: kickoff }
      : {};
  }
  const parts = calendar.formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    time: instant,
  };
}

/** Keep incoming order for ties; never use matchday, ID or name as a tiebreaker. */
export function orderMatches(
  matches: Match[],
  order: MatchOrder = "oldest-first",
): Match[] {
  const direction = order === "oldest-first" ? 1 : -1;
  const entries = matches.map((match, index) => ({
    match,
    index,
    ...timing(match.kickoff),
    stage: match.playoffRound ? playoffOrder[match.playoffRound] : 0,
  }));
  const chronological = (
    a: (typeof entries)[number],
    b: (typeof entries)[number],
  ) => {
    if (a.day && b.day && a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.time !== undefined && b.time !== undefined) return a.time - b.time;
    return 0;
  };
  if (entries.every((entry) => entry.time !== undefined)) {
    return entries
      .sort(
        (a, b) =>
          direction * (chronological(a, b) || a.stage - b.stage) ||
          a.index - b.index,
      )
      .map((entry) => entry.match);
  }

  // With missing times, a pairwise Array.sort comparator can be contradictory:
  // time can order two games one way while an undated game bridges their rounds
  // the other way. Keep all known chronology, then add compatible round ordering.
  const edges = entries.map(() => new Set<number>());
  const incoming = entries.map(() => 0);
  const link = (before: number, after: number) => {
    if (!edges[before].has(after)) {
      edges[before].add(after);
      incoming[after]++;
    }
  };
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      const comparison = direction * chronological(entries[a], entries[b]);
      if (comparison) link(comparison < 0 ? a : b, comparison < 0 ? b : a);
    }
  }
  const reaches = (from: number, target: number) => {
    const pending = [from],
      visited = new Set<number>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (!visited.has(current)) {
        visited.add(current);
        pending.push(...edges[current]);
      }
    }
    return false;
  };
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (chronological(entries[a], entries[b])) continue;
      const comparison = direction * (entries[a].stage - entries[b].stage);
      if (!comparison) continue;
      const before = comparison < 0 ? a : b,
        after = comparison < 0 ? b : a;
      if (!reaches(after, before)) link(before, after);
    }
  }
  const ordered: Match[] = [],
    used = new Set<number>();
  while (ordered.length < entries.length) {
    const next = entries.findIndex(
      (_, index) => !used.has(index) && incoming[index] === 0,
    );
    used.add(next);
    ordered.push(entries[next].match);
    for (const after of edges[next]) incoming[after]--;
  }
  return ordered;
}
