"use client";
import {
  createContext,
  useRef,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  initialMatches,
  players as samplePlayers,
  seasons as sampleSeasons,
} from "@/lib/sample-data";
import type {
  LeagueConnection,
  Match,
  Player,
  PrototypeData,
  Result,
  Season,
} from "@/lib/types";
import { validateDraft, validateResult } from "@/features/matches/validation";
import { useAuth } from "./auth/auth-provider";
import {
  readPublicClub,
  readCaptainClub,
  readDrafts,
  writeResult,
  writeFixture,
  writePlayer,
  type ClubSnapshot,
} from "@/lib/supabase/repository";
const KEY = "mauve-fc-prototype-v1";
const initial: PrototypeData = {
  version: 1,
  matches: initialMatches,
  players: samplePlayers,
  roster: sampleSeasons.flatMap((s) =>
    samplePlayers.map((p) => ({ seasonId: s.id, playerId: p.id })),
  ),
  history: [],
};
type Context = {
  league?: LeagueConnection;
  ready: boolean;
  resetVersion: number;
  matches: Match[];
  players: Player[];
  seasons: Season[];
  roster: { seasonId: string; playerId: string }[];
  seasonId: string;
  setSeasonId: (id: string) => void;
  drafts: Record<string, Result>;
  saveResult: (id: string, result: Result) => Promise<void>;
  saveFixture: (match: Match) => Promise<void>;
  savePlayer: (player: Player) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  notice: string;
  setNotice: (s: string) => void;
  live: boolean;
  loadError: string;
};
const Context = createContext<Context | null>(null);
export function PrototypeProvider({
  children,
  bootstrap,
}: {
  children: ReactNode;
  bootstrap?: ClubSnapshot | null;
}) {
  const auth = useAuth(),
    [data, setData] = useState<PrototypeData>(
      auth.live
        ? {
            version: 1,
            matches: bootstrap?.matches || [],
            players: bootstrap?.players || [],
            roster: bootstrap?.roster || [],
            history: [],
          }
        : initial,
    ),
    [seasons, setSeasons] = useState(
      auth.live ? bootstrap?.seasons || [] : sampleSeasons,
    ),
    [seasonId, setSeasonId] = useState(
      auth.live ? bootstrap?.seasons[0]?.id || "" : "fall-2026",
    ),
    [ready, setReady] = useState(Boolean(auth.live && bootstrap)),
    [notice, setNotice] = useState(""),
    [resetVersion, setResetVersion] = useState(0),
    [loadError, setLoadError] = useState("");
  const [league, setLeague] = useState<LeagueConnection | undefined>(
    bootstrap?.league,
  );
  const identity = useRef("");
  identity.current = `${auth.user?.id || ""}:${auth.captain}`;
  function apply(snapshot: ClubSnapshot, drafts: Record<string, Result> = {}) {
    setData({
      version: 1,
      matches: snapshot.matches,
      players: snapshot.players,
      roster: snapshot.roster,
      drafts,
      history: [],
    });
    setSeasons(snapshot.seasons);
    setLeague(snapshot.league);
    setSeasonId((id) =>
      snapshot.seasons.some((s) => s.id === id)
        ? id
        : snapshot.seasons[0]?.id || "",
    );
    setLoadError("");
  }
  async function refresh() {
    if (!auth.live) return;
    const owner = identity.current;
    const snapshot = auth.captain
      ? await readCaptainClub()
      : await readPublicClub();
    const drafts = auth.captain ? await readDrafts() : {};
    if (owner === identity.current) apply(snapshot, drafts);
  }
  useEffect(() => {
    if (!auth.live) {
      try {
        const saved = localStorage.getItem(KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as PrototypeData;
          const roster = parsed.players || samplePlayers;
          if (
            parsed.version === 1 &&
            Array.isArray(parsed.matches) &&
            parsed.matches.every(
              (m) =>
                typeof m.id === "string" &&
                (!m.result || validateResult(m.result, roster).length === 0),
            )
          )
            setData({
              ...parsed,
              players: roster,
              roster: parsed.roster || initial.roster,
              history: parsed.history || [],
            });
        }
      } catch {
        setNotice(
          "Browser storage is unavailable. Changes will last for this visit.",
        );
      }
      setReady(true);
      return;
    }
    if (auth.loading) return;
    let active = true;
    setReady(false);
    // Immediately discard any captain-only data when identity changes.
    setData({
      version: 1,
      matches: bootstrap?.matches || [],
      players: bootstrap?.players || [],
      roster: bootstrap?.roster || [],
      drafts: {},
      history: [],
    });
    if (!auth.configured) {
      setLoadError("Club data is being connected.");
      setReady(true);
      return;
    }
    void (async () => {
      try {
        const snapshot = auth.captain
            ? await readCaptainClub()
            : await readPublicClub(),
          drafts = auth.captain ? await readDrafts() : {};
        if (active) apply(snapshot, drafts);
      } catch {
        if (active)
          setLoadError("Club data could not be loaded. Please try again.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [auth.live, auth.user?.id, auth.captain, auth.loading]);
  useEffect(() => {
    if (ready && !auth.live)
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        setNotice(
          "Browser storage is unavailable. Changes will last for this visit.",
        );
      }
  }, [data, ready, auth.live]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  async function saveResult(id: string, result: Result) {
    const match = data.matches.find((m) => m.id === id);
    if (!match) throw new Error("Fixture not found.");
    const eligible = (data.players || []).filter((p) =>
      data.roster?.some(
        (sr) => sr.seasonId === match.seasonId && sr.playerId === p.id,
      ),
    );
    const errors = result.published
      ? validateResult(result, eligible)
      : validateDraft(result, eligible);
    if (errors.length) throw new Error(errors[0]);
    if (auth.live) {
      if (!auth.captain) throw new Error("Captain access required.");
      await writeResult(match, result);
      try {
        await refresh();
      } catch {
        setLoadError(
          "Saved successfully, but the latest club data could not be refreshed. Reload before making another edit.",
        );
      }
      return;
    }
    setData((previous) => {
      const before = previous.matches.find((m) => m.id === id)?.result,
        at = new Date().toISOString(),
        after = { ...result, updatedAt: at },
        drafts = { ...previous.drafts };
      if (after.published) delete drafts[id];
      else drafts[id] = after;
      return {
        ...previous,
        drafts,
        matches: after.published
          ? previous.matches.map((m) =>
              m.id === id ? { ...m, status: "completed", result: after } : m,
            )
          : previous.matches,
        history: [...previous.history, { matchId: id, at, before, after }],
      };
    });
  }
  async function saveFixture(match: Match) {
    if (auth.live) {
      if (!auth.captain) throw new Error("Captain access required.");
      await writeFixture(match);
      await refresh();
    } else
      setData((d) => ({
        ...d,
        matches: d.matches.some((m) => m.id === match.id)
          ? d.matches.map((m) => (m.id === match.id ? match : m))
          : [...d.matches, match],
      }));
  }
  async function savePlayer(player: Player) {
    if (auth.live) {
      if (!auth.captain) throw new Error("Captain access required.");
      await writePlayer(player, seasonId);
      await refresh();
    } else
      setData((d) => ({
        ...d,
        players: d.players?.some((p) => p.id === player.id)
          ? d.players.map((p) => (p.id === player.id ? player : p))
          : [...(d.players || []), player],
        roster: d.roster?.some(
          (sr) => sr.seasonId === seasonId && sr.playerId === player.id,
        )
          ? d.roster
          : [...(d.roster || []), { seasonId, playerId: player.id }],
      }));
  }
  function reset() {
    if (auth.live) return;
    setResetVersion((v) => v + 1);
    setData(structuredClone(initial));
    setSeasonId("fall-2026");
    setNotice("Demo reset. You’re back to the original sample season.");
  }
  return (
    <Context.Provider
      value={{
        league,
        ready,
        resetVersion,
        matches: data.matches,
        players: data.players || [],
        roster: data.roster || [],
        seasons,
        seasonId,
        setSeasonId,
        drafts: data.drafts || {},
        saveResult,
        saveFixture,
        savePlayer,
        refresh,
        reset,
        notice,
        setNotice,
        live: auth.live,
        loadError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePrototype() {
  const context = useContext(Context);
  if (!context) throw new Error("Club provider missing");
  return context;
}
