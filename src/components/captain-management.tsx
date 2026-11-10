"use client";
import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import type { Match, Player } from "@/lib/types";
import { fromNewYorkInput, toNewYorkInput } from "@/lib/kickoff";
import { useLeagueFixture } from "@/lib/supabase/repository";
export function FixtureManagement() {
  const { matches, seasonId, saveFixture, setNotice, live, refresh } =
      usePrototype(),
    [editing, setEditing] = useState<Match | null>(null),
    [kickoff, setKickoff] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fixtures = matches.filter((m) => m.seasonId === seasonId);
  function edit(match?: Match) {
    setEditing(
      match || {
        id: crypto.randomUUID(),
        seasonId,
        opponent: "",
        opponentCode: "FC",
        color: "#657293",
        kickoff: null,
        venue: "",
        round: fixtures.length + 1,
        home: true,
        status: "scheduled",
        revision: 0,
      },
    );
    setKickoff(toNewYorkInput(match?.kickoff || null));
    setError("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await saveFixture({ ...editing, kickoff: fromNewYorkInput(kickoff) });
      setEditing(null);
      setNotice(
        live ? "Fixture saved." : "Sample fixture saved in this browser.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save fixture.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section page-section management-page">
      <PageHeading
        eyebrow="CAPTAIN / FIXTURES"
        title="Set the next kickoff."
        description="Maintain the schedule, including reschedules and postponements."
      />
      <div className="management-grid">
        <div>
          <button className="button" onClick={() => edit()}>
            <Plus size={16} />
            Add fixture
          </button>
          <div className="management-list">
            {fixtures.map((m) => (
              <button key={m.id} onClick={() => edit(m)}>
                <span>
                  <strong>{m.opponent}</strong>
                  <small>
                    Matchday {m.round} · {m.status}
                    {m.source &&
                      (m.fixtureOverride
                        ? " · Captain override"
                        : " · LeagueApps")}
                  </small>
                </span>
                <span>Edit</span>
              </button>
            ))}
          </div>
        </div>
        {editing ? (
          <form className="management-form" onSubmit={submit}>
            <h2>
              {fixtures.some((m) => m.id === editing.id)
                ? "Edit fixture"
                : "New fixture"}
            </h2>
            {editing.source && (
              <p className="help-text">
                {editing.fixtureOverride
                  ? "Your fixture details are protected from league updates."
                  : "LeagueApps keeps this fixture up to date. Changing its details creates a captain override."}
              </p>
            )}
            {editing.fixtureOverride && (
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void useLeagueFixture(editing)
                    .then(() => refresh())
                    .then(() => {
                      setEditing(null);
                      setNotice(
                        "League fixture details restored. Automatic updates resumed.",
                      );
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Restore league fixture details
              </button>
            )}
            <label className="form-field">
              <span>Opponent</span>
              <input
                required
                maxLength={100}
                value={editing.opponent}
                onChange={(e) =>
                  setEditing({ ...editing, opponent: e.target.value })
                }
              />
            </label>
            <div className="field-pair">
              <label className="form-field">
                <span>Short code</span>
                <input
                  required
                  maxLength={4}
                  value={editing.opponentCode}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      opponentCode: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>Matchday</span>
                <input
                  required
                  type="number"
                  min="1"
                  max="999"
                  value={editing.round}
                  onChange={(e) =>
                    setEditing({ ...editing, round: e.target.valueAsNumber })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              <span>Kickoff · New York time</span>
              <input
                type="datetime-local"
                value={kickoff}
                onChange={(e) => setKickoff(e.target.value)}
              />
            </label>
            <p className="help-text">
              Leave blank until a postponed match’s new time is known.
            </p>
            <label className="form-field">
              <span>Venue</span>
              <input
                required
                maxLength={200}
                value={editing.venue}
                onChange={(e) =>
                  setEditing({ ...editing, venue: e.target.value })
                }
              />
            </label>
            <div className="field-pair">
              <label className="form-field">
                <span>Status</span>
                <select
                  disabled={editing.result?.published}
                  value={editing.status}
                  onChange={(e) => {
                    const status = e.target.value as Match["status"];
                    setEditing({ ...editing, status });
                    if (status === "postponed") setKickoff("");
                  }}
                >
                  {[
                    "scheduled",
                    "postponed",
                    "cancelled",
                    ...(editing.result?.published ? ["completed"] : []),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Location</span>
                <select
                  value={editing.home ? "home" : "away"}
                  onChange={(e) =>
                    setEditing({ ...editing, home: e.target.value === "home" })
                  }
                >
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                </select>
              </label>
            </div>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button className="button" disabled={busy}>
                <Save size={15} />
                {busy ? "Saving…" : "Save fixture"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="management-empty">
            <h2>The next chapter starts here.</h2>
            <p>Choose a fixture to edit or add the next match.</p>
          </div>
        )}
      </div>
    </div>
  );
}
export function RosterManagement() {
  const { players, roster, seasonId, savePlayer, setNotice, live } =
      usePrototype(),
    [editing, setEditing] = useState<Player | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await savePlayer({
        ...editing,
        initials: editing.name
          .trim()
          .split(/\s+/)
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase(),
      });
      setEditing(null);
      setNotice(
        live
          ? "Player saved to the season roster."
          : "Sample roster saved in this browser.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save player.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section page-section management-page">
      <PageHeading
        eyebrow="CAPTAIN / ROSTER"
        title="Build the squad."
        description="Add season players and approve the profile details the club shares publicly."
      />
      <div className="management-grid">
        <div>
          <button
            className="button"
            onClick={() => {
              setError("");
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                number: 0,
                position: "Midfielder",
                initials: "FC",
                hometown: "",
                bio: "",
                isPublic: false,
              });
            }}
          >
            <Plus size={16} />
            Add player
          </button>
          <div className="management-list">
            {players.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setEditing(p);
                  setError("");
                }}
              >
                <span>
                  <strong>
                    #{p.number} {p.name}
                  </strong>
                  <small>
                    {roster.some(
                      (sr) => sr.seasonId === seasonId && sr.playerId === p.id,
                    )
                      ? "On this season’s roster"
                      : "Add to this season"}{" "}
                    ·{" "}
                    {p.isPublic === false
                      ? "Private profile"
                      : "Public profile"}
                  </small>
                </span>
                <span>Edit</span>
              </button>
            ))}
          </div>
        </div>
        {editing ? (
          <form className="management-form" onSubmit={submit}>
            <h2>
              {players.some((p) => p.id === editing.id)
                ? "Edit player"
                : "New player"}
            </h2>
            <label className="form-field">
              <span>Player name</span>
              <input
                required
                maxLength={100}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <div className="field-pair">
              <label className="form-field">
                <span>Shirt number</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="99"
                  value={editing.number}
                  onChange={(e) =>
                    setEditing({ ...editing, number: e.target.valueAsNumber })
                  }
                />
              </label>
              <label className="form-field">
                <span>Position</span>
                <select
                  value={editing.position}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      position: e.target.value as Player["position"],
                    })
                  }
                >
                  {["Forward", "Midfielder", "Defender", "Goalkeeper"].map(
                    (p) => (
                      <option key={p}>{p}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>Hometown · optional</span>
              <input
                maxLength={100}
                value={editing.hometown}
                onChange={(e) =>
                  setEditing({ ...editing, hometown: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>Profile bio · optional</span>
              <textarea
                maxLength={1000}
                value={editing.bio}
                onChange={(e) =>
                  setEditing({ ...editing, bio: e.target.value })
                }
              />
            </label>
            <label className="public-profile-check">
              <input
                type="checkbox"
                checked={editing.isPublic !== false}
                onChange={(e) =>
                  setEditing({ ...editing, isPublic: e.target.checked })
                }
              />
              <span>Approve this profile for the public club site</span>
            </label>
            <p className="help-text">
              Saving also adds this player to the selected season. Keep a
              profile private until its details are approved.
            </p>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <div className="button-row">
              <button disabled={busy} className="button">
                <Save size={15} />
                {busy ? "Saving…" : "Save player"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="management-empty">
            <h2>Everyone has a part to play.</h2>
            <p>Choose a teammate or add a player to the selected season.</p>
          </div>
        )}
      </div>
    </div>
  );
}
