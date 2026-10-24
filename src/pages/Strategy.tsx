// Strategy (P-2, P-24, P-25). Two themes on the same data:
//  - Space: wordless — a galaxy of areas, one goal's solar system; light shows progress
//  - Pro: text and simple dashboards — outline, numbers, editing
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Loader2, Orbit, PanelRight, Plus, Sparkles, Sun } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppState } from "@/context/AppContext";
import { useStrategyActions, useStrategyNodes } from "@/hooks/useStrategy";
import { AREA_COLORS, buildForest, type TreeNode } from "@/lib/strategy";
import { cn } from "@/lib/utils";
import SolarSystem from "@/components/strategy/solar/SolarSystem";
import Galaxy from "@/components/strategy/galaxy/Galaxy";
import ProView from "@/components/strategy/ProView";
import TaskEditPopup from "@/components/TaskEditPopup";

type Theme = "space" | "pro";

// Remembered per browser: theme, which area / goal was open.
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

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeSwitch({ theme, onChange, dark }: { theme: Theme; onChange: (t: Theme) => void; dark: boolean }) {
  const options: [Theme, typeof Orbit, string][] = [["space", Orbit, "Space"], ["pro", LayoutDashboard, "Pro"]];
  return (
    <div className={cn("flex rounded-full border p-0.5", dark ? "border-white/10 bg-black/40 backdrop-blur-md" : "border-border bg-card")}>
      {options.map(([id, Icon, label]) => (
        <Tip key={id} label={label}>
          <button
            onClick={() => onChange(id)}
            className={cn(
              "rounded-full p-1.5 transition-colors",
              theme === id ? (dark ? "bg-white/15 text-white" : "bg-primary/10 text-primary") : dark ? "text-white/50 hover:text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        </Tip>
      ))}
    </div>
  );
}

// Space chips: a dot (or a sun) and the name — no numbers, the scene shows how far things are.
function Chip({ active, color, title, icon, onClick }: { active: boolean; color: string; title: string; icon?: boolean; onClick: () => void }) {
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
    </button>
  );
}

function AddChip({ label, onAdd, big, dark = true }: { label: string; onAdd: (title: string) => void; big?: boolean; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const done = () => {
    const t = text.trim();
    if (t) onAdd(t);
    setText("");
    setOpen(false);
  };
  const look = dark ? "border-white/10 bg-black/40 text-white/50 backdrop-blur-md hover:text-white" : "border-border bg-card text-muted-foreground hover:text-foreground";
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
          "rounded-full border px-3 py-1 outline-none",
          dark ? "border-white/20 bg-black/60 text-white backdrop-blur-md placeholder:text-white/30" : "border-border bg-card text-foreground placeholder:text-muted-foreground/60",
          big ? "w-56 text-sm" : "w-36 text-xs",
        )}
      />
    );
  }
  return (
    <Tip label={label}>
      <button onClick={() => setOpen(true)} className={cn("flex items-center justify-center rounded-full border", look, big ? "h-12 w-12" : "h-6 w-6")}>
        <Plus className={big ? "h-5 w-5" : "h-3.5 w-3.5"} />
      </button>
    </Tip>
  );
}

export default function Strategy() {
  const { tasks } = useAppState();
  const { data: nodes, isLoading, error } = useStrategyNodes();
  const { create } = useStrategyActions();
  const { roots, byId } = useMemo(() => buildForest(nodes ?? [], tasks), [nodes, tasks]);
  const areas = roots.filter((r) => r.kind === "area");
  const looseGoals = roots.filter((r) => r.kind === "goal");

  const [theme, setTheme] = useState<Theme>(() => remember.get("strategy.theme", "space"));
  const [areaId, setAreaId] = useState<string | null>(() => remember.get("strategy.area", null));
  const [goalOf, setGoalOf] = useState<Record<string, string>>(() => remember.get("strategy.goals", {}));
  const [galaxy, setGalaxy] = useState<boolean>(() => remember.get("strategy.galaxy", true));
  const [focusArea, setFocusArea] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  useEffect(() => remember.set("strategy.theme", theme), [theme]);
  useEffect(() => remember.set("strategy.area", areaId), [areaId]);
  useEffect(() => remember.set("strategy.goals", goalOf), [goalOf]);
  useEffect(() => remember.set("strategy.galaxy", galaxy), [galaxy]);

  const area: TreeNode | null = (areaId ? byId.get(areaId) : undefined)?.kind === "area" ? byId.get(areaId!)! : areas[0] ?? null;
  const goals = area ? area.children : looseGoals;
  const areaKey = area?.node.id ?? "_";
  const goal = goals.find((g) => g.node.id === goalOf[areaKey]) ?? goals.find((g) => g.node.status !== "dropped") ?? goals[0] ?? null;
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const inGalaxy = galaxy && (areas.length > 0 || looseGoals.length > 0);
  // Pro shows the selected node, else what Space has open.
  const proShown = selected ?? (inGalaxy && focusArea ? byId.get(focusArea) ?? null : null) ?? goal ?? area ?? roots[0] ?? null;

  // Keep Space in step with a choice: its area / goal becomes the open one.
  const openGoalOf = useCallback((t: TreeNode) => {
    let g: TreeNode | null = t;
    while (g && g.kind !== "goal") g = g.parent;
    if (!g) return null;
    if (g.parent) setAreaId(g.parent.node.id);
    setGoalOf((m) => ({ ...m, [g!.parent?.node.id ?? "_"]: g!.node.id }));
    return g;
  }, []);

  const select = useCallback((id: string | null) => {
    if (!id) return setSelectedId(null);
    const t = byId.get(id);
    if (!t) return;
    if (theme === "pro") {
      if (t.kind === "area") setAreaId(id);
      else openGoalOf(t);
      setSelectedId(id);
      return;
    }
    if (t.kind === "area") {
      setAreaId(id);
      setSelectedId(null);
      if (galaxy) setFocusArea(id);
      return;
    }
    const g = openGoalOf(t);
    if (galaxy) {
      setGalaxy(false);
      setFocusArea(null);
      setSelectedId(t.kind === "goal" ? null : id);
      return;
    }
    // Another goal: show its system first; a body of the open system: fly to it.
    setSelectedId(g && g.node.id !== goal?.node.id && t.kind === "goal" ? null : id);
  }, [byId, theme, galaxy, goal?.node.id, openGoalOf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      setSelectedId(null);
      setFocusArea(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switchTheme = (t: Theme) => {
    if (t === "pro" && !selectedId && inGalaxy && focusArea) setSelectedId(focusArea);
    if (t === "space") setSelectedId(null);
    setTheme(t);
  };
  const toggleGalaxy = () => {
    setSelectedId(null);
    setFocusArea(galaxy ? null : area?.node.id ?? null);
    setGalaxy(!galaxy);
  };
  const openTask = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const taskPopup = openTask && <TaskEditPopup task={openTask} onClose={() => setTaskId(null)} />;
  const addArea = (t: string) => create({ kind: "area", title: t, color: AREA_COLORS[areas.length % AREA_COLORS.length] });

  if (isLoading) return <div className="flex h-[70vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="flex h-[70vh] items-center justify-center text-sm text-red-500">{(error as Error).message}</div>;

  // ── Pro: outline + numbers + editing ──
  if (theme === "pro") {
    return (
      <div className="mx-auto max-w-6xl space-y-4 animate-fade-in">
        <div className="flex items-center justify-end gap-2">
          <AddChip dark={false} label="Area" onAdd={addArea} />
          <ThemeSwitch theme={theme} onChange={switchTheme} dark={false} />
        </div>
        {roots.length ? (
          <ProView roots={roots} selected={proShown} onSelect={select} onOpenTask={setTaskId} />
        ) : (
          <div className="flex h-[50vh] items-center justify-center"><AddChip big dark={false} label="Area" onAdd={addArea} /></div>
        )}
        {taskPopup}
      </div>
    );
  }

  // ── Space: wordless ──
  const detailsFor = selectedId ?? (inGalaxy ? focusArea : null);
  return (
    <div className="relative -m-4 h-[100dvh] overflow-hidden bg-[#020309] lg:-m-8">
      {inGalaxy ? (
        <Galaxy
          areas={areas}
          looseGoals={looseGoals}
          focusId={focusArea}
          onFocus={(id) => {
            setFocusArea(id);
            if (id) setAreaId(id);
          }}
          onOpenGoal={select}
        />
      ) : goal ? (
        <SolarSystem goal={goal} area={area} selectedId={selectedId} onSelect={select} onTask={setTaskId} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgba(124,156,255,0.08),transparent_60%)]">
          <Orbit className="h-10 w-10 text-white/20" />
          {area ? (
            <AddChip big label="Goal" onAdd={(t) => create({ kind: "goal", parent_id: area.node.id, title: t })} />
          ) : (
            <AddChip big label="Area" onAdd={addArea} />
          )}
        </div>
      )}

      {(areas.length > 0 || looseGoals.length > 0) && (
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-7rem)] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tip label="Galaxy">
              <button
                onClick={toggleGalaxy}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md transition-colors",
                  inGalaxy ? "border-white/25 bg-white/15 text-white" : "border-white/10 bg-black/40 text-white/60 hover:text-white",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </Tip>
            {areas.map((a) => (
              <Chip key={a.node.id} active={inGalaxy ? a.node.id === focusArea : a.node.id === area?.node.id} color={a.color} title={a.node.title} onClick={() => select(a.node.id)} />
            ))}
            <AddChip label="Area" onAdd={addArea} />
          </div>
          {area && goals.length > 0 && (!inGalaxy || focusArea) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {goals.map((g) => (
                <Chip key={g.node.id} icon active={!inGalaxy && g.node.id === goal?.node.id} color={g.color} title={g.node.title} onClick={() => select(g.node.id)} />
              ))}
              <AddChip label="Goal" onAdd={(t) => create({ kind: "goal", parent_id: area.node.id, title: t })} />
            </div>
          )}
        </div>
      )}

      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        {detailsFor && (
          <Tip label="Details">
            <button
              onClick={() => { setSelectedId(detailsFor); setTheme("pro"); }}
              className="rounded-full border border-white/10 bg-black/40 p-2 text-white/60 backdrop-blur-md hover:text-white"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}
        <ThemeSwitch theme={theme} onChange={switchTheme} dark />
      </div>

      {taskPopup}
    </div>
  );
}
