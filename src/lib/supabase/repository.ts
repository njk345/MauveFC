import { createClient } from "@supabase/supabase-js";
import type {
  LeagueConnection,
  Match,
  RemovedFixture,
  Player,
  Result,
  Season,
  MatchRsvp,
  MatchLineup,
  LineupPost,
  LineupPayload,
  PlayerAccount,
  RsvpResponse,
  SeasonStatsSnapshot,
  DirectoryPlayer,
  GuestChange,
  CaptainPlayerDetails,
  PreferredPosition,
  SeasonSetupInput,
  SeasonImportPreview,
  SeasonImportTeamChoice,
  ManualLeagueResult,
} from "../types";
import { clubId, publishableKey, supabaseUrl } from "./config";
import { getBrowserClient } from "./client";
export type ClubSnapshot = {
  leagues?: LeagueConnection[];
  removedFixtures?: RemovedFixture[];
  league?: LeagueConnection;
  matches: Match[];
  players: Player[];
  seasons: Season[];
  roster: { seasonId: string; playerId: string }[];
};
export type TeamSnapshot = ClubSnapshot & {
  rsvps: MatchRsvp[];
  lineups: MatchLineup[];
  lineupPosts: LineupPost[];
};
export async function readTeamClub(): Promise<TeamSnapshot> {
  const client = getBrowserClient();
  const [team, posts] = await Promise.all([
    client.rpc("get_team_club", { p_club_id: clubId }),
    client.rpc("get_lineup_posts", { p_club_id: clubId }),
  ]);
  if (team.error || posts.error)
    throw new Error(
      "Team data could not be loaded. Check your membership and try again.",
    );
  return {
    ...(team.data as TeamSnapshot),
    lineupPosts: posts.data as LineupPost[],
  };
}
export async function postLineupSuggestion(
  matchId: string,
  payload: LineupPayload,
) {
  const { data, error } = await getBrowserClient().rpc(
    "post_lineup_suggestion",
    {
      p_match_id: matchId,
      p_payload: payload,
    },
  );
  if (error) throw new Error(error.message);
  return data;
}
export const deleteLineupSuggestion = (postId: string) =>
  teamWrite("delete_lineup_suggestion", { p_post_id: postId });
export async function readPlayerAccounts(): Promise<PlayerAccount[]> {
  const { data, error } = await getBrowserClient().rpc("get_player_accounts", {
    p_club_id: clubId,
  });
  if (error) throw new Error("Player accounts could not be loaded.");
  return data as PlayerAccount[];
}
async function teamWrite(name: string, args: Record<string, unknown>) {
  const { error } = await getBrowserClient().rpc(name, args);
  if (error)
    throw new Error(
      error.code === "40001"
        ? "The lineup changed. Reload the latest version before saving."
        : error.message,
    );
}
export const writeRsvp = (matchId: string, response: RsvpResponse | null) =>
  teamWrite("save_match_rsvp", { p_match_id: matchId, p_response: response });
export const writeLineup = (
  matchId: string,
  revision: number,
  payload: LineupPayload,
  publish: boolean,
) =>
  teamWrite("save_match_lineup", {
    p_match_id: matchId,
    p_expected_revision: revision,
    p_payload: payload,
    p_publish: publish,
  });
export const unshareLineup = (matchId: string, revision: number) =>
  teamWrite("unshare_match_lineup", {
    p_match_id: matchId,
    p_expected_revision: revision,
  });
export const revokePlayerAccess = (playerId: string) =>
  teamWrite("revoke_player_access", {
    p_club_id: clubId,
    p_player_id: playerId,
  });
export const linkCaptainProfile = (playerId: string) =>
  teamWrite("link_captain_profile", {
    p_club_id: clubId,
    p_player_id: playerId,
  });
export async function createPlayerInvite(
  playerId: string,
  email: string,
): Promise<{ link: string }> {
  const { data, error } = await getBrowserClient().functions.invoke(
    "player-invite",
    { body: { clubId, playerId, email } },
  );
  if (error) {
    let message = "The invitation could not be created. Please try again.";
    if (error.context instanceof Response)
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* no unsafe transport error */
      }
    throw new Error(message);
  }
  if (!data?.link) throw new Error("The invitation could not be created.");
  return data;
}
export async function requestLeagueSync(seasonId?: string) {
  const { error } = await getBrowserClient().rpc("request_league_sync", {
    p_club_id: clubId,
    ...(seasonId ? { p_season_id: seasonId } : {}),
  });
  if (error)
    throw new Error(
      "LeagueApps refresh could not be requested. Please try again.",
    );
}
export async function previewSeasonImport(
  link: string,
  teamId: string,
  timeZone: string,
) {
  const { data, error } = await getBrowserClient().functions.invoke(
    "season-import",
    {
      body: { clubId, link, teamId, timeZone },
    },
  );
  if (error) {
    let message = "The season preview could not be loaded. Please try again.";
    if (error.context instanceof Response) {
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* preserve safe transport message */
      }
    }
    throw new Error(message);
  }
  return data as SeasonImportPreview | SeasonImportTeamChoice;
}
export async function createClubSeason(
  input: SeasonSetupInput,
  previewId?: string,
) {
  const { data, error } = await getBrowserClient().rpc("create_club_season", {
    p_club_id: clubId,
    p_input: input,
    p_preview_id: previewId || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function configureManualStandings(
  season: Season,
  enabled: boolean,
  teamNames: string[],
) {
  const { error } = await getBrowserClient().rpc("configure_manual_standings", {
    p_season_id: season.id,
    p_expected_revision: season.settingsRevision || 0,
    p_enabled: enabled,
    p_team_names: teamNames,
  });
  if (error) throw new Error(error.message);
}
export async function readManualLeagueResults(seasonId: string) {
  const { data, error } = await getBrowserClient().rpc(
    "get_manual_league_results",
    { p_season_id: seasonId },
  );
  if (error)
    throw new Error("League results could not be loaded. Please try again.");
  return data as ManualLeagueResult[];
}
export async function writeManualLeagueResult(
  result: ManualLeagueResult,
  remove = false,
) {
  const { error } = await getBrowserClient().rpc("write_manual_league_result", {
    p_season_id: result.seasonId,
    p_expected_revision: result.revision,
    p_result: result,
    p_remove: remove,
  });
  if (error) throw new Error(error.message);
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
export async function readSeasonStats(
  seasonId: string,
): Promise<SeasonStatsSnapshot> {
  const { data, error } = await getBrowserClient().rpc("get_season_stats", {
    p_club_id: clubId,
    p_season_id: seasonId,
  });
  if (error)
    throw new Error("Player stats could not be loaded. Please try again.");
  return data as SeasonStatsSnapshot;
}
export async function readPlayerDirectory(): Promise<DirectoryPlayer[]> {
  const { data, error } = await getBrowserClient().rpc("get_player_directory", {
    p_club_id: clubId,
  });
  if (error)
    throw new Error(
      "The player directory could not be loaded. Check your team access and try again.",
    );
  return data as DirectoryPlayer[];
}
export async function writePlayerDetails(player: Player) {
  const { data, error } = await getBrowserClient().rpc("save_player_details", {
    p_club_id: clubId,
    p_player_id: player.id,
    p_expected_revision: player.captainDetails?.revision ?? 0,
    p_details: {
      ...player.captainDetails,
      preferredPositions: player.preferredPositions || [],
    },
  });
  if (error) throw new Error(error.message);
  return data as {
    captainDetails: CaptainPlayerDetails;
    preferredPositions: PreferredPosition[];
  };
}
export async function readMemberPlayerProfiles(): Promise<ClubSnapshot> {
  const { data, error } = await getBrowserClient().rpc(
    "get_member_player_profiles",
    {
      p_club_id: clubId,
    },
  );
  if (error)
    throw new Error(
      "Team player profiles could not be loaded. Check your team access and try again.",
    );
  return data as ClubSnapshot;
}
export type GuestInput = {
  playerId?: string;
  player?: Pick<Player, "name" | "number" | "position">;
  allowSameName?: boolean;
  remove?: boolean;
};
export async function writeMatchGuest(
  matchId: string,
  revision: number,
  input: GuestInput,
): Promise<GuestChange> {
  const { data, error } = input.remove
    ? await getBrowserClient().rpc("remove_match_guest", {
        p_match_id: matchId,
        p_expected_revision: revision,
        p_player_id: input.playerId!,
      })
    : await getBrowserClient().rpc("add_match_guest", {
        p_match_id: matchId,
        p_expected_revision: revision,
        p_player_id: input.playerId || null,
        p_player: input.player || null,
        p_allow_same_name: input.allowSameName || false,
      });
  if (error)
    throw new Error(
      error.code === "40001"
        ? "This match changed. Reload its latest record before changing guests; your unsaved edits are still here."
        : error.message,
    );
  return data as GuestChange;
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
export async function writeFixtureRemoval(match: Match, removed: boolean) {
  const { error } = await getBrowserClient().rpc("set_fixture_removed", {
    p_match_id: match.id,
    p_expected_revision: match.revision ?? 0,
    p_removed: removed,
  });
  if (error) throw new Error(error.message);
}
export async function writeSeasonComplete(
  seasonId: string,
  revision: number,
  completed: boolean,
) {
  const { error } = await getBrowserClient().rpc("set_season_complete", {
    p_season_id: seasonId,
    p_expected_revision: revision,
    p_completed: completed,
  });
  if (error) throw new Error(error.message);
}
export async function writePlayer(player: Player, seasonId: string) {
  const { error } = await getBrowserClient().rpc("save_roster_player", {
    p_club_id: clubId,
    p_season_id: seasonId,
    p_player: player,
  });
  if (error) throw new Error(error.message);
}
