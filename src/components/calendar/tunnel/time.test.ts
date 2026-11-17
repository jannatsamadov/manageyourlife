import { describe, expect, it } from "vitest";
import { Q, dayOf, isoWeek, labelOf, levelOf, marks, weekdayOf } from "./time";

const D = (iso: string) => dayOf(iso);

describe("tunnel time", () => {
  it("knows Mondays", () => {
    expect(weekdayOf(D("2026-11-02"))).toBe(0); // Monday
    expect(weekdayOf(D("2026-11-08"))).toBe(6); // Sunday
  });

  it("gives a mark to its highest level only", () => {
    expect(levelOf(D("2027-01-01") * Q)).toBe("year");
    expect(levelOf(D("2026-12-01") * Q)).toBe("month"); // a Tuesday
    expect(levelOf(D("2026-11-02") * Q)).toBe("week");
    expect(levelOf(D("2026-11-03") * Q)).toBe("day");
    expect(levelOf(D("2026-11-03") * Q + 4)).toBe("hour");
    expect(levelOf(D("2026-11-03") * Q + 5)).toBe("quarter");
  });

  it("lists marks without the ones of a higher level", () => {
    const t0 = D("2026-10-30"), t1 = D("2026-11-10");
    expect(marks("month", t0, t1)).toEqual([D("2026-11-01")]);
    expect(marks("week", t0, t1)).toEqual([D("2026-11-02"), D("2026-11-09")]);
    const days = marks("day", t0, t1);
    expect(days).not.toContain(D("2026-11-01"));
    expect(days).not.toContain(D("2026-11-02"));
    expect(days).toContain(D("2026-10-30"));
    expect(marks("hour", t0, t0 + 0.2).length).toBe(4); // 01:00 … 04:00
    expect(marks("year", D("2025-06-01"), D("2028-06-01"))).toEqual([D("2026-01-01"), D("2027-01-01"), D("2028-01-01")]);
  });

  it("writes labels", () => {
    expect(labelOf("year", D("2027-01-01"))).toBe("2027");
    expect(labelOf("month", D("2026-11-01"))).toBe("Nov");
    expect(labelOf("day", D("2026-11-03"))).toBe("Tue 3");
    expect(labelOf("hour", D("2026-11-03") + 14 / 24)).toBe("14:00");
    expect(isoWeek(D("2026-11-02"))).toBe(45);
    expect(isoWeek(D("2027-01-01"))).toBe(53);
  });
});
