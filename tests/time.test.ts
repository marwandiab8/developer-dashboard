import { describe, expect, it, vi } from "vitest";
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE, toDisplayDate } from "../src/lib/utils/time";

describe("time formatting", () => {
  it("uses explicit locale and timezone for display formatting", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");

    const formatted = toDisplayDate("2026-07-28T12:34:56.789Z");

    expect(formatted).toBeTruthy();

    const [locale, options] = spy.mock.calls[0];
    expect(locale).toBe(DISPLAY_LOCALE);
    expect(options?.timeZone).toBe(DISPLAY_TIME_ZONE);
    expect(options?.year).toBe("numeric");

    spy.mockRestore();
  });

  it("formats the same input deterministically", () => {
    const source = "2026-07-28T12:34:56.789Z";
    const first = toDisplayDate(source);
    const second = toDisplayDate(source);

    expect(first).toBe(second);
  });

  it("returns Unknown for invalid timestamps", () => {
    expect(toDisplayDate("not-a-date")).toBe("Unknown");
  });
});
