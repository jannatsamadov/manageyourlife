// Board (P-69): one column per value of a field (status by default); dragging a card into another column sets it.
import { useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Item } from "@/core/items";
import { FIELDS, type Group, patchForGroup } from "../query";
import { FieldValue } from "../fields";
import { GroupIcon, GroupSums } from "./GroupHeader";
import { AddRow } from "./AddRow";
import { TitleCell } from "./TableLayout";
import type { LayoutProps } from "./common";

function Card({ item, props, overlay }: { item: Item; props: LayoutProps; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: overlay });
  const by = props.config.board_by ?? "status";
  const fields = props.config.fields.filter((f) => f !== "title" && f !== by && FIELDS[f]);
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={cn("rounded-md border border-border bg-card px-2 py-1.5 shadow-sm", isDragging && "opacity-40", overlay && "rotate-1 shadow-lg")}
    >
      <TitleCell item={item} {...props} showType={by !== "type"} />
      {fields.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5">
          {fields.map((f) => <FieldValue key={f} item={item} field={f} ctx={props.ctx} onChange={(p) => props.onChange(item, p)} />)}
        </div>
      )}
    </div>
  );
}

function Column({ group, props }: { group: Group; props: LayoutProps }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key });
  const by = props.config.board_by ?? "status";
  return (
    <div ref={setNodeRef} className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/10", isOver && "border-primary/50 bg-primary/5")}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <GroupIcon by={by} group={group} ctx={props.ctx} />
        <span className="truncate">{group.label}</span>
        <GroupSums group={group} />
      </div>
      <div className="flex min-h-[3rem] flex-col gap-1.5 px-2 pb-1">
        {group.items.map((i) => <Card key={i.id} item={i} props={props} />)}
      </div>
      <AddRow className="px-3" onAdd={(t) => props.onAdd(t, group.key)} />
    </div>
  );
}

export function BoardLayout(props: LayoutProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragging, setDragging] = useState<Item | null>(null);
  const by = props.config.board_by ?? "status";

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const item = props.ctx.byId.get(String(e.active.id));
    const to = e.over ? String(e.over.id) : null;
    if (!item || !to) return;
    const from = props.groups.find((g) => g.items.some((i) => i.id === item.id))?.key;
    if (from === to) return;
    props.onChange(item, patchForGroup(by, to, props.ctx));
  };

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(props.ctx.byId.get(String(e.active.id)) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex items-start gap-3 overflow-x-auto pb-3">
        {props.groups.map((g) => <Column key={g.key} group={g} props={props} />)}
      </div>
      <DragOverlay>{dragging && <div className="w-72"><Card item={dragging} props={props} overlay /></div>}</DragOverlay>
    </DndContext>
  );
}
