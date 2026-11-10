import { liveMode } from "./supabase/config";
export function playerHref(id: string) {
  return (!liveMode || process.env.NEXT_PUBLIC_MAUVE_STATIC_HOST === "true") &&
    /^[0-9a-f]{8}-/i.test(id)
    ? `/players/profile/?id=${encodeURIComponent(id)}`
    : `/players/${encodeURIComponent(id)}/`;
}
