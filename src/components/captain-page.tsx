"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  Info,
  Save,
  ShieldCheck,
} from "lucide-react";
import { usePrototype } from "./prototype-provider";
import type { Player } from "@/lib/types";
import { date } from "@/lib/format";
import type { Capture, Match, Result } from "@/lib/types";
import { validateDraft, validateResult } from "@/features/matches/validation";
import { PageHeading } from "./season-pages";
import { Crest, OpponentBadge } from "./brand";
function blank(players: Player[]): Result {
  return {
    home: 0,
    away: 0,
    onFieldHome: 0,
    onFieldAway: 0,
    basis: "played",
    reason: "",
    attendance: "unrecorded",
    scorers: "unrecorded",
    assists: "unrecorded",
    ownGoals: 0,
    stats: players.map((p) => ({
      playerId: p.id,
      appeared: false,
      goals: 0,
      assists: null,
    })),
    published: false,
  };
}
function expand(r: Result, players: Player[]): Result {
  return {
    ...r,
    stats: players.map(
      (p) =>
        r.stats.find((s) => s.playerId === p.id) || {
          playerId: p.id,
          appeared: false,
          goals: 0,
          assists: r.assists === "unrecorded" ? null : 0,
        },
    ),
  };
}
function CaptureSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Capture;
  onChange: (c: Capture) => void;
}) {
  return (
    <label className="capture-select">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Capture)}
      >
        <option value="unrecorded">Not recorded</option>
        <option value="partial">Partially recorded</option>
        <option value="complete">Complete</option>
      </select>
    </label>
  );
}
export function CaptainPage() {
  const {
      matches,
      players: allPlayers,
      roster,
      live,
      seasonId,
      drafts,
      saveResult,
      setNotice,
      ready,
      resetVersion,
    } = usePrototype(),
    players = allPlayers.filter((p) =>
      roster.some((sr) => sr.seasonId === seasonId && sr.playerId === p.id),
    ),
    fixtures = matches.filter(
      (m) => m.seasonId === seasonId && m.status !== "cancelled",
    ),
    [selectedId, setSelectedId] = useState(""),
    [r, setR] = useState<Result>(() => blank(players)),
    [step, setStep] = useState(0),
    [errors, setErrors] = useState<string[]>([]),
    [success, setSuccess] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const match = fixtures.find((m) => m.id === selectedId);
  function load(m: Match) {
    setSelectedId(m.id);
    setR({
      ...expand(drafts[m.id] || m.result || blank(players), players),
      baseRevision: drafts[m.id]?.baseRevision ?? m.revision ?? 0,
    });
    setStep(0);
    setErrors([]);
    setSuccess(false);
    setDirty(false);
  }
  useEffect(() => {
    if (!ready) return;
    const query = new URLSearchParams(window.location.search).get("match");
    const chosen =
      fixtures.find((m) => m.id === query) ||
      fixtures.find((m) => !m.result?.published && m.status === "scheduled") ||
      fixtures[0];
    if (chosen) load(chosen);
  }, [seasonId, ready, resetVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function patch(fields: Partial<Result>) {
    setR((prev) => ({ ...prev, ...fields }));
    setDirty(true);
    setErrors([]);
  }
  function changeScore(side: "home" | "away", value: number) {
    patch({
      [side]: value,
      ...(r.basis === "played"
        ? { [side === "home" ? "onFieldHome" : "onFieldAway"]: value }
        : {}),
    });
  }
  function updatePlayer(id: string, fields: Partial<Result["stats"][number]>) {
    patch({
      stats: r.stats.map((s) => (s.playerId === id ? { ...s, ...fields } : s)),
      ...(fields.appeared && r.attendance === "unrecorded"
        ? { attendance: "partial" as const }
        : {}),
      ...((fields.goals ?? 0) > 0 && r.scorers === "unrecorded"
        ? { scorers: "partial" as const }
        : {}),
    });
  }
  async function save(published: boolean) {
    const next = { ...r, published },
      issues = published
        ? validateResult(next, players)
        : validateDraft(next, players);
    if (issues.length) {
      setErrors(issues);
      return;
    }
    try {
      setSaving(true);
      await saveResult(selectedId, next);
      setDirty(false);
      setR((previous) => ({
        ...previous,
        baseRevision:
          (previous.baseRevision ?? 0) + (live && published ? 1 : 0),
      }));
      if (published) {
        setSuccess(true);
        setNotice(
          live
            ? "Result published. Club record and player stats updated."
            : "Sample result published. Club record and player stats updated.",
        );
      } else
        setNotice(
          live
            ? "Private draft saved. Public stats are unchanged."
            : "Draft saved in this browser. Public stats are unchanged.",
        );
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "Could not save result.",
      ]);
    } finally {
      setSaving(false);
    }
  }
  function next() {
    if (step === 0) {
      const scoreErrors = validateResult({
        ...r,
        scorers: "unrecorded",
        attendance: "unrecorded",
        assists: "unrecorded",
        stats: [],
        ownGoals: 0,
      }).filter((e) => !e.startsWith("Complete"));
      if (scoreErrors.length) {
        setErrors(scoreErrors);
        return;
      }
    }
    if (step === 1) {
      const issues = validateResult(r, players);
      if (issues.length) {
        setErrors(issues);
        return;
      }
    }
    setErrors([]);
    setStep(step + 1);
  }
  const goals = r.stats.reduce((n, s) => n + s.goals, 0),
    attended = r.stats.filter((s) => s.appeared).length;
  return (
    <div className="section page-section captain-page">
      <PageHeading
        eyebrow="THE CAPTAIN’S CORNER"
        title="From final whistle to final score."
        description="A minute for the basics. A little more for the moments that mattered."
      />
      {!live && (
        <div className="prototype-notice">
          <ShieldCheck size={20} />
          <div>
            <strong>Captain’s area · open demo</strong>
            <p>
              Try the workflow with fictional data. Edits stay in this browser.
              Live captain sign-in is available once the club is connected.
            </p>
          </div>
        </div>
      )}
      {live && match?.source && (
        <p className="help-text">
          {match.needsReview
            ? `LeagueApps currently reports ${match.leagueScore ? `${match.leagueScore.home}–${match.leagueScore.away}` : "no final score"}. Your published result is preserved for review.`
            : "The league score is imported automatically. Add attendance, goals and assists here. Once you publish, your result and player details are protected from automatic changes."}
        </p>
      )}
      {!fixtures.length ? (
        <div className="empty-state">
          <h2>Set the first kickoff.</h2>
          <p>Add a fixture before recording a result.</p>
          <Link className="button" href="/captain/fixtures/">
            Add fixture
          </Link>
        </div>
      ) : success ? (
        <section className="publish-success">
          <CheckCircle2 size={52} />
          <span className="eyebrow">THAT’S IN THE BOOKS</span>
          <h2>Another chapter, published.</h2>
          <p>
            Mauve FC {r.home} – {r.away} {match?.opponent}
          </p>
          <p>The club record, player totals, and charts are up to date.</p>
          <div className="button-row">
            <Link className="button" href="/results/">
              See the result <ArrowUpRight size={16} />
            </Link>
            <Link className="button secondary" href="/stats/">
              Explore updated stats <ArrowUpRight size={16} />
            </Link>
            <button
              className="text-link"
              onClick={() => {
                setSuccess(false);
                setStep(0);
              }}
            >
              Make a correction <ArrowRight size={15} />
            </button>
          </div>
        </section>
      ) : (
        <div className="entry-layout">
          <section className="entry-main">
            <label className="fixture-select">
              <span className="eyebrow">CHOOSE A MATCH</span>
              <select
                aria-label="Choose a match"
                value={selectedId}
                onChange={(e) => {
                  if (
                    dirty &&
                    !window.confirm(
                      "Leave these unsaved changes? Save a draft to keep them.",
                    )
                  )
                    return;
                  const m = fixtures.find((m) => m.id === e.target.value);
                  if (m) load(m);
                }}
              >
                {fixtures.map((m) => (
                  <option value={m.id} key={m.id}>
                    {date(m.kickoff)} · {m.opponent}
                    {drafts[m.id]
                      ? " · Draft"
                      : m.result?.published
                        ? " · Published"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <ol className="entry-steps">
              {["The score", "The squad", "Preview & publish"].map((s, i) => (
                <li
                  key={s}
                  className={step === i ? "current" : step > i ? "done" : ""}
                >
                  <span>{step > i ? <Check size={14} /> : i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            {errors.length > 0 && (
              <div role="alert" className="form-errors">
                <strong>A quick check before we continue.</strong>
                <ul>
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {step === 0 && (
              <div className="entry-step">
                <span className="eyebrow">01 / THE SCORE</span>
                <h2>How did we finish?</h2>
                <p>
                  Enter the official result. You can add player details next.
                </p>
                <div className="score-entry">
                  <label>
                    <Crest />
                    <strong>Mauve FC</strong>
                    <span className="sr-only">Mauve FC official score</span>
                    <input
                      aria-label="Mauve FC official score"
                      type="number"
                      min="0"
                      max="99"
                      value={Number.isNaN(r.home) ? "" : r.home}
                      onChange={(e) =>
                        changeScore("home", e.target.valueAsNumber)
                      }
                    />
                  </label>
                  <span className="score-dash">–</span>
                  <label>
                    <OpponentBadge
                      code={match?.opponentCode || "FC"}
                      color={match?.color || "#557285"}
                    />
                    <strong>{match?.opponent || "Opponent"}</strong>
                    <span className="sr-only">Opponent official score</span>
                    <input
                      aria-label="Opponent official score"
                      type="number"
                      min="0"
                      max="99"
                      value={Number.isNaN(r.away) ? "" : r.away}
                      onChange={(e) =>
                        changeScore("away", e.target.valueAsNumber)
                      }
                    />
                  </label>
                </div>
                <label className="form-field">
                  <span>Result basis</span>
                  <select
                    value={r.basis}
                    onChange={(e) => {
                      const basis = e.target.value as Result["basis"];
                      patch({
                        basis,
                        ...(basis === "played"
                          ? { onFieldHome: r.home, onFieldAway: r.away }
                          : {
                              onFieldHome: 0,
                              onFieldAway: 0,
                              attendance: "unrecorded",
                              scorers: "unrecorded",
                              assists: "unrecorded",
                              ownGoals: 0,
                              stats: blank(players).stats,
                            }),
                      });
                    }}
                  >
                    <option value="played">Played · score on the field</option>
                    <option value="forfeit">
                      Forfeit · official adjustment
                    </option>
                    <option value="adjusted">Other official adjustment</option>
                  </select>
                </label>
                {r.basis !== "played" && (
                  <div className="adjustment-fields">
                    <div className="field-pair">
                      <label className="form-field">
                        <span>On-field Mauve goals</span>
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={r.onFieldHome}
                          onChange={(e) =>
                            patch({ onFieldHome: e.target.valueAsNumber })
                          }
                        />
                      </label>
                      <label className="form-field">
                        <span>On-field opponent goals</span>
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={r.onFieldAway}
                          onChange={(e) =>
                            patch({ onFieldAway: e.target.valueAsNumber })
                          }
                        />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>Adjustment reason</span>
                      <textarea
                        value={r.reason}
                        onChange={(e) => patch({ reason: e.target.value })}
                        placeholder="Why does the official score differ?"
                      />
                    </label>
                    <p className="help-text">
                      For an unplayed forfeit, leave on-field goals at zero. No
                      player appearances or goals are inferred.
                    </p>
                  </div>
                )}
              </div>
            )}
            {step === 1 && (
              <div className="entry-step squad-entry">
                <span className="eyebrow">02 / THE SQUAD</span>
                <h2>Who made it happen?</h2>
                <p>
                  Record what you know. Leave the rest marked as not recorded.
                </p>
                <div className="capture-controls">
                  <CaptureSelect
                    label="Attendance"
                    value={r.attendance}
                    onChange={(attendance) =>
                      patch({
                        attendance,
                        ...(attendance === "unrecorded"
                          ? {
                              stats: blank(players).stats,
                              scorers: "unrecorded",
                              assists: "unrecorded",
                            }
                          : {}),
                      })
                    }
                  />
                  <CaptureSelect
                    label="Scorers"
                    value={r.scorers}
                    onChange={(scorers) =>
                      patch({
                        scorers,
                        ...(scorers === "unrecorded"
                          ? { stats: r.stats.map((s) => ({ ...s, goals: 0 })) }
                          : {}),
                      })
                    }
                  />
                  <CaptureSelect
                    label="Assists"
                    value={r.assists}
                    onChange={(assists) =>
                      patch({
                        assists,
                        stats: r.stats.map((s) => ({
                          ...s,
                          assists:
                            assists === "unrecorded" ? null : (s.assists ?? 0),
                        })),
                      })
                    }
                  />
                </div>
                <div className="entry-roster">
                  <div className="roster-head">
                    <span>PLAYER</span>
                    <span>PLAYED</span>
                    <span>GOALS</span>
                    <span>ASSISTS</span>
                  </div>
                  {players.map((p) => {
                    const s = r.stats.find((s) => s.playerId === p.id)!;
                    return (
                      <div
                        className={`roster-entry ${s.appeared ? "played" : ""}`}
                        key={p.id}
                      >
                        <span>
                          <small>#{p.number}</small>
                          <strong>{p.name}</strong>
                        </span>
                        <label className="attendance-check">
                          <span className="sr-only">{p.name} played</span>
                          <input
                            type="checkbox"
                            checked={s.appeared}
                            onChange={(e) =>
                              updatePlayer(p.id, {
                                appeared: e.target.checked,
                                ...(!e.target.checked
                                  ? {
                                      goals: 0,
                                      assists:
                                        r.assists === "unrecorded" ? null : 0,
                                    }
                                  : {}),
                              })
                            }
                          />
                          <span>{s.appeared ? <Check size={15} /> : null}</span>
                        </label>
                        <input
                          aria-label={`${p.name} goals`}
                          type="number"
                          min="0"
                          max="99"
                          disabled={!s.appeared}
                          value={s.goals}
                          onChange={(e) =>
                            updatePlayer(p.id, {
                              goals: e.target.valueAsNumber,
                            })
                          }
                        />
                        <input
                          aria-label={`${p.name} assists`}
                          type="number"
                          min="0"
                          max="99"
                          disabled={!s.appeared || r.assists === "unrecorded"}
                          value={s.assists ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            updatePlayer(p.id, {
                              assists: e.target.valueAsNumber,
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="own-goals">
                  <label>
                    Opposition own goals{" "}
                    <input
                      aria-label="Opposition own goals"
                      type="number"
                      min="0"
                      max="99"
                      value={r.ownGoals}
                      onChange={(e) =>
                        patch({ ownGoals: e.target.valueAsNumber })
                      }
                    />
                  </label>
                  <span>
                    {goals + r.ownGoals} of {r.onFieldHome} goals attributed
                  </span>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="entry-step preview-step">
                <span className="eyebrow">03 / ONE LAST LOOK</span>
                <h2>Ready for the club?</h2>
                <p>
                  Publishing updates the result and all related statistics
                  together.
                </p>
                <div className="result-preview">
                  <span className="eyebrow">
                    FULL TIME · {date(match?.kickoff || null)}
                  </span>
                  <div>
                    <Crest />
                    <strong>
                      {r.home} – {r.away}
                    </strong>
                    <OpponentBadge
                      code={match?.opponentCode || "FC"}
                      color={match?.color || "#557285"}
                    />
                  </div>
                  <h3>Mauve FC vs {match?.opponent}</h3>
                </div>
                <dl className="publish-summary">
                  <div>
                    <dt>Result basis</dt>
                    <dd>
                      {r.basis === "played"
                        ? "Played"
                        : `${r.basis} · ${r.reason}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Attendance</dt>
                    <dd>
                      {r.attendance === "unrecorded"
                        ? "Not recorded"
                        : `${attended} recorded · ${r.attendance}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Goals attributed</dt>
                    <dd>
                      {goals + r.ownGoals} / {r.onFieldHome} · {r.scorers}
                    </dd>
                  </div>
                  <div>
                    <dt>Assists</dt>
                    <dd>
                      {r.assists === "unrecorded" ? "Not recorded" : r.assists}
                    </dd>
                  </div>
                </dl>
                {r.stats
                  .filter((s) => s.goals > 0)
                  .map((s) => (
                    <div className="preview-scorer" key={s.playerId}>
                      <span>
                        {players.find((p) => p.id === s.playerId)?.name}
                      </span>
                      <strong>
                        {s.goals} {s.goals === 1 ? "goal" : "goals"}
                      </strong>
                    </div>
                  ))}
                {match?.result?.published && (
                  <div className="correction-note">
                    <Info size={17} /> This corrects the existing result. Player
                    and club totals will be recalculated.
                  </div>
                )}
              </div>
            )}
            <div className="entry-footer">
              <button
                className="text-link"
                disabled={saving}
                onClick={() => void save(false)}
              >
                <Save size={16} /> Save draft
              </button>
              <div>
                {step > 0 && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setStep(step - 1);
                      setErrors([]);
                    }}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                )}
                {step < 2 ? (
                  <button className="button" onClick={next}>
                    {step === 0 ? "Add player details" : "Preview result"}
                    {step === 0 ? <ArrowRight size={16} /> : <Eye size={16} />}
                  </button>
                ) : (
                  <button
                    disabled={saving}
                    className="button"
                    onClick={() => void save(true)}
                  >
                    {saving
                      ? "Publishing…"
                      : live
                        ? "Publish result"
                        : "Publish sample result"}{" "}
                    <Check size={16} />
                  </button>
                )}
              </div>
            </div>
          </section>
          <aside className="entry-aside">
            <span className="eyebrow">A GOOD MATCH REPORT</span>
            <h3>
              Keep it simple.
              <br />
              Make it count.
            </h3>
            <div>
              <span className="aside-step">01</span>
              <p>
                <strong>Start with the score.</strong>The result is enough to
                update the club record.
              </p>
            </div>
            <div>
              <span className="aside-step">02</span>
              <p>
                <strong>Capture what you know.</strong>Unknown stats stay
                unknown. You can add the details later.
              </p>
            </div>
            <div>
              <span className="aside-step">03</span>
              <p>
                <strong>Preview, then publish.</strong>Corrections update every
                affected view.
              </p>
            </div>
            <p className="aside-note">
              Demo drafts and corrections are saved in this browser. Reset the
              demo any time.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
