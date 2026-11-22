// Table (P-69): rows = items, columns = the view's fields; every cell is changed in place; groups fold. Rows are
// dragged by their grip: into another group (sets its value) and, when the view has no sort, to another place.
// Ticked rows get the bulk bar of the page.
import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { GripVertical, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item } from "@/core/items";
import { type FieldKey, fieldOf, type Group } from "../query";
import { FieldValue, StatusPicker, Tip, TypeIcon } from "../fields";
import { GroupHeader } from "./GroupHeader";
import { AddRow } from "./AddRow";
import type { LayoutProps } from "./common";

const WIDTH: Record<string, number> = { number: 60, parent: 200, url: 180, type: 110, status: 115, priority: 105, estimate_min: 90, spent_min: 80 };
const KIND_WIDTH: Record<string, number> = { select: 130, text: 170, checkbox: 80, number: 95, date: 105 };
const SELECT_W = 52; // tick box + grip

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
      {item.number > 0 && <span className="shrink-0 text-[10px] text-muted-foreground/60">#{item.number}</span>}
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

type Drop = { id: string; after: boolean } | null;

function Row({ item, group, index, props, fields, columns, drop, canDrag }: {
  item: Item; group: string; index: number; props: LayoutProps; fields: FieldKey[]; columns: string; drop: Drop; canDrag: boolean;
}) {
  const { ctx, onChange, selected, onSelect } = props;
  const drag = useDraggable({ id: item.id, data: { group }, disabled: !canDrag });
  const target = useDroppable({ id: `row:${item.id}`, data: { group, index, itemId: item.id } });
  const on = !!selected?.has(item.id);
  return (
    <div
      ref={target.setNodeRef}
      className={cn("group/row relative grid items-center border-t border-border/40 hover:bg-muted/20", on && "bg-primary/5", drag.isDragging && "opacity-40")}
      style={{ gridTemplateColumns: columns }}
    >
      {drop?.id === item.id && <div className={cn("pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary", drop.after ? "-bottom-px" : "-top-px")} />}
      <div className="flex items-center pl-1">
        <span
          ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners}
          className={cn("cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-foreground group-hover/row:opacity-100", !canDrag && "invisible")}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {onSelect && (
          <input
            type="checkbox" checked={on} aria-label="Select"
            onChange={() => undefined}
            onClick={(e) => onSelect(item.id, e.shiftKey)}
            className={cn("ml-0.5 h-3.5 w-3.5 cursor-pointer accent-primary", !on && !selected?.size && "opacity-0 group-hover/row:opacity-100")}
          />
        )}
      </div>
      <div className="min-w-0 py-1 pr-2"><TitleCell item={item} {...props} /></div>
      {fields.map((f) => (
        <div key={f} className="min-w-0 px-1 py-1"><FieldValue item={item} field={f} ctx={ctx} onChange={(p) => onChange(item, p)} /></div>
      ))}
    </div>
  );
}

function GroupEnd({ group, index, children }: { group: string; index: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `end:${group}`, data: { group, index } });
  return <div ref={setNodeRef} className={cn(isOver && "bg-primary/5")}>{children}</div>;
}

export function TableLayout(props: LayoutProps) {
  const { groups, config, ctx, onAdd, onMove, selected, onSelectAll } = props;
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<Item | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fields = config.fields.filter((f) => f !== "title" && fieldOf(ctx, f));
  const widthOf = (f: FieldKey) => WIDTH[f] ?? KIND_WIDTH[fieldOf(ctx, f)?.kind ?? ""] ?? 105;
  const columns = `${SELECT_W}px minmax(240px, 1fr) ${fields.map((f) => `${widthOf(f)}px`).join(" ")}`;
  const minWidth = SELECT_W + 240 + fields.reduce((s, f) => s + widthOf(f), 0);
  const grouped = !!config.group_by;
  const sorted = config.sort.length > 0;
  const canDrag = !!onMove && (!sorted || grouped);
  const visible = groups.flatMap((g) => (folded.has(g.key) ? [] : g.items.map((i) => i.id)));
  const allOn = visible.length > 0 && visible.every((id) => selected?.has(id));

  const overOf = (e: DragOverEvent | DragEndEvent): Drop => {
    const over = e.over;
    const id = over?.data.current?.itemId as string | undefined;
    if (!over || !id || id === e.active.id) return null;
    const box = e.active.rect.current.translated;
    const after = !!box && box.top + box.height / 2 > over.rect.top + over.rect.height / 2;
    return { id, after };
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setDrop(null);
    const item = ctx.byId.get(String(e.active.id));
    const data = e.over?.data.current as { group: string; index: number; itemId?: string } | undefined;
    if (!item || !data || !onMove || data.itemId === item.id) return;
    const from = e.active.data.current?.group as string;
    let index = data.index;
    if (data.itemId && overOf(e)?.after) index += 1;
    if (from === data.group) {
      const own = groups.find((g) => g.key === from)?.items.findIndex((i) => i.id === item.id) ?? -1;
      if (own >= 0 && own < index) index -= 1;
      if (sorted || own === index) return; // the order comes from the sort / nothing moved
    }
    onMove(item, data.group, index);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragging(ctx.byId.get(String(e.active.id)) ?? null)}
      onDragOver={(e) => setDrop(sorted && e.over?.data.current?.group === e.active.data.current?.group ? null : overOf(e))}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setDragging(null); setDrop(null); }}
    >
      <div className="overflow-x-auto rounded-lg border border-border">
        <div style={{ minWidth }}>
          <div className="sticky top-0 z-10 grid items-center border-b border-border bg-card/95 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" style={{ gridTemplateColumns: columns }}>
            <div className="flex justify-end pr-0.5">
              {onSelectAll && (
                <Tip label={allOn ? "Unselect all" : "Select all shown"}>
                  <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => onSelectAll(visible, !allOn)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
                </Tip>
              )}
            </div>
            <div className="py-2">Title</div>
            {fields.map((f) => {
              const def = fieldOf(ctx, f)!;
              return <div key={f} className="truncate px-2 py-2">{def.tip ? <Tip label={def.tip}><span>{def.label}</span></Tip> : def.label}</div>;
            })}
          </div>
          {groups.map((g: Group) => {
            const open = !folded.has(g.key);
            return (
              <div key={g.key} className="border-b border-border/60 last:border-b-0">
                {grouped && (
                  <GroupEnd group={g.key} index={0}>
                    <GroupHeader by={config.group_by} group={g} ctx={ctx} open={open}
                      toggle={() => setFolded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} />
                  </GroupEnd>
                )}
                {open && g.items.map((item, k) => (
                  <Row key={item.id} item={item} group={g.key} index={k} props={props} fields={fields} columns={columns} drop={drop} canDrag={canDrag} />
                ))}
                {open && (
                  <GroupEnd group={g.key} index={g.items.length}>
                    <AddRow className="border-t border-border/40" style={{ paddingLeft: SELECT_W + 4 }} onAdd={(t) => onAdd(t, g.key)} />
                  </GroupEnd>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <AddRow style={{ paddingLeft: SELECT_W + 4 }} onAdd={(t) => onAdd(t, "all")} />}
        </div>
      </div>
      <DragOverlay>
        {dragging && <div className="rounded-md border border-border bg-card px-3 py-1.5 text-sm shadow-lg">{dragging.title}</div>}
      </DragOverlay>
    </DndContext>
  );
}
