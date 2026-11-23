export type Capture = "unrecorded" | "partial" | "complete";
export type Player = {
  isPublic?: boolean;
  id: string;
  name: string;
  number: number;
  position: "Forward" | "Midfielder" | "Defender" | "Goalkeeper";
  initials: string;
  hometown: string;
  bio: string;
};
export type PlayerStat = {
  playerId: string;
  appeared: boolean;
  goals: number;
  assists: number | null;
};
export type DirectoryPlayer = Player & {
  rosterSeasonIds: string[];
  guestGames: number;
  appearances: number;
};
export type GuestChange = {
  matchId: string;
  revision: number;
  action: "add" | "remove";
  player: Player;
};
export type PlayerSeasonStats = Pick<
  Player,
  "id" | "name" | "number" | "position" | "initials" | "isPublic"
> & {
  isGuest?: boolean;
  appearances: number;
  goals: number;
  assists: number;
  appearancesKnown: boolean;
  goalsKnown: boolean;
  assistsKnown: boolean;
};
export type SeasonStatsSnapshot = {
  teamView: boolean;
  privatePlayerCount: number;
  assistsTotal: number | null;
  assistsRecordedMatches: number;
  assistsCompleteMatches: number;
  players: PlayerSeasonStats[];
};
export type RsvpResponse = "in" | "maybe" | "out";
export type MatchRsvp = {
  matchId: string;
  playerId: string;
  response: RsvpResponse;
  updatedAt: string;
  needsConfirmation: boolean;
};
export type Formation = "2-3-1" | "3-2-1" | "2-2-2";
export type LineupPayload = {
  formation: Formation;
  starters: (string | null)[];
  bench: string[];
  benchPositions?: Record<string, number>;
  firstNamesOnly?: boolean;
  hideNumbers?: boolean;
};
export type MatchLineup = {
  matchId: string;
  payload: LineupPayload;
  shared: boolean;
  updatedAt: string;
  revision?: number;
  hasDraft?: boolean;
};
export type LineupPost = {
  id: string;
  matchId: string;
  kind: "official" | "suggestion";
  payload: LineupPayload;
  authorName: string;
  createdAt: string;
  canDelete: boolean;
};
export type PlayerAccount = {
  playerId: string;
  status: "active" | "invited" | "expired" | "unlinked";
  email: string | null;
  role: "captain" | "player" | null;
  expiresAt: string | null;
};
export type Result = {
  decision?: "regulation" | "overtime" | "penalties";
  penaltyOutcome?: "W" | "L" | null;
  baseRevision?: number;
  home: number;
  away: number;
  onFieldHome: number;
  onFieldAway: number;
  basis: "played" | "forfeit" | "adjusted";
  reason: string;
  attendance: Capture;
  scorers: Capture;
  assists: Capture;
  ownGoals: number;
  stats: PlayerStat[];
  published: boolean;
  updatedAt?: string;
};
export type PlayoffRound = "playoffs" | "quarterfinals" | "semifinals" | "finals";
export type Match = {
  playoffRound?: PlayoffRound | null;
  guestPlayerIds?: string[];
  source?: string;
  externalId?: string;
  fixtureOverride?: boolean;
  resultSource?: "leagueapps" | "captain";
  needsReview?: boolean;
  leagueScore?: {
    home: number;
    away: number;
    basis: "played" | "forfeit";
  } | null;
  revision?: number;
  id: string;
  seasonId: string;
  opponent: string;
  opponentCode: string;
  color: string;
  kickoff: string | null;
  venue: string;
  round: number;
  home: boolean;
  status: "scheduled" | "completed" | "postponed" | "cancelled";
  result?: Result;
};
export type RemovedFixture = Match & {
  source: string;
  removedAt: string;
  feedAvailable?: boolean | null;
};
export type LeagueStanding = {
  position: number;
  teamId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  difference: number;
  forfeits: number;
  points: number;
};
export type LeagueConnection = {
  seasonId: string;
  teamId: string;
  teamName: string;
  standings: LeagueStanding[];
  lastSuccess: string | null;
  lastAttempt: string | null;
  error: string | null;
  state: "idle" | "queued" | "running" | "succeeded" | "failed";
};
export type Season = {
  completed?: boolean;
  completedAt?: string | null;
  finalPosition?: number | null;
  revision?: number;
  id: string;
  name: string;
  competition: string;
  format: string;
};
export type PrototypeData = {
  removedFixtures?: RemovedFixture[];
  seasons?: Season[];
  version: 1;
  players?: Player[];
  roster?: { seasonId: string; playerId: string }[];
  matches: Match[];
  drafts?: Record<string, Result>;
  history: { matchId: string; at: string; before?: Result; after: Result }[];
};
