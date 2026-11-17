// Item types (P-70): what the app shows for each type. The rules that must hold for every writer (where a type may
// sit, whether AI may see it) live in the DB table item_types; this registry is the UI side (names, groups, statuses).
// A new type = a row in item_types + an entry here.

export type ItemType =
  | "area" | "goal" | "mission" | "step" | "project" | "routine" | "milestone" | "option" | "obstacle"
  | "task" | "idea" | "capture" | "buy" | "bill" | "income" | "debt" | "loan";

export type TypeGroup = "strategy" | "work" | "inbox" | "money";

export const ITEM_TYPES: Record<ItemType, { label: string; group: TypeGroup; private?: boolean }> = {
  area: { label: "Area", group: "strategy" },
  goal: { label: "Goal", group: "strategy" },
  mission: { label: "Mission", group: "strategy" },
  step: { label: "Step", group: "strategy" },
  project: { label: "Project", group: "work" },
  routine: { label: "Routine", group: "work" },
  milestone: { label: "Milestone", group: "work" },
  option: { label: "Option", group: "work" },
  obstacle: { label: "Obstacle", group: "work" },
  task: { label: "Task", group: "work" },
  idea: { label: "Idea", group: "inbox" },
  capture: { label: "Capture", group: "inbox" },
  buy: { label: "To buy", group: "money", private: true },
  bill: { label: "Bill", group: "money", private: true },
  income: { label: "Income", group: "money", private: true },
  debt: { label: "Debt", group: "money", private: true },
  loan: { label: "Loan", group: "money", private: true },
};

// The strategy tree of v1 (P-2); phase 5 (P-54) widens it.
export const STRATEGY_TYPES: ItemType[] = ["area", "goal", "mission", "step"];
export const MONEY_TYPES: ItemType[] = ["income", "bill", "debt", "loan", "buy"];

// GTD on top of to do / doing / done: waiting for someone, maybe some day.
export type ItemStatus = "todo" | "doing" | "waiting" | "someday" | "done" | "dropped";
export const STATUSES: { id: ItemStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "waiting", label: "Waiting" },
  { id: "someday", label: "Someday" },
  { id: "done", label: "Done" },
  { id: "dropped", label: "Dropped" },
];

// 1 urgent … 4 low (Linear style); null = none.
export const PRIORITIES = [
  { id: 1, name: "urgent", label: "Urgent" },
  { id: 2, name: "high", label: "High" },
  { id: 3, name: "medium", label: "Medium" },
  { id: 4, name: "low", label: "Low" },
] as const;
