"use client";
import { useEffect, useState } from "react";
import { LockKeyhole, Search } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { readPlayerDirectory } from "@/lib/supabase/repository";
import type { DirectoryPlayer } from "@/lib/types";

export function PlayerDirectory() {
  const auth = useAuth(),
    { seasons, seasonId } = usePrototype();
  const [players, setPlayers] = useState<DirectoryPlayer[] | null>(null),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [reload, setReload] = useState(0);
  useEffect(() => {
    setPlayers(null);
    setError("");
    if (!auth.member || auth.loading) return;
    let active = true;
    void readPlayerDirectory().then(
      (data) => {
        if (active) setPlayers(data);
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [auth.user?.id, auth.member, auth.loading, reload]);
  if (!auth.member || auth.loading) return null;
  const filtered = (players || []).filter(
    (p) =>
      p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
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
              placeholder="Search all known players"
            />
          </div>
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
          <p className="directory-count">
            {filtered.length} of {players.length} known players
          </p>
          <div className="directory-grid">
            {filtered.map((p) => (
              <article key={p.id} className="directory-player-card">
                <div className="directory-player-heading">
                  <span className="initial-avatar">{p.initials}</span>
                  <div>
                    <h3>{p.name}</h3>
                    <p>
                      #{p.number} · {p.position}
                    </p>
                  </div>
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
