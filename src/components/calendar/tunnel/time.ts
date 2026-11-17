// Time along the tunnel (P-62). A time is a day number with a fraction: days since 1970-01-01 in the user's own
// calendar (the count the other views use), 0.5 = noon. Marks on the time axis (new year, month, week, day, hour,
// quarter hour) are whole quarter hours, so they are counted in quarter hours and compare exactly.
export const DAY_MS = 86400000;
export const Q = 96; // quarter hours a day

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Level = "year" | "month" | "week" | "day" | "hour" | "quarter";
export const LEVELS: Level[] = ["year", "month", "week", "day", "hour", "quarter"];
// The usual length of one step of a level, in days.
export const UNIT: Record<Level, number> = { year: 365.25, month: 30.44, week: 7, day: 1, hour: 1 / 24, quarter: 1 / Q };

// Zoom stops: how much time the passage holds ahead of you. Zoom is continuous; the stops are where the ladder's
// steps are and what the heading shows.
export const STOPS = [
  { name: "Years", span: 6 * 365, step: 365.25 },
  { name: "Year", span: 365, step: 30.44 },
  { name: "Month", span: 35, step: 7 },
  { name: "Week", span: 8, step: 1 },
  { name: "Day", span: 1.1, step: 1 / 24 },
  { name: "Hours", span: 0.25, step: 1 / Q },
];

export const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const isoOf = (day: number) => new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10);
const dateOf = (day: number) => new Date(Math.floor(day) * DAY_MS);

// Now, in the same count (local wall clock).
export function nowTime(d = new Date()) {
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  return day + (d.getHours() * 60 + d.getMinutes()) / 1440;
}

// "13:15" / "13:15:00" → fraction of a day.
export const fractionOf = (time: string | null | undefined) => {
  const m = time?.match(/^(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : null;
};

// Monday-based: day 4 (1970-01-05) was a Monday.
export const weekdayOf = (day: number) => (((Math.floor(day) - 4) % 7) + 7) % 7; // 0 = Monday … 6 = Sunday
export const mondayOf = (day: number) => Math.floor(day) - weekdayOf(day);

// The highest level a quarter-hour mark belongs to (1 Jan is a year mark, not also a month, week or day mark).
export function levelOf(q: number): Level {
  if (q % 4) return "quarter";
  if (q % Q) return "hour";
  const d = q / Q;
  const x = dateOf(d);
  if (x.getUTCDate() === 1) return x.getUTCMonth() === 0 ? "year" : "month";
  if (weekdayOf(d) === 0) return "week";
  return "day";
}

// The marks of one level between two times, as times; marks owned by a higher level are left out.
export function marks(level: Level, t0: number, t1: number, max = 400): number[] {
  const out: number[] = [];
  if (!(t1 >= t0)) return out;
  const take = (q: number) => {
    if (levelOf(q) === level) out.push(q / Q);
  };
  let guard = 0;
  switch (level) {
    case "year":
      for (let y = dateOf(t0).getUTCFullYear(); guard++ < max; y++) {
        const d = Date.UTC(y, 0, 1) / DAY_MS;
        if (d > t1) break;
        if (d >= t0) out.push(d);
      }
      break;
    case "month": {
      const s = dateOf(t0);
      for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); guard++ < max * 2; m++) {
        if (m === 12) { m = 0; y++; }
        const d = Date.UTC(y, m, 1) / DAY_MS;
        if (d > t1) break;
        if (d >= t0) take(d * Q);
      }
      break;
    }
    case "week":
      for (let d = mondayOf(Math.ceil(t0)) + (weekdayOf(Math.ceil(t0)) ? 7 : 0); d <= t1 && guard++ < max * 2; d += 7) take(d * Q);
      break;
    case "day":
      for (let d = Math.ceil(t0); d <= t1 && guard++ < max * 2; d++) take(d * Q);
      break;
    case "hour":
      for (let q = Math.ceil(t0 * 24) * 4; q <= t1 * Q && guard++ < max * 2; q += 4) take(q);
      break;
    case "quarter":
      for (let q = Math.ceil(t0 * Q); q <= t1 * Q && guard++ < max * 2; q++) take(q);
      break;
  }
  return out.slice(0, max);
}

// ISO week number of the week holding this day.
export function isoWeek(day: number) {
  const thursday = mondayOf(day) + 3;
  const y = dateOf(thursday).getUTCFullYear();
  return Math.floor((thursday - Date.UTC(y, 0, 1) / DAY_MS) / 7) + 1;
}

const hhmm = (t: number) => {
  const mins = Math.round((t - Math.floor(t)) * 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};

// The text on a mark.
export function labelOf(level: Level, t: number) {
  const x = dateOf(t);
  switch (level) {
    case "year": return String(x.getUTCFullYear());
    case "month": return MONTHS[x.getUTCMonth()];
    case "week": return `W${isoWeek(t)}`;
    case "day": return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()}`;
    default: return hhmm(t);
  }
}

export const fmtDay = (day: number) => {
  const x = dateOf(day);
  return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

// The heading for the time in focus at a zoom stop.
export function headingOf(t: number, stop: number) {
  const x = dateOf(t);
  const y = x.getUTCFullYear(), mo = MONTHS[x.getUTCMonth()];
  if (stop <= 1) return String(y);
  if (stop === 2) return `${mo} ${y}`;
  if (stop === 3) return `W${isoWeek(t)} · ${mo} ${y}`;
  if (stop === 4) return fmtDay(t);
  return `${WEEKDAYS[x.getUTCDay()]} ${x.getUTCDate()} ${mo} · ${hhmm(t)}`;
}
