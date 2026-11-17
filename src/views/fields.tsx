// How item fields look and how they are changed in place (table cells, cards, the item drawer). One icon per value,
// the words in tooltips (P-28).
import { useMemo, useState } from "react";
import {
  CalendarDays, Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleX, Flag, FolderKanban, Footprints,
  HandCoins, Hourglass, Inbox, Landmark, Layers, Lightbulb, type LucideIcon, Milestone, Receipt, Repeat, ShieldAlert,
  ShoppingCart, SignalHigh, SignalLow, SignalMedium, SignalZero, Split, SquareCheck, Target, Timer, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item, ItemPatch } from "@/core/items";
import { ITEM_TYPES, PRIORITIES, STATUSES, TYPE_ORDER, type ItemStatus, type ItemType } from "@/core/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, type Ctx, daysBetween, type FieldKey, isOpen, localDay, minutesLabel } from "./query";

// ── looks ──
export const TYPE_ICONS: Record<ItemType, LucideIcon> = {
  task: SquareCheck, idea: Lightbulb, capture: Inbox, project: FolderKanban, routine: Repeat, milestone: Milestone,
  option: Split, obstacle: ShieldAlert, area: Layers, goal: Target, mission: Flag, step: Footprints,
  buy: ShoppingCart, bill: Receipt, income: TrendingUp, debt: HandCoins, loan: Landmark,
};
export const STATUS_LOOK: Record<ItemStatus, { icon: LucideIcon; className: string }> = {
  todo: { icon: Circle, className: "text-muted-foreground" },
  doing: { icon: CircleDot, className: "text-amber-400" },
  waiting: { icon: Hourglass, className: "text-sky-400" },
  someday: { icon: CircleDashed, className: "text-muted-foreground/70" },
  done: { icon: CircleCheck, className: "text-primary" },
  dropped: { icon: CircleX, className: "text-muted-foreground/50" },
};
export const PRIORITY_LOOK: Record<string, { icon: LucideIcon; className: string; label: string }> = {
  1: { icon: CircleAlert, className: "text-red-500", label: "Urgent" },
  2: { icon: SignalHigh, className: "text-orange-400", label: "High" },
  3: { icon: SignalMedium, className: "text-yellow-500", label: "Medium" },
  4: { icon: SignalLow, className: "text-muted-foreground", label: "Low" },
  none: { icon: SignalZero, className: "text-muted-foreground/40", label: "No priority" },
};

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICONS[type as ItemType] ?? Circle;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} />;
}
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const look = STATUS_LOOK[status as ItemStatus] ?? STATUS_LOOK.todo;
  return <look.icon className={cn("h-3.5 w-3.5 shrink-0", look.className, className)} />;
}
export function PriorityIcon({ priority, className }: { priority: number | null; className?: string }) {
  const look = PRIORITY_LOOK[priority ?? "none"];
  return <look.icon className={cn("h-3.5 w-3.5 shrink-0", look.className, className)} />;
}

export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function dayLabel(day: string, today: string) {
  const d = daysBetween(today, day);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  const date = new Date(`${day}T12:00:00`);
  if (d > 1 && d < 7) return WEEKDAYS[date.getDay()];
  const s = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? s : `${s} ${day.slice(0, 4)}`;
}

// The path from the root to an item's parent: "Dissertation › Chapter 2".
export function pathOf(item: Item, c: Ctx, max = 3) {
  const out: Item[] = [];
  let p = item.parent_id ? c.byId.get(item.parent_id) : undefined;
  while (p && out.length < 20) {
    out.unshift(p);
    p = p.parent_id ? c.byId.get(p.parent_id) : undefined;
  }
  return out.slice(-max);
}

// ── pickers (each one changes one field) ──
type Change = (patch: ItemPatch) => void;
const menuRow = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";

function PickerShell({ trigger, label, children, open, setOpen, wide }: {
  trigger: React.ReactNode; label: string; children: React.ReactNode; open: boolean; setOpen: (o: boolean) => void; wide?: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className={cn("p-1", wide ? "w-72" : "w-48")} onClick={(e) => e.stopPropagation()}>{children}</PopoverContent>
    </Popover>
  );
}

const cellButton = "inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-muted/60";

export function StatusPicker({ item, onChange, showLabel }: { item: Item; onChange: Change; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = STATUSES.find((s) => s.id === item.status)?.label ?? item.status;
  return (
    <PickerShell open={open} setOpen={setOpen} label={label} trigger={
      <button type="button" className={cellButton}><StatusIcon status={item.status} />{showLabel && <span className="truncate">{label}</span>}</button>
    }>
      {STATUSES.map((s) => (
        <button key={s.id} type="button" className={menuRow} onClick={() => { setOpen(false); if (s.id !== item.status) onChange({ status: s.id }); }}>
          <StatusIcon status={s.id} />{s.label}
        </button>
      ))}
    </PickerShell>
  );
}

export function PriorityPicker({ item, onChange, showLabel }: { item: Item; onChange: Change; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const look = PRIORITY_LOOK[item.priority ?? "none"];
  return (
    <PickerShell open={open} setOpen={setOpen} label={look.label} trigger={
      <button type="button" className={cellButton}><PriorityIcon priority={item.priority} />{showLabel && <span className="truncate">{look.label}</span>}</button>
    }>
      {[...PRIORITIES.map((p) => p.id as number | null), null].map((p) => (
        <button key={String(p)} type="button" className={menuRow} onClick={() => { setOpen(false); if (p !== item.priority) onChange({ priority: p }); }}>
          <PriorityIcon priority={p} />{PRIORITY_LOOK[p ?? "none"].label}
        </button>
      ))}
    </PickerShell>
  );
}

export function TypePicker({ item, onChange, showLabel }: { item: Item; onChange: Change; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = ITEM_TYPES[item.type as ItemType]?.label ?? item.type;
  return (
    <PickerShell open={open} setOpen={setOpen} label={label} trigger={
      <button type="button" className={cellButton}><TypeIcon type={item.type} />{showLabel && <span className="truncate">{label}</span>}</button>
    }>
      <div className="max-h-72 overflow-y-auto">
        {TYPE_ORDER.map((t) => (
          <button key={t} type="button" className={menuRow} onClick={() => { setOpen(false); if (t !== item.type) onChange({ type: t }); }}>
            <TypeIcon type={t} />{ITEM_TYPES[t].label}
          </button>
        ))}
      </div>
    </PickerShell>
  );
}

// A day: quick choices + any date. `field` = which column it writes.
export function DatePicker({ item, field, ctx, onChange, label }: {
  item: Item; field: "planned_on" | "due_on" | "start_on"; ctx: Ctx; onChange: Change; label: string;
}) {
  const [open, setOpen] = useState(false);
  const value = item[field];
  const late = !!value && value < ctx.today && isOpen(item) && field !== "start_on";
  const pick = (v: string | null) => { setOpen(false); if (v !== value) onChange({ [field]: v }); };
  return (
    <PickerShell open={open} setOpen={setOpen} label={label} trigger={
      <button type="button" className={cn(cellButton, !value && "text-muted-foreground/40", late && "text-red-400")}>
        {value ? dayLabel(value, ctx.today) : <CalendarDays className="h-3.5 w-3.5" />}
      </button>
    }>
      <button type="button" className={menuRow} onClick={() => pick(ctx.today)}>Today</button>
      <button type="button" className={menuRow} onClick={() => pick(addDays(ctx.today, 1))}>Tomorrow</button>
      <button type="button" className={menuRow} onClick={() => pick(addDays(ctx.today, 7))}>In a week</button>
      <input
        type="date"
        defaultValue={value ?? ""}
        className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
        // a whole date picked or typed (while the year is typed the browser reports 0002, 0020 … — not taken)
        onChange={(e) => { const v = e.target.value; if (v && Number(v.slice(0, 4)) >= 1900) pick(v); }}
      />
      {value && <button type="button" className={cn(menuRow, "text-muted-foreground")} onClick={() => pick(null)}>Clear</button>}
    </PickerShell>
  );
}

export function MinutesPicker({ item, onChange }: { item: Item; onChange: Change }) {
  const [open, setOpen] = useState(false);
  const pick = (v: number | null) => { setOpen(false); if (v !== item.estimate_min) onChange({ estimate_min: v }); };
  return (
    <PickerShell open={open} setOpen={setOpen} label="Estimate" trigger={
      <button type="button" className={cn(cellButton, !item.estimate_min && "text-muted-foreground/40")}>
        {item.estimate_min ? minutesLabel(item.estimate_min) : <Timer className="h-3.5 w-3.5" />}
      </button>
    }>
      <div className="grid grid-cols-3 gap-1">
        {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => (
          <button key={m} type="button" className={cn(menuRow, "justify-center", m === item.estimate_min && "bg-accent")} onClick={() => pick(m)}>{minutesLabel(m)}</button>
        ))}
      </div>
      <input
        type="number" min={1} placeholder="min" defaultValue={item.estimate_min ?? ""}
        className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter") { const n = Number((e.target as HTMLInputElement).value); pick(n > 0 ? Math.round(n) : null); } }}
      />
      {item.estimate_min && <button type="button" className={cn(menuRow, "text-muted-foreground")} onClick={() => pick(null)}>Clear</button>}
    </PickerShell>
  );
}

// The main parent (P-70 tree): only the types the DB allows above this one; never itself or something below it.
export function ParentPicker({ item, ctx, onChange, children }: { item: Item; ctx: Ctx; onChange: Change; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const info = ITEM_TYPES[item.type as ItemType];
  const options = useMemo(() => {
    if (!open || !info) return [];
    const below = new Set([item.id]);
    let grew = true;
    const all = [...ctx.byId.values()];
    while (grew) {
      grew = false;
      for (const i of all) if (i.parent_id && below.has(i.parent_id) && !below.has(i.id)) { below.add(i.id); grew = true; }
    }
    return all
      .filter((i) => info.parents.includes(i.type as ItemType) && !below.has(i.id) && !i.deleted_at && !i.archived_at)
      .sort((a, b) => TYPE_ORDER.indexOf(a.type as ItemType) - TYPE_ORDER.indexOf(b.type as ItemType) || a.title.localeCompare(b.title));
  }, [open, info, item.id, ctx.byId]);
  const parent = item.parent_id ? ctx.byId.get(item.parent_id) : undefined;
  const pick = (id: string | null) => { setOpen(false); if (id !== item.parent_id) onChange({ parent_id: id }); };
  return (
    <PickerShell open={open} setOpen={setOpen} wide label={parent ? pathOf(item, ctx).map((p) => p.title).join(" › ") : "No parent"} trigger={
      children ? <button type="button" className={cellButton}>{children}</button> : (
        <button type="button" className={cn(cellButton, !parent && "text-muted-foreground/40")}>
          {parent ? <><TypeIcon type={parent.type} /><span className="truncate">{parent.title}</span></> : <FolderKanban className="h-3.5 w-3.5" />}
        </button>
      )
    }>
      <Command>
        <CommandInput placeholder="Find…" />
        <CommandList>
          <CommandEmpty>Nothing fits</CommandEmpty>
          <CommandGroup>
            {info?.rootOk && parent && <CommandItem value="— no parent" onSelect={() => pick(null)} className="text-muted-foreground">No parent</CommandItem>}
            {options.map((o) => (
              <CommandItem key={o.id} value={`${o.title} ${o.id}`} onSelect={() => pick(o.id)} className="gap-2">
                <TypeIcon type={o.type} /><span className="truncate">{o.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </PickerShell>
  );
}

// ── one field of an item, as a table cell / a line on a card ──
export function FieldValue({ item, field, ctx, onChange }: { item: Item; field: FieldKey; ctx: Ctx; onChange: Change }) {
  switch (field) {
    case "type": return <TypePicker item={item} onChange={onChange} showLabel />;
    case "status": return <StatusPicker item={item} onChange={onChange} showLabel />;
    case "priority": return <PriorityPicker item={item} onChange={onChange} showLabel />;
    case "parent": return <ParentPicker item={item} ctx={ctx} onChange={onChange} />;
    case "planned_on": return <DatePicker item={item} field="planned_on" ctx={ctx} onChange={onChange} label="Planned day" />;
    case "due_on": return <DatePicker item={item} field="due_on" ctx={ctx} onChange={onChange} label="Deadline" />;
    case "start_on": return <DatePicker item={item} field="start_on" ctx={ctx} onChange={onChange} label="Start" />;
    case "estimate_min": return <MinutesPicker item={item} onChange={onChange} />;
    case "when": {
      // The earlier of day / deadline; changing it changes the planned day.
      const due = !!item.due_on && (!item.planned_on || item.due_on < item.planned_on);
      return due
        ? <DatePicker item={item} field="due_on" ctx={ctx} onChange={onChange} label="Deadline" />
        : <DatePicker item={item} field="planned_on" ctx={ctx} onChange={onChange} label="Planned day" />;
    }
    case "spent_min": return <span className="px-1.5 text-xs text-muted-foreground">{minutesLabel(item.spent_min)}</span>;
    case "url": return item.url
      ? <a href={item.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate px-1.5 text-xs text-primary hover:underline">{item.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
      : null;
    case "created_at": case "updated_at": case "done_at": {
      const v = item[field];
      return v ? <span className="px-1.5 text-xs text-muted-foreground">{dayLabel(localDay(new Date(v)), ctx.today)}</span> : null;
    }
    default: return <span className="truncate px-1.5 text-xs">{String(item[field as keyof Item] ?? "")}</span>;
  }
}
