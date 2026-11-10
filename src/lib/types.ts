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
export type Result = {
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
export type Match = {
  source?: "leagueapps";
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
  id: string;
  name: string;
  competition: string;
  format: string;
};
export type PrototypeData = {
  version: 1;
  players?: Player[];
  roster?: { seasonId: string; playerId: string }[];
  matches: Match[];
  drafts?: Record<string, Result>;
  history: { matchId: string; at: string; before?: Result; after: Result }[];
};
