"use client";
import { Check } from "lucide-react";
import type { Capture, LineupPayload, Player, PlayerStat, Result } from "@/lib/types";
import { blankResult, prefillStarterAttendance } from "@/features/matches/player-stats";

export function MatchPlayerEditor({
  players,
  result: r,
  onChange,
  guestPlayerIds = [],
  officialLineup,
}: {
  players: Player[];
  result: Result;
  onChange: (fields: Partial<Result>) => void;
  guestPlayerIds?: string[];
  officialLineup?: LineupPayload;
}) {
  const canPrefill =
    officialLineup &&
    r.basis !== "forfeit" &&
    r.attendance !== "complete" &&
    players.some(
      (player) =>
        officialLineup.starters.includes(player.id) &&
        !r.stats.some((stat) => stat.playerId === player.id && stat.appeared),
    );
  function updatePlayer(id: string, fields: Partial<PlayerStat>) {
    onChange({
      stats: r.stats.some((s) => s.playerId === id)
        ? r.stats.map((s) => (s.playerId === id ? { ...s, ...fields } : s))
        : [
            ...r.stats,
            {
              playerId: id,
              appeared: false,
              goals: 0,
              assists: r.assists === "complete" ? 0 : null,
              ...fields,
            },
          ],
      ...(fields.appeared && r.attendance === "unrecorded"
        ? { attendance: "partial" as const }
        : {}),
      ...((fields.goals ?? 0) > 0 && r.scorers === "unrecorded"
        ? { scorers: "partial" as const }
        : {}),
      ...((fields.assists ?? 0) > 0 && r.assists === "unrecorded"
        ? { assists: "partial" as const }
        : {}),
    });
  }
  function setCapture(
    field: "attendance" | "scorers" | "assists",
    value: Capture,
  ) {
    if (field === "attendance" && value === "unrecorded") {
      onChange({
        attendance: value,
        scorers: "unrecorded",
        assists: "unrecorded",
        ownGoals: 0,
        stats: blankResult(players).stats,
      });
    } else if (field === "scorers") {
      onChange({
        scorers: value,
        ...(value === "unrecorded"
          ? { ownGoals: 0, stats: r.stats.map((s) => ({ ...s, goals: 0 })) }
          : {}),
      });
    } else if (field === "assists") {
      onChange({
        assists: value,
        stats: r.stats.map((s) => ({
          ...s,
          assists:
            value === "unrecorded"
              ? null
              : value === "complete"
                ? (s.assists ?? 0)
                : s.assists,
        })),
      });
    } else onChange({ [field]: value });
  }
  return (
    <div className="match-player-editor">
      {officialLineup && r.basis !== "forfeit" && (
        <div className="matchday-attendance">
          <div>
            <strong>Official lineup checklist</strong>
            <p>Check who actually played, including any subs. Attendance goes live when you publish the report.</p>
          </div>
          {canPrefill && (
            <button
              className="button secondary"
              type="button"
              onClick={() => onChange(prefillStarterAttendance(r, players, officialLineup))}
            >
              Prefill with starters
            </button>
          )}
        </div>
      )}
      <div className="capture-controls">
        {(
          [
            ["attendance", "Attendance"],
            ["scorers", "Goals"],
            ["assists", "Assists"],
          ] as const
        ).map(([field, label]) => (
          <label className="capture-select" key={field}>
            <span>{label}</span>
            <select
              aria-label={`${label} recording`}
              value={r[field]}
              onChange={(e) => setCapture(field, e.target.value as Capture)}
            >
              <option value="unrecorded">Not recorded</option>
              <option value="partial">Partially recorded</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        ))}
      </div>
      <p className="stats-recording-help" id="stats-recording-help">
        Check players who played, including substitutes.{" "}
        {r.attendance === "complete"
          ? "Unchecked players are recorded as absent."
          : "Until attendance is complete, unchecked players remain unconfirmed."}{" "}
        Choose partial when filling gaps in an older game. A blank assist total
        means unknown.
      </p>
      <div className="entry-roster" aria-describedby="stats-recording-help">
        <div className="roster-head" aria-hidden="true">
          <span>PLAYER</span>
          <span>PLAYED</span>
          <span>GOALS</span>
          <span>ASSISTS</span>
        </div>
        {players.map((p) => {
          const lineupRole = r.basis !== "forfeit" && (
            officialLineup?.starters.includes(p.id)
              ? "Lineup starter"
              : officialLineup?.bench.includes(p.id)
                ? "Lineup sub"
                : null
          );
          const s = r.stats.find((s) => s.playerId === p.id) || {
            playerId: p.id,
            appeared: false,
            goals: 0,
            assists: r.assists === "complete" ? 0 : null,
          };
          return (
            <div
              className={`roster-entry ${s.appeared ? "played" : ""}`}
              key={p.id}
            >
              <span>
                <small>#{p.number}</small>
                <strong>
                  {p.name}
                  {guestPlayerIds.includes(p.id) && (
                    <span className="guest-player-badge">Guest</span>
                  )}
                </strong>
                {lineupRole && <span className="matchday-roster-role">{lineupRole}</span>}
              </span>
              <label className="attendance-check">
                <span className="sr-only">{p.name} played</span>
                <input
                  type="checkbox"
                  checked={s.appeared}
                  onChange={(e) =>
                    updatePlayer(p.id, {
                      appeared: e.target.checked,
                      ...(!e.target.checked
                        ? {
                            goals: 0,
                            assists: r.assists === "complete" ? 0 : null,
                          }
                        : {}),
                    })
                  }
                />
                <span>{s.appeared ? <Check size={18} /> : null}</span>
                <small className="stats-mobile-label">Played</small>
              </label>
              <label className="player-stat-input">
                <small className="stats-mobile-label">Goals</small>
                <input
                  aria-label={`${p.name} goals`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="99"
                  step="1"
                  disabled={!s.appeared}
                  value={Number.isNaN(s.goals) ? "" : s.goals}
                  onChange={(e) =>
                    updatePlayer(p.id, { goals: e.target.valueAsNumber })
                  }
                />
              </label>
              <label className="player-stat-input">
                <small className="stats-mobile-label">Assists</small>
                <input
                  aria-label={`${p.name} assists`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="99"
                  step="1"
                  disabled={!s.appeared || r.assists === "unrecorded"}
                  value={s.assists ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    updatePlayer(p.id, {
                      assists:
                        e.target.value === "" ? null : e.target.valueAsNumber,
                    })
                  }
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="own-goals">
        <label>
          Opposition own goals{" "}
          <input
            aria-label="Opposition own goals"
            type="number"
            inputMode="numeric"
            min="0"
            max="99"
            step="1"
            value={Number.isNaN(r.ownGoals) ? "" : r.ownGoals}
            onChange={(e) =>
              onChange({
                ownGoals: e.target.valueAsNumber,
                ...(r.scorers === "unrecorded" ? { scorers: "partial" } : {}),
              })
            }
          />
        </label>
        <span>
          {r.stats.reduce(
            (n, s) => n + (Number.isNaN(s.goals) ? 0 : s.goals),
            0,
          ) + (Number.isNaN(r.ownGoals) ? 0 : r.ownGoals)}{" "}
          of {r.onFieldHome} on-field goals attributed
        </span>
      </div>
    </div>
  );
}
