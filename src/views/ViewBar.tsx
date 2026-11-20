// The views' tabs and the toolbar of the open view (P-69): layout, filter, slice, group by, sort, fields (+ new field).
// Changes show at once; a dot on the tab means "changed, not saved" — Save keeps them for every device, Discard drops them.
import { useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChartGantt, ChevronDown, Columns3, Copy, Kanban, ListFilter, PanelLeft, Pencil, Plus, Rows3,
  SlidersHorizontal, Table2, Trash2, X, CircleHelp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { boardableFields, type Ctx, type CustomField, type FieldKey, fieldOf, groupableFields, type Layout, type ViewConfig } from "./query";
import { Tip } from "./fields";
import { FieldEditor } from "./FieldEditor";
import type { FieldActions } from "./useFields";
import type { View } from "./useViews";

export const LAYOUTS: { id: Layout; label: string; icon: typeof Table2 }[] = [
  { id: "table", label: "Table", icon: Table2 },
  { id: "board", label: "Board", icon: Kanban },
  { id: "timeline", label: "Timeline", icon: ChartGantt },
];
const layoutIcon = (l: string) => LAYOUTS.find((x) => x.id === l)?.icon ?? Table2;

export type ExtraTab = { id: string; label: string; tip: string; icon: typeof Table2 };

export function ViewTabs({ views, active, dirty, extra, onSelect, onAdd, onRename, onDuplicate, onDelete }: {
  views: View[]; active: string | null; dirty: Set<string>; extra: ExtraTab[];
  onSelect: (id: string) => void; onAdd: () => void; onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const tab = (on: boolean) => cn(
    "group flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
    on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );
  return (
    <div className="flex items-end overflow-x-auto border-b border-border">
      {views.map((v) => {
        const Icon = layoutIcon(v.layout);
        const on = v.id === active;
        if (renaming === v.id) {
          return (
            <input
              key={v.id} autoFocus defaultValue={v.name}
              className="w-32 shrink-0 border-b-2 border-primary bg-transparent px-3 py-2 text-sm outline-none"
              onBlur={(e) => { setRenaming(null); const n = e.target.value.trim(); if (n && n !== v.name) onRename(v.id, n); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
            />
          );
        }
        return (
          <div key={v.id} className={tab(on)}>
            <button type="button" onClick={() => onSelect(v.id)} onDoubleClick={() => setRenaming(v.id)} className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {v.name}
              {dirty.has(v.id) && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
            {on && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded p-0.5 text-muted-foreground hover:bg-muted/60"><ChevronDown className="h-3 w-3" /></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setRenaming(v.id)}><Pencil className="mr-2 h-3.5 w-3.5" />Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(v.id)}><Copy className="mr-2 h-3.5 w-3.5" />Duplicate</DropdownMenuItem>
                  {views.length > 1 && (
                    <DropdownMenuItem onClick={() => onDelete(v.id)} className="text-destructive"><Trash2 className="mr-2 h-3.5 w-3.5" />Delete view</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      <Tip label="New view">
        <button type="button" onClick={onAdd} className="shrink-0 px-2 py-2 text-muted-foreground hover:text-foreground"><Plus className="h-4 w-4" /></button>
      </Tip>
      {extra.length > 0 && <div className="mx-2 mb-2 h-4 w-px shrink-0 bg-border" />}
      {extra.map((x) => (
        <Tip key={x.id} label={x.tip}>
          <button type="button" onClick={() => onSelect(x.id)} className={cn(tab(x.id === active), "opacity-80")}>
            <x.icon className="h-3.5 w-3.5" />{x.label}
          </button>
        </Tip>
      ))}
    </div>
  );
}

const menuRow = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";
const toolButton = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground";

function Menu({ icon: Icon, label, tip, children, wide }: { icon: typeof Table2; label: string; tip: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <Popover>
      <Tip label={tip}>
        <PopoverTrigger asChild>
          <button type="button" className={toolButton}><Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span></button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className={cn("p-1", wide ? "w-64" : "w-52")}>{children}</PopoverContent>
    </Popover>
  );
}

const FILTER_HELP = "type:task,idea · status:todo · -status:done · is:open · is:overdue · priority:urgent,high · in:thesis · day:@today · due:<@today+7 · no:due · has:estimate · estimate:>60 · <custom field>:<value> · free words";

export function ViewToolbar({ layout, config, ctx, count, dirty, fieldActions, extra, onLayout, onConfig, onSave, onDiscard }: {
  layout: Layout; config: ViewConfig; ctx: Ctx; count: number; dirty: boolean; fieldActions: FieldActions; extra?: React.ReactNode;
  onLayout: (l: Layout) => void; onConfig: (c: Partial<ViewConfig>) => void; onSave: () => void; onDiscard: () => void;
}) {
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);
  const label = (f: string | null | undefined) => fieldOf(ctx, f)?.label ?? "None";
  const all = Object.values(ctx.fields).map((d) => d.key);
  const boardBy = config.board_by ?? "status";
  const sortable = all.filter((f) => !config.sort.some((s) => s.field === f));
  const groupable = groupableFields(ctx);

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <div className="flex rounded-md border border-border p-0.5">
        {LAYOUTS.map((l) => (
          <Tip key={l.id} label={l.label}>
            <button type="button" onClick={() => onLayout(l.id)}
              className={cn("rounded px-2 py-1", layout === l.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              <l.icon className="h-3.5 w-3.5" />
            </button>
          </Tip>
        ))}
      </div>

      <div className="relative flex min-w-[12rem] flex-1 items-center">
        <ListFilter className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={config.filter}
          onChange={(e) => onConfig({ filter: e.target.value })}
          placeholder="Filter"
          className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-14 text-sm outline-none focus:border-primary/50"
        />
        {config.filter && (
          <button type="button" onClick={() => onConfig({ filter: "" })} className="absolute right-8 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        )}
        <Tip label={FILTER_HELP}>
          <CircleHelp className="absolute right-2.5 h-3.5 w-3.5 text-muted-foreground" />
        </Tip>
      </div>

      <Menu icon={PanelLeft} label={config.slice_by ? label(config.slice_by) : "Slice"} tip="Slice by: a list of its values on the side">
        <button type="button" className={cn(menuRow, !config.slice_by && "bg-accent")} onClick={() => onConfig({ slice_by: null })}>None</button>
        {groupable.map((f) => (
          <button key={f} type="button" className={cn(menuRow, f === config.slice_by && "bg-accent")} onClick={() => onConfig({ slice_by: f })}>{label(f)}</button>
        ))}
      </Menu>

      {layout === "board" ? (
        <Menu icon={Columns3} label={label(boardBy)} tip="Columns by">
          {boardableFields(ctx).map((f) => (
            <button key={f} type="button" className={cn(menuRow, f === boardBy && "bg-accent")} onClick={() => onConfig({ board_by: f })}>{label(f)}</button>
          ))}
        </Menu>
      ) : (
        <Menu icon={Rows3} label={config.group_by ? label(config.group_by) : "Group"} tip="Group by">
          <button type="button" className={cn(menuRow, !config.group_by && "bg-accent")} onClick={() => onConfig({ group_by: null })}>None</button>
          {groupable.map((f) => (
            <button key={f} type="button" className={cn(menuRow, f === config.group_by && "bg-accent")} onClick={() => onConfig({ group_by: f })}>{label(f)}</button>
          ))}
        </Menu>
      )}

      <Menu icon={ArrowUpDown} label={config.sort.length ? label(config.sort[0].field) : "Sort"} tip="Sort; no sort = your own order (drag rows)" wide>
        {config.sort.map((s, k) => (
          <div key={s.field} className="flex items-center gap-1 px-1">
            <span className="flex-1 px-1 text-sm">{label(s.field)}</span>
            <Tip label={s.desc ? "Descending" : "Ascending"}>
              <button type="button" className="rounded p-1 hover:bg-accent"
                onClick={() => onConfig({ sort: config.sort.map((x, j) => (j === k ? { ...x, desc: !x.desc } : x)) })}>
                {s.desc ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </button>
            </Tip>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => onConfig({ sort: config.sort.filter((_, j) => j !== k) })}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {config.sort.length > 0 && <div className="my-1 h-px bg-border" />}
        <div className="max-h-56 overflow-y-auto">
          {sortable.map((f) => (
            <button key={f} type="button" className={menuRow} onClick={() => onConfig({ sort: [...config.sort, { field: f }] })}>
              <Plus className="h-3 w-3 text-muted-foreground" />{label(f)}
            </button>
          ))}
        </div>
      </Menu>

      {layout !== "timeline" && (
        <Menu icon={SlidersHorizontal} label="Fields" tip="Shown fields; + New field" wide>
          <div className="max-h-80 overflow-y-auto">
            {all.filter((f) => f !== "title").map((f) => {
              const on = config.fields.includes(f);
              const custom = ctx.fields[f]?.custom;
              return (
                <div key={f} className="flex items-center">
                  <label className={cn(menuRow, "flex-1 cursor-pointer")}>
                    <input type="checkbox" className="accent-primary" checked={on}
                      onChange={() => onConfig({ fields: on ? config.fields.filter((x) => x !== f) : [...config.fields, f] as FieldKey[] })} />
                    {label(f)}
                  </label>
                  {custom && (
                    <Tip label="Edit field">
                      <button type="button" onClick={() => setEditing(custom)} className="rounded p-1.5 text-muted-foreground hover:bg-accent"><Pencil className="h-3 w-3" /></button>
                    </Tip>
                  )}
                </div>
              );
            })}
          </div>
          <div className="my-1 h-px bg-border" />
          <button type="button" className={menuRow} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" />New field</button>
        </Menu>
      )}

      {layout === "timeline" && (
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {(["month", "quarter", "year"] as const).map((z) => (
            <button key={z} type="button" onClick={() => onConfig({ zoom: z })}
              className={cn("rounded px-2 py-1 capitalize", (config.zoom ?? "quarter") === z ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {z}
            </button>
          ))}
        </div>
      )}

      {extra}
      <span className="ml-auto text-xs text-muted-foreground">{count}</span>
      {dirty && (
        <>
          <button type="button" onClick={onDiscard} className={toolButton}>Discard</button>
          <button type="button" onClick={onSave} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
        </>
      )}

      {editing && (
        <FieldEditor
          key={editing === "new" ? "new" : editing.id}
          field={editing === "new" ? null : editing} open onClose={() => setEditing(null)} actions={fieldActions}
          onMade={(f) => onConfig({ fields: [...config.fields, `props.${f.key}`] })}
        />
      )}
    </div>
  );
}
