"use client";
import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import {
  configureManualStandings,
  readManualLeagueResults,
  writeManualLeagueResult,
} from "@/lib/supabase/repository";
import type { ManualLeagueResult, Season } from "@/lib/types";

export function ManualSeasonStandings({ season }: { season: Season }) {
  const { refresh, setNotice } = usePrototype();
  const [enabled, setEnabled] = useState(!!season.manualStandings),
    [newTeams, setNewTeams] = useState("");
  const [results, setResults] = useState<ManualLeagueResult[] | null>(null),
    [editing, setEditing] = useState<ManualLeagueResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const teams = (season.leagueTeams || []).filter((team) => !team.isOurs);
  useEffect(() => {
    let active = true;
    setResults(null);
    setError("");
    void readManualLeagueResults(season.id).then(
      (data) => {
        if (active) setResults(data);
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [season.id, reload]);
  async function configure(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await configureManualStandings(
        season,
        enabled,
        newTeams
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
      );
      await refresh();
      setNewTeams("");
      setNotice("Manual standings settings saved.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save standings settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  function add() {
    setEditing({
      id: crypto.randomUUID(),
      seasonId: season.id,
      homeTeamId: teams[0]?.id || "",
      awayTeamId: teams[1]?.id || "",
      home: 0,
      away: 0,
      playedOn: "",
      decision: "regulation",
      penaltyOutcome: null,
      revision: 0,
    });
    setError("");
  }
  async function save(result: ManualLeagueResult, remove = false) {
    if (busy) return;
    if (!remove && result.homeTeamId === result.awayTeamId) {
      setError("Choose two different league teams.");
      return;
    }
    if (
      !remove &&
      result.decision === "penalties" &&
      result.home !== result.away
    ) {
      setError(
        "Enter the tied match score before choosing the penalty shootout winner.",
      );
      return;
    }
    if (
      remove &&
      !window.confirm(
        "Remove this other-team result from the manual league table?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await writeManualLeagueResult(result, remove);
      setResults(await readManualLeagueResults(season.id));
      await refresh();
      setEditing(null);
      setNotice(
        remove
          ? "League result removed; standings updated."
          : "League result saved; standings updated.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the league result.",
      );
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string) =>
    season.leagueTeams?.find((team) => team.id === id)?.name || "League team";
  return (
    <section
      className="section manual-season-panel"
      aria-label="Manual league standings"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">{season.name} / LEAGUE RECORD</span>
          <h2>Your league, as recorded.</h2>
          <p>
            Our fixtures and player stats stay in the usual Fixtures and Results
            tools. Add other teams’ regular-season games here to fill in the
            league table.
          </p>
        </div>
      </div>
      <div className="manual-season-grid">
        <form className="manual-standings-settings" onSubmit={configure}>
          <h3>Standings settings</h3>
          <label className="form-field">
            <span>Construct standings from entered results?</span>
            <select
              value={enabled ? "yes" : "no"}
              onChange={(e) => setEnabled(e.target.value === "yes")}
            >
              <option value="no">No — show our team record only</option>
              <option value="yes">Yes — build a league table</option>
            </select>
          </label>
          <div className="manual-league-team-list">
            <span className="small-text">League teams</span>
            <div className="directory-positions">
              {(season.leagueTeams || []).map((team) => (
                <span key={team.id}>
                  {team.name}
                  {team.isOurs ? " · our team" : ""}
                </span>
              ))}
            </div>
          </div>
          <label className="form-field">
            <span>Add league teams · one per line</span>
            <textarea
              rows={4}
              maxLength={10000}
              value={newTeams}
              onChange={(e) => setNewTeams(e.target.value)}
              placeholder="Enter additional team names"
            />
          </label>
          <p className="season-help">
            Use the same opponent names in our fixtures. Standings award 3
            points per win and 1 per draw, then sort by goal difference and
            goals scored. Games marked as playoffs do not affect the league
            table.
          </p>
          <button className="button secondary" disabled={busy}>
            <Save size={16} /> Save standings settings
          </button>
        </form>
        <div className="manual-league-games">
          <div className="manual-games-heading">
            <h3>Other teams’ results</h3>
            {season.manualStandings && (
              <button
                className="button secondary small"
                disabled={busy || teams.length < 2}
                onClick={add}
              >
                <Plus size={15} /> Add league result
              </button>
            )}
          </div>
          {!season.manualStandings ? (
            <p className="season-help">
              Manual standings are off. Enabling them preserves the fixtures and
              stats you have already entered.
            </p>
          ) : (
            <>
              {teams.length < 2 && (
                <p className="season-help">
                  Add at least two other league teams to record a game between
                  them.
                </p>
              )}
              {!results && !error && (
                <p role="status">Loading league results…</p>
              )}
              {results?.length === 0 && (
                <p className="season-help">
                  No other-team results entered yet. The table still includes
                  our published regular-season games against known league teams.
                </p>
              )}
              <div className="manual-league-result-list">
                {results?.map((result) => (
                  <article key={result.id}>
                    <div>
                      <strong>
                        {name(result.homeTeamId)} {result.home}–{result.away}{" "}
                        {name(result.awayTeamId)}
                      </strong>
                      <small>
                        {result.playedOn || "Date not recorded"}
                        {result.decision === "penalties"
                          ? ` · penalties won by ${name(result.penaltyOutcome === "W" ? result.homeTeamId : result.awayTeamId)}`
                          : result.decision === "overtime"
                            ? " · after overtime"
                            : ""}
                      </small>
                    </div>
                    <div className="button-row">
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => {
                          setEditing(result);
                          setError("");
                        }}
                      >
                        Edit league result
                      </button>
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => void save(result, true)}
                      >
                        Remove league result
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {season.manualStandings && editing && (
        <form
          className="manual-league-result-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing);
          }}
        >
          <h3>
            {editing.revision ? "Edit league result" : "New league result"}
          </h3>
          <p className="season-help">
            Only other teams belong here. These games affect the manual
            standings and never enter our club’s schedule, results or player
            stats.
          </p>
          <fieldset disabled={busy}>
            <div className="season-setup-fields">
              <label className="form-field">
                <span>Home team</span>
                <select
                  required
                  value={editing.homeTeamId}
                  onChange={(e) =>
                    setEditing({ ...editing, homeTeamId: e.target.value })
                  }
                >
                  <option value="">Choose team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Away team</span>
                <select
                  required
                  value={editing.awayTeamId}
                  onChange={(e) =>
                    setEditing({ ...editing, awayTeamId: e.target.value })
                  }
                >
                  <option value="">Choose team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Home goals</span>
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  value={editing.home}
                  onChange={(e) =>
                    setEditing({ ...editing, home: e.target.valueAsNumber })
                  }
                />
              </label>
              <label className="form-field">
                <span>Away goals</span>
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  value={editing.away}
                  onChange={(e) =>
                    setEditing({ ...editing, away: e.target.valueAsNumber })
                  }
                />
              </label>
              <label className="form-field">
                <span>Date played · optional</span>
                <input
                  type="date"
                  value={editing.playedOn || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, playedOn: e.target.value })
                  }
                />
              </label>
              <label className="form-field">
                <span>Result decided in</span>
                <select
                  value={editing.decision}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      decision: e.target
                        .value as ManualLeagueResult["decision"],
                      penaltyOutcome:
                        e.target.value === "penalties" ? "W" : null,
                    })
                  }
                >
                  <option value="regulation">Regular time</option>
                  <option value="overtime">Overtime</option>
                  <option value="penalties">Penalties</option>
                </select>
              </label>
              {editing.decision === "penalties" && (
                <label className="form-field season-wide">
                  <span>Penalty shootout winner</span>
                  <select
                    value={editing.penaltyOutcome || "W"}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        penaltyOutcome: e.target.value as "W" | "L",
                      })
                    }
                  >
                    <option value="W">{name(editing.homeTeamId)}</option>
                    <option value="L">{name(editing.awayTeamId)}</option>
                  </select>
                  <small>
                    Enter the tied match score above; shootout kicks do not
                    count as goals.
                  </small>
                </label>
              )}
            </div>
          </fieldset>
          <div className="button-row">
            <button className="button" disabled={busy}>
              {busy ? "Saving…" : "Save league result"}
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
      )}
      {error && (
        <div role="alert" className="form-errors">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              setEditing(null);
              setReload((v) => v + 1);
              void refresh().catch(() =>
                setError("Could not reload season settings."),
              );
            }}
          >
            Reload league results
          </button>
        </div>
      )}
    </section>
  );
}
