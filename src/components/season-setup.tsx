"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import {
  createClubSeason,
  previewSeasonImport,
} from "@/lib/supabase/repository";
import type {
  SeasonImportPreview,
  SeasonImportTeamChoice,
  SeasonSetupInput,
} from "@/lib/types";

const terms = ["Winter", "Spring", "Summer", "Fall"] as const;
const teamNames = (text: string) =>
  text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
export function SeasonSetup({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const { players, refresh, setSeasonId, setNotice, live } = usePrototype();
  const [input, setInput] = useState<SeasonSetupInput | null>(null);
  const [step, setStep] = useState(1),
    [link, setLink] = useState(""),
    [teamId, setTeamId] = useState(""),
    [teamsText, setTeamsText] = useState(""),
    [rosterQuery, setRosterQuery] = useState("");
  const [preview, setPreview] = useState<SeasonImportPreview | null>(null),
    [choices, setChoices] = useState<SeasonImportTeamChoice | null>(null);
  const [busy, setBusy] = useState(false),
    [loadingPreview, setLoadingPreview] = useState(false),
    [error, setError] = useState(""),
    [savedId, setSavedId] = useState("");
  const request = useRef(0);
  function start() {
    onOpenChange?.(true);
    const year = Number(
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        timeZone: "America/New_York",
      }).format(new Date()),
    );
    request.current++;
    setInput({
      id: crypto.randomUUID(),
      source: "manual",
      year,
      term: "Fall",
      name: "",
      teamName: "",
      competition: "",
      location: "",
      leagueWebsite: "",
      timeZone: "America/New_York",
      format: "7v7",
      completed: false,
      manualStandings: false,
      teams: [],
      rosterPlayerIds: [],
    });
    setStep(1);
    setError("");
    setPreview(null);
    setChoices(null);
    setLink("");
    setTeamId("");
    setTeamsText("");
    setRosterQuery("");
    setSavedId("");
    setLoadingPreview(false);
  }
  function update(change: Partial<SeasonSetupInput>) {
    if (!input) return;
    if (change.source || change.timeZone) {
      request.current++;
      setPreview(null);
      setChoices(null);
      setTeamId("");
      setLoadingPreview(false);
    }
    setInput({ ...input, ...change });
    setError("");
  }
  async function loadPreview() {
    if (!input) return;
    const current = ++request.current;
    setLoadingPreview(true);
    setError("");
    setPreview(null);
    try {
      const result = await previewSeasonImport(link, teamId, input.timeZone);
      if (current !== request.current) return;
      if (result.phase === "choose-team") setChoices(result);
      else {
        setPreview(result);
        setChoices(null);
        setInput(
          (previous) =>
            previous && {
              ...previous,
              teamName: previous.teamName || result.teamName,
              leagueWebsite: previous.leagueWebsite || result.source.origin,
            },
        );
      }
    } catch (e) {
      if (current === request.current)
        setError(
          e instanceof Error ? e.message : "Could not load the season preview.",
        );
    } finally {
      if (current === request.current) setLoadingPreview(false);
    }
  }
  function next(event: React.FormEvent) {
    event.preventDefault();
    if (!input) return;
    setError("");
    if (step >= 3) {
      void save();
      return;
    }
    if (step === 2) {
      if (input.source === "leagueapps" && !preview) {
        setError("Preview the league’s results before continuing.");
        return;
      }
      const teams = teamNames(teamsText);
      if (input.source === "manual" && input.manualStandings && !teams.length) {
        setError("Enter at least one other league team.");
        return;
      }
      const names = [input.teamName, ...teams].map((name) =>
        name.trim().toLocaleLowerCase(),
      );
      if (
        input.source === "manual" &&
        (new Set(names).size !== names.length ||
          teams.some((name) => name.length > 100))
      ) {
        setError(
          "Use distinct team names of 100 characters or fewer, including our team.",
        );
        return;
      }
      setInput({ ...input, teams: input.manualStandings ? teams : [] });
    }
    setStep((value) => value + 1);
  }
  async function finishSelection(id: string) {
    await refresh();
    setSeasonId(id);
    setNotice("Season saved. The season selector now shows your new season.");
  }
  async function save() {
    if (!input || busy) return;
    setBusy(true);
    setError("");
    try {
      const id = await createClubSeason(input, preview?.previewId);
      setSavedId(id);
      await finishSelection(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the season.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section season-setup" aria-label="Season setup">
      <div className="season-setup-heading">
        <div>
          <span className="eyebrow">ONE CLUB / EVERY CHAPTER</span>
          <h1>Your seasons, together.</h1>
          <p>
            Create a season manually or bring in a LeagueApps team’s results.
            Use the season selector above to explore each chapter.
          </p>
        </div>
        {!input && (
          <button className="button" onClick={start} disabled={!live}>
            <Plus size={17} /> Add a season
          </button>
        )}
      </div>
      {!live && (
        <p className="help-text">
          Season creation is available in the connected club.
        </p>
      )}
      {input &&
        (savedId ? (
          <div className="season-saved" role="status">
            <CheckCircle2 size={26} />
            <h2>Your season is saved.</h2>
            <p>
              {input.term} {input.year} · {input.teamName || preview?.teamName}
            </p>
            {error ? (
              <>
                <p className="form-errors">
                  {error} The season was saved; reload it to continue.
                </p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void finishSelection(savedId)
                      .then(() => setError(""))
                      .catch(() => setError("Could not load the saved season."))
                      .finally(() => setBusy(false));
                  }}
                >
                  Reload saved season
                </button>
              </>
            ) : (
              <div className="button-row">
                <Link
                  className="button"
                  href={
                    input.source === "manual"
                      ? "/captain/fixtures/"
                      : "/captain/stats/"
                  }
                >
                  {input.source === "manual"
                    ? "Add fixtures and results"
                    : "Add player stats"}
                </Link>
                <Link className="button secondary" href="/">
                  View season
                </Link>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setInput(null);
                    onOpenChange?.(false);
                  }}
                >
                  Season settings
                </button>
              </div>
            )}
          </div>
        ) : (
          <form className="season-setup-form" onSubmit={next}>
            <ol
              className="season-setup-progress"
              aria-label="Season setup progress"
            >
              {["Season details", "Results & roster", "Review & save"].map(
                (label, index) => (
                  <li
                    key={label}
                    aria-current={step === index + 1 ? "step" : undefined}
                    className={step >= index + 1 ? "active" : ""}
                  >
                    {label}
                  </li>
                ),
              )}
            </ol>
            <fieldset disabled={busy}>
              {step === 1 && (
                <>
                  <h2>Start with the season.</h2>
                  <div
                    className="season-source-options"
                    role="group"
                    aria-label="Season source"
                  >
                    {[
                      [
                        "manual",
                        "Enter manually",
                        "Add fixtures and player stats yourself. Optionally build a league table.",
                      ],
                      [
                        "leagueapps",
                        "Import from LeagueApps",
                        "Preview fixtures, scores and the official standings from a league link.",
                      ],
                    ].map(([value, title, detail]) => (
                      <label
                        key={value}
                        className={input.source === value ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name="season-source"
                          value={value}
                          checked={input.source === value}
                          onChange={() =>
                            update({
                              source: value as SeasonSetupInput["source"],
                            })
                          }
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{detail}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="season-setup-fields">
                    <label className="form-field">
                      <span>Year</span>
                      <input
                        required
                        type="number"
                        min={1900}
                        max={2100}
                        value={input.year}
                        onChange={(e) =>
                          update({
                            year: e.target.valueAsNumber,
                            completed:
                              e.target.valueAsNumber < new Date().getFullYear(),
                          })
                        }
                      />
                    </label>
                    <label className="form-field">
                      <span>Season</span>
                      <select
                        value={input.term}
                        onChange={(e) =>
                          update({
                            term: e.target.value as SeasonSetupInput["term"],
                          })
                        }
                      >
                        {terms.map((term) => (
                          <option key={term}>{term}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>
                        Team name this season
                        {input.source === "leagueapps"
                          ? " · optional until preview"
                          : ""}
                      </span>
                      <input
                        required={input.source === "manual"}
                        maxLength={100}
                        value={input.teamName}
                        onChange={(e) => update({ teamName: e.target.value })}
                        placeholder="The name the team played under"
                      />
                    </label>
                    <label className="form-field">
                      <span>League name</span>
                      <input
                        required
                        maxLength={150}
                        value={input.competition}
                        onChange={(e) =>
                          update({ competition: e.target.value })
                        }
                        placeholder="e.g. NYC Soccer or NYC Footy"
                      />
                    </label>
                    <label className="form-field">
                      <span>League location</span>
                      <input
                        required
                        maxLength={150}
                        value={input.location}
                        onChange={(e) => update({ location: e.target.value })}
                        placeholder="e.g. Brooklyn, New York"
                      />
                    </label>
                    <label className="form-field">
                      <span>League website · optional</span>
                      <input
                        type="url"
                        maxLength={500}
                        value={input.leagueWebsite}
                        onChange={(e) =>
                          update({ leagueWebsite: e.target.value })
                        }
                        placeholder="https://…"
                      />
                    </label>
                    <label className="form-field">
                      <span>Playing format</span>
                      <select
                        value={input.format}
                        onChange={(e) => update({ format: e.target.value })}
                      >
                        {["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"].map(
                          (format) => (
                            <option key={format}>{format}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>League’s local time zone</span>
                      <select
                        value={input.timeZone}
                        onChange={(e) => update({ timeZone: e.target.value })}
                      >
                        {[
                          ["America/New_York", "Eastern — New York"],
                          ["America/Chicago", "Central — Chicago"],
                          ["America/Denver", "Mountain — Denver"],
                          ["America/Los_Angeles", "Pacific — Los Angeles"],
                          ["Europe/London", "United Kingdom — London"],
                          ["UTC", "UTC"],
                        ].map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field season-wide">
                      <span>Season label · optional</span>
                      <input
                        maxLength={150}
                        value={input.name}
                        onChange={(e) => update({ name: e.target.value })}
                        placeholder={`${input.term} ${input.year} · ${input.competition || "League name"}`}
                      />
                    </label>
                  </div>
                  <label className="season-check">
                    <input
                      type="checkbox"
                      checked={input.completed}
                      onChange={(e) => update({ completed: e.target.checked })}
                    />
                    <span>This season is complete</span>
                  </label>
                  <p className="season-help">
                    Completed seasons remain editable. LeagueApps history stays
                    archived until a captain requests a refresh.
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <h2>
                    {input.source === "manual"
                      ? "Build the record at your pace."
                      : "Preview the league record."}
                  </h2>
                  {input.source === "manual" ? (
                    <>
                      <label className="form-field">
                        <span>
                          Construct league standings from entered results?
                        </span>
                        <select
                          aria-label="Construct manual standings"
                          value={input.manualStandings ? "yes" : "no"}
                          onChange={(e) =>
                            update({
                              manualStandings: e.target.value === "yes",
                            })
                          }
                        >
                          <option value="no">
                            No — show our team record only
                          </option>
                          <option value="yes">
                            Yes — build a league table
                          </option>
                        </select>
                      </label>
                      <p className="season-help">
                        Add our games through Fixtures and Results as usual.
                        Standings use published regular-season results: 3 points
                        for a win, 1 for a draw, then goal difference and goals
                        scored. Playoffs and removed games are excluded.
                      </p>
                      {input.manualStandings && (
                        <>
                          <label className="form-field">
                            <span>
                              Other teams in this league · one per line
                            </span>
                            <textarea
                              required
                              rows={5}
                              maxLength={10000}
                              value={teamsText}
                              onChange={(e) => setTeamsText(e.target.value)}
                              placeholder={"Parkside United\nEast River FC"}
                            />
                          </label>
                          <p className="season-help">
                            {input.teamName} is included automatically. You can
                            add results between other teams in Season settings.
                            The table will use whatever has been entered and
                            will be labelled as a partial league record.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="form-field">
                        <span>LeagueApps team, schedule or standings link</span>
                        <input
                          required
                          type="url"
                          value={link}
                          maxLength={1000}
                          onChange={(e) => {
                            request.current++;
                            setLink(e.target.value);
                            setTeamId("");
                            setPreview(null);
                            setChoices(null);
                            setLoadingPreview(false);
                            setError("");
                          }}
                          placeholder="https://your-league.leagueapps.com/leagues/…"
                        />
                      </label>
                      <p className="season-help">
                        A team-page link selects your team directly. A schedule
                        or standings link lets you choose the team next. This
                        works across LeagueApps league websites; no calendar
                        subscription is used.
                      </p>
                      {choices && (
                        <label className="form-field">
                          <span>Choose your LeagueApps team</span>
                          <select
                            required
                            value={teamId}
                            onChange={(e) => {
                              setTeamId(e.target.value);
                              setPreview(null);
                            }}
                          >
                            <option value="">Select a team</option>
                            {choices.teams.map((team) => (
                              <option key={team.teamId} value={team.teamId}>
                                {team.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <button
                        className="button secondary"
                        type="button"
                        disabled={
                          loadingPreview || !link || (!!choices && !teamId)
                        }
                        onClick={() => void loadPreview()}
                      >
                        {loadingPreview
                          ? "Reading league pages…"
                          : preview
                            ? "Refresh preview"
                            : choices
                              ? "Preview this team"
                              : "Read league link"}
                      </button>
                      {preview && (
                        <div className="season-import-preview" role="status">
                          <h3>{preview.teamName}</h3>
                          <p>
                            {preview.games.length} fixture
                            {preview.games.length === 1 ? "" : "s"} ·{" "}
                            {preview.games.filter((game) => game.score).length}{" "}
                            final result
                            {preview.games.filter((game) => game.score)
                              .length === 1
                              ? ""
                              : "s"}{" "}
                            · {preview.standings.length} league teams
                          </p>
                          <p>
                            Player appearances, goals and assists remain
                            unrecorded until you add them. Review playoff
                            designations after importing.
                          </p>
                          <div className="season-preview-table">
                            <table>
                              <caption>Fixtures to import</caption>
                              <thead>
                                <tr>
                                  <th>Opponent</th>
                                  <th>Result / status</th>
                                  <th>Kickoff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.games.map((game) => (
                                  <tr key={game.externalId}>
                                    <th scope="row">{game.opponent}</th>
                                    <td>
                                      {game.score
                                        ? `${game.score.home}–${game.score.away}${game.score.basis === "forfeit" ? " · forfeit" : ""}`
                                        : game.status}
                                    </td>
                                    <td>
                                      {game.kickoff
                                        ? new Intl.DateTimeFormat("en-US", {
                                            timeZone: "America/New_York",
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit",
                                          }).format(new Date(game.kickoff)) +
                                          " ET"
                                        : "TBD"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <details className="season-preview-standings">
                            <summary>Preview official standings</summary>
                            <div className="season-preview-table">
                              <table>
                                <caption>
                                  League standings in source order
                                </caption>
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>Team</th>
                                    <th>Played</th>
                                    <th>Goal difference</th>
                                    <th>Points</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {preview.standings.map((row) => (
                                    <tr key={row.teamId}>
                                      <td>{row.position}</td>
                                      <th scope="row">{row.name}</th>
                                      <td>{row.played}</td>
                                      <td>{row.difference}</td>
                                      <td>{row.points}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      )}
                    </>
                  )}
                  <div className="season-roster-choice">
                    <h3>Choose this season’s roster · optional</h3>
                    <p className="season-help">
                      Reuse existing player identities across seasons. Leave
                      guests off the roster and add them to individual games.
                      You can adjust the roster later.
                    </p>
                    <label className="form-field">
                      <span>Find existing club players</span>
                      <input
                        value={rosterQuery}
                        onChange={(e) => setRosterQuery(e.target.value)}
                        maxLength={100}
                        placeholder="Search the private club directory"
                      />
                    </label>
                    <p className="season-help">
                      {input.rosterPlayerIds.length} selected
                    </p>
                    <div className="season-roster-options">
                      {players
                        .filter((player) =>
                          player.name
                            .toLocaleLowerCase()
                            .includes(rosterQuery.trim().toLocaleLowerCase()),
                        )
                        .map((player) => (
                          <label key={player.id}>
                            <input
                              type="checkbox"
                              checked={input.rosterPlayerIds.includes(
                                player.id,
                              )}
                              onChange={(e) =>
                                update({
                                  rosterPlayerIds: e.target.checked
                                    ? [...input.rosterPlayerIds, player.id]
                                    : input.rosterPlayerIds.filter(
                                        (id) => id !== player.id,
                                      ),
                                })
                              }
                            />
                            <span>{player.name}</span>
                          </label>
                        ))}
                      {!players.length && (
                        <p>
                          No existing players yet. Add them through Roster after
                          saving.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
              {step === 3 && (
                <div className="season-review">
                  <h2>A new chapter, ready to save.</h2>
                  <dl>
                    {[
                      [
                        "Season",
                        input.name ||
                          `${input.term} ${input.year} · ${input.competition}`,
                      ],
                      ["Team", input.teamName || preview?.teamName || ""],
                      ["League", `${input.competition} · ${input.location}`],
                      [
                        "Source",
                        input.source === "manual"
                          ? "Manual entry"
                          : `LeagueApps · ${preview?.source.origin}`,
                      ],
                      [
                        "Standings",
                        input.source === "leagueapps"
                          ? "Official league table"
                          : input.manualStandings
                            ? `${input.teams.length + 1} teams · built from entered results`
                            : "Off — our team record only",
                      ],
                      [
                        "Fixtures",
                        preview
                          ? `${preview.games.length} fixtures, ${preview.games.filter((game) => game.score).length} final results`
                          : "Add through Fixtures after saving",
                      ],
                      [
                        "Roster",
                        `${input.rosterPlayerIds.length} existing player${input.rosterPlayerIds.length === 1 ? "" : "s"} selected`,
                      ],
                      ["Status", input.completed ? "Complete" : "In progress"],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="season-help">
                    Saving adds this season to the selector for the whole club.
                    Player profiles keep their existing privacy settings.
                  </p>
                </div>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="form-errors">
                {error}
              </p>
            )}
            <div className="button-row season-setup-actions">
              {step > 1 && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || loadingPreview}
                  onClick={() => {
                    setStep((value) => value - 1);
                    setError("");
                  }}
                >
                  Back
                </button>
              )}
              {step < 3 ? (
                <button className="button" disabled={busy || loadingPreview}>
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "Saving season…" : "Save season"}
                </button>
              )}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  request.current++;
                  setInput(null);
                  onOpenChange?.(false);
                }}
              >
                Cancel setup
              </button>
            </div>
          </form>
        ))}
    </section>
  );
}
