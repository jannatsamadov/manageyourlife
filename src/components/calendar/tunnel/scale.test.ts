import { describe, expect, it } from "vitest";
import { HOURS, Scale } from "./scale";

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const today = day("2026-11-21"); // a Saturday

describe("tunnel scale", () => {
  it("day: 06:00 of today is row 0, an hour a row, the night before 06:00", () => {
    const s = new Scale("day", today);
    expect(s.rowOf(today, 6 * 60)).toBe(0);
    expect(s.rowOf(today, 9 * 60 + 30)).toBe(3.5);
    expect(s.rowOf(today + 2, 6 * 60)).toBe(2 * (HOURS + 4));
    expect(s.rowOf(today, 0)).toBe(-4);
    expect(s.at(s.rowOf(today + 1, 14 * 60)).minutes).toBe(14 * 60);
    expect(s.at(s.rowOf(today + 1, 3 * 60)).day).toBe(today + 1);
  });

  it("month: rows are the month's days, boxes follow each other", () => {
    const s = new Scale("month", today);
    expect(s.rows(0)).toBe(30);
    expect(s.rowOf(today)).toBe(20);
    expect(s.start(1)).toBe(30 + 3);
    expect(s.rowOf(day("2026-12-01"))).toBe(33);
    expect(s.start(-1)).toBe(-(31 + 3));
    for (const iso of ["2026-01-31", "2026-02-28", "2027-03-15", "2025-12-31"]) {
      const d = day(iso);
      expect(s.at(s.rowOf(d)).day).toBe(d);
      expect(s.boxAt(s.rowOf(d))).toBe(s.boxOfDay(d));
    }
  });

  it("year: a week a row, the weekday a lane", () => {
    const s = new Scale("year", today);
    expect(s.dayRange(0)).toEqual([day("2026-01-01"), day("2027-01-01")]);
    expect(s.rowOf(day("2026-01-01"))).toBe(0); // a Thursday, in the first week row
    expect(s.rowOf(day("2026-01-05"))).toBe(1); // the next Monday
    expect(s.laneOf(day("2026-01-05"))).toBe(0);
    expect(s.dayOfCell(0, 0, 0)).toBe(null); // Mon 29 Dec 2025 is not in 2026
    expect(s.dayOfCell(0, 0, 3)).toBe(day("2026-01-01"));
    const last = day("2026-12-31");
    expect(s.rowOf(last)).toBe(s.rows(0) - 1);
    expect(s.rowOf(day("2027-01-01"))).toBe(s.rows(0) + 4);
  });
});
