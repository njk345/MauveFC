"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { readArchiveStats, readSeasonStats } from "@/lib/supabase/repository";
import { sampleSeasonStats } from "@/features/stats/queries";
import type { SeasonStatsSnapshot } from "@/lib/types";

export function useSeasonStats(seasonIds: string[]) {
  const auth = useAuth();
  const { live, ready, resetVersion, matches, players, roster } =
    usePrototype();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    owner: string;
    data?: SeasonStatsSnapshot;
    error?: string;
  }>();
  // Hide the previous identity/season synchronously, before effect cleanup runs.
  const scope = seasonIds.join(",");
  const owner = `${auth.user?.id || "public"}:${auth.member}:${auth.loading}:${scope}:${resetVersion}:${revision}`;
  useEffect(() => {
    setResponse(undefined);
    if (!live || !ready || auth.loading || !scope) return;
    let active = true;
    const ids = scope.split(",");
    const request =
      ids.length === 1 ? readSeasonStats(ids[0]) : readArchiveStats(ids);
    void request.then(
      (data) => {
        if (active) setResponse({ owner, data });
      },
      (error) => {
        if (active)
          setResponse({
            owner,
            error:
              error instanceof Error
                ? error.message
                : "Stats could not be loaded.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [live, ready, auth.loading, scope, owner]);
  if (!live)
    return {
      data: sampleSeasonStats(
        matches.filter((m) => seasonIds.includes(m.seasonId)),
        players.filter(
          (p) =>
            roster.some(
              (r) => seasonIds.includes(r.seasonId) && r.playerId === p.id,
            ) ||
            matches.some(
              (m) =>
                seasonIds.includes(m.seasonId) &&
                m.guestPlayerIds?.includes(p.id),
            ),
        ),
      ),
      loading: false,
      error: "",
      reload: () => setRevision((v) => v + 1),
    };
  const current =
    response?.owner === owner && !auth.loading ? response : undefined;
  return {
    data: current?.data,
    loading: !!scope && !current,
    error: current?.error || "",
    reload: () => setRevision((v) => v + 1),
  };
}
