// Slice (GitHub Projects' "Slice by"): the values of one field with their counts beside the view; picking one shows
// only its items. The field is saved with the view, the picked value is not (it is a quick look).
import { cn } from "@/lib/utils";
import type { Ctx, FieldKey, Group } from "./query";
import { fieldOf } from "./query";
import { GroupIcon } from "./layouts/GroupHeader";

export function SlicePanel({ by, groups, total, active, ctx, onPick }: {
  by: FieldKey; groups: Group[]; total: number; active: string | null; ctx: Ctx; onPick: (key: string | null) => void;
}) {
  const shown = groups.filter((g) => g.items.length || g.key === active);
  const row = (on: boolean) => cn(
    "flex w-full shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm md:w-full",
    on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
  );
  return (
    <aside className="flex gap-1 overflow-x-auto pb-2 md:sticky md:top-2 md:w-52 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:pb-0">
      <div className="hidden px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:block">{fieldOf(ctx, by)?.label}</div>
      <button type="button" onClick={() => onPick(null)} className={cn(row(active === null), "w-auto")}>
        <span className="flex-1 truncate">All</span><span className="text-xs">{total}</span>
      </button>
      {shown.map((g) => (
        <button key={g.key} type="button" onClick={() => onPick(g.key === active ? null : g.key)} className={cn(row(g.key === active), "w-auto")}>
          <GroupIcon by={by} group={g} ctx={ctx} />
          <span className="flex-1 truncate">{g.label}</span>
          <span className="text-xs">{g.items.length}</span>
        </button>
      ))}
    </aside>
  );
}
