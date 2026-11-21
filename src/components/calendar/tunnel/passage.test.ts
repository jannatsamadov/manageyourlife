import { describe, expect, it } from "vitest";
import { HOURS, NIGHT_ROWS, PERIOD, rowAt, timeAt } from "./passage";

describe("tunnel rows ↔ time", () => {
  it("puts today's 06:00 at row 0 and an hour per row", () => {
    expect(rowAt(0, 6 * 60)).toBe(0);
    expect(rowAt(0, 9 * 60 + 30)).toBe(3.5);
    expect(rowAt(2, 6 * 60)).toBe(2 * PERIOD);
  });

  it("puts the hours before 06:00 into the night band in front of the day", () => {
    expect(rowAt(0, 0)).toBe(-PERIOD + HOURS);
    expect(rowAt(0, 3 * 60)).toBe(-PERIOD + HOURS + NIGHT_ROWS / 2);
  });

  it("reads the time back", () => {
    for (const [k, m] of [[0, 6 * 60], [0, 14 * 60 + 15], [3, 23 * 60], [1, 2 * 60], [-1, 0]] as const) {
      const t = timeAt(rowAt(k, m));
      expect(t.k).toBe(k);
      expect(t.minutes).toBeCloseTo(m, 6);
    }
  });
});
