import type { Result, Player } from "@/lib/types";
import { players } from "@/lib/sample-data";
export function validateResult(
  r: Result,
  roster: Player[] = players,
): string[] {
  const errors: string[] = [];
  if (
    ![r.home, r.away, r.onFieldHome, r.onFieldAway, r.ownGoals].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 99,
    )
  )
    errors.push("Scores must be whole numbers between 0 and 99.");
  if (r.basis !== "played" && !r.reason.trim())
    errors.push("Add a reason for the official score adjustment.");
  if (
    r.basis === "played" &&
    (r.home !== r.onFieldHome || r.away !== r.onFieldAway)
  )
    errors.push(
      "Played results must use the on-field score as the official score.",
    );
  if (
    new Set(r.stats.map((s) => s.playerId)).size !== r.stats.length ||
    r.stats.some((s) => !roster.some((p) => p.id === s.playerId))
  )
    errors.push("Each roster player can appear only once.");
  if (
    r.stats.some(
      (s) =>
        ![s.goals, ...(s.assists === null ? [] : [s.assists])].every(
          (n) => Number.isInteger(n) && n >= 0 && n <= 99,
        ),
    )
  )
    errors.push("Player totals must be whole numbers between 0 and 99.");
  if (r.stats.some((s) => !s.appeared && (s.goals > 0 || (s.assists ?? 0) > 0)))
    errors.push("Mark a player as played before assigning goals or assists.");
  const attributed = r.stats.reduce((n, s) => n + s.goals, 0) + r.ownGoals;
  if (attributed > r.onFieldHome)
    errors.push("Attributed goals exceed the on-field team score.");
  if (r.scorers === "complete" && attributed !== r.onFieldHome)
    errors.push(
      "Complete scoring requires all on-field goals to be attributed, including own goals.",
    );
  if (
    (r.stats.some((s) => s.goals > 0) || r.ownGoals > 0) &&
    r.scorers === "unrecorded"
  )
    errors.push(
      "Choose partial or complete scoring when recording player goals.",
    );
  if (r.stats.some((s) => s.appeared) && r.attendance === "unrecorded")
    errors.push(
      "Choose partial or complete attendance when recording appearances.",
    );
  if (r.assists === "unrecorded" && r.stats.some((s) => s.assists !== null))
    errors.push("Unrecorded assists must remain unknown.");
  return errors;
}

export function validateDraft(r: Result, roster: Player[] = players): string[] {
  return validateResult(r, roster).filter(
    (e) => e.includes("whole numbers") || e.includes("roster"),
  );
}
