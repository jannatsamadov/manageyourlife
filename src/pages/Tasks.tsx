// Tasks (P-69, P-70 phase 3, T-114): every item of the workspace through saved views — tasks, ideas, the Inbox,
// money, the strategy — as a table, a board or a timeline, with filter / sort / group by (GitHub Projects style).
// The views exist to feed the app's question "what is best to do now?" (P-65): the default view groups the open
// tasks by when they need attention. Until phase 4 the to-dos and ideas written in notes are two extra tabs.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Lightbulb, ListChecks, Loader2 } from "lucide-react";
import { useItems } from "@/core/items";
import { useItemEdit } from "@/core/edit";
import { ITEM_TYPES, type ItemType } from "@/core/types";
import { useItemDrawer } from "@/features/items/ItemDrawer";
import { type Layout, makeCtx, patchForGroup, runView, type ViewConfig } from "@/views/query";
import { normalizeConfig, useViews, type View, type ViewSeed } from "@/views/useViews";
import { type ExtraTab, ViewTabs, ViewToolbar } from "@/views/ViewBar";
import { kidsOf } from "@/views/layouts/common";
import { TableLayout } from "@/views/layouts/TableLayout";
import { BoardLayout } from "@/views/layouts/BoardLayout";
import { TimelineLayout } from "@/views/layouts/TimelineLayout";
import NoteTodos from "./NoteTodos";
import Ideas from "./Ideas";

const SEEDS: ViewSeed[] = [
  { name: "Tasks", layout: "table", config: { filter: "type:task is:open", group_by: "when", sort: [{ field: "priority" }], fields: ["priority", "when", "estimate_min", "parent"], new_type: "task" } },
  { name: "Board", layout: "board", config: { filter: "type:task,idea,capture -status:dropped", group_by: null, board_by: "status", sort: [{ field: "priority" }], fields: ["priority", "when", "parent"], new_type: "task" } },
  { name: "Inbox", layout: "table", config: { filter: "type:capture,idea is:open no:parent", group_by: "type", sort: [{ field: "created_at", desc: true }], fields: ["type", "created_at"], new_type: "capture" } },
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
  const edit = useItemEdit();
  const drawer = useItemDrawer();
  const [params, setParams] = useSearchParams();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const asked = params.get("view") ?? remember.get("tasks.view");
  const extra = EXTRA.find((x) => x.id === asked);
  const view = extra ? undefined : views?.find((v) => v.id === asked) ?? views?.[0];
  const activeId = extra?.id ?? view?.id ?? null;
  useEffect(() => { if (activeId) remember.set("tasks.view", activeId); }, [activeId]);

  const select = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("view", id); return n; });
  const draft: Draft | null = useMemo(() => (view ? drafts[view.id] ?? { layout: view.layout, config: view.config } : null), [view, drafts]);
  const dirty = new Set(Object.entries(drafts).filter(([id, d]) => { const v = views?.find((x) => x.id === id); return v && !same(d, v); }).map(([id]) => id));
  const edit_ = (change: Partial<Draft>) => view && draft && setDrafts((d) => ({ ...d, [view.id]: { ...draft, ...change } }));

  const all = useMemo(() => items.data ?? [], [items.data]);
  const ctx = useMemo(() => makeCtx(all), [all]);
  const kids = useMemo(() => kidsOf(all), [all]);
  const groupBy = draft ? (draft.layout === "board" ? draft.config.board_by ?? "status" : draft.config.group_by) : null;
  const groups = useMemo(() => (draft ? runView(all, draft.config, ctx, groupBy) : []), [all, draft, ctx, groupBy]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  if (items.isLoading || isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const onAdd = (title: string, groupKey: string) => {
    if (!draft) return;
    const patch = patchForGroup(groupBy, groupKey, ctx);
    const type = newType(draft.config, patch.type);
    const position = Math.max(0, ...all.filter((i) => i.type === type).map((i) => i.position)) + 1;
    edit.create({ ...patch, type, title, position } as Parameters<typeof edit.create>[0]);
  };

  const layoutProps = draft && {
    groups, config: { ...draft.config, group_by: groupBy }, ctx, kids,
    onOpen: drawer.open,
    onChange: edit.change,
    onAdd,
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
            layout={draft.layout} config={draft.config} count={count} dirty={dirty.has(view.id)}
            onLayout={(layout) => edit_({ layout })}
            onConfig={(c) => edit_({ config: { ...draft.config, ...c } })}
            onSave={async () => {
              await save(view.id, { layout: draft.layout, config: draft.config });
              setDrafts(({ [view.id]: _, ...rest }) => rest);
            }}
            onDiscard={() => setDrafts(({ [view.id]: _, ...rest }) => rest)}
          />
          {draft.layout === "table" && <TableLayout {...layoutProps} />}
          {draft.layout === "board" && <BoardLayout {...layoutProps} />}
          {draft.layout === "timeline" && <TimelineLayout {...layoutProps} />}
        </>
      )}
    </div>
  );
}
