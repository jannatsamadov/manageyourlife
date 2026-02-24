import { useState } from "react";
import { useAppState } from "@/context/AppContext";
import { Eye, Crosshair, Target, Flag, CheckCircle2, Circle, Plus, Trash2, Edit3, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Strategy() {
  const { strategy, setStrategy } = useAppState();
  const [editingVision, setEditingVision] = useState(false);
  const [editingMission, setEditingMission] = useState(false);
  const [visionDraft, setVisionDraft] = useState(strategy.vision);
  const [missionDraft, setMissionDraft] = useState(strategy.mission);
  const [newGoal, setNewGoal] = useState("");
  const [newCheckpoint, setNewCheckpoint] = useState<Record<string, string>>({});

  const toggleCheckpoint = (goalId: string, checkpointId: string) => {
    setStrategy((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === goalId
          ? { ...g, checkpoints: g.checkpoints.map((c) => (c.id === checkpointId ? { ...c, completed: !c.completed } : c)) }
          : g
      ),
    }));
  };

  const goalProgress = (goalId: string) => {
    const goal = strategy.goals.find((g) => g.id === goalId);
    if (!goal || goal.checkpoints.length === 0) return 0;
    return Math.round((goal.checkpoints.filter((c) => c.completed).length / goal.checkpoints.length) * 100);
  };

  const addGoal = () => {
    if (!newGoal.trim()) return;
    setStrategy((prev) => ({
      ...prev,
      goals: [...prev.goals, { id: `g-${Date.now()}`, title: newGoal.trim(), checkpoints: [] }],
    }));
    setNewGoal("");
  };

  const deleteGoal = (id: string) => {
    setStrategy((prev) => ({ ...prev, goals: prev.goals.filter((g) => g.id !== id) }));
  };

  const addCheckpoint = (goalId: string) => {
    const title = newCheckpoint[goalId]?.trim();
    if (!title) return;
    const month = new Date().toISOString().slice(0, 7);
    setStrategy((prev) => ({
      ...prev,
      goals: prev.goals.map((g) =>
        g.id === goalId
          ? { ...g, checkpoints: [...g.checkpoints, { id: `c-${Date.now()}`, title, completed: false, month }] }
          : g
      ),
    }));
    setNewCheckpoint((prev) => ({ ...prev, [goalId]: "" }));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-fade-in">
      {/* Vision */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10">
            <Eye className="h-4 w-4 text-info" />
          </div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Vision</h3>
          <button onClick={() => { setEditingVision(true); setVisionDraft(strategy.vision); }} className="ml-auto text-muted-foreground hover:text-foreground">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>
        {editingVision ? (
          <div className="flex gap-2">
            <input value={visionDraft} onChange={(e) => setVisionDraft(e.target.value)} className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            <button onClick={() => { setStrategy((p) => ({ ...p, vision: visionDraft })); setEditingVision(false); }} className="p-2 text-primary"><Check className="h-4 w-4" /></button>
            <button onClick={() => setEditingVision(false)} className="p-2 text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <p className="text-lg font-medium text-foreground">{strategy.vision}</p>
        )}
      </section>

      {/* Mission */}
      <section className="glass-card p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
            <Crosshair className="h-4 w-4 text-warning" />
          </div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mission</h3>
          <button onClick={() => { setEditingMission(true); setMissionDraft(strategy.mission); }} className="ml-auto text-muted-foreground hover:text-foreground">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>
        {editingMission ? (
          <div className="flex gap-2">
            <input value={missionDraft} onChange={(e) => setMissionDraft(e.target.value)} className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            <button onClick={() => { setStrategy((p) => ({ ...p, mission: missionDraft })); setEditingMission(false); }} className="p-2 text-primary"><Check className="h-4 w-4" /></button>
            <button onClick={() => setEditingMission(false)} className="p-2 text-muted-foreground"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <p className="text-foreground">{strategy.mission}</p>
        )}
      </section>

      {/* Goals */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Target className="h-4 w-4 text-primary" />
          </div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Strategic Goals</h3>
        </div>

        <div className="space-y-4">
          {strategy.goals.map((goal) => {
            const progress = goalProgress(goal.id);
            return (
              <div key={goal.id} className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Flag className="h-4 w-4 text-primary" />
                    <h4 className="font-semibold text-foreground">{goal.title}</h4>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-primary">{progress}%</span>
                    <button onClick={() => deleteGoal(goal.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Checkpoints */}
                <div className="space-y-2 pl-2">
                  {goal.checkpoints.map((cp) => (
                    <button
                      key={cp.id}
                      onClick={() => toggleCheckpoint(goal.id, cp.id)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors text-left"
                    >
                      {cp.completed ? (
                        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className={cn(cp.completed && "line-through text-muted-foreground")}>{cp.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground font-mono">{cp.month}</span>
                    </button>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      value={newCheckpoint[goal.id] || ""}
                      onChange={(e) => setNewCheckpoint((p) => ({ ...p, [goal.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && addCheckpoint(goal.id)}
                      placeholder="Add checkpoint..."
                      className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button onClick={() => addCheckpoint(goal.id)} className="p-1.5 text-primary hover:bg-primary/10 rounded-md">
                      <Plus className="h-4 w-4" />
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
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGoal()}
              placeholder="Add a new strategic goal..."
              className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={addGoal} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" />
              Add Goal
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
