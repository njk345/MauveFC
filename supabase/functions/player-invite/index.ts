import { createClient } from "@supabase/supabase-js";

const site = "https://mauve-fc-club-prototype.deluxehill3.chatgpt.site";
const allowedOrigins = new Set([
  site,
  "https://mauve-fc-club-prototype.njk345.chatgpt.site",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
]);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : site,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
  const response = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: cors });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")
    return response({ error: "Method not allowed" }, 405);
  if (origin && !allowedOrigins.has(origin))
    return response({ error: "Origin not allowed" }, 403);
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return response({ error: "Sign in required" }, 401);
  const publishable =
    JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default ||
    Deno.env.get("SUPABASE_ANON_KEY")!;
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(authorization.slice(7));
  if (authError || !user) return response({ error: "Sign in required" }, 401);
  let body: { clubId: string; playerId: string; email: string };
  try {
    const raw = await req.text();
    if (raw.length > 2000) throw new Error();
    body = JSON.parse(raw);
    if (
      typeof body.email !== "string" ||
      typeof body.clubId !== "string" ||
      typeof body.playerId !== "string"
    )
      throw new Error();
  } catch {
    return response({ error: "Invalid invitation request" }, 400);
  }
  const { data: invite, error: prepareError } = await caller.rpc(
    "prepare_player_invite",
    { p_club_id: body.clubId, p_player_id: body.playerId, p_email: body.email },
  );
  if (prepareError)
    return response(
      {
        error:
          prepareError.code === "42501"
            ? "Captain access required"
            : prepareError.message,
      },
      prepareError.code === "42501" ? 403 : 400,
    );
  // Existing identities outside this roster must sign in normally; a captain
  // cannot obtain a recovery credential for another club or captain account.
  if (invite.type === "existing")
    return response({ link: site + "/login/", existingAccount: true });
  try {
    const secret =
      JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Generates a one-use credential; sends no email and changes no password.
    const { data, error } = await admin.auth.admin.generateLink({
      type: invite.type as "invite" | "recovery",
      email: body.email.trim().toLowerCase(),
      options: { redirectTo: site + "/login/" },
    });
    if (error || !data.properties?.hashed_token) throw new Error();
    // Fragments stay out of HTTP logs/referrers. Acceptance requires a button
    // press, so merely previewing the link cannot consume the invitation.
    return response({
      link:
        site +
        "/login/#" +
        new URLSearchParams({
          token_hash: data.properties.hashed_token,
          type: invite.type,
        }).toString(),
    });
  } catch {
    await caller.rpc("cancel_player_invite", {
      p_club_id: body.clubId,
      p_player_id: body.playerId,
      p_generation: invite.generation,
    });
    return response(
      {
        error:
          "The sign-in link could not be generated. No email was sent. Try again shortly.",
      },
      502,
    );
  }
});
