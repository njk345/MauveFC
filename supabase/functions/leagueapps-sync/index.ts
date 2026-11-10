import { createClient } from "@supabase/supabase-js";
import { parseLeagueSnapshot, source } from "../_shared/leagueapps.ts";

// Only Postgres dispatches jobs. Browser callers use the captain-authorized RPC.
// verify_jwt=false is required for pg_net; a private, expiring, single-use token
// is validated by the service-only begin RPC before any outbound fetch happens.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  let token: string;
  try {
    if (Number(req.headers.get("content-length") || 0) > 1024)
      throw new Error();
    const body = await req.text();
    if (body.length > 1024) throw new Error();
    token = JSON.parse(body).token;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    )
      throw new Error();
  } catch {
    return new Response("Invalid job", { status: 400 });
  }
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: config, error } = await admin.rpc("begin_league_sync", {
    p_token: token,
  });
  if (
    error ||
    config?.programId !== source.programId ||
    config?.teamId !== source.teamId
  )
    return new Response("Invalid job", { status: 403 });
  try {
    async function page(url: string) {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "text/html",
          "User-Agent": "MauveFC-LeagueSync/1.0",
        },
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/html")
      )
        throw new Error("Source unavailable");
      const reader = response.body!.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Error("Source too large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder().decode(bytes);
    }
    const [schedule, standings] = await Promise.all([
      page(source.scheduleUrl),
      page(source.standingsUrl),
    ]);
    const snapshot = parseLeagueSnapshot(schedule, standings);
    const { data, error: applyError } = await admin.rpc("apply_league_sync", {
      p_token: token,
      p_snapshot: snapshot,
    });
    if (applyError) throw new Error("Import rejected");
    return Response.json({ ok: true, ...data });
  } catch {
    await admin.rpc("fail_league_sync", { p_token: token });
    return Response.json(
      {
        ok: false,
        error: "LeagueApps refresh failed; previous data retained.",
      },
      { status: 502 },
    );
  }
});
