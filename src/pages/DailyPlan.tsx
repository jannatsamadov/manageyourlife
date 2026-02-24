import { useState, useMemo } from "react";
import { Plus, Trash2, Play, CheckCircle2, Clock, Timer, Loader2, GripVertical } from "lucide-react";
import { useAppState, Task } from "@/context/AppContext";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatEstimated(mins: number | null): string {
  if (!mins) return "";
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
  return `${mins}m`;
}

function formatDayLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/**
 * full_time = 100 * estimated_hours
 * remaining = (deadline - today) * 8h
 * progress = (full_time - remaining) / full_time
 */
function getTaskProgress(task: Task): number {
  if (!task.estimatedTime) return 0;
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const deadline = new Date(task.date);
  const daysUntil = Math.ceil((deadline.getTime() - todayDate.getTime()) / 86400000);
  const fullTime = (task.estimatedTime / 60) * 100;
  const remaining = Math.max(0, daysUntil) * 8;
  if (remaining >= fullTime) return 0;
  return Math.min(1, (fullTime - remaining) / fullTime);
}

function isTaskOverdue(task: Task): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return task.date < today && task.status !== "complete";
}

export default function DailyPlan() {
  const { tasks, loading, addTask, deleteTask, updateTask, reorderTasks } = useAppState();
  const [newTask, setNewTask] = useState("");
  const [newEst, setNewEst] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const { showProgressBars, blinkEffect } = getSettings();

  const dayCount = 14;
  const visibleDates = useMemo(() => {
    return Array.from({ length: dayCount }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, []);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    visibleDates.forEach((d) => { map[d] = []; });
    [...tasks]
      .filter((t) => visibleDates.includes(t.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0))
      .forEach((t) => map[t.date].push(t));
    return map;
  }, [tasks, visibleDates]);

  const handleAdd = async () => {
    if (!newTask.trim()) return;
    await addTask({
      title: newTask.trim(),
      description: "",
      estimatedTime: newEst ? parseInt(newEst) : null,
      status: "idle",
      startTime: null,
      endTime: null,
      date: today,
      position: 0,
      link: "",
      priority: "medium",
    });
    setNewTask("");
    setNewEst("");
  };

  const startTask = (id: string) => updateTask(id, { status: "active", startTime: Date.now() });
  const completeTask = (id: string) => updateTask(id, { status: "complete", endTime: Date.now() });

  const handleReorderStart = (e: React.DragEvent, taskId: string, date: string) => {
    e.dataTransfer.setData("application/task-id", taskId);
    e.dataTransfer.setData("application/task-date", date);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleReorderDrop = (e: React.DragEvent, targetTaskId: string, date: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("application/task-id");
    const sourceDate = e.dataTransfer.getData("application/task-date");
    if (!sourceId || sourceDate !== date || sourceId === targetTaskId) return;
    const dayTasks = tasksByDate[date];
    const sourceIdx = dayTasks.findIndex((t) => t.id === sourceId);
    const targetIdx = dayTasks.findIndex((t) => t.id === targetTaskId);
    if (sourceIdx < 0 || targetIdx < 0) return;
    const reordered = [...dayTasks];
    const [removed] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, removed);
    reorderTasks(date, reordered.map((t) => t.id));
  };

  const handleReorderOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const todayTasks = tasksByDate[today] || [];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Today's Plan</h2>
            <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {todayTasks.filter((t) => t.status === "complete").length}/{todayTasks.length} done
          </div>
        </div>

        {/* Compact Add task - single row */}
        <div className="flex gap-2">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Add task..."
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="number"
            value={newEst}
            onChange={(e) => setNewEst(e.target.value)}
            placeholder="min"
            min="1"
            className="w-16 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>

        {/* Multi-day task list with boundaries */}
        <div className="space-y-8">
          {visibleDates.map((dateStr) => {
            const dayTasks = tasksByDate[dateStr] || [];
            return (
              <section key={dateStr}>
                <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                  <h3 className={cn(
                    "text-sm font-semibold",
                    dateStr === today ? "text-primary" : "text-muted-foreground"
                  )}>
                    {formatDayLabel(dateStr)}
                  </h3>
                  {dayTasks.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {dayTasks.filter((t) => t.status === "complete").length}/{dayTasks.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {dayTasks.length === 0 && dateStr === today && (
                    <div className="rounded-lg border border-dashed border-border py-8 text-center">
                      <p className="text-sm text-muted-foreground">No tasks yet. Add one above.</p>
                    </div>
                  )}
                  {dayTasks.length === 0 && dateStr !== today && (
                    <div className="rounded-lg border border-dashed border-border/50 py-4 text-center">
                      <p className="text-xs text-muted-foreground/70">No tasks</p>
                    </div>
                  )}
                  {dayTasks.map((task) => {
                    const overdue = isTaskOverdue(task);
                    const progressPct = getTaskProgress(task);
                    return (
                      <Tooltip key={task.id}>
                        <TooltipTrigger asChild>
                          <div
                            draggable={task.status !== "complete"}
                            onDragStart={(e) => task.status !== "complete" && handleReorderStart(e, task.id, dateStr)}
                            onDrop={(e) => task.status !== "complete" && handleReorderDrop(e, task.id, dateStr)}
                            onDragOver={handleReorderOver}
                            className={cn(
                              "group relative flex items-center gap-3 rounded-lg border p-3 transition-all overflow-hidden",
                              task.status !== "complete" && "cursor-grab active:cursor-grabbing",
                              task.status === "idle" && !overdue && "border-border bg-card",
                              task.status === "active" && !overdue && "task-card-active",
                              task.status === "complete" && "task-card-complete",
                              overdue && "task-card-overdue"
                            )}
                          >
                            {showProgressBars && progressPct > 0 && task.status !== "complete" && (
                              <div
                                className={cn("task-progress-red absolute inset-0 pointer-events-none rounded-lg", blinkEffect && "task-progress-blink")}
                                style={{
                                  ["--progress-pct" as string]: `${Math.min(progressPct, 1) * 100}%`,
                                  ["--blink-duration" as string]: progressPct >= 0.75 ? `${Math.max(0.6, 3.6 - (progressPct - 0.75) * 12)}s` : "3.6s",
                                }}
                              />
                            )}
                            {task.status !== "complete" && (
                              <GripVertical className="relative h-4 w-4 text-muted-foreground/60 shrink-0 z-[1]" />
                            )}
                            <div className="relative flex-1 min-w-0 z-[1]">
                              <div className="flex items-center gap-2">
                                <p className={cn(
                                  "font-medium truncate",
                                  task.status === "complete" && "line-through text-muted-foreground"
                                )}>
                                  {task.title}
                                </p>
                                {task.estimatedTime && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                                    <Timer className="h-2.5 w-2.5" />
                                    {formatEstimated(task.estimatedTime)}
                                  </span>
                                )}
                              </div>
                              {(task.startTime || task.endTime) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                  {task.startTime && <span>Started {formatTime(task.startTime)}</span>}
                                  {task.endTime && <span>Ended {formatTime(task.endTime)}</span>}
                                  {task.startTime && task.endTime && (
                                    <span className="text-primary">{formatDuration(task.endTime - task.startTime)}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="relative flex items-center gap-1 z-[1]">
                              {task.status === "idle" && (
                                <button onClick={() => startTask(task.id)} className="flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20">
                                  <Play className="h-2.5 w-2.5" /> Start
                                </button>
                              )}
                              {task.status === "active" && (
                                <button onClick={() => completeTask(task.id)} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> Done
                                </button>
                              )}
                              {task.status !== "active" && (
                                <button onClick={() => deleteTask(task.id)} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </TooltipTrigger>
                        {task.description && (
                          <TooltipContent side="bottom" className="max-w-xs text-sm">
                            {task.description}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
