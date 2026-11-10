export const liveMode = process.env.NEXT_PUBLIC_MAUVE_MODE === "live";
export const clubId = process.env.NEXT_PUBLIC_MAUVE_CLUB_ID || "";
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const configured = Boolean(
  liveMode &&
  /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:|\/))/.test(supabaseUrl) &&
  publishableKey &&
  clubId,
);
