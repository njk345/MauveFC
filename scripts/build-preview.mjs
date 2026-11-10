import { rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// Static export requires cacheable fetches. Each publication must start from a
// fresh public Supabase snapshot rather than a previous build's data cache.
await rm(path.join(process.env.MAUVE_BUILD_DIR || ".next", "cache", "fetch-cache"), {
  recursive: true,
  force: true,
});
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
  env: { ...process.env, MAUVE_STATIC_EXPORT: "true" },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
