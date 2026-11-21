import type { Result } from "@/lib/types";

export function resultOutcome(result: Result) {
  if (result.decision === "penalties" && result.penaltyOutcome)
    return result.penaltyOutcome;
  return result.home > result.away
    ? "W"
    : result.home < result.away
      ? "L"
      : "D";
}

export function decisionLabel(result: Result) {
  const outcome = resultOutcome(result);
  if (result.decision === "penalties")
    return outcome === "W" ? "Won on penalties" : "Lost on penalties";
  if (result.decision === "overtime")
    return `${outcome === "W" ? "Won" : outcome === "L" ? "Lost" : "Drew"} after overtime`;
  return null;
}

export function validateDecision(result: Result, publish = true): string[] {
  const errors: string[] = [];
  const decision = result.decision ?? "regulation";
  if (!["regulation", "overtime", "penalties"].includes(decision))
    errors.push("Choose a valid match decision.");
  if (
    result.penaltyOutcome != null &&
    !["W", "L"].includes(result.penaltyOutcome)
  )
    errors.push("Penalties must end in a win or loss.");
  if (decision !== "penalties" && result.penaltyOutcome != null)
    errors.push("Only a penalty shootout can have a penalty result.");
  if (publish) {
    if (decision !== "regulation" && result.basis !== "played")
      errors.push("Overtime and penalties apply to played games.");
    if (decision === "penalties") {
      if (!result.penaltyOutcome)
        errors.push("Choose a win or loss on penalties.");
      if (
        result.home !== result.away ||
        result.onFieldHome !== result.onFieldAway
      )
        errors.push(
          "Enter the tied match score before the shootout; penalty kicks do not count as goals.",
        );
    }
  }
  return errors;
}
