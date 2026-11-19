"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LockKeyhole, Save } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import { MatchPlayerEditor } from "./match-player-editor";
import { captureSummary, expandResult } from "@/features/matches/player-stats";
import { validateResult } from "@/features/matches/validation";
import type { Match, Result } from "@/lib/types";
import { date } from "@/lib/format";

export function CaptainPlayerStats() {
  const { ready, seasonId, resetVersion } = usePrototype();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [reloadMatchId, setReloadMatchId] = useState<string>();
  return (
    <div className="section page-section captain-stats-page">
      <PageHeading
        eyebrow="CAPTAIN / PLAYER STATS"
        title="Every contribution counts."
        description="Record goals, assists and attendance for this season’s games, including past matches."
      />
      <p className="stats-privacy-note">
        <LockKeyhole size={17} /> Player names and individual stats stay private
        with your current roster settings.
      </p>
      {ready ? (
        <SeasonStatsEditor
          key={`${seasonId}:${resetVersion}:${reloadVersion}`}
          preferredMatchId={reloadMatchId}
          onReload={(id) => {
            setReloadMatchId(id);
            setReloadVersion((v) => v + 1);
          }}
        />
      ) : (
        <p role="status">Loading match records…</p>
      )}
    </div>
  );
}

function SeasonStatsEditor({
  onReload,
  preferredMatchId,
}: {
  onReload: (id: string) => void;
  preferredMatchId?: string;
}) {
  const {
    matches,
    seasonId,
    seasons,
    players: allPlayers,
    roster,
    drafts,
    live,
    saveResult,
    refresh,
    setNotice,
  } = usePrototype();
  const players = allPlayers.filter((p) =>
    roster.some((sr) => sr.seasonId === seasonId && sr.playerId === p.id),
  );
  const fixtures = matches
    .filter((m) => m.seasonId === seasonId && m.status !== "cancelled")
    .sort(
      (a, b) =>
        Number(!!b.result?.published) - Number(!!a.result?.published) ||
        (b.kickoff || "").localeCompare(a.kickoff || "") ||
        b.round - a.round,
    );
  const [selectedId, setSelectedId] = useState(() => {
    const query = new URLSearchParams(window.location.search).get("match");
    return (
      fixtures.find((m) => m.id === preferredMatchId)?.id ||
      fixtures.find((m) => m.id === query)?.id ||
      fixtures.find(
        (m) => m.result?.published && captureSummary(m) !== "Complete",
      )?.id ||
      fixtures[0]?.id ||
      ""
    );
  });
  const match = fixtures.find((m) => m.id === selectedId);
  const [result, setResult] = useState<Result | null>(() =>
    match?.result?.published
      ? {
          ...expandResult(match.result, players),
          baseRevision: match.revision ?? 0,
        }
      : null,
  );
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]),
    [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) errorBox.current?.focus();
  }, [errors]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function load(m: Match) {
    setSelectedId(m.id);
    setResult(
      m.result?.published
        ? { ...expandResult(m.result, players), baseRevision: m.revision ?? 0 }
        : null,
    );
    setDirty(false);
    setErrors([]);
    setSaved(false);
    setStale(false);
  }
  function choose(m: Match) {
    if (
      saving ||
      (dirty && !window.confirm("Leave these unsaved player stats?"))
    )
      return;
    load(m);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!result || !match || saving || drafts[match.id]) return;
    const issues = validateResult(result, players);
    if (issues.length) {
      setErrors(issues);
      return;
    }
    setSaving(true);
    setErrors([]);
    setSaved(false);
    try {
      await saveResult(match.id, { ...result, published: true });
      setResult({
        ...result,
        baseRevision: (result.baseRevision ?? 0) + (live ? 1 : 0),
      });
      setDirty(false);
      setSaved(true);
      setNotice(
        live
          ? "Player stats saved."
          : "Sample player stats saved in this browser.",
      );
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Could not save player stats.",
      ]);
      setStale(
        error instanceof Error && error.message.includes("changed since"),
      );
    } finally {
      setSaving(false);
    }
  }
  async function reload() {
    if (
      dirty &&
      !window.confirm(
        "Reload the latest record and discard these unsaved player stats?",
      )
    )
      return;
    setSaving(true);
    try {
      await refresh();
      onReload(selectedId);
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : "Could not reload match records.",
      ]);
    } finally {
      setSaving(false);
    }
  }
  const recordedGames = fixtures.filter(
    (m) => m.result?.published && captureSummary(m) !== "Not recorded",
  ).length;
  return (
    <>
      <div className="stats-season-summary">
        <div>
          <span className="eyebrow">SEASON RECORD</span>
          <h2>{seasons.find((s) => s.id === seasonId)?.name}</h2>
          <p>
            {recordedGames} of{" "}
            {fixtures.filter((m) => m.result?.published).length} results have
            player stats. Use the season selector above to visit another season.
          </p>
        </div>
        <Link className="button secondary" href="/captain/fixtures/">
          Add a historical game
        </Link>
      </div>
      {!fixtures.length ? (
        <div className="empty-state">
          <h2>No games in this season yet.</h2>
          <p>
            Add the fixture with its original date, then record its result and
            player stats.
          </p>
        </div>
      ) : (
        <div className="player-stats-layout">
          <form
            className="player-stats-form"
            onSubmit={submit}
            aria-label="Match player stats"
          >
            <label className="form-field">
              <span>Choose a game</span>
              <select
                aria-label="Choose a game"
                disabled={saving}
                value={selectedId}
                onChange={(e) => {
                  const next = fixtures.find((m) => m.id === e.target.value);
                  if (next) choose(next);
                }}
              >
                {fixtures.map((m) => (
                  <option key={m.id} value={m.id}>
                    {date(m.kickoff)} · {m.opponent} · {captureSummary(m)}
                  </option>
                ))}
              </select>
            </label>
            {match && (
              <div className="stats-game-heading">
                <span className="eyebrow">
                  MATCHDAY {match.round} · {date(match.kickoff, "long")}
                </span>
                <h2>
                  Mauve FC{" "}
                  {match.result?.published
                    ? `${match.result.home} – ${match.result.away}`
                    : "vs"}{" "}
                  {match.opponent}
                </h2>
                <p>{match.venue}</p>
              </div>
            )}
            {match && drafts[match.id] ? (
              <div className="stats-next-step">
                <h3>This game has a saved result draft.</h3>
                <p>
                  Finish or correct the draft in Results to keep all your edits
                  together.
                </p>
                <Link
                  className="button secondary"
                  href={`/captain/?match=${match.id}`}
                >
                  Open result draft
                </Link>
              </div>
            ) : !result ? (
              <div className="stats-next-step">
                <h3>Record the result first.</h3>
                <p>
                  Enter the final score and then add attendance, goals and
                  assists. This works for historical games too.
                </p>
                <Link
                  className="button secondary"
                  href={`/captain/?match=${match?.id}`}
                >
                  Record result & stats
                </Link>
              </div>
            ) : !players.length ? (
              <div className="stats-next-step">
                <h3>Add this season’s players first.</h3>
                <p>Only players on this season’s roster can receive stats.</p>
                <Link className="button secondary" href="/captain/roster/">
                  Manage roster
                </Link>
              </div>
            ) : (
              <>
                {errors.length > 0 && (
                  <div
                    role="alert"
                    className="form-errors"
                    ref={errorBox}
                    tabIndex={-1}
                  >
                    <strong>Check these details before saving.</strong>
                    <ul>
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                    {stale && (
                      <button
                        type="button"
                        className="text-link"
                        disabled={saving}
                        onClick={() => void reload()}
                      >
                        Reload latest record
                      </button>
                    )}
                  </div>
                )}
                {saved && (
                  <p className="stats-save-success" role="status">
                    <CheckCircle2 size={18} /> Player stats saved. You can make
                    corrections here anytime.
                  </p>
                )}
                <fieldset disabled={saving || stale}>
                  <legend className="sr-only">
                    Attendance, goals and assists
                  </legend>
                  <MatchPlayerEditor
                    players={players}
                    result={result}
                    onChange={(fields) => {
                      setResult({ ...result, ...fields });
                      setDirty(true);
                      setSaved(false);
                      setErrors([]);
                    }}
                  />
                </fieldset>
                <div className="stats-save-bar">
                  <p>{dirty ? "Unsaved player stats" : "Up to date"}</p>
                  <button
                    className="button"
                    type="submit"
                    disabled={saving || !dirty || stale}
                  >
                    <Save size={17} />
                    {saving ? "Saving…" : "Save player stats"}
                  </button>
                </div>
                <p className="stats-save-note">
                  Saving keeps the displayed final score and protects this
                  record from automatic league changes.{" "}
                  {match?.source &&
                    "Any later LeagueApps score change will be flagged for captain review."}{" "}
                  <Link href={`/captain/?match=${match?.id}`}>
                    Correct the score in Results
                  </Link>
                  .
                </p>
              </>
            )}
          </form>
          <aside className="stats-match-history" aria-label="Match history">
            <span className="eyebrow">BACKFILL & REVIEW</span>
            <h2>Match history</h2>
            <p>Choose a game to fill in the gaps.</p>
            {fixtures.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-pressed={m.id === selectedId}
                disabled={saving}
                onClick={() => choose(m)}
              >
                <span>
                  <small>{date(m.kickoff)}</small>
                  <strong>{m.opponent}</strong>
                  <small>{captureSummary(m)}</small>
                </span>
                <b>
                  {m.result?.published
                    ? `${m.result.home}–${m.result.away}`
                    : "—"}
                </b>
              </button>
            ))}
          </aside>
        </div>
      )}
    </>
  );
}
