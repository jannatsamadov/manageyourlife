// Table (P-69): rows = items, columns = the view's fields; every cell is changed in place; groups fold.
import { useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item } from "@/core/items";
import { FIELDS, type FieldKey } from "../query";
import { FieldValue, StatusPicker, Tip, TypeIcon } from "../fields";
import { GroupHeader } from "./GroupHeader";
import { AddRow } from "./AddRow";
import type { LayoutProps } from "./common";

const WIDTH: Partial<Record<FieldKey, number>> = { parent: 200, url: 180, type: 110, status: 115, priority: 105, estimate_min: 90, spent_min: 80 };
const widthOf = (f: FieldKey) => WIDTH[f] ?? 105;

export function TitleCell({ item, kids, onOpen, onChange, showType = true }: Pick<LayoutProps, "kids" | "onOpen" | "onChange"> & { item: Item; showType?: boolean }) {
  const k = kids.get(item.id);
  const closed = item.status === "done" || item.status === "dropped";
  return (
    <div className="flex min-w-0 items-center gap-1">
      <StatusPicker item={item} onChange={(p) => onChange(item, p)} />
      {showType && <TypeIcon type={item.type} />}
      <button type="button" onClick={() => onOpen(item.id)} className={cn("min-w-0 truncate text-left text-sm hover:underline", closed && "text-muted-foreground line-through")}>
        {item.title}
      </button>
      {k && (
        <Tip label={`${k.total - k.open} of ${k.total} sub-items done`}>
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{k.total - k.open}/{k.total}</span>
        </Tip>
      )}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-primary"><Link2 className="h-3 w-3" /></a>
      )}
    </div>
  );
}

export function TableLayout(props: LayoutProps) {
  const { groups, config, ctx, onChange, onAdd } = props;
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fields = config.fields.filter((f) => f !== "title" && FIELDS[f]);
  const columns = `minmax(260px, 1fr) ${fields.map((f) => `${widthOf(f)}px`).join(" ")}`;
  const minWidth = 260 + fields.reduce((s, f) => s + widthOf(f), 0);
  const grouped = !!config.group_by;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div style={{ minWidth }}>
        <div className="sticky top-0 z-10 grid border-b border-border bg-card/95 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" style={{ gridTemplateColumns: columns }}>
          <div className="px-3 py-2">Title</div>
          {fields.map((f) => (
            <div key={f} className="truncate px-2 py-2">
              {FIELDS[f].tip ? <Tip label={FIELDS[f].tip!}><span>{FIELDS[f].label}</span></Tip> : FIELDS[f].label}
            </div>
          ))}
        </div>
        {groups.map((g) => {
          const open = !folded.has(g.key);
          return (
            <div key={g.key} className="border-b border-border/60 last:border-b-0">
              {grouped && (
                <GroupHeader by={config.group_by} group={g} ctx={ctx} open={open}
                  toggle={() => setFolded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} />
              )}
              {open && g.items.map((item) => (
                <div key={item.id} className="grid items-center border-t border-border/40 hover:bg-muted/20" style={{ gridTemplateColumns: columns }}>
                  <div className="min-w-0 px-2 py-1"><TitleCell item={item} {...props} /></div>
                  {fields.map((f) => (
                    <div key={f} className="min-w-0 px-1 py-1"><FieldValue item={item} field={f} ctx={ctx} onChange={(p) => onChange(item, p)} /></div>
                  ))}
                </div>
              ))}
              {open && <AddRow className="border-t border-border/40 pl-3" onAdd={(t) => onAdd(t, g.key)} />}
            </div>
          );
        })}
        {groups.length === 0 && <AddRow className="pl-3" onAdd={(t) => onAdd(t, "all")} />}
      </div>
    </div>
  );
}
