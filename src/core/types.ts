// Item types (P-70): what the app shows for each type. The rules every writer must keep (where a type may sit,
// whether AI may see it) live in the DB table item_types; `parents` / `rootOk` below mirror them so the UI offers only
// what the DB accepts (the DB still decides). A new type = a row in item_types + an entry here.

export type ItemType =
  | "area" | "goal" | "mission" | "step" | "project" | "routine" | "milestone" | "option" | "obstacle"
  | "task" | "idea" | "capture" | "buy" | "bill" | "income" | "debt" | "loan";

export type TypeGroup = "strategy" | "work" | "inbox" | "money";

type TypeInfo = { label: string; group: TypeGroup; parents: ItemType[]; rootOk: boolean; private?: boolean };

const WORK_PARENTS: ItemType[] = ["area", "goal", "mission", "step", "project"];

export const ITEM_TYPES: Record<ItemType, TypeInfo> = {
  task: { label: "Task", group: "work", parents: [...WORK_PARENTS, "routine", "milestone", "option", "task"], rootOk: true },
  idea: { label: "Idea", group: "inbox", parents: [...WORK_PARENTS, "idea"], rootOk: true },
  capture: { label: "Capture", group: "inbox", parents: [], rootOk: true },
  project: { label: "Project", group: "work", parents: WORK_PARENTS, rootOk: true },
  routine: { label: "Routine", group: "work", parents: ["area", "goal", "mission", "project"], rootOk: true },
  milestone: { label: "Milestone", group: "work", parents: ["goal", "mission", "step", "project"], rootOk: true },
  option: { label: "Option", group: "work", parents: WORK_PARENTS, rootOk: true },
  obstacle: { label: "Obstacle", group: "work", parents: ["goal", "mission", "step", "project", "task"], rootOk: true },
  area: { label: "Area", group: "strategy", parents: [], rootOk: true },
  goal: { label: "Goal", group: "strategy", parents: ["area"], rootOk: true },
  mission: { label: "Mission", group: "strategy", parents: ["goal"], rootOk: false },
  step: { label: "Step", group: "strategy", parents: ["mission", "step"], rootOk: false },
  buy: { label: "To buy", group: "money", parents: WORK_PARENTS, rootOk: true, private: true },
  bill: { label: "Bill", group: "money", parents: ["area"], rootOk: true, private: true },
  income: { label: "Income", group: "money", parents: ["area"], rootOk: true, private: true },
  debt: { label: "Debt", group: "money", parents: ["area"], rootOk: true, private: true },
  loan: { label: "Loan", group: "money", parents: ["area"], rootOk: true, private: true },
};
export const TYPE_ORDER = Object.keys(ITEM_TYPES) as ItemType[];

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
export const CLOSED_STATUSES: ItemStatus[] = ["done", "dropped"];

// 1 urgent … 4 low (Linear style); null = none.
export const PRIORITIES = [
  { id: 1, name: "urgent", label: "Urgent" },
  { id: 2, name: "high", label: "High" },
  { id: 3, name: "medium", label: "Medium" },
  { id: 4, name: "low", label: "Low" },
] as const;
