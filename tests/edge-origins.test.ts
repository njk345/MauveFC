import test from "node:test";
import assert from "node:assert/strict";

type Handler = (request: Request) => Response | Promise<Response>;
const currentSite = "https://mauve-fc-club-prototype.njk345.chatgpt.site";
const legacySite = "https://mauve-fc-club-prototype.deluxehill3.chatgpt.site";

test("browser-facing Edge functions accept both club origins and preserve their auth gates", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Deno");
  let handler: Handler | undefined;
  Object.defineProperty(globalThis, "Deno", {
    configurable: true,
    value: {
      serve(callback: Handler) {
        handler = callback;
      },
      env: {
        get() {
          throw new Error("Preflight and unauthenticated requests must not reach database setup");
        },
      },
    },
  });
  try {
    for (const name of ["season-import", "player-invite"]) {
      handler = undefined;
      await import(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).href);
      assert.ok(handler, `${name} registers its request handler`);
      const handle = handler as Handler;
      await t.test(`${name}: current and legacy sites pass preflight but still require sign-in`, async () => {
        for (const origin of [currentSite, legacySite]) {
          const preflight = await handle(new Request("https://edge.example.test", {
            method: "OPTIONS",
            headers: {
              origin,
              "Access-Control-Request-Method": "POST",
              "Access-Control-Request-Headers": "authorization,apikey,content-type,x-client-info",
            },
          }));
          assert.equal(preflight.status, 204);
          assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
          assert.equal(preflight.headers.get("Vary"), "Origin");
          const request = await handle(new Request("https://edge.example.test", {
            method: "POST", headers: { origin }, body: "{}",
          }));
          assert.equal(request.status, 401);
          assert.deepEqual(await request.json(), { error: "Sign in required" });
          assert.equal(request.headers.get("Access-Control-Allow-Origin"), origin);
        }
      });
      await t.test(`${name}: unrelated and deceptive origins remain blocked`, async () => {
        for (const origin of ["https://unrelated.chatgpt.site", `${currentSite}.example.test`]) {
          const response = await handle(new Request("https://edge.example.test", {
            method: "POST", headers: { origin }, body: "{}",
          }));
          assert.equal(response.status, 403);
          assert.notEqual(response.headers.get("Access-Control-Allow-Origin"), origin);
          assert.deepEqual(await response.json(), { error: "Origin not allowed" });
        }
      });
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "Deno", previous);
    else Reflect.deleteProperty(globalThis, "Deno");
  }
});
