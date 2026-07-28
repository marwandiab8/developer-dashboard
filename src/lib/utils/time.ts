export const nowIso = (): string => new Date().toISOString();

export const DISPLAY_LOCALE = "en-CA";
export const DISPLAY_TIME_ZONE = "America/Toronto";

export const toDisplayDate = (value?: string): string => {
  if (!value) return "Unknown";
  try {
    const valueDate = new Date(value);
    if (Number.isNaN(valueDate.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: DISPLAY_TIME_ZONE,
    }).format(valueDate);
  } catch {
    return "Unknown";
  }
};
