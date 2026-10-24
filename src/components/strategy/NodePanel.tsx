// Side panel of the Strategy page: one node — its progress, done / due / weight / "at least N", what is inside it,
// and the daily tasks that serve it. Few words; the rest is in tooltips.
import { useEffect, useRef, useState } from "react";
import {
  Ban, CalendarDays, CheckCircle2, ChevronRight, Circle, FileText, Globe, Hash, ListTodo, Moon, Palette, Plus, Scale,
  Sparkles, Sun, Trash2, X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppState } from "@/context/AppContext";
import { useStrategyActions } from "@/hooks/useStrategy";
import { CHILD_KIND, daysLeft, percent, type NodeKind, type TreeNode } from "@/lib/strategy";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<NodeKind, typeof Sun> = { area: Sparkles, goal: Sun, mission: Globe, step: Moon };
const KIND_NAME: Record<NodeKind, string> = { area: "Area", goal: "Goal", mission: "Mission", step: "Step" };

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

// A number that saves on Enter / leaving the field.
function NumberField({ value, onSave, min, max, placeholder, className }: {
  value: number | null; onSave: (v: number | null) => void; min: number; max: number; placeholder?: string; className?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const n = text.trim() === "" ? null : Number(text);
    if (n !== null && (!Number.isFinite(n) || n < min || n > max)) return setText(value === null ? "" : String(value));
    if (n !== value) onSave(n);
  };
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn("w-12 rounded bg-white/5 px-1.5 py-0.5 text-xs tabular-nums text-white outline-none focus:bg-white/10", className)}
    />
  );
}

const iconButton = "rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white";

export default function NodePanel({ tree, onSelect, onOpenTask, onClose }: {
  tree: TreeNode;
  onSelect: (id: string | null) => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  const { create, update, remove } = useStrategyActions();
  const { addTask, updateTask } = useAppState();
  const node = tree.node;
  const kind = tree.kind;
  const childKind = CHILD_KIND[kind];
  const Icon = KIND_ICON[kind];
  const ChildIcon = KIND_ICON[childKind];

  const [title, setTitle] = useState(node.title);
  const [desc, setDesc] = useState(node.description);
  const [showDesc, setShowDesc] = useState(!!node.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newChild, setNewChild] = useState("");
  const [newTask, setNewTask] = useState("");
  const [editValue, setEditValue] = useState(false);
  const colorTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setTitle(node.title);
    setDesc(node.description);
    setShowDesc(!!node.description);
    setConfirmDelete(false);
    setEditValue(false);
  }, [node.id, node.title, node.description]);

  const chain: TreeNode[] = [];
  for (let p = tree.parent; p; p = p.parent) chain.unshift(p);
  // Value set by hand only where nothing below decides it.
  const manual = tree.children.length === 0 && tree.tasks.length === 0 && !node.target_count;
  const dropped = node.status === "dropped";
  const days = tree.done ? null : daysLeft(node.due_date);

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== node.title) update(node.id, { title: t });
    else setTitle(node.title);
  };
  const addChild = async () => {
    const t = newChild.trim();
    if (!t) return;
    setNewChild("");
    await create({ parent_id: node.id, kind: childKind, title: t });
  };
  const addLinkedTask = async () => {
    const t = newTask.trim();
    if (!t) return;
    setNewTask("");
    await addTask({
      title: t, description: "", estimatedTime: null, status: "idle", startTime: null, endTime: null,
      date: "", deadline: "", position: 0, link: "", priority: "medium", nodeId: node.id,
    });
  };
  const toggleTask = (id: string, done: boolean) =>
    updateTask(id, done ? { status: "idle", endTime: null } : { status: "complete", endTime: Date.now() });
  const del = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    onSelect(tree.parent?.node.id ?? null);
    remove(node.id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#090c16]/80 text-white shadow-2xl backdrop-blur-xl">
      {/* Where it sits */}
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px] text-white/40">
          {chain.map((p) => (
            <span key={p.node.id} className="flex items-center gap-1">
              <button onClick={() => onSelect(p.node.id)} className="max-w-[9rem] truncate hover:text-white">{p.node.title}</button>
              <ChevronRight className="h-3 w-3" />
            </span>
          ))}
        </div>
        <Tip label="Close">
          <button onClick={onClose} className={iconButton}><X className="h-4 w-4" /></button>
        </Tip>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 chat-scroll">
        {/* Title */}
        <div className="flex items-center gap-2">
          <Tip label={KIND_NAME[kind]}>
            <Icon className="h-4 w-4 shrink-0" style={{ color: tree.color }} />
          </Tip>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={cn("min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none", dropped && "text-white/40 line-through")}
          />
        </div>

        {/* How far */}
        <div className="flex items-end justify-between">
          {manual && editValue ? (
            <NumberField
              value={node.progress === null ? null : Math.round(Number(node.progress) * 100)}
              min={0}
              max={100}
              onSave={(v) => { update(node.id, { progress: v === null ? null : v / 100 }); setEditValue(false); }}
              className="w-24 text-3xl"
            />
          ) : (
            <Tip label={manual ? "Click to set" : "Progress"}>
              <button
                onClick={() => manual && setEditValue(true)}
                className={cn("text-5xl font-extralight tabular-nums leading-none", !manual && "cursor-default")}
                style={{ color: dropped ? "rgba(255,255,255,.3)" : tree.color }}
              >
                {Math.round(tree.value * 100)}
                <span className="text-2xl">%</span>
              </button>
            </Tip>
          )}
          {node.due_date && (
            <span className={cn("text-xs tabular-nums", days !== null && days < 0 ? "text-red-400" : days !== null && days <= 7 ? "text-amber-300" : "text-white/45")}>
              {days === null ? node.due_date : days === 0 ? "today" : days > 0 ? `${days}d` : `${-days}d late`}
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-1">
          {kind !== "area" && (
            <Tip label={node.status === "done" ? "Reopen" : "Done"}>
              <button onClick={() => update(node.id, { status: node.status === "done" ? "open" : "done" })} className={iconButton}>
                {node.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Circle className="h-4 w-4" />}
              </button>
            </Tip>
          )}
          <Tip label="Due">
            <label className={cn(iconButton, "relative flex cursor-pointer items-center gap-1")}>
              <CalendarDays className="h-4 w-4" />
              <input
                type="date"
                value={node.due_date ?? ""}
                onChange={(e) => update(node.id, { due_date: e.target.value || null })}
                className="w-0 opacity-0 [color-scheme:dark] focus:w-28 focus:opacity-100"
              />
            </label>
          </Tip>
          {kind !== "area" && (
            <Tip label="Weight">
              <span className="flex items-center gap-1 px-1 text-white/55">
                <Scale className="h-4 w-4" />
                <NumberField value={Number(node.weight)} min={0.1} max={100} onSave={(v) => v && update(node.id, { weight: v })} />
              </span>
            </Tip>
          )}
          {kind !== "area" && (
            <Tip label="At least">
              <span className="flex items-center gap-1 px-1 text-white/55">
                <Hash className="h-4 w-4" />
                <NumberField value={node.target_count} min={1} max={100} placeholder="–" onSave={(v) => update(node.id, { target_count: v })} />
              </span>
            </Tip>
          )}
          {(kind === "area" || kind === "goal") && (
            <Tip label="Colour">
              <label className={cn(iconButton, "relative cursor-pointer")}>
                <Palette className="h-4 w-4" style={{ color: tree.color }} />
                <input
                  type="color"
                  value={tree.color || "#7c9cff"}
                  onChange={(e) => {
                    const c = e.target.value;
                    clearTimeout(colorTimer.current);
                    colorTimer.current = setTimeout(() => update(node.id, { color: c }), 400);
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </Tip>
          )}
          <Tip label="Notes">
            <button onClick={() => setShowDesc((s) => !s)} className={cn(iconButton, showDesc && "text-white")}>
              <FileText className="h-4 w-4" />
            </button>
          </Tip>
          <div className="flex-1" />
          {kind !== "area" && (
            <Tip label={dropped ? "Restore" : "Drop"}>
              <button onClick={() => update(node.id, { status: dropped ? "open" : "dropped" })} className={cn(iconButton, dropped && "text-white")}>
                <Ban className="h-4 w-4" />
              </button>
            </Tip>
          )}
          <Tip label={confirmDelete ? "Click again: delete with everything inside" : "Delete"}>
            <button onClick={del} onMouseLeave={() => setConfirmDelete(false)} className={cn(iconButton, confirmDelete && "bg-red-500/20 text-red-400")}>
              <Trash2 className="h-4 w-4" />
            </button>
          </Tip>
        </div>

        {showDesc && (
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => desc !== node.description && update(node.id, { description: desc })}
            rows={4}
            className="w-full resize-y rounded-lg bg-white/5 px-3 py-2 text-sm text-white/85 outline-none focus:bg-white/10"
          />
        )}

        {/* Inside */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-white/45">
            <ChildIcon className="h-3.5 w-3.5" />
            <span className="tabular-nums">
              {tree.children.filter((c) => c.done).length}/{Math.max(tree.children.filter((c) => c.node.status !== "dropped").length, node.target_count ?? 0)}
            </span>
          </div>
          {tree.children.map((c) => {
            const ItemIcon = c.done ? CheckCircle2 : Circle;
            return (
              <div key={c.node.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
                {c.kind === "goal" ? (
                  <Sun className="h-4 w-4 shrink-0" style={{ color: c.color }} />
                ) : (
                  <button onClick={() => update(c.node.id, { status: c.node.status === "done" ? "open" : "done" })} className="shrink-0">
                    <ItemIcon className={cn("h-4 w-4", c.done ? "text-emerald-400" : "text-white/35 hover:text-white")} />
                  </button>
                )}
                <button
                  onClick={() => onSelect(c.node.id)}
                  className={cn("min-w-0 flex-1 truncate text-left text-sm", c.node.status === "dropped" ? "text-white/30 line-through" : "text-white/85")}
                >
                  {c.node.title}
                </button>
                <span className="text-[11px] tabular-nums text-white/40">{percent(c.value)}</span>
              </div>
            );
          })}
          {tree.slots > 0 && (
            <Tip label={`At least ${node.target_count}`}>
              <div className="px-1.5 text-xs text-white/30">+{tree.slots}</div>
            </Tip>
          )}
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
            <Plus className="h-4 w-4 shrink-0 text-white/35" />
            <input
              value={newChild}
              onChange={(e) => setNewChild(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addChild()}
              placeholder={KIND_NAME[childKind]}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
          </div>
        </div>

        {/* Daily tasks that serve it */}
        {kind !== "area" && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-white/45">
              <ListTodo className="h-3.5 w-3.5" />
              <span className="tabular-nums">{tree.tasks.filter((t) => t.status === "complete").length}/{tree.tasks.length}</span>
            </div>
            {tree.tasks.map((t) => {
              const done = t.status === "complete";
              return (
                <div key={t.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5">
                  <button onClick={() => toggleTask(t.id, done)} className="shrink-0">
                    {done ? <CheckCircle2 className="h-4 w-4 text-amber-300" /> : <Circle className="h-4 w-4 text-white/35 hover:text-white" />}
                  </button>
                  <button onClick={() => onOpenTask(t.id)} className={cn("min-w-0 flex-1 truncate text-left text-sm", done ? "text-white/45 line-through" : "text-white/85")}>
                    {t.title}
                  </button>
                  {t.date && <span className="text-[11px] tabular-nums text-white/35">{t.date.slice(8, 10)}.{t.date.slice(5, 7)}</span>}
                  <Tip label="Unlink">
                    <button onClick={() => updateTask(t.id, { nodeId: null })} className="shrink-0 text-white/0 group-hover:text-white/40 hover:!text-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                </div>
              );
            })}
            <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
              <Plus className="h-4 w-4 shrink-0 text-white/35" />
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLinkedTask()}
                placeholder="Task"
                className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
