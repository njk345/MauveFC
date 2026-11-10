"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { ArrowUpRight, CalendarPlus, MapPin } from "lucide-react";
import { Crest, OpponentBadge } from "./brand";
import { date, day, month, time } from "@/lib/format";
import type { Match } from "@/lib/types";
import { usePrototype } from "./prototype-provider";
import { outcome } from "@/features/stats/queries";
export function FormBadge({ value }: { value: string | null }) {
  return <span className={`form-badge form-${value}`}>{value || "—"}</span>;
}
export function MatchRow({
  match,
  action = "details",
  onOpen,
}: {
  match: Match;
  action?: "details" | "edit";
  onOpen?: (match: Match) => void;
}) {
  const result = match.result?.published ? match.result : undefined;
  return (
    <div className={`match-row ${result ? "finished" : ""}`}>
      <div className="match-date">
        <strong>{day(match.kickoff)}</strong>
        <span>{month(match.kickoff)}</span>
      </div>
      <div className="match-information">
        <div className="match-round">
          MATCHDAY {String(match.round).padStart(2, "0")}{" "}
          <span>· {match.home ? "HOME" : "AWAY"}</span>
        </div>
        <div className="match-opponent">
          <OpponentBadge small code={match.opponentCode} color={match.color} />
          {onOpen ? (
            <button
              className="match-title-button"
              onClick={() => onOpen(match)}
            >
              {match.opponent}
            </button>
          ) : (
            <strong>{match.opponent}</strong>
          )}
        </div>
        <span className="match-venue">
          <MapPin size={12} />
          {match.venue}
        </span>
      </div>
      <div className="match-row-end">
        {result ? (
          <>
            <strong className="row-score">
              {result.home} <span>–</span> {result.away}
            </strong>
            <FormBadge value={outcome(match)} />
          </>
        ) : (
          <div className="match-time">
            <strong>
              {match.status === "postponed"
                ? "Postponed"
                : match.status === "cancelled"
                  ? "Cancelled"
                  : time(match.kickoff)}
            </strong>
            <span>
              {match.status === "scheduled"
                ? match.source &&
                  match.kickoff &&
                  Date.parse(match.kickoff) < Date.now()
                  ? "Awaiting league result"
                  : "New York time"
                : "New date to follow"}
            </span>
          </div>
        )}
        {action === "edit" ? (
          <Link
            className="icon-button row-detail"
            href={`/captain/?match=${match.id}`}
            aria-label={`Edit result against ${match.opponent}`}
          >
            <ArrowUpRight size={18} />
          </Link>
        ) : onOpen ? (
          <button
            className="icon-button row-detail"
            onClick={() => onOpen(match)}
            aria-label={`View ${match.opponent} match details`}
          >
            <ArrowUpRight size={18} />
          </button>
        ) : (
          <Link
            className="icon-button row-detail"
            href={result ? "/results/" : "/schedule/"}
            aria-label="View match"
          >
            <ArrowUpRight size={18} />
          </Link>
        )}
      </div>
    </div>
  );
}
export function CalendarButton({
  match,
  compact = false,
}: {
  match: Match;
  compact?: boolean;
}) {
  const { live } = usePrototype();
  function download() {
    if (!match.kickoff) return;
    const stamp = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const start = new Date(match.kickoff),
      end = new Date(start.getTime() + 60 * 60 * 1000);
    const data = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Mauve FC//Club Fixtures//EN",
      "BEGIN:VEVENT",
      `UID:${match.id}@mauve-fc-prototype`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${live ? "" : "[SAMPLE] "}Mauve FC vs ${match.opponent}`,
      `LOCATION:${match.venue.replace(/,/g, "\\,")}`,
      live
        ? "DESCRIPTION:Mauve FC club fixture."
        : "DESCRIPTION:Fictional fixture from the Mauve FC prototype.",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([data], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `mauve-${match.id}${live ? "" : "-sample"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      className={`button ${compact ? "secondary small" : "light"}`}
      disabled={
        !match.kickoff ||
        match.status === "cancelled" ||
        match.status === "postponed"
      }
      onClick={download}
    >
      <CalendarPlus size={16} />
      {compact ? "Add to calendar" : "Add to calendar"}
    </button>
  );
}
export function FixtureCard({ match }: { match: Match }) {
  return (
    <article className="fixture-card">
      <div className="card-eyebrow">
        <span className="live-dot" /> NEXT UP{" "}
        <span>MATCHDAY {String(match.round).padStart(2, "0")}</span>
      </div>
      <div className="fixture-teams">
        <div>
          <Crest />
          <strong>Mauve FC</strong>
        </div>
        <span className="versus">VS</span>
        <div>
          <OpponentBadge code={match.opponentCode} color={match.color} />
          <strong>{match.opponent}</strong>
        </div>
      </div>
      <div className="fixture-time">
        <strong>{date(match.kickoff, "long")}</strong>
        <span>
          {time(match.kickoff)} <span>·</span> {match.home ? "Home" : "Away"}
        </span>
      </div>
      <p className="fixture-venue">
        <MapPin size={14} />
        {match.venue}
      </p>
      <CalendarButton match={match} />
    </article>
  );
}
