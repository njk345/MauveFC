export function matchdayHref(
  matchId: string,
  report = false,
  page: "/team/" | "/login/" = "/team/",
) {
  const query = new URLSearchParams({ match: matchId });
  if (report) query.set("view", "report");
  return `${page}?${query}`;
}
