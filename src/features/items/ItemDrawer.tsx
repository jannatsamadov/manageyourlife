// The item drawer (P-70 §10, like GitHub's issue side panel): any item, opened from any page by `?item=<id>` in the
// URL (so a link opens it too). Its #number, properties by type, the path to the root, sub-items, linked notes with
// their to-dos, comments (#200), where it came from, the timer.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, Play, Square, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { type Item, useItems, useTimeLogs, useTimer } from "@/core/items";
import { useItemEdit } from "@/core/edit";
import { useItemNotes, useNoteLinkActions, useNoteTodos } from "@/core/notes";
import { ITEM_TYPES, TYPE_ORDER, type ItemType } from "@/core/types";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { customFields, localDay, makeCtx, minutesLabel } from "@/views/query";
import { useFields } from "@/views/useFields";
import {
  CustomPicker, DatePicker, dayLabel, MinutesPicker, ParentPicker, pathOf, PriorityPicker, StatusPicker, Tip, TypeIcon, TypePicker,
} from "@/views/fields";
import { AddRow } from "@/views/layouts/AddRow";
import { Comments } from "./Comments";

// `fresh`: an item just made (e.g. a click on an empty cell of the Tunnel view) — the drawer opens with its title
// selected, ready to type over (?new=1).
export function useItemDrawer() {
  const [params, setParams] = useSearchParams();
  const open = useCallback((id: string, opts?: { fresh?: boolean }) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set("item", id);
    if (opts?.fresh) n.set("new", "1");
    else n.delete("new");
    return n;
  }), [setParams]);
  const close = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete("item"); n.delete("new"); return n; }), [setParams]);
  return { id: params.get("item"), fresh: params.get("new") === "1", open, close };
}

// What "+ Add" makes under an item: the next level of the strategy, else a task where tasks may sit.
function childType(parent: string): ItemType | null {
  const next: Partial<Record<string, ItemType>> = { area: "goal", goal: "mission", mission: "step", step: "step", idea: "idea" };
  if (next[parent]) return next[parent]!;
  if (ITEM_TYPES.task.parents.includes(parent as ItemType)) return "task";
  return TYPE_ORDER.find((t) => ITEM_TYPES[t].parents.includes(parent as ItemType)) ?? null;
}

const SOURCE_NAME: Record<string, string> = { google_tasks: "Google Tasks", google_calendar: "Google Calendar", telegram: "Telegram", vault: "Notes", mcp: "MCP" };

const Row = ({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) => (
  <>
    <div className="py-1 text-xs text-muted-foreground">{tip ? <Tip label={tip}><span>{label}</span></Tip> : label}</div>
    <div className="flex min-w-0 items-center gap-1">{children}</div>
  </>
);

function Notes({ item }: { item: Item }) {
  const notes = useItemNotes(item.id);
  const todos = useNoteTodos(item.id);
  const { toggleTodo } = useNoteLinkActions();
  if (!notes.data?.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</h3>
      {notes.data.map((n) => (
        <div key={n.id}>
          <Link to={`/notes?open=${encodeURIComponent(n.path)}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />{n.title}
          </Link>
          {(todos.data ?? []).filter((t) => t.note_id === n.id).map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2 py-0.5 pl-5 text-sm">
              <input type="checkbox" className="accent-primary" checked={t.completed} onChange={() => toggleTodo(t, !t.completed, item.id)} />
              <span className={cn(t.completed && "text-muted-foreground line-through")}>{t.title}</span>
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}

function Body({ item }: { item: Item }) {
  const edit = useItemEdit();
  const items = useItems();
  const logs = useTimeLogs();
  const timer = useTimer();
  const drawer = useItemDrawer();
  const custom = useFields();
  const ctx = useMemo(() => makeCtx(items.data ?? [], new Date(), custom.fields), [items.data, custom.fields]);
  const change = (patch: Parameters<typeof edit.change>[1]) => edit.change(item, patch);
  // a fresh item: its title focused and selected (after the sheet has placed its own focus)
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const fresh = drawer.fresh;
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 80);
    return () => window.clearTimeout(t);
  }, [fresh, item.id]);
  const running = logs.data?.some((l) => l.item_id === item.id && !l.ended_at);
  const kids = useMemo(() => (items.data ?? []).filter((i) => i.parent_id === item.id && !i.deleted_at).sort((a, b) => a.position - b.position), [items.data, item.id]);
  const sources = useQuery({
    queryKey: ["item-sources", item.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("item_sources").select("source").eq("item_id", item.id);
      if (error) throw new Error(error.message);
      return data.map((s) => s.source);
    },
  });
  const path = pathOf(item, ctx, 6);
  const type = item.type as ItemType;
  const kidType = childType(type);
  const strategyish = ITEM_TYPES[type]?.group === "strategy" || ["project", "milestone", "routine"].includes(type);

  return (
    <div className="space-y-5">
      {(path.length > 0 || item.number > 0) && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {item.number > 0 && (
            <Tip label="Its number: type #N in a search, or ask the AI about it">
              <span className="mr-1.5 font-medium text-foreground/70">#{item.number}</span>
            </Tip>
          )}
          {path.map((p, k) => (
            <span key={p.id} className="flex items-center gap-1">
              {k > 0 && <ChevronRight className="h-3 w-3" />}
              <button type="button" onClick={() => drawer.open(p.id)} className="flex items-center gap-1 hover:text-foreground"><TypeIcon type={p.type} />{p.title}</button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={titleRef}
        key={`t-${item.id}-${item.title}`}
        defaultValue={item.title}
        rows={Math.min(4, Math.max(1, Math.ceil(item.title.length / 45)))}
        className="w-full resize-none bg-transparent text-lg font-semibold outline-none"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        onBlur={(e) => {
          const t = e.target.value.trim();
          if (t && t !== item.title) {
            change({ title: t });
            if (fresh) drawer.open(item.id); // named: no longer fresh
          }
        }}
      />

      <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-0.5">
        <Row label="Type"><TypePicker item={item} onChange={change} showLabel /></Row>
        <Row label="Status"><StatusPicker item={item} onChange={change} showLabel /></Row>
        <Row label="Priority"><PriorityPicker item={item} onChange={change} showLabel /></Row>
        <Row label="In" tip="The main parent: progress and sums go up this way"><ParentPicker item={item} ctx={ctx} onChange={change} /></Row>
        {strategyish && <Row label="Start"><DatePicker item={item} field="start_on" ctx={ctx} onChange={change} label="Start" /></Row>}
        <Row label="Day" tip="Planned day (and time)">
          <DatePicker item={item} field="planned_on" ctx={ctx} onChange={change} label="Planned day" />
          {item.planned_on && (
            <input type="time" defaultValue={item.planned_time ?? ""} key={`pt-${item.planned_time}`}
              className="rounded border border-transparent bg-transparent px-1 text-xs text-muted-foreground hover:border-border"
              onBlur={(e) => { const v = e.target.value || null; if (v !== item.planned_time) change({ planned_time: v }); }} />
          )}
          {item.planned_on && item.planned_time && (
            <Tip label="A fixed-time event (not a time block)">
              <label className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" className="accent-primary" checked={item.is_event} onChange={() => change({ is_event: !item.is_event })} />Event
              </label>
            </Tip>
          )}
        </Row>
        <Row label="Due" tip="Deadline">
          <DatePicker item={item} field="due_on" ctx={ctx} onChange={change} label="Deadline" />
          {item.due_on && (
            <input type="time" defaultValue={item.due_time ?? ""} key={`dt-${item.due_time}`}
              className="rounded border border-transparent bg-transparent px-1 text-xs text-muted-foreground hover:border-border"
              onBlur={(e) => { const v = e.target.value || null; if (v !== item.due_time) change({ due_time: v }); }} />
          )}
        </Row>
        <Row label="Estimate"><MinutesPicker item={item} onChange={change} /></Row>
        <Row label="Spent" tip="Logged by the timer">
          <span className="px-1.5 text-xs">{minutesLabel(item.spent_min) || "—"}</span>
          <Tip label={running ? "Stop the timer" : "Start the timer"}>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              onClick={async () => {
                if (running) return timer.stop(item.id);
                await timer.start(item.id);
                if (item.status === "todo") change({ status: "doing" });
              }}>
              {running ? <Square className="h-3.5 w-3.5 text-amber-400" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          </Tip>
        </Row>
        <Row label="Link">
          <input
            defaultValue={item.url ?? ""} key={`u-${item.url}`} placeholder="https://…"
            className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs hover:border-border focus:border-border focus:outline-none"
            onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== item.url) change({ url: v }); }}
          />
        </Row>
        {customFields(ctx).filter((d) => !d.custom?.item_types?.length || d.custom.item_types.includes(item.type) || d.get(item, ctx) !== null).map((d) => (
          <Row key={d.key} label={d.label}><CustomPicker item={item} def={d} ctx={ctx} onChange={change} showEmpty /></Row>
        ))}
      </div>

      <textarea
        key={`b-${item.id}-${item.body}`}
        defaultValue={item.body}
        placeholder="Notes"
        rows={Math.min(14, Math.max(4, item.body.split("\n").length + 1))}
        className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary/50"
        onBlur={(e) => { if (e.target.value !== item.body) change({ body: e.target.value }); }}
      />

      {(kids.length > 0 || kidType) && (
        <section className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sub-items {kids.length > 0 && <span className="normal-case">{kids.filter((k) => k.status === "done").length}/{kids.length}</span>}
          </h3>
          {kids.map((k) => (
            <div key={k.id} className="flex items-center gap-1">
              <StatusPicker item={k} onChange={(p) => edit.change(k, p)} />
              <TypeIcon type={k.type} />
              <button type="button" onClick={() => drawer.open(k.id)} className={cn("truncate text-left text-sm hover:underline", (k.status === "done" || k.status === "dropped") && "text-muted-foreground line-through")}>{k.title}</button>
            </div>
          ))}
          {kidType && (
            <AddRow onAdd={(title) => edit.create({
              type: kidType, title, parent_id: item.id, position: Math.max(-1, ...kids.map((k) => k.position)) + 1,
            })} />
          )}
        </section>
      )}

      <Notes item={item} />

      <Comments itemId={item.id} today={ctx.today} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        {(sources.data ?? []).map((s) => <span key={s} className="rounded bg-muted px-1.5 py-0.5">{SOURCE_NAME[s] ?? s}</span>)}
        <span>Created {dayLabel(localDay(new Date(item.created_at)), ctx.today)}</span>
        {item.done_at && <span>· Done {dayLabel(localDay(new Date(item.done_at)), ctx.today)}</span>}
        <span className="ml-auto" />
        {item.deleted_at ? (
          <button type="button" onClick={() => edit.restore(item)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:text-foreground"><Undo2 className="h-3 w-3" />Restore</button>
        ) : (
          <Tip label="Move to the trash">
            <button type="button" onClick={async () => { if (await edit.trash(item)) drawer.close(); }} className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
          </Tip>
        )}
      </div>
    </div>
  );
}

export default function ItemDrawer() {
  const { id, close } = useItemDrawer();
  const items = useItems();
  const item = id ? items.data?.find((i) => i.id === id) : undefined;
  return (
    <Sheet open={!!item} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetTitle className="sr-only">{item?.title ?? "Item"}</SheetTitle>
        <SheetDescription className="sr-only">Item details</SheetDescription>
        {item && <div className="pt-4"><Body item={item} /></div>}
      </SheetContent>
    </Sheet>
  );
}
