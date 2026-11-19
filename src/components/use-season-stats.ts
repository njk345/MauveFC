"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { readSeasonStats } from "@/lib/supabase/repository";
import { sampleSeasonStats } from "@/features/stats/queries";
import type { SeasonStatsSnapshot } from "@/lib/types";

export function useSeasonStats() {
  const auth = useAuth();
  const { live, ready, seasonId, resetVersion, matches, players, roster } =
    usePrototype();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    owner: string;
    data?: SeasonStatsSnapshot;
    error?: string;
  }>();
  // Hide the previous identity/season synchronously, before effect cleanup runs.
  const owner = `${auth.user?.id || "public"}:${auth.member}:${auth.loading}:${seasonId}:${resetVersion}:${revision}`;
  useEffect(() => {
    setResponse(undefined);
    if (!live || !ready || auth.loading || !seasonId) return;
    let active = true;
    void readSeasonStats(seasonId).then(
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
  }, [live, ready, auth.loading, seasonId, owner]);
  if (!live)
    return {
      data: sampleSeasonStats(
        matches.filter((m) => m.seasonId === seasonId),
        players.filter(
          (p) =>
            roster.some(
              (r) => r.seasonId === seasonId && r.playerId === p.id,
            ) ||
            matches.some(
              (m) =>
                m.seasonId === seasonId && m.guestPlayerIds?.includes(p.id),
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
    loading: !current,
    error: current?.error || "",
    reload: () => setRevision((v) => v + 1),
  };
}
