"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Plus, Search, UserPlus } from "lucide-react";
import { useAuth } from "./auth/auth-provider";
import { usePrototype } from "./prototype-provider";
import { readPlayerDirectory } from "@/lib/supabase/repository";
import type { GuestInput } from "@/lib/supabase/repository";
import type { DirectoryPlayer, GuestChange, Match, Player } from "@/lib/types";

const normalized = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function MatchGuests({
  match,
  players,
  revision,
  onChange,
  disabled = false,
  canRemove = true,
  onBusy,
}: {
  match: Match;
  players: Player[];
  revision?: number;
  onChange: (change: GuestChange) => void;
  disabled?: boolean;
  canRemove?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const auth = useAuth();
  // Keep search/create controls independent of the surrounding stats form.
  const formId = useId();
  const { changeGuest, roster } = usePrototype();
  const [open, setOpen] = useState(false),
    [creating, setCreating] = useState(false);
  const [directory, setDirectory] = useState<DirectoryPlayer[] | null>(null);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const [name, setName] = useState(""),
    [number, setNumber] = useState("0"),
    [position, setPosition] = useState<Player["position"]>("Midfielder");
  const [allowSameName, setAllowSameName] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      onBusy?.(false);
    };
  }, [onBusy]);
  useEffect(() => {
    if (!open || !auth.captain) return;
    let active = true;
    void readPlayerDirectory().then(
      (data) => {
        if (active) {
          setDirectory(data);
          setError("");
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, auth.captain]);
  if (!auth.live || !auth.captain) return null;
  const guests = players.filter((p) => match.guestPlayerIds?.includes(p.id));
  const sameNames = (directory || []).filter(
    (p) => normalized(p.name) === normalized(name),
  );
  const candidates = (directory || []).filter((p) =>
    normalized(p.name).includes(normalized(query)),
  );
  const isRoster = (id: string) =>
    roster.some((r) => r.seasonId === match.seasonId && r.playerId === id);
  async function change(input: GuestInput) {
    if (busy || disabled) return;
    if (
      input.player &&
      (!input.player.name.trim() ||
        input.player.name.trim().length > 100 ||
        !/^\d{1,2}$/.test(number))
    ) {
      setError("Enter a name, position and jersey number from 0 to 99.");
      return;
    }
    setBusy(true);
    onBusy?.(true);
    setError("");
    setNotice("");
    try {
      const result = await changeGuest(
        match.id,
        revision ?? match.revision ?? 0,
        input,
      );
      if (!active.current) return;
      onChange(result);
      setNotice(
        `${result.player.name} ${result.action === "add" ? "added to this game" : "removed from this game"}. Their player history is retained.`,
      );
      setOpen(false);
      setCreating(false);
      setDirectory(null);
      setQuery("");
      setSelected("");
      setName("");
      setNumber("0");
      setAllowSameName(false);
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error ? e.message : "Could not update game guests.",
        );
    } finally {
      if (active.current) {
        setBusy(false);
        onBusy?.(false);
      }
    }
  }
  return (
    <section className="match-guests-panel" aria-label="Match guests">
      <div className="guest-panel-heading">
        <div>
          <h3>Guest substitutes</h3>
          <p>
            Add someone for this game without adding them to the season roster.
            Attendance and stats are recorded separately.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy || match.status === "cancelled"}
          onClick={() => {
            setOpen(!open);
            setError("");
            setNotice("");
          }}
        >
          <UserPlus size={17} />
          {open ? "Close guest search" : "Add guest substitute"}
        </button>
      </div>
      {!!guests.length && (
        <ul className="match-guest-list">
          {guests.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong>
                <small>
                  Guest · #{p.number} · {p.position}
                </small>
              </span>
              <button
                type="button"
                className="text-link"
                disabled={disabled || busy || !canRemove}
                onClick={() => void change({ playerId: p.id, remove: true })}
                aria-label={`Remove ${p.name} from this game`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {!canRemove && !!guests.length && (
        <p className="guest-help">
          Save or discard current edits before removing a guest.
        </p>
      )}
      {open && (
        <div className="guest-search-area">
          <label className="form-field">
            <span>Find a known player</span>
            <div className="guest-search-input">
              <Search size={17} />
              <input
                form={formId}
                aria-label="Search player directory"
                value={query}
                maxLength={100}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected("");
                }}
                placeholder="Search current and historical players"
                disabled={busy}
              />
            </div>
          </label>
          {!directory ? (
            <p role="status">
              {error
                ? "Directory unavailable. Close and reopen guest search to retry."
                : "Loading player directory…"}
            </p>
          ) : (
            <>
              <label className="form-field">
                <span>Known players</span>
                <select
                  form={formId}
                  aria-label="Known guest player"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose a known player</option>
                  {candidates.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={
                        isRoster(p.id) || match.guestPlayerIds?.includes(p.id)
                      }
                    >
                      {p.name} · #{p.number} ·{" "}
                      {isRoster(p.id)
                        ? "On this season’s roster"
                        : match.guestPlayerIds?.includes(p.id)
                          ? "Already in this game"
                          : p.rosterSeasonIds.length
                            ? "Past roster player"
                            : `${p.guestGames} guest games`}
                    </option>
                  ))}
                </select>
              </label>
              {!candidates.length && (
                <p className="guest-help">
                  No matching player in the directory yet.
                </p>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={!selected || busy}
                onClick={() => void change({ playerId: selected })}
              >
                Add selected guest
              </button>
              <button
                type="button"
                className="text-link guest-create-toggle"
                disabled={busy}
                onClick={() => {
                  setCreating(!creating);
                  setName(query.trim());
                  setAllowSameName(false);
                }}
              >
                <Plus size={16} />
                {creating ? "Close new player form" : "Create a new player"}
              </button>
              {creating && (
                <div className="guest-create-fields">
                  <label className="form-field guest-name-field">
                    <span>Player name</span>
                    <input
                      form={formId}
                      aria-label="Guest player name"
                      value={name}
                      maxLength={100}
                      disabled={busy}
                      onChange={(e) => {
                        setName(e.target.value);
                        setAllowSameName(false);
                      }}
                    />
                  </label>
                  <label className="form-field">
                    <span>Jersey number</span>
                    <input
                      form={formId}
                      aria-label="Guest jersey number"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="99"
                      step="1"
                      disabled={busy}
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span>Position</span>
                    <select
                      form={formId}
                      aria-label="Guest position"
                      disabled={busy}
                      value={position}
                      onChange={(e) =>
                        setPosition(e.target.value as Player["position"])
                      }
                    >
                      {["Forward", "Midfielder", "Defender", "Goalkeeper"].map(
                        (p) => (
                          <option key={p}>{p}</option>
                        ),
                      )}
                    </select>
                  </label>
                  {!!sameNames.length && (
                    <label className="guest-name-confirm">
                      <input
                        form={formId}
                        type="checkbox"
                        checked={allowSameName}
                        disabled={busy}
                        onChange={(e) => setAllowSameName(e.target.checked)}
                      />
                      <span>
                        A player with this name exists. This is a different
                        person who needs their own history.
                      </span>
                    </label>
                  )}
                  <p className="guest-help guest-name-field">
                    New players start with a private profile and no team
                    account. Use an existing player whenever it is the same
                    person.
                  </p>
                  <button
                    type="button"
                    className="button guest-name-field"
                    disabled={
                      busy ||
                      !name.trim() ||
                      (!!sameNames.length && !allowSameName)
                    }
                    onClick={() =>
                      void change({
                        player: { name, number: Number(number), position },
                        allowSameName,
                      })
                    }
                  >
                    {busy ? "Adding…" : "Create player & add to game"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="guest-success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
