"use client";
import { useState } from "react";
import { Plus, Save, UserPlus } from "lucide-react";
import { PositionGroupFields } from "./position-group-fields";
import { positionGroupLabel } from "@/lib/player-positions";
import { usePrototype } from "./prototype-provider";
import {
  PlayerDetailFields,
  withEditableDetails,
} from "./player-detail-fields";
import { PageHeading } from "./season-pages";
import { orderMatches } from "@/features/matches/order";
import type { Match, Player, PlayoffRound } from "@/lib/types";
import { playoffRounds } from "@/features/matches/playoffs";
import { fromZonedInput, toZonedInput } from "@/lib/kickoff";
import { useLeagueFixture } from "@/lib/supabase/repository";
import {
  feedName,
  RemoveFixtureButton,
  RemovedFeedFixtures,
} from "./fixture-removal";
export function FixtureManagement() {
  const { seasonId } = usePrototype();
  return <SeasonFixtureManagement key={seasonId} />;
}
function SeasonFixtureManagement() {
  const { matches, seasonId, seasons, saveFixture, setNotice, live, refresh } =
      usePrototype(),
    [editing, setEditing] = useState<Match | null>(null),
    [kickoff, setKickoff] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fixtures = orderMatches(matches.filter((m) => m.seasonId === seasonId));
  const season = seasons.find((s) => s.id === seasonId);
  const leagueTeams = season?.manualStandings
    ? season.leagueTeams?.filter((team) => !team.isOurs)
    : undefined;
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
        playoffRound: null,
      },
    );
    setKickoff(toZonedInput(match?.kickoff || null, season?.timeZone));
    setError("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await saveFixture({
        ...editing,
        kickoff: fromZonedInput(kickoff, season?.timeZone),
      });
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
                    {m.playoffRound &&
                      ` · Playoffs: ${playoffRounds[m.playoffRound]}`}
                    {m.source &&
                      (m.fixtureOverride
                        ? " · Captain override"
                        : ` · ${feedName(m.source)}`)}
                  </small>
                </span>
                <span>Edit</span>
              </button>
            ))}
          </div>
          <RemovedFeedFixtures />
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
                  : `${feedName(editing.source)} keeps this fixture up to date. Playoff labels are managed by the captain; changing schedule details creates a captain override.`}
              </p>
            )}
            {editing.fixtureOverride && editing.source === "leagueapps" && (
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
            <fieldset className="playoff-settings">
              <legend>Match type</legend>
              <label className="playoff-toggle">
                <input
                  type="checkbox"
                  checked={!!editing.playoffRound}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      playoffRound: e.target.checked ? "playoffs" : null,
                    })
                  }
                />
                <span>Playoff match</span>
              </label>
              {editing.playoffRound && (
                <label className="form-field">
                  <span>Playoff round</span>
                  <select
                    aria-label="Playoff round"
                    value={editing.playoffRound}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        playoffRound: e.target.value as PlayoffRound,
                      })
                    }
                  >
                    {Object.entries(playoffRounds).map(([value, label]) => (
                      <option key={value} value={value}>
                        {value === "playoffs"
                          ? "Playoffs · round not specified"
                          : label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                Playoff games appear in Schedule, Results and Stats. Their
                results do not count toward Home’s regular-season record or
                league standings.
              </p>
            </fieldset>
            <label className="form-field">
              <span>Opponent</span>
              {leagueTeams?.length ? (
                <select
                  required
                  value={editing.opponent}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      opponent: e.target.value,
                      opponentCode: e.target.value
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((word) => word[0])
                        .join("")
                        .toUpperCase(),
                    })
                  }
                >
                  <option value="">Choose a league team</option>
                  {editing.opponent &&
                    !leagueTeams.some(
                      (team) => team.name === editing.opponent,
                    ) && (
                      <option value={editing.opponent}>
                        {editing.opponent} · not listed
                      </option>
                    )}
                  {leagueTeams.map((team) => (
                    <option key={team.id}>{team.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  maxLength={100}
                  value={editing.opponent}
                  onChange={(e) =>
                    setEditing({ ...editing, opponent: e.target.value })
                  }
                />
              )}
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
              <span>
                Kickoff ·{" "}
                {season?.timeZone && season.timeZone !== "America/New_York"
                  ? season.timeZone.replaceAll("_", " ")
                  : "New York time"}
              </span>
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
            {fixtures.some((m) => m.id === editing.id) && (
              <div className="fixture-remove-zone">
                <RemoveFixtureButton
                  match={editing}
                  disabled={busy}
                  onRemoved={() => setEditing(null)}
                />
              </div>
            )}
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
  const { seasonId } = usePrototype();
  return <SeasonRosterManagement key={seasonId} />;
}
function SeasonRosterManagement() {
  const {
      players,
      roster,
      seasonId,
      seasons,
      savePlayer,
      setNotice,
      live,
      refresh,
    } = usePrototype(),
    [editing, setEditing] = useState<Player | null>(null),
    [directoryOpen, setDirectoryOpen] = useState(false),
    [directoryQuery, setDirectoryQuery] = useState(""),
    [selectedPlayerId, setSelectedPlayerId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seasonPlayerIds = new Set(
    roster
      .filter((entry) => entry.seasonId === seasonId)
      .map((entry) => entry.playerId),
  );
  const seasonPlayers = players.filter((player) =>
    seasonPlayerIds.has(player.id),
  );
  const season = seasons.find((entry) => entry.id === seasonId);
  const directoryPlayers = players
    .filter((player) => !seasonPlayerIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const matchingPlayers = directoryPlayers.filter((player) =>
    player.name
      .toLocaleLowerCase()
      .includes(directoryQuery.trim().toLocaleLowerCase()),
  );
  const selectedPlayer = matchingPlayers.find(
    (player) => player.id === selectedPlayerId,
  );
  async function addKnownPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !selectedPlayer) return;
    setBusy(true);
    setError("");
    try {
      await savePlayer(selectedPlayer);
      setSelectedPlayerId("");
      setDirectoryQuery("");
      setNotice(
        `${selectedPlayer.name} added to ${season?.name || "the season roster"}.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not add this player to the roster.",
      );
    } finally {
      setBusy(false);
    }
  }
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
          <div className="roster-add-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              aria-expanded={directoryOpen}
              aria-controls="roster-directory-picker"
              onClick={() => {
                setEditing(null);
                setError("");
                setDirectoryQuery("");
                setSelectedPlayerId("");
                setDirectoryOpen(true);
              }}
            >
              <UserPlus size={16} />
              Add from directory
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setDirectoryOpen(false);
                setError("");
                setEditing(
                  withEditableDetails({
                    id: crypto.randomUUID(),
                    name: "",
                    number: 0,
                    position: "Midfielder",
                    initials: "FC",
                    hometown: "",
                    bio: "",
                    isPublic: false,
                  }),
                );
              }}
            >
              <Plus size={16} />
              Add player
            </button>
          </div>
          <div className="management-list">
            {seasonPlayers.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => {
                  setDirectoryOpen(false);
                  setEditing(withEditableDetails(p));
                  setError("");
                }}
              >
                <span>
                  <strong>
                    #{p.number} {p.name}
                  </strong>
                  <small>
                    On this season’s roster ·{" "}
                    {p.isPublic === false
                      ? "Private profile"
                      : "Public profile"}
                  </small>
                </span>
                <span>Edit</span>
              </button>
            ))}
            {!seasonPlayers.length && (
              <p className="help-text">
                No players on this season’s roster yet. Add a player to build
                the squad.
              </p>
            )}
          </div>
        </div>
        {directoryOpen ? (
          <form
            id="roster-directory-picker"
            className="management-form roster-directory-form"
            aria-label="Add an existing player"
            onSubmit={addKnownPlayer}
          >
            <span className="eyebrow">CLUB DIRECTORY</span>
            <h2>A familiar face.</h2>
            <p className="help-text">
              Add a known player to {season?.name || "this season"}. Their
              existing profile and past appearances stay together.
            </p>
            {directoryPlayers.length ? (
              <>
                <label className="form-field">
                  <span>Search directory</span>
                  <input
                    type="search"
                    autoFocus
                    placeholder="Search by player name"
                    value={directoryQuery}
                    disabled={busy}
                    onChange={(e) => {
                      setDirectoryQuery(e.target.value);
                      setSelectedPlayerId("");
                      setError("");
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Known player</span>
                  <select
                    required
                    value={selectedPlayerId}
                    disabled={busy || !matchingPlayers.length}
                    onChange={(e) => {
                      setSelectedPlayerId(e.target.value);
                      setError("");
                    }}
                  >
                    <option value="">Choose a player</option>
                    {matchingPlayers.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name} · #{player.number} ·{" "}
                        {positionGroupLabel(player)}
                      </option>
                    ))}
                  </select>
                </label>
                {!matchingPlayers.length && (
                  <p className="help-text" role="status">
                    No players match this search. Try another name.
                  </p>
                )}
                {selectedPlayer && (
                  <div className="roster-directory-preview">
                    <strong>{selectedPlayer.name}</strong>
                    <span>
                      #{selectedPlayer.number} ·{" "}
                      {positionGroupLabel(selectedPlayer)} ·{" "}
                      {selectedPlayer.isPublic === false
                        ? "Private profile"
                        : "Public profile"}
                    </span>
                    <p>
                      {roster.some(
                        (entry) => entry.playerId === selectedPlayer.id,
                      )
                        ? "Previously on a season roster."
                        : "Not yet on a season roster."}
                    </p>
                  </div>
                )}
                <p className="help-text">
                  Players already on this season’s roster are excluded.
                </p>
              </>
            ) : (
              <p className="help-text" role="status">
                {players.length
                  ? "Every known player is already on this season’s roster."
                  : "The club directory is empty. Use Add player to create the first profile."}
              </p>
            )}
            {error && (
              <div role="alert" className="auth-error">
                <p>{error}</p>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void refresh()
                      .then(() => {
                        setSelectedPlayerId("");
                        setError("");
                      })
                      .catch(() =>
                        setError("Could not reload the directory. Try again."),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Reload directory
                </button>
              </div>
            )}
            <div className="button-row">
              <button className="button" disabled={busy || !selectedPlayer}>
                <UserPlus size={16} />
                {busy ? "Adding…" : "Add to season roster"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setDirectoryOpen(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : editing ? (
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
            <PositionGroupFields player={editing} onChange={setEditing} />
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
            <PlayerDetailFields player={editing} onChange={setEditing} />
            <p className="help-text">
              Saving also adds this player to the selected season. Keep a
              profile private until its details are approved.
            </p>
            {error && (
              <div role="alert" className="auth-error">
                <p>{error}</p>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    void refresh()
                      .then(() => {
                        setEditing(null);
                        setError("");
                      })
                      .catch(() =>
                        setError("Could not reload players. Try again."),
                      );
                  }}
                >
                  Reload players
                </button>
              </div>
            )}
            <div className="button-row">
              <button disabled={busy} className="button">
                <Save size={15} />
                {busy ? "Saving…" : "Save player"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="management-empty">
            <h2>Everyone has a part to play.</h2>
            <p>
              Choose a teammate, add someone from the club directory, or create
              a new player for this season.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
