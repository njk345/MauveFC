"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./auth/auth-provider";
import { LineupExport } from "./lineup-export";
import { formations } from "@/lib/formations";
import {
  deleteLineupSuggestion,
  postLineupSuggestion,
  unshareLineup,
  writeLineup,
} from "@/lib/supabase/repository";
import type {
  Formation,
  LineupPayload,
  LineupPost,
  Match,
  MatchLineup,
  Player,
} from "@/lib/types";

const empty = (): LineupPayload => ({
  formation: "2-3-1",
  starters: Array(7).fill(null),
  bench: [],
});
const postedAt = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
const optionLabel = (post: LineupPost, index: number) =>
  `${index === 0 ? "Latest · " : ""}${post.authorName} · ${post.payload.formation} · ${postedAt(post.createdAt)}`;

export function LineupBoard({
  match,
  lineup,
  posts,
  players,
  onRefresh,
  onDirty,
}: {
  match: Match;
  lineup?: MatchLineup;
  posts: LineupPost[];
  players: Player[];
  onRefresh: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const auth = useAuth(),
    [view, setView] = useState("latest"),
    [composer, setComposer] = useState<LineupPayload | null>(null),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const official = posts.filter((p) => p.kind === "official"),
    suggestions = posts.filter((p) => p.kind === "suggestion"),
    selected =
      view === "latest" ? official[0] : posts.find((p) => p.id === view),
    savedDraft =
      view === "draft" && auth.captain && lineup?.hasDraft
        ? lineup.payload
        : null,
    payload = composer || savedDraft || selected?.payload || empty(),
    editing = composer !== null,
    complete = payload.starters.every(Boolean),
    label = editing
      ? auth.captain
        ? "Captain draft"
        : "Lineup suggestion"
      : savedDraft
        ? "Captain draft"
        : selected?.kind === "official"
          ? "Official lineup"
          : "Team suggestion";
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (
      view !== "latest" &&
      view !== "draft" &&
      !posts.some((p) => p.id === view) &&
      !editing
    )
      setView("latest");
  }, [posts, view, editing]);
  useEffect(() => {
    if (view === "draft" && auth.captain && lineup?.hasDraft && !composer) {
      setComposer(lineup.payload);
      setRevision(lineup.revision || 0);
    }
  }, [view, lineup, auth.captain, composer]);
  function clearChanges() {
    setDirty(false);
    onDirty(false);
    setError("");
    setNotice("");
  }
  function canLeave() {
    return !dirty || window.confirm("Discard unsaved lineup changes?");
  }
  function choose(next: string) {
    if (!canLeave()) return;
    setComposer(null);
    setView(next);
    clearChanges();
  }
  function begin() {
    setComposer(structuredClone(payload));
    setRevision(lineup?.revision || 0);
    clearChanges();
  }
  function change(next: LineupPayload) {
    setComposer(next);
    setDirty(true);
    onDirty(true);
    setError("");
    setNotice("");
  }
  async function save(publish: boolean) {
    setBusy(true);
    setError("");
    try {
      await writeLineup(match.id, revision, payload, publish);
      await onRefresh();
      setComposer(null);
      clearChanges();
      setView(publish ? "latest" : "draft");
      setNotice(
        publish
          ? "Official lineup shared with the team."
          : "Private captain draft saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save lineup.");
    } finally {
      setBusy(false);
    }
  }
  async function post() {
    setBusy(true);
    setError("");
    try {
      const id = await postLineupSuggestion(match.id, payload);
      await onRefresh();
      setComposer(null);
      clearChanges();
      setView(id);
      setNotice("Your suggestion is now visible to the team.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post suggestion.");
    } finally {
      setBusy(false);
    }
  }
  async function removeSuggestion() {
    if (
      !selected ||
      !window.confirm("Remove this suggestion from the team area?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteLineupSuggestion(selected.id);
      await onRefresh();
      choose("latest");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove suggestion.");
    } finally {
      setBusy(false);
    }
  }
  async function unshare() {
    if (
      !window.confirm(
        "Unshare all official versions for this match? Your captain draft will be kept.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await unshareLineup(match.id, lineup?.revision || 0);
      await onRefresh();
      setComposer(null);
      clearChanges();
      setView("latest");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unshare lineup.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="lineup-panel">
      <div className="lineup-heading">
        <div>
          <span className="eyebrow">SEVEN ON THE PITCH</span>
          <h3>
            {editing
              ? "Set the shape."
              : savedDraft
                ? "Your private draft."
                : selected
                  ? selected.kind === "official"
                    ? "The captain’s match plan."
                    : "An idea from the team."
                  : "Make a match plan."}
          </h3>
        </div>
        <span className="pill">
          {editing
            ? dirty
              ? "UNSAVED"
              : view === "draft"
                ? "PRIVATE DRAFT"
                : "BUILDING"
            : selected?.kind === "official"
              ? "OFFICIAL"
              : selected
                ? "SUGGESTION"
                : "NO LINEUP YET"}
        </span>
      </div>
      <div className="lineup-selectors">
        <label className="form-field">
          <span>Official lineups</span>
          <select
            disabled={busy}
            value={!editing && selected?.kind === "official" ? selected.id : ""}
            onChange={(e) => choose(e.target.value || "latest")}
          >
            <option value="">
              {official.length
                ? "Choose an official lineup"
                : "No official lineups posted"}
            </option>
            {official.map((p, i) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p, i)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Team suggestions</span>
          <select
            disabled={busy}
            value={
              !editing && selected?.kind === "suggestion" ? selected.id : ""
            }
            onChange={(e) => choose(e.target.value || "latest")}
          >
            <option value="">
              {suggestions.length
                ? "Choose a team suggestion"
                : "No suggestions posted yet"}
            </option>
            {suggestions.map((p, i) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p, i)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!editing && selected && (
        <p className="help-text lineup-source">
          {selected.kind === "official" ? "Posted by captain" : "Suggested by"}{" "}
          {selected.authorName} · {postedAt(selected.createdAt)} ET
        </p>
      )}
      {!editing && (
        <div className="button-row lineup-start-actions">
          <button className="button small" disabled={busy} onClick={begin}>
            {selected ? "Create a lineup from this" : "Create a lineup"}
          </button>
          {auth.captain && lineup?.hasDraft && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => choose("draft")}
            >
              Open private draft
            </button>
          )}
        </div>
      )}
      {editing && (
        <>
          <label className="form-field">
            <span>Formation</span>
            <select
              disabled={busy}
              value={payload.formation}
              onChange={(e) =>
                change({ ...payload, formation: e.target.value as Formation })
              }
            >
              {Object.keys(formations).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <p className="help-text">
            {auth.captain
              ? "Save a private draft, post an idea, or publish an official lineup. The team sees only posted versions."
              : "Try a formation and post it as a suggestion. Unposted changes last only while this page is open. Only the captain can save private drafts or publish official lineups."}
          </p>
        </>
      )}
      <div
        className="formation-pitch"
        aria-label={`${payload.formation} formation`}
      >
        <div className="pitch-boundary" />
        <div className="pitch-halfway" />
        <div className="pitch-circle" />
        <div className="pitch-goal-area top" />
        <div className="pitch-goal-area bottom" />
        {formations[payload.formation].map((slot, i) => {
          const player = players.find((p) => p.id === payload.starters[i]);
          return (
            <div
              className="formation-slot"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              key={i}
            >
              <span className="formation-position">{slot.label}</span>
              <span className="formation-player-number">
                {player?.number ?? "—"}
              </span>
              {editing ? (
                <select
                  aria-label={`Starter ${slot.label}`}
                  disabled={busy}
                  value={payload.starters[i] || ""}
                  onChange={(e) => {
                    const starters = [...payload.starters];
                    starters[i] = e.target.value || null;
                    change({
                      ...payload,
                      starters,
                      bench: payload.bench.filter(
                        (id) => id !== e.target.value,
                      ),
                    });
                  }}
                >
                  <option value="">Choose player</option>
                  {players
                    .filter(
                      (p) =>
                        p.id === payload.starters[i] ||
                        !payload.starters.includes(p.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              ) : (
                <strong title={player?.name}>
                  {player?.name || "Unassigned"}
                </strong>
              )}
            </div>
          );
        })}
      </div>
      <div className="lineup-bench">
        <h4>Substitutes</h4>
        {editing ? (
          <div className="bench-options">
            {players
              .filter((p) => !payload.starters.includes(p.id))
              .map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={payload.bench.includes(p.id)}
                    disabled={busy}
                    onChange={(e) =>
                      change({
                        ...payload,
                        bench: e.target.checked
                          ? [...payload.bench, p.id]
                          : payload.bench.filter((id) => id !== p.id),
                      })
                    }
                  />
                  #{p.number} {p.name}
                </label>
              ))}
          </div>
        ) : (
          <p>
            {payload.bench
              .map((id) => players.find((p) => p.id === id)?.name)
              .filter(Boolean)
              .join(" · ") || "No substitutes named."}
          </p>
        )}
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="lineup-notice" role="status">
          {notice}
        </p>
      )}
      <div className="button-row lineup-actions">
        {editing && (
          <>
            {auth.captain && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void save(false)}
              >
                Save lineup draft
              </button>
            )}
            {auth.captain && (
              <button
                className="button small"
                disabled={busy || !complete}
                onClick={() => void save(true)}
              >
                {busy ? "Saving…" : "Publish official lineup"}
              </button>
            )}
            <button
              className="button secondary small"
              disabled={busy || !complete}
              onClick={() => void post()}
            >
              Post suggestion
            </button>
          </>
        )}
        <LineupExport
          key={`${match.id}:${view}:${editing}`}
          match={match}
          payload={payload}
          players={players}
          label={label}
        />
        {editing && (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => choose("latest")}
          >
            Cancel editing
          </button>
        )}
        {!editing && selected?.canDelete && (
          <button
            className="text-link"
            disabled={busy}
            onClick={() => void removeSuggestion()}
          >
            Remove suggestion
          </button>
        )}
        {!editing &&
          auth.captain &&
          lineup?.shared &&
          selected?.kind === "official" && (
            <button
              className="text-link"
              disabled={busy}
              onClick={() => void unshare()}
            >
              Unshare official lineups
            </button>
          )}
      </div>
      {editing && !complete && (
        <p className="help-text">
          Choose all seven starters before posting. You can export an incomplete
          formation.
        </p>
      )}
    </article>
  );
}
