import { createClient } from "@supabase/supabase-js";
import {
  fetchLeaguePage,
  leagueSourceFromLink,
  parseLeagueSnapshot,
  parseLeagueTeams,
} from "../_shared/leagueapps.ts";

const site = "https://mauve-fc-club-prototype.deluxehill3.chatgpt.site";
const origins = new Set([
  site,
  "https://mauve-fc-club-prototype.njk345.chatgpt.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3100",
]);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : site,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: cors });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (origin && !origins.has(origin))
    return reply({ error: "Origin not allowed" }, 403);
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return reply({ error: "Sign in required" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const publishable =
    JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default ||
    Deno.env.get("SUPABASE_ANON_KEY")!;
  const caller = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply({ error: "Sign in required" }, 401);
  let body: {
    clubId: string;
    link: string;
    teamId?: string;
    timeZone?: string;
  };
  try {
    const raw = await req.text();
    if (raw.length > 4000) throw new Error();
    body = JSON.parse(raw);
    if (
      typeof body.clubId !== "string" ||
      typeof body.link !== "string" ||
      (body.teamId !== undefined && typeof body.teamId !== "string") ||
      (body.timeZone !== undefined && typeof body.timeZone !== "string")
    )
      throw new Error();
  } catch {
    return reply({ error: "Enter a LeagueApps page link" }, 400);
  }
  const { data: captain, error: accessError } = await caller.rpc("is_captain", {
    p_club_id: body.clubId,
  });
  if (accessError || !captain)
    return reply({ error: "Captain access required" }, 403);
  let source;
  try {
    source = leagueSourceFromLink(
      body.link,
      body.teamId,
      body.timeZone || "America/New_York",
    );
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Invalid LeagueApps link" },
      400,
    );
  }
  try {
    const standingsHtml = await fetchLeaguePage(source.standingsUrl);
    const teams = parseLeagueTeams(standingsHtml, source);
    if (!source.teamId)
      return reply({
        phase: "choose-team",
        teams,
        origin: source.origin,
        programId: source.programId,
      });
    const scheduleHtml = await fetchLeaguePage(source.scheduleUrl);
    const snapshot = parseLeagueSnapshot(scheduleHtml, standingsHtml, source);
    const secret =
      JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: previewId, error } = await admin.rpc("stage_season_import", {
      p_club_id: body.clubId,
      p_user_id: user.id,
      p_config: {
        origin: source.origin,
        programId: source.programId,
        teamId: source.teamId,
        timeZone: source.timeZone,
      },
      p_snapshot: snapshot,
    });
    if (error) throw new Error("Could not prepare import");
    return reply({
      phase: "ready",
      previewId,
      teamName: teams.find((team) => team.teamId === source.teamId)!.name,
      divisionName: snapshot.standings[0]?.divisionName,
      source: {
        origin: source.origin,
        programId: source.programId,
        teamId: source.teamId,
      },
      games: snapshot.games,
      standings: snapshot.standings,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch {
    return reply(
      {
        error:
          "The league pages could not be read. Check the link and team, and make sure the schedule and standings are public.",
      },
      422,
    );
  }
});
