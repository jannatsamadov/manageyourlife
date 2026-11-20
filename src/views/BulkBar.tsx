// Bulk edit (GitHub Projects' multi-select): the ticked rows get one change at once — status, priority, type, parent,
// planned day, deadline, a custom select / checkbox — or go to the Trash. All or none are saved.
import { CalendarClock, CalendarDays, ChevronDown, FolderKanban, Trash2, X } from "lucide-react";
import type { Item, ItemPatch } from "@/core/items";
import { ITEM_TYPES, PRIORITIES, STATUSES, TYPE_ORDER } from "@/core/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Ctx, customFields } from "./query";
import { DatePicker, OptionDot, ParentPicker, PriorityIcon, StatusIcon, Tip, TypeIcon } from "./fields";

const button = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground";

function Pick({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={button}>{label}<ChevronDown className="h-3 w-3" /></DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" className="max-h-80 overflow-y-auto">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BulkBar({ items, ctx, onChange, onTrash, onClear }: {
  items: Item[]; ctx: Ctx; onChange: (patch: ItemPatch) => void; onTrash: () => void; onClear: () => void;
}) {
  if (!items.length) return null;
  // A blank copy of the first row: the date / parent pickers show empty, and offer the parents its type allows.
  const blank = { ...items[0], planned_on: null, due_on: null, parent_id: null } as Item;
  const choices = customFields(ctx).filter((d) => d.kind === "select" || d.kind === "checkbox");

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur">
        <span className="px-2 text-xs font-medium">{items.length}</span>
        <Pick label="Status">
          {STATUSES.map((s) => <DropdownMenuItem key={s.id} onClick={() => onChange({ status: s.id })}><StatusIcon status={s.id} className="mr-2" />{s.label}</DropdownMenuItem>)}
        </Pick>
        <Pick label="Priority">
          {[...PRIORITIES.map((p) => ({ id: p.id as number | null, label: p.label })), { id: null, label: "No priority" }].map((p) => (
            <DropdownMenuItem key={String(p.id)} onClick={() => onChange({ priority: p.id })}><PriorityIcon priority={p.id} className="mr-2" />{p.label}</DropdownMenuItem>
          ))}
        </Pick>
        <Pick label="Type">
          {TYPE_ORDER.map((t) => <DropdownMenuItem key={t} onClick={() => onChange({ type: t })}><TypeIcon type={t} className="mr-2" />{ITEM_TYPES[t].label}</DropdownMenuItem>)}
        </Pick>
        <ParentPicker item={blank} ctx={ctx} onChange={onChange}><FolderKanban className="h-3.5 w-3.5" />In</ParentPicker>
        <span className="inline-flex items-center text-xs text-muted-foreground">
          <CalendarDays className="ml-1 h-3 w-3" /><DatePicker item={blank} field="planned_on" ctx={ctx} onChange={onChange} label="Planned day" />
        </span>
        <span className="inline-flex items-center text-xs text-muted-foreground">
          <CalendarClock className="ml-1 h-3 w-3" /><DatePicker item={blank} field="due_on" ctx={ctx} onChange={onChange} label="Deadline" />
        </span>
        {choices.map((d) => (
          <Pick key={d.key} label={d.label}>
            {d.kind === "select"
              ? [...d.custom!.options.map((o) => ({ id: o.id as string | null, name: o.name, color: o.color })), { id: null, name: "None", color: undefined }].map((o) => (
                <DropdownMenuItem key={String(o.id)} onClick={() => onChange({ props: { [d.custom!.key]: o.id } })}>
                  <OptionDot color={o.color} className={o.id ? "mr-2" : "mr-2 opacity-30"} />{o.name}
                </DropdownMenuItem>
              ))
              : [true, false].map((v) => (
                <DropdownMenuItem key={String(v)} onClick={() => onChange({ props: { [d.custom!.key]: v } })}>{v ? "Yes" : "No"}</DropdownMenuItem>
              ))}
          </Pick>
        ))}
        <Tip label="Move to Trash">
          <button type="button" onClick={onTrash} className={`${button} hover:text-destructive`}><Trash2 className="h-3.5 w-3.5" /></button>
        </Tip>
        <Tip label="Unselect (Esc)">
          <button type="button" onClick={onClear} className={button}><X className="h-3.5 w-3.5" /></button>
        </Tip>
      </div>
    </div>
  );
}
