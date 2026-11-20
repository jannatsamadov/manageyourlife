// The views engine (P-69, T-114): fields, the filter language, sort and group by over items. Pure functions, no React,
// so the layouts (table, board, timeline …), the tests and later a phone app share them. One person's items are a few
// thousand rows at most, so everything runs in the browser over the cached items.
// Fields are the built-in columns plus the workspace's custom fields (table `fields`, values in items.props; their
// key in a view is "props.<key>", in the filter just "<key>:").
import type { Item, ItemPatch } from "@/core/items";
import { CLOSED_STATUSES, ITEM_TYPES, PRIORITIES, STATUSES, TYPE_ORDER, type ItemType } from "@/core/types";

export type BuiltinField =
  | "title" | "type" | "status" | "priority" | "parent" | "when" | "planned_on" | "due_on" | "start_on"
  | "estimate_min" | "spent_min" | "created_at" | "updated_at" | "done_at" | "url";
export type FieldKey = BuiltinField | `props.${string}`;
export type Layout = "table" | "board" | "timeline";
export type SortRule = { field: FieldKey; desc?: boolean };
export type ViewConfig = {
  filter: string;
  group_by: FieldKey | null;
  sort: SortRule[];
  fields: FieldKey[]; // table columns / lines on a card (title is always shown)
  board_by?: FieldKey; // the board's columns
  slice_by?: FieldKey | null; // the slice panel's field
  zoom?: "month" | "quarter" | "year"; // the timeline's scale
  new_type?: ItemType; // what "+ Add" makes in this view
};

// A custom field (P-70 "Adding columns later"): a row of `fields`; select options keep their id when renamed.
export type CustomKind = "text" | "number" | "date" | "select" | "checkbox" | "url";
export type FieldOption = { id: string; name: string; color?: string };
// item_types: the types it is shown for in the item drawer (null = every type).
export type CustomField = { id: string; key: string; name: string; kind: CustomKind; options: FieldOption[]; position: number; item_types?: string[] | null };
export const CUSTOM_KINDS: { id: CustomKind; label: string }[] = [
  { id: "text", label: "Text" }, { id: "number", label: "Number" }, { id: "date", label: "Date" },
  { id: "select", label: "Select" }, { id: "checkbox", label: "Checkbox" }, { id: "url", label: "Link" },
];

export type Ctx = { byId: Map<string, Item>; today: string; fields: Record<string, FieldDef> };

// ── dates (local days as YYYY-MM-DD) ──
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
const dayOfStamp = (ts: string | null) => (ts ? localDay(new Date(ts)) : null);
export const makeCtx = (items: Item[], now = new Date(), custom: CustomField[] = []): Ctx => ({
  byId: new Map(items.map((i) => [i.id, i])), today: localDay(now), fields: fieldsWith(custom),
});

export const isOpen = (i: Item) => !CLOSED_STATUSES.includes(i.status as never);
// The day an item needs attention: its planned day or its deadline, whichever comes first.
export const whenOf = (i: Item) => [i.planned_on, i.due_on].filter(Boolean).sort()[0] ?? null;

// ── fields ──
type Kind = "text" | "type" | "status" | "priority" | "parent" | "date" | "number" | "select" | "checkbox";
export type FieldDef = {
  key: FieldKey; label: string; kind: Kind; tip?: string; custom?: CustomField;
  get: (i: Item, c: Ctx) => string | number | boolean | null;
};

export const FIELDS: Record<BuiltinField, FieldDef> = {
  title: { key: "title", label: "Title", kind: "text", get: (i) => i.title },
  type: { key: "type", label: "Type", kind: "type", get: (i) => i.type },
  status: { key: "status", label: "Status", kind: "status", get: (i) => i.status },
  priority: { key: "priority", label: "Priority", kind: "priority", get: (i) => i.priority },
  parent: { key: "parent", label: "In", kind: "parent", tip: "The project, goal or task it belongs to", get: (i, c) => (i.parent_id ? c.byId.get(i.parent_id)?.title ?? null : null) },
  when: { key: "when", label: "When", kind: "date", tip: "Planned day or deadline, whichever is first", get: (i) => whenOf(i) },
  planned_on: { key: "planned_on", label: "Day", kind: "date", tip: "Planned day", get: (i) => i.planned_on },
  due_on: { key: "due_on", label: "Due", kind: "date", tip: "Deadline", get: (i) => i.due_on },
  start_on: { key: "start_on", label: "Start", kind: "date", get: (i) => i.start_on },
  estimate_min: { key: "estimate_min", label: "Estimate", kind: "number", tip: "Planned minutes", get: (i) => i.estimate_min },
  spent_min: { key: "spent_min", label: "Spent", kind: "number", tip: "Minutes logged by the timer", get: (i) => i.spent_min || null },
  created_at: { key: "created_at", label: "Created", kind: "date", get: (i) => dayOfStamp(i.created_at) },
  updated_at: { key: "updated_at", label: "Updated", kind: "date", get: (i) => dayOfStamp(i.updated_at) },
  done_at: { key: "done_at", label: "Done on", kind: "date", get: (i) => dayOfStamp(i.done_at) },
  url: { key: "url", label: "Link", kind: "text", get: (i) => i.url },
};
export const FIELD_KEYS = Object.keys(FIELDS) as BuiltinField[];
const GROUPABLE: FieldKey[] = ["status", "type", "priority", "parent", "when", "planned_on", "due_on", "start_on"];
const BOARDABLE: FieldKey[] = ["status", "type", "priority", "parent"];

export const propsOf = (i: Item) => (i.props && typeof i.props === "object" && !Array.isArray(i.props) ? i.props as Record<string, unknown> : {});

// A custom field as a field of the engine.
export function customDef(f: CustomField): FieldDef {
  const kind: Kind = f.kind === "url" ? "text" : f.kind;
  return {
    key: `props.${f.key}`, label: f.name, kind, custom: f,
    get: (i) => {
      const v = propsOf(i)[f.key];
      if (v === null || v === undefined || v === "") return null;
      if (f.kind === "checkbox") return v === true;
      if (f.kind === "number") return typeof v === "number" ? v : Number.isNaN(Number(v)) ? null : Number(v);
      return typeof v === "string" ? v : String(v);
    },
  };
}
export const fieldsWith = (custom: CustomField[]): Record<string, FieldDef> =>
  ({ ...FIELDS, ...Object.fromEntries([...custom].sort((a, b) => a.position - b.position).map((f) => [`props.${f.key}`, customDef(f)])) });
export const fieldOf = (c: Ctx, key: string | null | undefined): FieldDef | null => (key ? c.fields[key] ?? null : null);
export const customFields = (c: Ctx) => Object.values(c.fields).filter((d) => d.custom);
export const groupableFields = (c: Ctx) => [...GROUPABLE, ...customFields(c).filter((d) => ["select", "checkbox", "date"].includes(d.kind)).map((d) => d.key)];
export const boardableFields = (c: Ctx) => [...BOARDABLE, ...customFields(c).filter((d) => ["select", "checkbox"].includes(d.kind)).map((d) => d.key)];
export const optionOf = (d: FieldDef | null, id: unknown) => d?.custom?.options.find((o) => o.id === id) ?? null;

// ── filter: a small GitHub-style language ──
// type:task,idea  -status:done  priority:urgent,high  in:thesis  due:<@today  day:@today..@today+7  is:open  no:due
// has:estimate  estimate:>60  "exact words"  free words (title + text).
type Pred = (i: Item, c: Ctx) => boolean;
export type Filter = { test: (i: Item, c: Ctx) => boolean; trashed: boolean };

const ALIAS: Record<string, string> = {
  t: "type", s: "status", p: "priority", in: "parent", planned: "day", est: "estimate", deadline: "due",
};
const DATE_KEYS: Record<string, (i: Item) => string | null> = {
  day: (i) => i.planned_on, due: (i) => i.due_on, start: (i) => i.start_on, when: whenOf,
  created: (i) => dayOfStamp(i.created_at), updated: (i) => dayOfStamp(i.updated_at), done: (i) => dayOfStamp(i.done_at),
};
const NUM_KEYS: Record<string, (i: Item) => number | null> = {
  estimate: (i) => i.estimate_min, spent: (i) => i.spent_min, priority: (i) => i.priority,
};
const PRESENT: Record<string, (i: Item) => unknown> = {
  due: (i) => i.due_on, day: (i) => i.planned_on, start: (i) => i.start_on, parent: (i) => i.parent_id, estimate: (i) => i.estimate_min,
  priority: (i) => i.priority, url: (i) => i.url, link: (i) => i.url, body: (i) => i.body?.trim(), spent: (i) => i.spent_min,
};

// "@today", "@today+3", "@today-1w", "2026-12-01" → a day; anything else → null.
function dayValue(v: string, today: string): string | null {
  const m = v.match(/^@today(?:([+-])(\d+)([dwm]?))?$/i);
  if (m) {
    const n = m[2] ? Number(m[2]) * (m[3] === "w" ? 7 : m[3] === "m" ? 30 : 1) : 0;
    return addDays(today, m[1] === "-" ? -n : n);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// One compared value: "<x", ">=x", "a..b" or "x".
function compare<T extends string | number>(value: T | null, raw: string, parse: (s: string) => T | null): boolean {
  if (value === null || value === undefined) return false;
  const range = raw.split("..");
  if (range.length === 2) {
    const a = range[0] ? parse(range[0]) : null;
    const b = range[1] ? parse(range[1]) : null;
    return (a === null || value >= a) && (b === null || value <= b);
  }
  const op = raw.match(/^(<=|>=|<|>)?(.*)$/)!;
  const x = parse(op[2]);
  if (x === null) return false;
  switch (op[1]) {
    case "<": return value < x;
    case ">": return value > x;
    case "<=": return value <= x;
    case ">=": return value >= x;
    default: return value === x;
  }
}

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();
const PRIORITY_IDS: Record<string, number> = Object.fromEntries(PRIORITIES.flatMap((p) => [[p.name, p.id], [String(p.id), p.id]]));

function predicate(key: string, values: string[]): Pred | null {
  switch (key) {
    case "type": return (i) => values.some((v) => i.type === v || lower(ITEM_TYPES[i.type as ItemType]?.label) === v);
    case "status": return (i) => values.some((v) => i.status === v || lower(STATUSES.find((s) => s.id === i.status)?.label) === v);
    case "priority":
      if (values.some((v) => /[<>.]/.test(v))) return (i) => values.some((v) => compare(i.priority, v, (s) => PRIORITY_IDS[s] ?? null));
      return (i) => values.some((v) => (v === "none" ? i.priority === null : i.priority === PRIORITY_IDS[v]));
    case "parent":
      return (i, c) => {
        const p = i.parent_id ? c.byId.get(i.parent_id) : undefined;
        return values.some((v) => (v === "none" ? !p : !!p && (p.id === v || lower(p.title).includes(v))));
      };
    case "title": return (i) => values.some((v) => lower(i.title).includes(v));
    case "is":
      return (i, c) => values.some((v) => {
        switch (v) {
          case "open": return isOpen(i);
          case "closed": return !isOpen(i);
          case "done": case "dropped": return i.status === v;
          case "trashed": return !!i.deleted_at;
          case "archived": return !!i.archived_at;
          case "event": return i.is_event;
          case "overdue": { const w = whenOf(i); return isOpen(i) && !!w && w < c.today; }
          case "private": return !!ITEM_TYPES[i.type as ItemType]?.private;
          default: return ITEM_TYPES[v as ItemType] ? i.type === v : false;
        }
      });
    case "no": return (i, c) => values.every((v) => !present(v, i, c));
    case "has": return (i, c) => values.every((v) => present(v, i, c));
  }
  if (DATE_KEYS[key]) {
    const get = DATE_KEYS[key];
    return (i, c) => values.some((v) => (v === "none" ? !get(i) : compare(get(i), v, (s) => dayValue(s, c.today))));
  }
  if (NUM_KEYS[key]) {
    const get = NUM_KEYS[key];
    return (i) => values.some((v) => compare(get(i), v, parseNumber));
  }
  // Any other key may be a custom field ("kind:idea"); decided per item, since the fields come with the context.
  // Without such a field the token is plain words, like an unknown key.
  const words = `${key}:${values.join(",")}`;
  return (i, c) => {
    const def = c.fields[`props.${key}`];
    return def ? matchCustom(def, i, values, c) : lower(i.title).includes(words) || lower(i.body).includes(words);
  };
}

const parseNumber = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : null);
const YES = ["yes", "true", "1", "on"];

function matchCustom(def: FieldDef, i: Item, values: string[], c: Ctx) {
  const v = def.get(i, c);
  return values.some((x) => {
    if (x === "none") return v === null || v === false;
    switch (def.kind) {
      case "select": { const o = optionOf(def, v); return !!o && (o.id.toLowerCase() === x || o.name.toLowerCase() === x); }
      case "checkbox": return (v === true) === YES.includes(x);
      case "number": return compare(v as number | null, x, parseNumber);
      case "date": return compare(v as string | null, x, (s) => dayValue(s, c.today));
      default: return lower(v as string | null).includes(x);
    }
  });
}

function present(key: string, i: Item, c: Ctx) {
  if (PRESENT[key]) return !!PRESENT[key](i);
  const def = c.fields[`props.${key}`];
  if (!def) return true;
  const v = def.get(i, c);
  return v !== null && v !== false;
}

export function parseFilter(q: string): Filter {
  const preds: Pred[] = [];
  let trashed = false;
  let archived = false;
  for (const m of q.matchAll(/(-?)([a-z_]+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/gi)) {
    if (m[2]) {
      const key = ALIAS[m[2].toLowerCase()] ?? m[2].toLowerCase();
      const values = m[3].replace(/^"|"$/g, "").toLowerCase().split(",").map((v) => v.trim()).filter(Boolean);
      const p = values.length ? predicate(key, values) : null;
      if (p) {
        if (key === "is" && !m[1] && values.includes("trashed")) trashed = true;
        if (key === "is" && !m[1] && values.includes("archived")) archived = true;
        preds.push(m[1] ? (i, c) => !p(i, c) : p);
        continue;
      }
    }
    const words = lower(m[4] ?? m[0]).replace(/^-/, "");
    const neg = !m[4] && m[0].startsWith("-");
    if (!words) continue;
    const p: Pred = (i) => lower(i.title).includes(words) || lower(i.body).includes(words);
    preds.push(neg ? (i, c) => !p(i, c) : p);
  }
  return {
    trashed,
    test: (i, c) => (trashed || !i.deleted_at) && (archived || !i.archived_at) && preds.every((p) => p(i, c)),
  };
}

export const applyFilter = (items: Item[], q: string, c: Ctx) => {
  const f = parseFilter(q);
  return items.filter((i) => f.test(i, c));
};

// ── sort ──
function sortValue(key: FieldKey, i: Item, c: Ctx): string | number | null {
  switch (key) {
    case "status": return STATUSES.findIndex((s) => s.id === i.status);
    case "type": return TYPE_ORDER.indexOf(i.type as ItemType);
    case "title": return lower(i.title);
    case "parent": return lower(FIELDS.parent.get(i, c) as string | null) || null;
  }
  const def = fieldOf(c, key);
  if (!def) return null;
  const v = def.get(i, c);
  if (def.kind === "select") { const k = def.custom!.options.findIndex((o) => o.id === v); return k < 0 ? null : k; }
  if (def.kind === "checkbox") return v ? 0 : 1;
  if (def.kind === "text") return typeof v === "string" ? v.toLowerCase() : null;
  return v as string | number | null;
}

export function sortItems(items: Item[], rules: SortRule[], c: Ctx): Item[] {
  const keyed = items.map((i) => ({ i, v: rules.map((r) => sortValue(r.field, i, c)) }));
  keyed.sort((a, b) => {
    for (let k = 0; k < rules.length; k++) {
      const x = a.v[k], y = b.v[k];
      if (x === y) continue;
      if (x === null || x === undefined) return 1; // empty values last, either direction
      if (y === null || y === undefined) return -1;
      const d = x < y ? -1 : 1;
      return rules[k].desc ? -d : d;
    }
    return a.i.position - b.i.position || a.i.created_at.localeCompare(b.i.created_at);
  });
  return keyed.map((k) => k.i);
}

// ── group by ──
export type Group = { key: string; label: string; items: Item[] };

const BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "Next 7 days" },
  { key: "month", label: "Next 30 days" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date" },
];
export function dateBucket(day: string | null, today: string): string {
  if (!day) return "none";
  const d = daysBetween(today, day);
  return d < 0 ? "overdue" : d === 0 ? "today" : d === 1 ? "tomorrow" : d <= 7 ? "week" : d <= 30 ? "month" : "later";
}

// The groups a field gives, in their natural order (statuses in their order, priorities urgent → none, date buckets
// from overdue to later). Empty groups are kept for status / priority (a board needs every column).
export function groupItems(items: Item[], by: FieldKey | null, c: Ctx): Group[] {
  const def = fieldOf(c, by);
  if (!by || !def) return [{ key: "all", label: "", items }];
  const fixed: { key: string; label: string }[] | null =
    def.kind === "status" ? STATUSES.map((s) => ({ key: s.id, label: s.label }))
    : def.kind === "priority" ? [...PRIORITIES.map((p) => ({ key: String(p.id), label: p.label })), { key: "none", label: "No priority" }]
    : def.kind === "select" ? [...def.custom!.options.map((o) => ({ key: o.id, label: o.name })), { key: "none", label: `No ${def.label.toLowerCase()}` }]
    : def.kind === "checkbox" ? [{ key: "yes", label: def.label }, { key: "none", label: `Not ${def.label.toLowerCase()}` }]
    : def.kind === "date" ? BUCKETS.map((b) => (by === "when" || by === "due_on" ? b : b.key === "overdue" ? { ...b, label: "Before today" } : b))
    : null;
  const keyOf = (i: Item): string => {
    if (def.kind === "date") return dateBucket(def.get(i, c) as string | null, c.today);
    if (def.kind === "parent") return i.parent_id && c.byId.has(i.parent_id) ? i.parent_id : "none";
    const v = def.get(i, c);
    if (def.kind === "checkbox") return v ? "yes" : "none";
    if (def.kind === "select" && !optionOf(def, v)) return "none";
    return v === null || v === undefined ? "none" : String(v);
  };
  const map = new Map<string, Item[]>();
  for (const i of items) {
    const k = keyOf(i);
    map.set(k, [...(map.get(k) ?? []), i]);
  }
  if (fixed) {
    const out = fixed.map((f) => ({ ...f, items: map.get(f.key) ?? [] }));
    return def.kind === "date" ? out.filter((g) => g.items.length) : out;
  }
  const groups = [...map.entries()].map(([key, list]) => ({
    key,
    label: key === "none" ? (def.kind === "parent" ? "No parent" : "None")
      : def.kind === "type" ? ITEM_TYPES[key as ItemType]?.label ?? key
      : def.kind === "parent" ? c.byId.get(key)?.title ?? key
      : key,
    items: list,
  }));
  const rank = (g: Group) => (g.key === "none" ? Infinity
    : def.kind === "type" ? TYPE_ORDER.indexOf(g.key as ItemType)
    : def.kind === "parent" ? c.byId.get(g.key)!.position : 0);
  return groups.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

// What an item gets when it is dropped into a group (a board column) or added inside it.
// A custom field's value goes in as { props: { key: value } }: only that key, merged into the item's props by the
// writer (src/core/edit.ts), so other keys are kept.
export function patchForGroup(by: FieldKey | null, key: string, c: Ctx): ItemPatch {
  const def = fieldOf(c, by);
  if (!by || !def || key === "all") return {};
  if (def.custom) {
    const k = def.custom.key;
    if (def.kind === "select") return { props: { [k]: key === "none" ? null : key } };
    if (def.kind === "checkbox") return { props: { [k]: key === "yes" } };
    if (def.kind === "date") {
      const day = key === "today" ? c.today : key === "tomorrow" ? addDays(c.today, 1) : key === "none" ? null : undefined;
      return day === undefined ? {} : { props: { [k]: day } };
    }
    return {};
  }
  switch (def.kind) {
    case "status": return { status: key };
    case "priority": return { priority: key === "none" ? null : Number(key) };
    case "type": return key === "none" ? {} : { type: key };
    case "parent": return { parent_id: key === "none" ? null : key };
    case "date": {
      const field = by === "when" ? "planned_on" : by;
      if (!["planned_on", "due_on", "start_on"].includes(field)) return {};
      const day = key === "today" ? c.today : key === "tomorrow" ? addDays(c.today, 1) : key === "none" ? null : undefined;
      return day === undefined ? {} : { [field]: day };
    }
    default: return {};
  }
}

// Count + minutes of a group (the sums under a group header).
export function totals(items: Item[]) {
  let estimate = 0, spent = 0;
  for (const i of items) {
    estimate += i.estimate_min ?? 0;
    spent += i.spent_min ?? 0;
  }
  return { count: items.length, estimate, spent };
}

export const minutesLabel = (m: number | null | undefined) => {
  if (!m) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};

// The whole pipeline: filter → sort → group.
export function runView(items: Item[], config: ViewConfig, c: Ctx, groupBy: FieldKey | null = config.group_by): Group[] {
  return groupItems(sortItems(applyFilter(items, config.filter, c), config.sort, c), groupBy, c);
}
