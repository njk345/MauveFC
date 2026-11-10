import { createClient } from "@supabase/supabase-js";
import type { LeagueConnection, Match, Player, Result, Season } from "../types";
import { clubId, publishableKey, supabaseUrl } from "./config";
import { getBrowserClient } from "./client";
export type ClubSnapshot = {
  league?: LeagueConnection;
  matches: Match[];
  players: Player[];
  seasons: Season[];
  roster: { seasonId: string; playerId: string }[];
};
export async function requestLeagueSync() {
  const { error } = await getBrowserClient().rpc("request_league_sync", {
    p_club_id: clubId,
  });
  if (error)
    throw new Error(
      "LeagueApps refresh could not be requested. Please try again.",
    );
}
export async function useLeagueFixture(match: Match) {
  const { error } = await getBrowserClient().rpc("use_league_fixture", {
    p_match_id: match.id,
    p_expected_revision: match.revision ?? 0,
  });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "This fixture changed. Reload before restoring league details."
        : "League details could not be restored.",
    );
}
export async function readPublicClub(
  staticSnapshot = false,
): Promise<ClubSnapshot> {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: staticSnapshot ? "force-cache" : "no-store",
        }),
    },
  });
  const { data, error } = await client.rpc("get_public_club", {
    p_club_id: clubId,
  });
  if (error)
    throw new Error("Club data could not be loaded. Please try again.");
  return data as ClubSnapshot;
}
export async function readCaptainClub(): Promise<ClubSnapshot> {
  const { data, error } = await getBrowserClient().rpc("get_captain_club", {
    p_club_id: clubId,
  });
  if (error) throw new Error("Captain access could not be verified.");
  return data as ClubSnapshot;
}
export async function readDrafts() {
  const { data, error } = await getBrowserClient()
    .from("match_drafts")
    .select("match_id,payload,base_revision")
    .eq("club_id", clubId);
  if (error) throw new Error("Drafts could not be loaded.");
  return Object.fromEntries(
    (data || []).map((d) => [
      d.match_id,
      { ...d.payload, baseRevision: d.base_revision },
    ]),
  ) as Record<string, Result>;
}
export async function writeResult(match: Match, result: Result) {
  const { error } = await getBrowserClient().rpc("save_match_result", {
    p_match_id: match.id,
    p_expected_revision: result.baseRevision ?? match.revision ?? 0,
    p_payload: result,
  });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "This match changed since you opened it. Reload the latest version before saving."
        : error.code === "42501"
          ? "Captain access is required."
          : `Result could not be saved: ${error.message}`,
    );
}
export async function writeFixture(fixture: Match) {
  const { error } = await getBrowserClient().rpc("save_fixture", {
    p_club_id: clubId,
    p_fixture: fixture,
  });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "This fixture changed. Reload before saving."
        : error.message,
    );
}
export async function writePlayer(player: Player, seasonId: string) {
  const { error } = await getBrowserClient().rpc("save_roster_player", {
    p_club_id: clubId,
    p_season_id: seasonId,
    p_player: player,
  });
  if (error) throw new Error(error.message);
}
