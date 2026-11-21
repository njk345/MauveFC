import type { Result } from "@/lib/types";
import { decisionLabel } from "@/features/matches/decisions";

export function ResultDecision({ result }: { result: Result }) {
  const label = decisionLabel(result);
  return label ? <span className="decision-badge">{label}</span> : null;
}
