export const date = (
  value: string | null,
  style: "short" | "long" = "short",
) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: style === "long" ? "long" : "short",
        day: "numeric",
        weekday: style === "long" ? "long" : undefined,
      }).format(new Date(value))
    : "Date to be confirmed";
export const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value))
    : "Kickoff TBC";
export const month = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "short",
      }).format(new Date(value))
    : "TBC";
export const day = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        day: "2-digit",
      }).format(new Date(value))
    : "—";
