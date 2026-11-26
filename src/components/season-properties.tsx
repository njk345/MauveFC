"use client";
import { useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import { editableSeasonDetails } from "@/features/seasons/details";
import type { Season, SeasonDetails } from "@/lib/types";

export function SeasonPropertiesForm({ season }: { season: Season }) {
  const { saveSeasonDetails, setNotice, refresh } = usePrototype();
  const [input, setInput] = useState(() => editableSeasonDetails(season));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function update(change: Partial<SeasonDetails>) {
    setInput({ ...input, ...change });
    setError("");
  }
  return (
    <form
      className="season-properties-form"
      aria-label="Season details"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(
            new Date(0),
          );
        } catch {
          setError("Enter a valid IANA time zone, such as America/New_York.");
          return;
        }
        setBusy(true);
        try {
          await saveSeasonDetails(season, input);
          setNotice("Season details saved.");
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not save season details.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Season details</h2>
      <p>Keep the league, team and season information up to date.</p>
      <fieldset disabled={busy} className="season-properties-fields">
        <label className="form-field">
          <span>League name</span>
          <input
            required
            maxLength={150}
            value={input.competition}
            onChange={(e) => update({ competition: e.target.value })}
          />
        </label>
        <label className="form-field">
          <span>League location · optional</span>
          <input
            maxLength={150}
            value={input.location}
            onChange={(e) => update({ location: e.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Team name for this season</span>
          <input
            required
            maxLength={100}
            value={input.teamName}
            onChange={(e) => update({ teamName: e.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Playing format</span>
          <input
            required
            maxLength={60}
            placeholder="7v7 coed"
            value={input.format}
            onChange={(e) => update({ format: e.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Year</span>
          <input
            required
            type="number"
            min={1900}
            max={2100}
            value={input.year}
            onChange={(e) => update({ year: e.target.valueAsNumber })}
          />
        </label>
        <label className="form-field">
          <span>Season of year</span>
          <select
            value={input.term}
            onChange={(e) =>
              update({ term: e.target.value as SeasonDetails["term"] })
            }
          >
            {["Winter", "Spring", "Summer", "Fall"].map((term) => (
              <option key={term}>{term}</option>
            ))}
          </select>
        </label>
        <label className="form-field season-properties-wide">
          <span>Season label · optional</span>
          <input
            maxLength={180}
            placeholder={`${input.term} ${input.year}`}
            value={input.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          <small>
            Leave blank to use the season and year. The selector also includes
            the league name.
          </small>
        </label>
        <label className="form-field">
          <span>Time zone</span>
          <input
            required
            list="season-time-zones"
            value={input.timeZone}
            onChange={(e) => update({ timeZone: e.target.value })}
          />
          <datalist id="season-time-zones">
            {[
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
              "Europe/London",
              "Etc/UTC",
            ].map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <small>
            Used for display and future league refreshes. Saving does not
            reschedule fixtures.
          </small>
        </label>
        <label className="form-field">
          <span>League website · optional</span>
          <input
            type="url"
            maxLength={500}
            value={input.leagueWebsite}
            onChange={(e) => update({ leagueWebsite: e.target.value })}
          />
        </label>
      </fieldset>
      {error && (
        <div className="form-errors" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void refresh()
                .then(() => {
                  setInput(editableSeasonDetails(season));
                  setError("");
                })
                .catch(() =>
                  setError("Could not reload season details. Try again."),
                )
                .finally(() => setBusy(false));
            }}
          >
            Reload season details
          </button>
        </div>
      )}
      <button className="button" disabled={busy}>
        <Save size={17} />
        {busy ? "Saving…" : "Save season details"}
      </button>
    </form>
  );
}

export function SeasonDeletePanel({ season }: { season: Season }) {
  const { deleteSeason, setNotice, matches, removedFixtures } = usePrototype();
  const [confirming, setConfirming] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const count = new Set(
    [...matches, ...removedFixtures]
      .filter((match) => match.seasonId === season.id)
      .map((match) => match.id),
  ).size;
  return (
    <section
      className="section season-delete-section"
      aria-label="Delete season"
    >
      <div className="season-delete-panel">
        <h2>Delete this season</h2>
        <p>
          Remove {season.name} and its {count}{" "}
          {count === 1 ? "fixture" : "fixtures"}, including results, player
          stats, lineups and RSVPs. Its league connection will also be removed.
        </p>
        <p>
          <strong>Every player stays in the club directory</strong>, including
          players who only appeared in this season. Profiles, contact details
          and accounts are kept.
        </p>
        {!confirming ? (
          <button
            type="button"
            className="button season-delete-button"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={17} />
            Delete season
          </button>
        ) : (
          <form
            aria-label="Confirm season deletion"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || confirmation.trim() !== season.name) return;
              setBusy(true);
              setError("");
              try {
                await deleteSeason(season, confirmation);
                setNotice(
                  `${season.name} deleted. Player directory records kept.`,
                );
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not delete this season.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              This permanently removes the season from statistics and player
              appearance history.
            </p>
            <label className="form-field">
              <span>Type {season.name} to confirm</span>
              <input
                required
                autoComplete="off"
                value={confirmation}
                disabled={busy}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            {error && (
              <p className="form-errors" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button
                className="button season-delete-button"
                disabled={busy || confirmation.trim() !== season.name}
              >
                {busy ? "Deleting…" : "Permanently delete season"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setConfirmation("");
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
