"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { useEffect, useState } from "react";
import { LockKeyhole, Search } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import {
  readPlayerDirectory,
  writePlayerDetails,
} from "@/lib/supabase/repository";
import {
  preferredPositions,
  type DirectoryPlayer,
  type Player,
} from "@/lib/types";
import {
  PlayerDetailFields,
  withEditableDetails,
} from "./player-detail-fields";

function DirectoryDetailsEditor({
  player,
  onSave,
  onClose,
  onReload,
}: {
  player: DirectoryPlayer;
  onSave: (player: DirectoryPlayer) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState<Player>(() =>
    withEditableDetails(player),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const details = await writePlayerDetails(editing);
      onSave({ ...player, ...details });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save player details.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="management-form directory-details-editor" onSubmit={save}>
      <span className="eyebrow">CAPTAIN / PLAYER DETAILS</span>
      <h2>{player.name}</h2>
      <p className="help-text">
        Update this player’s club record across every season and guest
        appearance.
      </p>
      <PlayerDetailFields player={editing} onChange={setEditing} />
      {error && (
        <div className="form-errors" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary small"
            onClick={onReload}
          >
            Reload directory
          </button>
        </div>
      )}
      <div className="button-row">
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save player details"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PlayerDirectory() {
  const auth = useAuth(),
    { seasons, seasonId, refresh, setNotice } = usePrototype();
  const [response, setResponse] = useState<{
    owner: string;
    players?: DirectoryPlayer[];
    error?: string;
  }>();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [position, setPosition] = useState("all"),
    [editingId, setEditingId] = useState(""),
    [reload, setReload] = useState(0);
  const owner = `${auth.user?.id}:${auth.member}:${auth.captain}:${auth.loading}:${reload}`;
  useEffect(() => {
    setResponse(undefined);
    setEditingId("");
    if (!auth.member || auth.loading) return;
    let active = true;
    void readPlayerDirectory().then(
      (data) => {
        if (active) setResponse({ owner, players: data });
      },
      (e) => {
        if (active) {
          setResponse({ owner, error: e.message });
          void auth.refreshAccess().catch(() => {});
        }
      },
    );
    return () => {
      active = false;
    };
  }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!auth.member || auth.loading) return null;
  const current = response?.owner === owner ? response : undefined;
  const players = current?.players,
    error = current?.error;
  const editing = players?.find((p) => p.id === editingId);
  const filtered = (players || []).filter(
    (p) =>
      (p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
        (auth.captain &&
          [
            p.captainDetails?.email,
            p.captainDetails?.phone,
            p.captainDetails?.relationshipNote,
          ].some((v) =>
            v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          ))) &&
      (position === "all" ||
        (position === "unknown"
          ? !p.preferredPositions?.length
          : p.preferredPositions?.some((p) => p === position))) &&
      (filter === "all" ||
        (filter === "roster" && p.rosterSeasonIds.includes(seasonId)) ||
        (filter === "guests" && p.guestGames > 0) ||
        (filter === "past" &&
          p.rosterSeasonIds.length > 0 &&
          !p.rosterSeasonIds.includes(seasonId))),
  );
  return (
    <section className="player-directory" aria-label="Club player directory">
      <div className="directory-heading">
        <div>
          <span className="eyebrow">ONE CLUB / SHARED HISTORY</span>
          <h2>Club player directory</h2>
          <p>
            Season players and game guests share one player history, even when
            their role changes between seasons.
          </p>
        </div>
        <span className="directory-private">
          <LockKeyhole size={16} />
          Team members only
        </span>
      </div>
      <div className="directory-controls">
        <label className="form-field">
          <span>Find a player</span>
          <div className="guest-search-input">
            <Search size={17} />
            <input
              aria-label="Search club directory"
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                auth.captain
                  ? "Name, contact details or captain notes"
                  : "Search all known players"
              }
            />
          </div>
        </label>
        <label className="form-field">
          <span>Preferred position</span>
          <select
            aria-label="Filter preferred position"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="all">All positions</option>
            {preferredPositions.map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value="unknown">Preferences not recorded</option>
          </select>
        </label>
        <label className="form-field">
          <span>Player history</span>
          <select
            aria-label="Filter player directory"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All known players</option>
            <option value="roster">This season’s roster</option>
            <option value="guests">Guest assignments</option>
            <option value="past">Past roster players</option>
          </select>
        </label>
      </div>
      {!players && !error && <p role="status">Loading player history…</p>}
      {error && (
        <div role="alert" className="form-errors">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setReload((v) => v + 1)}
          >
            Retry directory
          </button>
        </div>
      )}
      {players && (
        <>
          {auth.captain && editing && (
            <DirectoryDetailsEditor
              key={`${owner}:${editing.id}:${editing.captainDetails?.revision ?? 0}`}
              player={editing}
              onClose={() => setEditingId("")}
              onReload={() => setReload((v) => v + 1)}
              onSave={(updated) => {
                setResponse({
                  owner,
                  players: players.map((p) =>
                    p.id === updated.id ? updated : p,
                  ),
                });
                setEditingId("");
                setNotice("Player details saved to the club directory.");
                void refresh().catch(() => {});
              }}
            />
          )}
          <p className="directory-count">
            {filtered.length} of {players.length} known players
          </p>
          <div className="directory-grid">
            {filtered.map((p) => (
              <article key={p.id} className="directory-player-card">
                <div className="directory-player-heading">
                  <span className="initial-avatar">{p.initials}</span>
                  <div>
                    <h3>
                      <Link href={playerHref(p.id)}>{p.name}</Link>
                    </h3>
                    <p>
                      #{p.number} · {p.position}
                    </p>
                  </div>
                </div>
                <div
                  className="directory-positions"
                  aria-label="Preferred positions"
                >
                  {p.preferredPositions?.length ? (
                    p.preferredPositions.map((position) => (
                      <span key={position}>{position}</span>
                    ))
                  ) : (
                    <p>Preferred positions not recorded</p>
                  )}
                </div>
                <div className="directory-history">
                  <span>
                    {p.rosterSeasonIds.includes(seasonId)
                      ? "Current roster"
                      : p.rosterSeasonIds.length
                        ? "Past roster player"
                        : "Guest player"}
                  </span>
                  <p>
                    {p.rosterSeasonIds.length
                      ? p.rosterSeasonIds
                          .map(
                            (id) =>
                              seasons.find((s) => s.id === id)?.name ||
                              "Earlier season",
                          )
                          .join(" · ")
                      : "No season-roster membership"}
                  </p>
                  <p>
                    {p.guestGames} guest game assignments · {p.appearances}{" "}
                    recorded appearances
                  </p>
                </div>
                <small>
                  {p.isPublic ? "Public profile approved" : "Private profile"}
                </small>
                {auth.captain && (
                  <div className="directory-captain-details">
                    <span className="directory-notebook-label">
                      <LockKeyhole size={13} /> Captain’s notebook
                    </span>
                    {p.captainDetails?.email && (
                      <a
                        href={`mailto:${encodeURIComponent(p.captainDetails.email)}`}
                      >
                        {p.captainDetails.email}
                      </a>
                    )}
                    {p.captainDetails?.phone && (
                      <a
                        href={`tel:${p.captainDetails.phone.replace(/[^+\d]/g, "")}`}
                      >
                        {p.captainDetails.phone}
                      </a>
                    )}
                    {p.captainDetails?.relationshipNote && (
                      <p className="directory-relationship-note">
                        {p.captainDetails.relationshipNote}
                      </p>
                    )}
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => {
                        setEditingId(p.id);
                        requestAnimationFrame(() =>
                          document
                            .querySelector(".directory-details-editor")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            }),
                        );
                      }}
                    >
                      Edit player details
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filtered.length && (
            <p className="empty-state">No players match this search.</p>
          )}
        </>
      )}
    </section>
  );
}
