// Tasks (P-69, P-70 phase 3, T-114): every item of the workspace through saved views — tasks, ideas, the Inbox,
// money, the strategy — as a table, a board or a timeline, with filter / slice / sort / group by and custom fields
// (GitHub Projects style). The views exist to feed the app's question "what is best to do now?" (P-65): the default
// view groups the open tasks by when they need attention; the Inbox view collects every capture (Telegram, MCP, the
// app) to be sorted by hand (bulk edit) or with AI. Until phase 4 the to-dos and ideas written in notes are two extra tabs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Lightbulb, ListChecks, Loader2 } from "lucide-react";
import { type Item, type ItemPatch, useItems } from "@/core/items";
import { useItemEdit } from "@/core/edit";
import { ITEM_TYPES, type ItemType } from "@/core/types";
import { useItemDrawer } from "@/features/items/ItemDrawer";
import { AiSort } from "@/features/items/AiSort";
import { applyFilter, groupItems, type Layout, makeCtx, patchForGroup, sortItems, type ViewConfig } from "@/views/query";
import { normalizeConfig, useViews, type View, type ViewSeed } from "@/views/useViews";
import { useFields } from "@/views/useFields";
import { type ExtraTab, ViewTabs, ViewToolbar } from "@/views/ViewBar";
import { SlicePanel } from "@/views/SlicePanel";
import { BulkBar } from "@/views/BulkBar";
import { kidsOf, placeAt } from "@/views/layouts/common";
import { TableLayout } from "@/views/layouts/TableLayout";
import { BoardLayout } from "@/views/layouts/BoardLayout";
import { TimelineLayout } from "@/views/layouts/TimelineLayout";
import NoteTodos from "./NoteTodos";
import Ideas from "./Ideas";

const SEEDS: ViewSeed[] = [
  { name: "Tasks", layout: "table", config: { filter: "type:task is:open", group_by: "when", sort: [{ field: "priority" }], fields: ["priority", "props.who", "when", "estimate_min", "parent"], new_type: "task" } },
  { name: "Inbox", layout: "table", config: { filter: "type:capture is:open", group_by: null, slice_by: "props.kind", sort: [{ field: "created_at", desc: true }], fields: ["props.kind", "type", "parent", "when", "created_at"], new_type: "capture" } },
  { name: "Board", layout: "board", config: { filter: "type:task,idea -status:dropped", group_by: null, board_by: "status", sort: [{ field: "priority" }], fields: ["priority", "when", "parent"], new_type: "task" } },
  { name: "Ideas", layout: "table", config: { filter: "type:idea", group_by: "parent", sort: [{ field: "created_at", desc: true }], fields: ["status", "parent", "created_at"], new_type: "idea" } },
  { name: "Timeline", layout: "timeline", config: { filter: "is:open -is:private", group_by: "type", sort: [{ field: "when" }], fields: [], zoom: "quarter" } },
  { name: "All", layout: "table", config: { filter: "", group_by: "type", sort: [], fields: ["status", "priority", "when", "parent", "updated_at"] } },
];

const EXTRA: ExtraTab[] = [
  { id: "note-todos", label: "Note to-dos", tip: "To-dos written in the notes; they become items later", icon: ListChecks },
  { id: "note-ideas", label: "Note ideas", tip: "Ideas written in the notes; they become items later", icon: Lightbulb },
];

const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

type Draft = { layout: Layout; config: ViewConfig };
const same = (a: Draft, v: View) => a.layout === v.layout && JSON.stringify(a.config) === JSON.stringify(v.config);

// The type a new item gets: the group's (a "Type" group or column), the view's, the first type in its filter, a task.
function newType(config: ViewConfig, patchType: unknown): ItemType {
  if (typeof patchType === "string" && ITEM_TYPES[patchType as ItemType]) return patchType as ItemType;
  if (config.new_type) return config.new_type;
  const m = config.filter.match(/(?:^|\s)type:([a-z]+)/);
  return m && ITEM_TYPES[m[1] as ItemType] ? (m[1] as ItemType) : "task";
}

export default function Tasks() {
  const items = useItems();
  const { views, isLoading, save, add, remove } = useViews("tasks", SEEDS);
  const custom = useFields();
  const edit = useItemEdit();
  const drawer = useItemDrawer();
  const [params, setParams] = useSearchParams();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [slice, setSlice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastPicked = useRef<string | null>(null);

  const asked = params.get("view") ?? remember.get("tasks.view");
  const extra = EXTRA.find((x) => x.id === asked);
  const view = extra ? undefined : views?.find((v) => v.id === asked) ?? views?.[0];
  const activeId = extra?.id ?? view?.id ?? null;
  useEffect(() => { if (activeId) remember.set("tasks.view", activeId); }, [activeId]);
  // Another view: no slice value, nothing ticked.
  useEffect(() => { setSlice(null); setSelected(new Set()); lastPicked.current = null; }, [activeId]);

  const select = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("view", id); return n; });
  const draft: Draft | null = useMemo(() => (view ? drafts[view.id] ?? { layout: view.layout, config: view.config } : null), [view, drafts]);
  const dirty = new Set(Object.entries(drafts).filter(([id, d]) => { const v = views?.find((x) => x.id === id); return v && !same(d, v); }).map(([id]) => id));
  const edit_ = (change: Partial<Draft>) => view && draft && setDrafts((d) => ({ ...d, [view.id]: { ...draft, ...change } }));

  const all = useMemo(() => items.data ?? [], [items.data]);
  const ctx = useMemo(() => makeCtx(all, new Date(), custom.fields), [all, custom.fields]);
  const kids = useMemo(() => kidsOf(all), [all]);
  const config = draft?.config;
  const groupBy = draft ? (draft.layout === "board" ? draft.config.board_by ?? "status" : draft.config.group_by) : null;

  // filter → slice → sort → group
  const filtered = useMemo(() => (config ? applyFilter(all, config.filter, ctx) : []), [all, config, ctx]);
  const slices = useMemo(() => (config?.slice_by ? groupItems(filtered, config.slice_by, ctx) : null), [filtered, config, ctx]);
  const sliced = useMemo(() => (slices && slice ? slices.find((g) => g.key === slice)?.items ?? [] : filtered), [slices, slice, filtered]);
  const groups = useMemo(() => (config ? groupItems(sortItems(sliced, config.sort, ctx), groupBy, ctx) : []), [sliced, config, ctx, groupBy]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const shown = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const picked = useMemo(() => shown.filter((i) => selected.has(i.id)), [shown, selected]);

  const onSelect = useCallback((id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const from = lastPicked.current ? shown.findIndex((i) => i.id === lastPicked.current) : -1;
      const to = shown.findIndex((i) => i.id === id);
      if (shift && from >= 0 && to >= 0) {
        const on = !prev.has(id);
        for (const i of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) { if (on) next.add(i.id); else next.delete(i.id); }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastPicked.current = id;
  }, [shown]);

  useEffect(() => {
    if (!selected.size) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(new Set()); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [selected.size]);

  if (items.isLoading || isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const onAdd = (title: string, groupKey: string) => {
    if (!draft) return;
    // The group's value, and the picked slice's too (a row added while "Idea" is sliced gets Kind = Idea).
    const own = patchForGroup(groupBy, groupKey, ctx);
    const patch = slice && config?.slice_by ? merge(own, patchForGroup(config.slice_by, slice, ctx)) : own;
    const type = newType(draft.config, patch.type);
    const position = Math.max(0, ...all.filter((i) => i.type === type).map((i) => i.position)) + 1;
    edit.create({ ...patch, type, title, position } as Parameters<typeof edit.create>[0]);
  };

  // A row dropped into a group / at a place (table): the group's value, and its place when the view has no sort.
  const onMove = (item: Item, groupKey: string, index: number) => {
    if (!config) return;
    const from = groups.find((g) => g.items.some((i) => i.id === item.id))?.key;
    const patch: ItemPatch = from !== groupKey ? patchForGroup(groupBy, groupKey, ctx) : {};
    const changes: { item: Item; patch: ItemPatch }[] = [];
    if (!config.sort.length) {
      const list = (groups.find((g) => g.key === groupKey)?.items ?? []).filter((i) => i.id !== item.id);
      const place = placeAt(list, index);
      if ("position" in place) patch.position = place.position;
      else {
        patch.position = index;
        for (const r of place.renumber) { const i = ctx.byId.get(r.id); if (i && i.position !== r.position) changes.push({ item: i, patch: { position: r.position } }); }
      }
    }
    if (Object.keys(patch).length) changes.unshift({ item, patch });
    edit.changeMany(changes);
  };

  const captures = (picked.length ? picked : shown).filter((i) => i.type === "capture" && !i.deleted_at);

  const layoutProps = draft && {
    groups, config: { ...draft.config, group_by: groupBy }, ctx, kids,
    onOpen: drawer.open,
    onChange: edit.change,
    onAdd,
    onMove,
    selected,
    onSelect,
    onSelectAll: (ids: string[], on: boolean) => setSelected(on ? new Set(ids) : new Set()),
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-xl font-bold text-foreground">Tasks</h1>
      </div>

      <ViewTabs
        views={views ?? []} active={activeId} dirty={dirty} extra={EXTRA}
        onSelect={select}
        onAdd={async () => {
          const v = await add({ name: `View ${(views?.length ?? 0) + 1}`, layout: "table", config: normalizeConfig({ filter: "is:open", fields: ["status", "priority", "when", "parent"] }) });
          if (v) select(v.id);
        }}
        onRename={(id, name) => save(id, { name })}
        onDuplicate={async (id) => {
          const v = views?.find((x) => x.id === id);
          const d = drafts[id] ?? (v && { layout: v.layout, config: v.config });
          const copy = v && d && await add({ name: `${v.name} copy`, layout: d.layout, config: d.config });
          if (copy) select(copy.id);
        }}
        onDelete={async (id) => {
          await remove(id);
          setDrafts(({ [id]: _, ...rest }) => rest);
          const next = views?.find((v) => v.id !== id);
          if (next) select(next.id);
        }}
      />

      {extra?.id === "note-todos" && <div className="pt-4"><NoteTodos embedded /></div>}
      {extra?.id === "note-ideas" && <div className="pt-4"><Ideas embedded /></div>}

      {view && draft && layoutProps && (
        <>
          <ViewToolbar
            layout={draft.layout} config={draft.config} ctx={ctx} count={count} dirty={dirty.has(view.id)} fieldActions={custom}
            extra={<AiSort captures={captures} ctx={ctx} onApply={async (changes) => { const ok = await edit.changeMany(changes); if (ok) setSelected(new Set()); return ok; }} />}
            onLayout={(layout) => edit_({ layout })}
            onConfig={(c) => { if ("slice_by" in c) setSlice(null); edit_({ config: { ...draft.config, ...c } }); }}
            onSave={async () => {
              await save(view.id, { layout: draft.layout, config: draft.config });
              setDrafts(({ [view.id]: _, ...rest }) => rest);
            }}
            onDiscard={() => setDrafts(({ [view.id]: _, ...rest }) => rest)}
          />
          <div className="flex flex-col gap-3 md:flex-row">
            {config?.slice_by && slices && (
              <SlicePanel by={config.slice_by} groups={slices} total={filtered.length} active={slice} ctx={ctx} onPick={setSlice} />
            )}
            <div className="min-w-0 flex-1">
              {draft.layout === "table" && <TableLayout {...layoutProps} />}
              {draft.layout === "board" && <BoardLayout {...layoutProps} />}
              {draft.layout === "timeline" && <TimelineLayout {...layoutProps} />}
            </div>
          </div>
          {draft.layout === "table" && (
            <BulkBar
              items={picked} ctx={ctx}
              onChange={(patch) => edit.changeMany(picked.map((item) => ({ item, patch })))}
              onTrash={async () => { if (await edit.changeMany(picked.map((item) => ({ item, patch: { deleted_at: new Date().toISOString() } })))) setSelected(new Set()); }}
              onClear={() => setSelected(new Set())}
            />
          )}
        </>
      )}
    </div>
  );
}

// Two group patches together (the group's value and the slice's); custom-field keys are joined, not replaced.
function merge(a: ItemPatch, b: ItemPatch): ItemPatch {
  const props = a.props || b.props ? { ...(a.props as object ?? {}), ...(b.props as object ?? {}) } : undefined;
  return { ...a, ...b, ...(props && { props }) };
}
