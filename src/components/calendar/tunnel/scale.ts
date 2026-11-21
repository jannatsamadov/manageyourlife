// The tunnel's spans (P-62 scope B, #191): the passage stays a passage, only what a row and a box mean changes.
//   day   — a box = a day,   a row = an hour (06:00 → 24:00), a dark band of 4 rows (the night)
//   month — a box = a month, a row = a day, a band of 3 rows
//   year  — a box = a year,  a row = a week, the 7 days across the floor (a 3-D GitHub activity year), a band of 4
// (A week span existed for a day; the owner dropped it, 2026-11-21 — it is on the local branch `tunnel-week`.)
// Days are epoch day numbers (UTC days since 1970-01-01, the way the calendar views count them). Box 0 holds today.
export type Span = "day" | "month" | "year";
export const SPANS: Span[] = ["day", "month", "year"];

export const HOUR_FROM = 6; // a day's box starts at 06:00 …
export const HOURS = 18; // … and runs to 24:00, a row per hour

const BAND: Record<Span, number> = { day: 4, month: 3, year: 4 };
const LANES: Record<Span, number> = { day: 5, month: 5, year: 7 };

const weekday = (day: number) => (day + 3) % 7; // Monday = 0 (1970-01-01 was a Thursday)
const ymd = (day: number) => {
  const d = new Date(day * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const dayOfYmd = (y: number, m: number, d = 1) => Math.floor(Date.UTC(y, m, d) / 86400000);
const floorDiv = (a: number, b: number) => Math.floor(a / b);

export class Scale {
  readonly span: Span;
  readonly band: number;
  readonly lanes: number;
  readonly today: number;
  private starts = new Map<number, number>(); // box → its first row
  private first: number; // the first day of box 0

  constructor(span: Span, today: number) {
    this.span = span;
    this.today = today;
    this.band = BAND[span];
    this.lanes = LANES[span];
    const t = ymd(today);
    this.first = span === "day" ? today : span === "month" ? dayOfYmd(t.y, t.m) : dayOfYmd(t.y, 0);
  }

  // The first day of box b and the day after its last one.
  dayRange(b: number): [number, number] {
    const t = ymd(this.first);
    switch (this.span) {
      case "day": return [this.first + b, this.first + b + 1];
      case "month": return [dayOfYmd(t.y, t.m + b), dayOfYmd(t.y, t.m + b + 1)];
      case "year": return [dayOfYmd(t.y + b, 0), dayOfYmd(t.y + b + 1, 0)];
    }
  }

  // Rows inside box b (the band after it not counted).
  rows(b: number) {
    const [from, to] = this.dayRange(b);
    switch (this.span) {
      case "day": return HOURS;
      case "month": return to - from;
      case "year": return floorDiv(to - 1 - this.weekStart(from), 7) + 1;
    }
  }

  private weekStart(day: number) {
    return day - weekday(day);
  }

  // The first row of box b (box 0 starts at row 0; a band follows every box).
  start(b: number): number {
    if (this.span === "day") return b * (HOURS + this.band);
    const hit = this.starts.get(b);
    if (hit !== undefined) return hit;
    let row = 0;
    if (b > 0) for (let i = 0; i < b; i++) row += this.rows(i) + this.band;
    else for (let i = -1; i >= b; i--) row -= this.rows(i) + this.band;
    this.starts.set(b, row);
    return row;
  }

  // The box a row is in (the band after a box belongs to it).
  boxAt(row: number) {
    if (this.span === "day") return Math.floor(row / (HOURS + this.band));
    const avg = this.span === "month" ? 30.44 + this.band : 52.6 + this.band;
    let b = Math.floor(row / avg);
    while (this.start(b) > row) b--;
    while (this.start(b + 1) <= row) b++;
    return b;
  }

  // Where a day is: its row (fractional for a time of day in the day span) and, in the year span, its lane.
  rowOf(day: number, minutes: number | null = null): number {
    const b = this.boxOfDay(day);
    const [from] = this.dayRange(b);
    switch (this.span) {
      case "day": {
        const m = minutes ?? HOUR_FROM * 60;
        // the hours before 06:00 are the night band in front of the day
        if (m >= HOUR_FROM * 60) return this.start(b) + Math.min(m - HOUR_FROM * 60, HOURS * 60) / 60;
        return this.start(b - 1) + HOURS + (m / (HOUR_FROM * 60)) * this.band;
      }
      case "month": return this.start(b) + (day - from);
      case "year": return this.start(b) + floorDiv(day - this.weekStart(from), 7);
    }
  }
  laneOf(day: number) {
    return weekday(day);
  }

  boxOfDay(day: number) {
    switch (this.span) {
      case "day": return day - this.first;
      case "month": {
        const a = ymd(this.first), d = ymd(day);
        return (d.y - a.y) * 12 + (d.m - a.m);
      }
      case "year": return ymd(day).y - ymd(this.first).y;
    }
  }

  // What a row shows: the day (and, in the day span, the time) — for the label of where the camera is.
  at(row: number): { day: number; minutes: number | null; band: boolean } {
    const b = this.boxAt(row);
    const local = row - this.start(b);
    const rows = this.rows(b);
    const [from, to] = this.dayRange(b);
    if (this.span === "day") {
      if (local < HOURS) return { day: from, minutes: HOUR_FROM * 60 + local * 60, band: false };
      return { day: from + 1, minutes: ((local - HOURS) / this.band) * HOUR_FROM * 60, band: true };
    }
    if (local >= rows) return { day: to, minutes: null, band: true };
    if (this.span === "year") return { day: Math.max(from, this.weekStart(from) + Math.floor(local) * 7), minutes: null, band: false };
    return { day: from + Math.floor(local), minutes: null, band: false };
  }

  // The day a cell stands for (null in a band or outside the box): rows → days; in the year a lane is a weekday.
  dayOfCell(b: number, localRow: number, lane: number | null): number | null {
    const [from, to] = this.dayRange(b);
    if (localRow < 0 || localRow >= this.rows(b)) return null;
    if (this.span === "day") return from;
    if (this.span === "year") {
      if (lane === null) return null;
      const day = this.weekStart(from) + localRow * 7 + lane;
      return day >= from && day < to ? day : null;
    }
    return from + localRow;
  }
}
