// Strategy (P-2, P-24, P-25): areas of life side by side, one goal's system on screen, details in the side panel.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Orbit, PanelRightOpen, Plus, Sun } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppState } from "@/context/AppContext";
import { useStrategyActions, useStrategyNodes } from "@/hooks/useStrategy";
import { AREA_COLORS, buildForest, percent, type TreeNode } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import SolarSystem from "@/components/strategy/solar/SolarSystem";
import NodePanel from "@/components/strategy/NodePanel";
import TaskEditPopup from "@/components/TaskEditPopup";

// Remembered per browser: which area / goal was open.
const remember = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

function Chip({ active, color, title, value, icon, onClick }: {
  active: boolean; color: string; title: string; value: number; icon?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs backdrop-blur-md transition-colors",
        active ? "border-white/25 bg-white/15 text-white" : "border-white/10 bg-black/40 text-white/60 hover:text-white",
      )}
    >
      {icon ? <Sun className="h-3 w-3" style={{ color }} /> : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      <span className="max-w-[10rem] truncate">{title}</span>
      <span className="tabular-nums text-white/40">{percent(value)}</span>
    </button>
  );
}

function AddChip({ label, onAdd, big }: { label: string; onAdd: (title: string) => void; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const done = () => {
    const t = text.trim();
    if (t) onAdd(t);
    setText("");
    setOpen(false);
  };
  if (open) {
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") { setText(""); setOpen(false); }
        }}
        placeholder={label}
        className={cn(
          "rounded-full border border-white/20 bg-black/60 px-3 py-1 text-white outline-none backdrop-blur-md placeholder:text-white/30",
          big ? "w-56 text-sm" : "w-36 text-xs",
        )}
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "flex items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/50 backdrop-blur-md hover:text-white",
            big ? "h-12 w-12" : "h-6 w-6",
          )}
        >
          <Plus className={big ? "h-5 w-5" : "h-3.5 w-3.5"} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Strategy() {
  const { tasks } = useAppState();
  const { data: nodes, isLoading, error } = useStrategyNodes();
  const { create } = useStrategyActions();
  const { roots, byId } = useMemo(() => buildForest(nodes ?? [], tasks), [nodes, tasks]);
  const areas = roots.filter((r) => r.kind === "area");
  const looseGoals = roots.filter((r) => r.kind === "goal");

  const [areaId, setAreaId] = useState<string | null>(() => remember.get("strategy.area", null));
  const [goalOf, setGoalOf] = useState<Record<string, string>>(() => remember.get("strategy.goals", {}));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  useEffect(() => remember.set("strategy.area", areaId), [areaId]);
  useEffect(() => remember.set("strategy.goals", goalOf), [goalOf]);

  const area: TreeNode | null = (areaId ? byId.get(areaId) : undefined)?.kind === "area" ? byId.get(areaId!)! : areas[0] ?? null;
  const goals = area ? area.children : looseGoals;
  const areaKey = area?.node.id ?? "_";
  const goal = goals.find((g) => g.node.id === goalOf[areaKey]) ?? goals.find((g) => g.node.status !== "dropped") ?? goals[0] ?? null;
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const shown = selected ?? goal ?? area;

  const select = useCallback((id: string | null) => {
    if (!id) return setSelectedId(null);
    const t = byId.get(id);
    if (!t) return;
    setPanelOpen(true);
    if (t.kind === "area") {
      setAreaId(id);
      setSelectedId(null);
      return;
    }
    // Bring the node's goal on screen first.
    let g: TreeNode | null = t;
    while (g && g.kind !== "goal") g = g.parent;
    if (g && g.node.id !== goal?.node.id) {
      if (g.parent) setAreaId(g.parent.node.id);
      setGoalOf((m) => ({ ...m, [g!.parent?.node.id ?? "_"]: g!.node.id }));
      setSelectedId(t.kind === "goal" ? null : id);
      return;
    }
    setSelectedId(id);
  }, [byId, goal?.node.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement) && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closePanel = () => (selectedId ? setSelectedId(null) : setPanelOpen(false));
  const openTask = taskId ? tasks.find((t) => t.id === taskId) : undefined;

  return (
    <div className="relative -m-4 h-[100dvh] overflow-hidden bg-[#020309] lg:-m-8">
      {isLoading ? (
        <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>
      ) : error ? (
        <div className="flex h-full items-center justify-center text-sm text-red-400">{(error as Error).message}</div>
      ) : goal ? (
        <SolarSystem goal={goal} area={area} selectedId={selectedId} onSelect={select} onTask={setTaskId} />
      ) : (
        // Nothing to draw yet: an empty sky with one "+".
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgba(124,156,255,0.08),transparent_60%)]">
          <Orbit className="h-10 w-10 text-white/20" />
          {area ? (
            <AddChip big label="Goal" onAdd={(t) => create({ kind: "goal", parent_id: area.node.id, title: t })} />
          ) : (
            <AddChip big label="Area" onAdd={(t) => create({ kind: "area", title: t, color: AREA_COLORS[0] })} />
          )}
        </div>
      )}

      {/* Areas, then the goals of the open area */}
      {!isLoading && (areas.length > 0 || looseGoals.length > 0) && (
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {areas.map((a) => (
              <Chip key={a.node.id} active={a.node.id === area?.node.id} color={a.color} title={a.node.title} value={a.value} onClick={() => select(a.node.id)} />
            ))}
            <AddChip label="Area" onAdd={(t) => create({ kind: "area", title: t, color: AREA_COLORS[areas.length % AREA_COLORS.length] })} />
          </div>
          {area && goals.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {goals.map((g) => (
                <Chip key={g.node.id} icon active={g.node.id === goal?.node.id} color={g.color} title={g.node.title} value={g.value} onClick={() => select(g.node.id)} />
              ))}
              <AddChip label="Goal" onAdd={(t) => create({ kind: "goal", parent_id: area.node.id, title: t })} />
            </div>
          )}
        </div>
      )}

      {shown && (panelOpen ? (
        <div className="absolute bottom-20 right-3 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))]">
          <NodePanel tree={shown} onSelect={select} onOpenTask={setTaskId} onClose={closePanel} />
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => setPanelOpen(true)} className="absolute right-3 top-3 z-20 rounded-full border border-white/10 bg-black/40 p-2 text-white/60 backdrop-blur-md hover:text-white">
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Details</TooltipContent>
        </Tooltip>
      ))}

      {openTask && <TaskEditPopup task={openTask} onClose={() => setTaskId(null)} />}
    </div>
  );
}
