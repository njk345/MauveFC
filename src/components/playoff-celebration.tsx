"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import type { Match } from "@/lib/types";
import { isFinalsWin, playoffRounds } from "@/features/matches/playoffs";
import { ResultDecision } from "./result-decision";

export function PlayoffBadge({ match }: { match: Match }) {
  if (!match.playoffRound) return null;
  return (
    <span className="playoff-badge">
      {match.playoffRound === "playoffs"
        ? "Playoffs"
        : `Playoffs · ${playoffRounds[match.playoffRound]}`}
    </span>
  );
}

function ConfettiBurst({ celebration }: { celebration: string }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setActive(!motion.matches);
    const stop = () => setActive(false);
    motion.addEventListener("change", stop);
    const timer = setTimeout(stop, 3800);
    return () => {
      clearTimeout(timer);
      motion.removeEventListener("change", stop);
    };
  }, [celebration]);
  if (!active) return null;
  const colors = ["#dfeea2", "#cfac5f", "#b78ead", "#fff5d4", "#92668b"];
  return (
    <span className="championship-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: colors[i % colors.length],
            animationDelay: `${(i % 7) * 0.1}s`,
            animationDuration: `${2.2 + (i % 5) * 0.15}s`,
            rotate: `${i * 29}deg`,
          }}
        />
      ))}
    </span>
  );
}

export function FinalsVictory({ match }: { match: Match }) {
  if (!isFinalsWin(match)) return null;
  return (
    <>
      <span className="finals-victory" aria-label="League champions">
        <Trophy size={17} aria-hidden="true" />
        Champions!
      </span>
      <ConfettiBurst
        celebration={`${match.id}:${match.result!.home}:${match.result!.away}`}
      />
    </>
  );
}

export function HomeChampions({
  match,
  season,
  teamName,
}: {
  match: Match;
  season: string;
  teamName: string;
}) {
  if (!isFinalsWin(match)) return null;
  return (
    <section className="section home-champions" aria-label="League champions">
      <div className="championship-banner">
        <ConfettiBurst
          celebration={`${match.id}:${match.result!.home}:${match.result!.away}`}
        />
        <span className="championship-cup">
          <Trophy size={42} aria-hidden="true" />
        </span>
        <div className="championship-copy">
          <span className="eyebrow">{season} · LEAGUE CHAMPIONS</span>
          <h2>The league is ours.</h2>
          <p>
            Finals · {teamName} {match.result!.home}–{match.result!.away}{" "}
            {match.opponent}
          </p>
          <ResultDecision result={match.result!} />
        </div>
        <Link className="button" href="/results/">
          Relive the final
        </Link>
      </div>
    </section>
  );
}
