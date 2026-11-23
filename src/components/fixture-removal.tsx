"use client";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { Match } from "@/lib/types";
import { date } from "@/lib/format";
import { usePrototype } from "./prototype-provider";
import { Modal } from "./modal";
import { ResultDecision } from "./result-decision";
import { PlayoffBadge } from "./playoff-celebration";

export function feedName(source: string) {
  if (source === "leagueapps") return "LeagueApps";
  return source.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function RemoveFixtureButton({
  match,
  disabled,
  onRemoved,
}: {
  match: Match;
  disabled?: boolean;
  onRemoved: () => void;
}) {
  const { removeFixture, setNotice } = usePrototype();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="text-link fixture-remove-link"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        <Trash2 size={16} /> Remove fixture
      </button>
      {open && (
        <Modal
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <section
            className="dialog fixture-remove-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fixture-remove-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="eyebrow">CAPTAIN / FIXTURES</span>
            <h2 id="fixture-remove-title">Remove this fixture?</h2>
            <p>
              <strong>Mauve FC vs {match.opponent}</strong>
              <br />
              {date(match.kickoff)} · Matchday {match.round}
            </p>
            <p>
              This removes the game from Schedule, Results, player stats and
              team totals. A completed season’s finish will be recalculated from
              the remaining results. The league standings stay unchanged.
            </p>
            <p>
              {match.source
                ? `The game will stay in Removed feed fixtures. ${feedName(match.source)} refreshes will keep it removed until you add it back; its recorded result, stats and team data will be retained.`
                : "This manually added game will be removed from the club’s fixture list."}
            </p>
            {error && (
              <p className="form-errors" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                autoFocus
                className="button secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Keep fixture
              </button>
              <button
                type="button"
                className="button fixture-remove-confirm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await removeFixture(match);
                    setOpen(false);
                    onRemoved();
                    setNotice(
                      match.source
                        ? "Fixture removed. You can add it back from Removed feed fixtures."
                        : "Fixture removed. Results and player totals updated.",
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not remove fixture.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Removing…" : "Remove fixture"}
              </button>
            </div>
          </section>
        </Modal>
      )}
    </>
  );
}

export function RemovedFeedFixtures() {
  const { removedFixtures, seasonId, restoreFixture, setNotice } =
    usePrototype();
  const fixtures = removedFixtures.filter((m) => m.seasonId === seasonId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  return (
    <section
      className="removed-feed-fixtures"
      aria-label="Removed feed fixtures"
    >
      <h2>
        Removed feed fixtures <span>{fixtures.length}</span>
      </h2>
      <p>
        Games you removed from the site stay here. Add one back to restore its
        recorded result and player stats.
      </p>
      {error && (
        <p className="form-errors" role="alert">
          {error}
        </p>
      )}
      {!fixtures.length ? (
        <p className="removed-feed-empty">
          No removed feed fixtures for this season.
        </p>
      ) : (
        <ul className="removed-feed-list">
          {fixtures.map((m) => (
            <li key={m.id}>
              <div>
                <span className="removed-feed-source">
                  {feedName(m.source)}
                </span>
                <h3>{m.opponent}</h3>
                <p>
                  {date(m.kickoff)} · Matchday {m.round}
                </p>
                <PlayoffBadge match={m} />
                {m.result?.published && (
                  <div className="removed-feed-result">
                    <strong>
                      {m.result.home}–{m.result.away}
                    </strong>
                    <ResultDecision result={m.result} />
                  </div>
                )}
                <p className="removed-feed-availability">
                  {m.feedAvailable === true
                    ? "Available in the latest feed"
                    : m.feedAvailable === false
                      ? "Not listed in the latest feed; saved game retained"
                      : "Saved feed fixture"}
                </p>
              </div>
              <button
                type="button"
                className="button secondary small"
                disabled={!!busy}
                aria-label={`Add back fixture against ${m.opponent}`}
                onClick={async () => {
                  setBusy(m.id);
                  setError("");
                  try {
                    await restoreFixture(m);
                    setNotice(
                      "Fixture added back. Its result and player stats are included again.",
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not restore fixture.",
                    );
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <RotateCcw size={16} />{" "}
                {busy === m.id ? "Restoring…" : "Add back"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
