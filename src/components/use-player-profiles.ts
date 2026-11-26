"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import {
  readMemberPlayerProfiles,
  type ClubSnapshot,
} from "@/lib/supabase/repository";

export function usePlayerProfiles() {
  const auth = useAuth();
  const club = usePrototype();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{
    owner: string;
    data?: ClubSnapshot;
    error?: string;
  }>();
  const teamView = auth.live && !!auth.user && auth.member && !auth.loading;
  // Invalidate old-account data synchronously, before effect cleanup runs.
  const owner = `${auth.user?.id || "public"}:${auth.member}:${auth.loading}:${club.resetVersion}:${revision}`;
  useEffect(() => {
    setResponse(undefined);
    if (!teamView || !club.ready) return;
    let active = true;
    void readMemberPlayerProfiles().then(
      (data) => {
        if (active) setResponse({ owner, data });
      },
      (error) => {
        if (!active) return;
        setResponse({
          owner,
          error:
            error instanceof Error
              ? error.message
              : "Player profiles could not be loaded.",
        });
        void auth.refreshAccess().catch(() => {});
      },
    );
    const refresh = () => {
      if (document.visibilityState === "visible") setRevision((v) => v + 1);
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [teamView, club.ready, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = response?.owner === owner && teamView ? response : undefined;
  return {
    teamView,
    players: teamView
      ? current?.data?.players || []
      : club.players.filter((p) => p.isPublic !== false),
    matches: teamView ? current?.data?.matches || [] : club.matches,
    roster: teamView ? current?.data?.roster || [] : club.roster,
    loading: auth.loading || (teamView && !current),
    error: current?.error || "",
    reload: () => setRevision((v) => v + 1),
  };
}
