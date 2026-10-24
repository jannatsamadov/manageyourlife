// Pro theme (owner, 2026-10-24: "a Pro theme with text and simple dashboards"): the same strategy as an outline on the
// left, a few numbers and the editable details on the right. The Space theme stays wordless.
import { useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronRight, LayoutDashboard, ListTodo, TrendingUp } from "lucide-react";
import { daysLeft, percent, type TreeNode } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import NodePanel, { Bar, KIND_ICON } from "./NodePanel";

function walk(t: TreeNode, f: (n: TreeNode) => void) {
  f(t);
  t.children.forEach((c) => walk(c, f));
}

function Outline({ t, depth, selectedId, open, toggle, onSelect }: {
  t: TreeNode; depth: number; selectedId: string | null; open: Set<string>; toggle: (id: string) => void; onSelect: (id: string) => void;
}) {
  const Icon = KIND_ICON[t.kind];
  const expanded = open.has(t.node.id);
  const dropped = t.node.status === "dropped";
  return (
    <>
      <div
        className={cn("group flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm", selectedId === t.node.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button onClick={() => toggle(t.node.id)} className={cn("shrink-0 rounded p-0.5", !t.children.length && "invisible")}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: t.color }} />
        <button onClick={() => onSelect(t.node.id)} className={cn("min-w-0 flex-1 truncate text-left", dropped && "line-through opacity-60")}>
          {t.node.title}
        </button>
        <span className="text-[11px] tabular-nums opacity-70">{percent(t.value)}</span>
      </div>
      {expanded && t.children.map((c) => (
        <Outline key={c.node.id} t={c} depth={depth + 1} selectedId={selectedId} open={open} toggle={toggle} onSelect={onSelect} />
      ))}
    </>
  );
}

const dueText = (days: number) => (days === 0 ? "today" : days > 0 ? `${days}d` : `${-days}d late`);

// Nothing selected: every section with its goals, and what is due next anywhere.
function Overview({ roots, onSelect }: { roots: TreeNode[]; onSelect: (id: string | null) => void }) {
  const due: TreeNode[] = [];
  roots.forEach((r) => walk(r, (n) => {
    if (!n.done && n.node.status !== "dropped" && n.node.due_date) due.push(n);
  }));
  due.sort((a, b) => a.node.due_date!.localeCompare(b.node.due_date!));
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {roots.map((r) => (
          <div key={r.node.id} className="rounded-xl border border-border bg-card p-4">
            <button onClick={() => onSelect(r.node.id)} className="flex w-full items-center gap-2 text-left">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{r.node.title}</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: r.color }}>{percent(r.value)}</span>
            </button>
            <Bar value={r.value} color={r.color} className="mt-2" />
            <div className="mt-3 space-y-0.5">
              {r.children.map((g) => {
                const Icon = KIND_ICON[g.kind];
                return (
                  <button key={g.node.id} onClick={() => onSelect(g.node.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/50">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: g.color }} />
                    <span className={cn("min-w-0 flex-1 truncate text-sm", g.node.status === "dropped" ? "text-muted-foreground line-through" : "text-foreground")}>{g.node.title}</span>
                    <Bar value={g.node.status === "dropped" ? 0 : g.value} color={g.color} className="w-20" />
                    <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{percent(g.value)}</span>
                  </button>
                );
              })}
              {!r.children.length && <div className="px-1 text-xs text-muted-foreground/50">—</div>}
            </div>
          </div>
        ))}
      </div>
      {due.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Next due
          </div>
          {due.slice(0, 8).map((n) => {
            const d = daysLeft(n.node.due_date)!;
            let g: TreeNode | null = n;
            while (g && g.kind !== "goal") g = g.parent;
            return (
              <button key={n.node.id} onClick={() => onSelect(n.node.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/50">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {n.node.title}
                  {g && g !== n && <span className="ml-2 text-xs text-muted-foreground">{g.node.title}</span>}
                </span>
                <span className={cn("text-xs tabular-nums", d < 0 ? "text-red-500" : d <= 7 ? "text-amber-500" : "text-muted-foreground")}>{dueText(d)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, children }: { icon: typeof TrendingUp; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export default function ProView({ roots, selected, onSelect, onOpenTask }: {
  roots: TreeNode[];
  selected: TreeNode | null;
  onSelect: (id: string | null) => void;
  onOpenTask: (taskId: string) => void;
}) {
  // Areas and goals open at first; deeper levels on demand.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    roots.forEach((r) => { s.add(r.node.id); r.children.forEach((g) => s.add(g.node.id)); });
    return s;
  });
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  // Numbers for the selected node and everything inside it.
  let tasksDone = 0, tasksAll = 0, overdue = 0;
  let next: TreeNode | null = null;
  if (selected) {
    walk(selected, (n) => {
      tasksAll += n.tasks.length;
      tasksDone += n.tasks.filter((t) => t.status === "complete").length;
      if (n.done || n.node.status === "dropped" || !n.node.due_date) return;
      const d = daysLeft(n.node.due_date)!;
      if (d < 0) overdue++;
      else if (!next || n.node.due_date < next.node.due_date!) next = n;
    });
  }
  const live = selected?.children.filter((c) => c.node.status !== "dropped") ?? [];
  const nextNode = next as TreeNode | null;
  const nextDays = nextNode ? daysLeft(nextNode.node.due_date) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="h-fit rounded-xl border border-border bg-card p-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <button
          onClick={() => onSelect(null)}
          className={cn("mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm", !selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Overview
        </button>
        {roots.map((r) => (
          <Outline key={r.node.id} t={r} depth={0} selectedId={selected?.node.id ?? null} open={open} toggle={toggle} onSelect={onSelect} />
        ))}
      </div>

      {!selected && <Overview roots={roots} onSelect={onSelect} />}
      {selected && (
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat icon={TrendingUp} label="Progress">
              <div className="text-2xl font-semibold tabular-nums" style={{ color: selected.color }}>{percent(selected.value)}</div>
              <Bar value={selected.value} color={selected.color} className="mt-2" />
            </Stat>
            <Stat icon={CheckCircle2} label="Done">
              <div className="text-2xl font-semibold tabular-nums">
                {selected.children.filter((c) => c.done).length}
                <span className="text-base text-muted-foreground">/{Math.max(live.length, selected.node.target_count ?? 0)}</span>
              </div>
            </Stat>
            <Stat icon={ListTodo} label="Tasks">
              <div className="text-2xl font-semibold tabular-nums">
                {tasksDone}
                <span className="text-base text-muted-foreground">/{tasksAll}</span>
              </div>
            </Stat>
            <Stat icon={CalendarClock} label="Next due">
              {nextNode ? (
                <button onClick={() => onSelect(nextNode.node.id)} className="w-full text-left">
                  <div className={cn("text-2xl font-semibold tabular-nums", nextDays !== null && nextDays <= 7 && "text-amber-500")}>
                    {nextDays === 0 ? "today" : `${nextDays}d`}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{nextNode.node.title}</div>
                </button>
              ) : (
                <div className="text-2xl font-semibold text-muted-foreground">—</div>
              )}
              {overdue > 0 && <div className="text-xs text-red-500">{overdue} late</div>}
            </Stat>
          </div>
          <NodePanel tree={selected} onSelect={onSelect} onOpenTask={onOpenTask} />
        </div>
      )}
    </div>
  );
}
