"use client";
import { useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import { PageHeading } from "./season-pages";
import { HomeSeasonFinish } from "./season-finish";
import { ordinal } from "@/features/matches/season-finish";
import type { LeagueConnection, Match, Season } from "@/lib/types";
import { SeasonSetup } from "./season-setup";
import { ManualSeasonStandings } from "./manual-season-standings";

export function CaptainSeason() {
  const [settingUp, setSettingUp] = useState(false);
  const {
    seasons,
    seasonId,
    matches,
    league,
    setSeasonComplete,
    setNotice,
    live,
  } = usePrototype();
  const season = seasons.find((s) => s.id === seasonId);
  // Mount a new form for each season/revision; background refreshes cannot
  // overwrite an unsaved choice unless the saved season status changed.
  return (
    <>
      <SeasonSetup onOpenChange={setSettingUp} />
      {!settingUp && season && (
        <SeasonForm
          key={`${season.id}:${season.revision ?? 0}`}
          season={season}
          matches={matches}
          league={league}
          save={setSeasonComplete}
          notify={setNotice}
        />
      )}
      {!settingUp && live && season?.source === "manual" && (
        <ManualSeasonStandings
          key={`${season.id}:${season.settingsRevision || 0}`}
          season={season}
        />
      )}
    </>
  );
}

function SeasonForm({
  season,
  matches,
  league,
  save,
  notify,
}: {
  season: Season;
  matches: Match[];
  league?: LeagueConnection;
  save: (id: string, revision: number, completed: boolean) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [completed, setCompleted] = useState(!!season.completed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownStanding =
    league?.seasonId === season.id
      ? league.standings.find((s) => s.teamId === league.teamId)
      : undefined;
  const placing =
    league?.kind === "manual" && !ownStanding?.played
      ? undefined
      : ownStanding?.position;
  const preview = {
    ...season,
    completed,
    finalPosition: season.completed ? season.finalPosition : placing,
  };
  return (
    <div className="section page-section season-management">
      <PageHeading
        eyebrow="THE CAPTAIN’S CORNER"
        title="Close a chapter in mauve."
        description="Mark the season complete when the team’s campaign is finished."
      />
      <form
        className="season-status-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await save(season.id, season.revision ?? 0, completed);
            notify(
              completed
                ? "Season marked complete. Home now shows the season finish."
                : "Season reopened.",
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save season status.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="season-status-heading">
          <h2>{season.name}</h2>
          <span className="pill">
            {season.completed ? "Complete" : "In progress"}
          </span>
        </div>
        <p>
          {season.teamName || "Mauve FC"} · {season.competition}
          {season.location ? ` · ${season.location}` : ""}
        </p>
        {season.leagueWebsite && (
          <a
            className="text-link"
            href={season.leagueWebsite}
            target="_blank"
            rel="noreferrer"
          >
            League website
          </a>
        )}
        <label className="playoff-toggle">
          <input
            type="checkbox"
            checked={completed}
            disabled={busy}
            onChange={(e) => setCompleted(e.target.checked)}
          />
          <span>Season complete</span>
        </label>
        <p>
          Home will show the championship, playoff finish or final league
          placing. You can still correct results and player stats, or reopen the
          season.
        </p>
        <p>
          {season.completed
            ? season.finalPosition
              ? `Saved league placing: ${ordinal(season.finalPosition)}.`
              : "No recorded league placing is available for this completed season."
            : placing
              ? `Current league placing: ${ordinal(placing)}. It will be saved when you complete the season.`
              : "No verified league placing is available. The season can still be marked complete without inventing a position."}
        </p>
        {error && (
          <p role="alert" className="form-errors">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="button"
          disabled={busy || completed === !!season.completed}
        >
          {busy ? (
            "Saving…"
          ) : (
            <>
              <Save size={17} /> Save season status
            </>
          )}
        </button>
      </form>
      {completed && (
        <div className="season-finish-preview">
          <p className="eyebrow">
            <CheckCircle2 size={16} /> HOME PREVIEW
          </p>
          <HomeSeasonFinish season={preview} matches={matches} />
        </div>
      )}
    </div>
  );
}
