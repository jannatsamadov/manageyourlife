// Pro theme detail: one node — progress, done / due / weight / "at least N", what is inside it, and the daily tasks
// that serve it. Few words; the rest is in tooltips.
import { useEffect, useRef, useState } from "react";
import {
  Ban, CalendarDays, CalendarRange, CheckCircle2, ChevronRight, Circle, FileText, Globe, Hash, ListTodo, Moon, Palette, Plus, Scale,
  Sparkles, Sun, Trash2, X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppState } from "@/context/AppContext";
import { useStrategyActions } from "@/hooks/useStrategy";
import { CHILD_KIND, daysLeft, percent, type NodeKind, type TreeNode } from "@/lib/strategy";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<NodeKind, typeof Sun> = { area: Sparkles, goal: Sun, mission: Globe, step: Moon };
const KIND_NAME: Record<NodeKind, string> = { area: "Area", goal: "Goal", mission: "Mission", step: "Step" };

export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </div>
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
      className={cn("w-12 rounded bg-muted/50 px-1.5 py-0.5 text-xs tabular-nums text-foreground outline-none focus:bg-muted", className)}
    />
  );
}

const iconButton = "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export default function NodePanel({ tree, onSelect, onOpenTask, onClose }: {
  tree: TreeNode;
  onSelect: (id: string | null) => void;
  onOpenTask: (taskId: string) => void;
  onClose?: () => void;
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
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {/* Where it sits */}
      {(chain.length > 0 || onClose) && (
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {chain.map((p) => (
              <span key={p.node.id} className="flex items-center gap-1">
                <button onClick={() => onSelect(p.node.id)} className="max-w-[12rem] truncate hover:text-foreground">{p.node.title}</button>
                <ChevronRight className="h-3 w-3" />
              </span>
            ))}
          </div>
          {onClose && (
            <Tip label="Close">
              <button onClick={onClose} className={iconButton}><X className="h-4 w-4" /></button>
            </Tip>
          )}
        </div>
      )}

      {/* Title + how far */}
      <div className="flex items-center gap-2">
        <Tip label={KIND_NAME[kind]}>
          <Icon className="h-4 w-4 shrink-0" style={{ color: tree.color }} />
        </Tip>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={cn("min-w-0 flex-1 bg-transparent text-lg font-semibold text-foreground outline-none", dropped && "text-muted-foreground line-through")}
        />
        {manual && editValue ? (
          <NumberField
            value={node.progress === null ? null : Math.round(Number(node.progress) * 100)}
            min={0}
            max={100}
            onSave={(v) => { update(node.id, { progress: v === null ? null : v / 100 }); setEditValue(false); }}
            className="w-16 text-base"
          />
        ) : (
          <Tip label={manual ? "Click to set" : "Progress"}>
            <button onClick={() => manual && setEditValue(true)} className={cn("text-lg font-semibold tabular-nums", !manual && "cursor-default")} style={{ color: tree.color }}>
              {percent(tree.value)}
            </button>
          </Tip>
        )}
      </div>
      <Bar value={dropped ? 0 : tree.value} color={tree.color} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1">
        {kind !== "area" && (
          <Tip label={node.status === "done" ? "Reopen" : "Done"}>
            <button onClick={() => update(node.id, { status: node.status === "done" ? "open" : "done" })} className={iconButton}>
              {node.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4" />}
            </button>
          </Tip>
        )}
        {kind !== "area" && (
          <Tip label="Start">
            <label className={cn(iconButton, "relative flex cursor-pointer items-center gap-1")}>
              <CalendarRange className="h-4 w-4" />
              {node.start_date && (
                <span className="text-xs tabular-nums">{node.start_date.slice(8, 10)}.{node.start_date.slice(5, 7)}</span>
              )}
              <input
                type="date"
                value={node.start_date ?? ""}
                max={node.due_date ?? undefined}
                onChange={(e) => update(node.id, { start_date: e.target.value || null })}
                className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
              />
            </label>
          </Tip>
        )}
        <Tip label="Due">
          <label className={cn(iconButton, "relative flex cursor-pointer items-center gap-1")}>
            <CalendarDays className="h-4 w-4" />
            {node.due_date && (
              <span className={cn("text-xs tabular-nums", days !== null && days < 0 ? "text-red-500" : days !== null && days <= 7 ? "text-amber-500" : "")}>
                {node.due_date.slice(8, 10)}.{node.due_date.slice(5, 7)}
              </span>
            )}
            <input
              type="date"
              value={node.due_date ?? ""}
              min={node.start_date ?? undefined}
              onChange={(e) => update(node.id, { due_date: e.target.value || null })}
              className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
            />
          </label>
        </Tip>
        {kind !== "area" && (
          <Tip label="Weight">
            <span className="flex items-center gap-1 px-1 text-muted-foreground">
              <Scale className="h-4 w-4" />
              <NumberField value={Number(node.weight)} min={0.1} max={100} onSave={(v) => v && update(node.id, { weight: v })} />
            </span>
          </Tip>
        )}
        {kind !== "area" && (
          <Tip label="At least">
            <span className="flex items-center gap-1 px-1 text-muted-foreground">
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
          <button onClick={() => setShowDesc((s) => !s)} className={cn(iconButton, showDesc && "text-foreground")}>
            <FileText className="h-4 w-4" />
          </button>
        </Tip>
        <div className="flex-1" />
        {kind !== "area" && (
          <Tip label={dropped ? "Restore" : "Drop"}>
            <button onClick={() => update(node.id, { status: dropped ? "open" : "dropped" })} className={cn(iconButton, dropped && "text-foreground")}>
              <Ban className="h-4 w-4" />
            </button>
          </Tip>
        )}
        <Tip label={confirmDelete ? "Click again: delete with everything inside" : "Delete"}>
          <button onClick={del} onMouseLeave={() => setConfirmDelete(false)} className={cn(iconButton, confirmDelete && "bg-red-500/15 text-red-500")}>
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
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
      )}

      {/* Inside */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <ChildIcon className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            {tree.children.filter((c) => c.done).length}/{Math.max(tree.children.filter((c) => c.node.status !== "dropped").length, node.target_count ?? 0)}
          </span>
        </div>
        {tree.children.map((c) => {
          const ItemIcon = c.done ? CheckCircle2 : Circle;
          const cDays = c.done ? null : daysLeft(c.node.due_date);
          return (
            <div key={c.node.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-muted/50">
              {c.kind === "goal" ? (
                <Sun className="h-4 w-4 shrink-0" style={{ color: c.color }} />
              ) : (
                <button onClick={() => update(c.node.id, { status: c.node.status === "done" ? "open" : "done" })} className="shrink-0">
                  <ItemIcon className={cn("h-4 w-4", c.done ? "text-emerald-500" : "text-muted-foreground hover:text-foreground")} />
                </button>
              )}
              <button onClick={() => onSelect(c.node.id)} className="min-w-0 flex-1 text-left">
                <span className={cn("block truncate text-sm", c.node.status === "dropped" ? "text-muted-foreground line-through" : "text-foreground")}>{c.node.title}</span>
                <Bar value={c.node.status === "dropped" ? 0 : c.value} color={c.color} className="mt-1 h-0.5" />
              </button>
              {cDays !== null && cDays <= 7 && (
                <span className={cn("text-[11px] tabular-nums", cDays < 0 ? "text-red-500" : "text-amber-500")}>
                  {c.node.due_date!.slice(8, 10)}.{c.node.due_date!.slice(5, 7)}
                </span>
              )}
              <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{percent(c.value)}</span>
            </div>
          );
        })}
        {tree.slots > 0 && (
          <Tip label={`At least ${node.target_count}`}>
            <div className="px-1.5 text-xs text-muted-foreground/60">+{tree.slots}</div>
          </Tip>
        )}
        <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <input
            value={newChild}
            onChange={(e) => setNewChild(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChild()}
            placeholder={KIND_NAME[childKind]}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* Daily tasks that serve it */}
      {kind !== "area" && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
            <ListTodo className="h-3.5 w-3.5" />
            <span className="tabular-nums">{tree.tasks.filter((t) => t.status === "complete").length}/{tree.tasks.length}</span>
          </div>
          {tree.tasks.map((t) => {
            const done = t.status === "complete";
            return (
              <div key={t.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/50">
                <button onClick={() => toggleTask(t.id, done)} className="shrink-0">
                  {done ? <CheckCircle2 className="h-4 w-4 text-amber-500" /> : <Circle className="h-4 w-4 text-muted-foreground hover:text-foreground" />}
                </button>
                <button onClick={() => onOpenTask(t.id)} className={cn("min-w-0 flex-1 truncate text-left text-sm", done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {t.title}
                </button>
                {t.date && <span className="text-[11px] tabular-nums text-muted-foreground">{t.date.slice(8, 10)}.{t.date.slice(5, 7)}</span>}
                <Tip label="Unlink">
                  <button onClick={() => updateTask(t.id, { nodeId: null })} className="shrink-0 text-transparent group-hover:text-muted-foreground hover:!text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Tip>
              </div>
            );
          })}
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLinkedTask()}
              placeholder="Task"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}
