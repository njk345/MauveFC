export function toNewYorkInput(instant: string | null) {
  if (!instant) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function fromNewYorkInput(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("Enter a valid kickoff date and time.");
  const naive = Date.parse(value + "Z");
  if (!Number.isFinite(naive)) throw new Error("Invalid kickoff date.");
  const candidates = [4, 5]
    .map((h) => new Date(naive + h * 3600000).toISOString())
    .filter((instant) => toNewYorkInput(instant) === value);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice at the daylight-saving change. Choose an unambiguous kickoff time."
        : "This local time does not exist. Check the daylight-saving change.",
    );
  return candidates[0];
}
