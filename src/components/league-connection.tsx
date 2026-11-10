"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import type { LeagueConnection } from "@/lib/types";
import { requestLeagueSync } from "@/lib/supabase/repository";
import { usePrototype } from "./prototype-provider";
export function LeagueUpdated({ league }: { league: LeagueConnection }) {
  return (
    <p className="standings-note">
      {league.lastSuccess
        ? `LeagueApps · Updated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(league.lastSuccess))} ET`
        : "LeagueApps · First update pending"}
      {league.error || league.state === "failed"
        ? " · Refresh delayed"
        : " · Refreshes hourly"}
    </p>
  );
}
export function LeaguePageNote() {
  const { league, seasonId } = usePrototype();
  if (!league || league.seasonId !== seasonId) return null;
  return (
    <div className="league-page-note">
      <LeagueUpdated league={league} />
      <a
        className="text-link"
        href="https://nycsoccer.leagueapps.com/leagues/5162244/schedule"
        target="_blank"
        rel="noreferrer"
      >
        View league source <ArrowUpRight size={14} />
      </a>
    </div>
  );
}
export function LeagueConnectionPanel() {
  const { league, matches, refresh, setNotice } = usePrototype(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pending = league?.state === "queued" || league?.state === "running";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void refreshRef
        .current()
        .catch(() => setError("Could not check refresh progress."));
    }, 2500);
    return () => clearInterval(timer);
  }, [pending]);
  if (!league) return null;
  const conflicts = matches.filter((m) => m.needsReview);
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await requestLeagueSync();
      await refresh();
      setNotice(
        "League refresh requested. Recent requests share the latest update for five minutes.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="section league-panel"
      aria-label="LeagueApps connection"
    >
      <div>
        <span className="eyebrow">CONNECTED TO LEAGUEAPPS</span>
        <h2>{league.teamName}</h2>
        <p>Scores, fixtures and the full league table refresh automatically.</p>
        <LeagueUpdated league={league} />
      </div>
      <div className="league-actions">
        <button
          className="button secondary small"
          onClick={() => void sync()}
          disabled={busy || pending}
        >
          <RefreshCw size={15} />
          {busy || pending ? "Refreshing…" : "Refresh now"}
        </button>
        <a
          className="text-link"
          href="https://nycsoccer.leagueapps.com/leagues/5162244/schedule"
          target="_blank"
          rel="noreferrer"
        >
          League schedule <ArrowUpRight size={14} />
        </a>
      </div>
      {(error || league.error || league.state === "failed") && (
        <p className="league-message" role="status">
          {error ||
            league.error ||
            "Refresh delayed. Showing the last successful update."}
        </p>
      )}
      {conflicts.map((m) => (
        <p key={m.id} className="league-message">
          {m.opponent}:{" "}
          {m.leagueScore
            ? `League score ${m.leagueScore.home}–${m.leagueScore.away}.`
            : "League result was withdrawn."}{" "}
          Your captain result and player stats are preserved.{" "}
          <Link className="text-link" href={`/captain/?match=${m.id}`}>
            Review result
          </Link>
        </p>
      ))}
    </section>
  );
}
