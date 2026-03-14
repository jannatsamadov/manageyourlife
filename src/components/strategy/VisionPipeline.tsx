import { useState } from "react";
import { useAppState } from "@/context/AppContext";
import { Plus, Trash2, Edit3, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VisionPipeline() {
  const { strategy, setStrategy, tasks } = useAppState();
  const [newGoal, setNewGoal] = useState("");
  const [newCheckpoint, setNewCheckpoint] = useState<Record<string, string>>({});
  const [editingVision, setEditingVision] = useState(false);
  const [editingMission, setEditingMission] = useState(false);
  const [visionDraft, setVisionDraft] = useState(strategy.vision);
  const [missionDraft, setMissionDraft] = useState(strategy.mission);

  const goalProgress = (goalId: string) => {
    const goal = strategy.goals.find(g => g.id === goalId);
    if (!goal || goal.checkpoints.length === 0) return 0;
    return Math.round((goal.checkpoints.filter(c => c.completed).length / goal.checkpoints.length) * 100);
  };

  const toggleCheckpoint = (goalId: string, cpId: string) => {
    setStrategy(prev => ({
      ...prev,
      goals: prev.goals.map(g =>
        g.id === goalId
          ? { ...g, checkpoints: g.checkpoints.map(c => c.id === cpId ? { ...c, completed: !c.completed } : c) }
          : g
      ),
    }));
  };

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setStrategy(prev => ({
      ...prev,
      goals: [...prev.goals, { id: `g-${Date.now()}`, title: newGoal.trim(), checkpoints: [] }],
    }));
    setNewGoal("");
  };

  const deleteGoal = (id: string) => {
    setStrategy(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== id) }));
  };

  const addCheckpoint = (goalId: string) => {
    const title = newCheckpoint[goalId]?.trim();
    if (!title) return;
    const month = new Date().toISOString().slice(0, 7);
    setStrategy(prev => ({
      ...prev,
      goals: prev.goals.map(g =>
        g.id === goalId
          ? { ...g, checkpoints: [...g.checkpoints, { id: `c-${Date.now()}`, title, completed: false, month }] }
          : g
      ),
    }));
    setNewCheckpoint(prev => ({ ...prev, [goalId]: "" }));
  };

  return (
    <div className="space-y-6">
      {/* Vision & Mission compact header */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="glass-card p-4 border-border/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-info">◈ VISION</span>
            <button onClick={() => { setEditingVision(true); setVisionDraft(strategy.vision); }} className="text-muted-foreground hover:text-foreground">
              <Edit3 className="h-3 w-3" />
            </button>
          </div>
          {editingVision ? (
            <div className="flex gap-1.5">
              <input value={visionDraft} onChange={e => setVisionDraft(e.target.value)} className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={() => { setStrategy(p => ({ ...p, vision: visionDraft })); setEditingVision(false); }} className="text-primary"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditingVision(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <p className="text-sm text-foreground">{strategy.vision}</p>
          )}
        </div>
        <div className="glass-card p-4 border-border/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-warning">◈ MISSION</span>
            <button onClick={() => { setEditingMission(true); setMissionDraft(strategy.mission); }} className="text-muted-foreground hover:text-foreground">
              <Edit3 className="h-3 w-3" />
            </button>
          </div>
          {editingMission ? (
            <div className="flex gap-1.5">
              <input value={missionDraft} onChange={e => setMissionDraft(e.target.value)} className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={() => { setStrategy(p => ({ ...p, mission: missionDraft })); setEditingMission(false); }} className="text-primary"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditingMission(false)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <p className="text-sm text-foreground">{strategy.mission}</p>
          )}
        </div>
      </div>

      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">▸ VISION PIPELINES</span>
        <div className="flex-1 h-px bg-border/30" />
      </div>

      {/* Pipelines */}
      <div className="space-y-5">
        {strategy.goals.map(goal => {
          const progress = goalProgress(goal.id);
          const checkpoints = goal.checkpoints;

          return (
            <div key={goal.id} className="glass-card p-5 border-border/30 relative overflow-hidden">
              {/* Subtle neon glow based on progress */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `linear-gradient(90deg, hsl(var(--primary) / ${progress > 0 ? 0.05 : 0}) 0%, transparent ${progress}%)`,
                }}
              />

              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-foreground text-sm">{goal.title}</h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-primary"
                      style={{ textShadow: progress > 50 ? "0 0 10px hsl(var(--primary) / 0.5)" : "none" }}>
                      {progress}%
                    </span>
                    <button onClick={() => deleteGoal(goal.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Horizontal pipeline path */}
                {checkpoints.length > 0 && (
                  <div className="relative py-6 px-2">
                    {/* The track (dim path) */}
                    <div className="absolute top-1/2 left-4 right-4 h-1 -translate-y-1/2 rounded-full bg-muted/60" />
                    {/* Filled track */}
                    <div
                      className="absolute top-1/2 left-4 h-1 -translate-y-1/2 rounded-full transition-all duration-700"
                      style={{
                        width: `calc(${progress}% - 32px)`,
                        background: "linear-gradient(90deg, hsl(var(--primary) / 0.5), hsl(var(--primary)))",
                        boxShadow: "0 0 12px hsl(var(--primary) / 0.4)",
                      }}
                    />

                    {/* Checkpoint nodes */}
                    <div className="relative flex justify-between">
                      {checkpoints.map((cp, i) => {
                        const nodeReached = ((i + 1) / checkpoints.length) * 100 <= progress + 1;
                        return (
                          <button
                            key={cp.id}
                            onClick={() => toggleCheckpoint(goal.id, cp.id)}
                            className="flex flex-col items-center gap-2 group relative"
                            title={cp.title}
                          >
                            {/* Node */}
                            <div
                              className={cn(
                                "w-5 h-5 rounded-full border-2 transition-all duration-500 flex items-center justify-center",
                                cp.completed
                                  ? "border-primary bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.6)] scale-110"
                                  : nodeReached
                                  ? "border-primary/60 bg-primary/20"
                                  : "border-muted-foreground/30 bg-muted/40"
                              )}
                            >
                              {cp.completed && (
                                <div className="w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
                              )}
                            </div>
                            {/* Label */}
                            <span className={cn(
                              "text-[10px] max-w-[80px] text-center leading-tight transition-colors",
                              cp.completed ? "text-primary" : "text-muted-foreground"
                            )}>
                              {cp.title}
                            </span>
                            <span className="text-[8px] font-mono text-muted-foreground/60">{cp.month}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Add checkpoint */}
                <div className="flex gap-2 mt-3">
                  <input
                    value={newCheckpoint[goal.id] || ""}
                    onChange={e => setNewCheckpoint(p => ({ ...p, [goal.id]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addCheckpoint(goal.id)}
                    placeholder="Add checkpoint..."
                    className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button onClick={() => addCheckpoint(goal.id)} className="p-1.5 text-primary hover:bg-primary/10 rounded">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add goal */}
        <div className="flex gap-2">
          <input
            value={newGoal}
            onChange={e => setNewGoal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addGoal()}
            placeholder="Add a new vision pipeline..."
            className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button onClick={addGoal} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
