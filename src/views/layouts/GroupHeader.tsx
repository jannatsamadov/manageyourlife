import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Ctx, FIELDS, type FieldKey, type Group, minutesLabel, totals } from "../query";
import { PriorityIcon, StatusIcon, Tip, TypeIcon } from "../fields";

export function GroupIcon({ by, group, ctx }: { by: FieldKey | null; group: Group; ctx: Ctx }) {
  if (!by) return null;
  switch (FIELDS[by].kind) {
    case "status": return <StatusIcon status={group.key} />;
    case "type": return <TypeIcon type={group.key} />;
    case "priority": return <PriorityIcon priority={group.key === "none" ? null : Number(group.key)} />;
    case "parent": { const p = ctx.byId.get(group.key); return p ? <TypeIcon type={p.type} /> : null; }
    case "date": return <CalendarDays className={cn("h-3.5 w-3.5", group.key === "overdue" ? "text-red-400" : "text-muted-foreground")} />;
    default: return null;
  }
}

// "Today  4  · 2h 30m" — count and the estimated time of the group.
export function GroupSums({ group }: { group: Group }) {
  const t = totals(group.items);
  return (
    <>
      <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{t.count}</span>
      {t.estimate > 0 && (
        <Tip label={`Estimated${t.spent ? `; ${minutesLabel(t.spent)} logged` : ""}`}>
          <span className="text-[10px] text-muted-foreground">{minutesLabel(t.estimate)}</span>
        </Tip>
      )}
    </>
  );
}

export function GroupHeader({ by, group, ctx, open, toggle }: { by: FieldKey | null; group: Group; ctx: Ctx; open: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm font-medium hover:bg-muted/30">
      {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      <GroupIcon by={by} group={group} ctx={ctx} />
      <span className="truncate">{group.label}</span>
      <GroupSums group={group} />
    </button>
  );
}
