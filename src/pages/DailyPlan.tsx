import { useState, useMemo } from "react";
import { Plus, Trash2, ExternalLink, GripVertical, CalendarX, RotateCcw, Loader2, Timer } from "lucide-react";
import { useAppState, type TaskPriority, type Task } from "@/context/AppContext";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TaskEditPopup from "@/components/TaskEditPopup";

function formatEstimated(mins: number | null): string {
  if (!mins) return "";
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
  return `${mins}m`;
}

function getTaskProgress(task: Task): number {
  if (!task.estimatedTime) return 0;
  if (!task.deadline) return 0;
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const deadline = new Date(task.deadline);
  const daysUntil = Math.ceil((deadline.getTime() - todayDate.getTime()) / 86400000);
  const fullTime = (task.estimatedTime / 60) * 100;
  const remaining = Math.max(0, daysUntil) * 8;
  if (remaining >= fullTime) return 0;
  return Math.min(1, (fullTime - remaining) / fullTime);
}

const priorityColors: Record<TaskPriority, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/10 text-warning",
  low: "bg-info/10 text-info",
};

export default function DailyPlan() {
  const { tasks, loading, addTask, deleteTask, permanentDeleteTask, updateTask } = useAppState();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    estimatedTime: "",
    deadline: "",
    link: "",
    priority: "medium" as TaskPriority,
  });

  const [scheduledLimit, setScheduledLimit] = useState(5);
  const [unscheduledLimit, setUnscheduledLimit] = useState(5);
  const [abandonedLimit, setAbandonedLimit] = useState(3);

  const { showProgressBars, blinkEffect } = getSettings();

  const scheduledTasks = useMemo(
    () => tasks
      .filter((t) => !!t.date && t.status !== "complete" && t.status !== "abandoned")
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.position - b.position),
    [tasks]
  );

  const unscheduledTasks = useMemo(
    () => tasks
      .filter((t) => !t.date && t.status !== "complete" && t.status !== "abandoned")
      .sort((a, b) => (a.deadline || "z").localeCompare(b.deadline || "z") || a.position - b.position),
    [tasks]
  );

  const abandonedTasks = useMemo(
    () => tasks
      .filter((t) => t.status === "abandoned")
      .sort((a, b) => (b.deadline || "").localeCompare(a.deadline || "")),
    [tasks]
  );

  const handleAddTask = async () => {
    if (!form.title.trim()) return;
    await addTask({
      title: form.title.trim(),
      description: form.description,
      estimatedTime: form.estimatedTime ? parseInt(form.estimatedTime) : null,
      status: "idle",
      startTime: null,
      endTime: null,
      date: "",
      deadline: form.deadline,
      position: 0,
      link: form.link,
      priority: form.priority,
    });
    setForm({ title: "", description: "", estimatedTime: "", deadline: "", link: "", priority: "medium" });
    setShowForm(false);
  };

  const openEditPopup = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) setEditingTask(task);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("application/schedule-id", id);
    e.dataTransfer.effectAllowed = "move";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const renderTaskCard = (task: Task, options?: { showDate?: boolean; showUnschedule?: boolean }) => {
    const progressPct = getTaskProgress(task);
    return (
      <Tooltip key={task.id}>
        <TooltipTrigger asChild>
          <div
            draggable
            onDragStart={(e) => handleDragStart(e, task.id)}
            onClick={() => openEditPopup(task.id)}
            className="group relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors overflow-hidden"
          >
            {showProgressBars && progressPct > 0 && (
              <div
                className={cn("task-progress-red absolute inset-0 pointer-events-none rounded-lg", blinkEffect && "task-progress-blink")}
                style={{
                  ["--progress-pct" as string]: `${Math.min(progressPct, 1) * 100}%`,
                  ["--blink-duration" as string]: progressPct >= 0.75 ? `${Math.max(0.6, 3.6 - (progressPct - 0.75) * 12)}s` : "3.6s",
                }}
              />
            )}
            <GripVertical className="relative h-4 w-4 text-muted-foreground/60 shrink-0 z-[1]" />
            <div className="relative flex-1 min-w-0 z-[1]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{task.title}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[task.priority])}>{task.priority}</span>
                {task.estimatedTime && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                    <Timer className="h-2.5 w-2.5" />
                    {formatEstimated(task.estimatedTime)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                {options?.showDate && task.date && <span className="font-mono text-primary">{task.date}</span>}
                {task.deadline && <span className="font-mono">Deadline: {task.deadline}</span>}
                {task.link && (
                  <a href={task.link} target="_blank" rel="noopener" className="flex items-center gap-0.5 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    <ExternalLink className="h-3 w-3" />Link
                  </a>
                )}
              </div>
            </div>
            {options?.showUnschedule && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={(e) => { e.stopPropagation(); updateTask(task.id, { date: "" }); }} className="relative rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-warning z-[1]">
                    <CalendarX className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">Unschedule</TooltipContent>
              </Tooltip>
            )}
            <button onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="relative rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive z-[1]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </TooltipTrigger>
        {task.description && <TooltipContent side="bottom" className="max-w-xs text-sm">{task.description}</TooltipContent>}
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Tasks</h2>
            <p className="text-sm text-muted-foreground">Create and manage all your tasks</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Task
          </button>
        </div>

        {/* Add Task Form */}
        {showForm && (
          <div className="glass-card p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Task title *" className="rounded border border-border bg-background px-3 py-2 text-sm" />
              <div>
                <label className="text-[10px] text-muted-foreground">Deadline</label>
                <input type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} className="w-full rounded border border-border bg-background px-3 py-2 text-sm [color-scheme:dark]" />
              </div>
              <input type="number" value={form.estimatedTime} onChange={(e) => setForm((f) => ({ ...f, estimatedTime: e.target.value }))} placeholder="Estimated minutes" min="1" className="rounded border border-border bg-background px-3 py-2 text-sm" />
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))} className="rounded border border-border bg-background px-3 py-2 text-sm">
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
              </select>
              <input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="Link (optional)" className="rounded border border-border bg-background px-3 py-2 text-sm" />
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" rows={1} className="rounded border border-border bg-background px-3 py-2 text-sm resize-none" />
            </div>
            <button onClick={handleAddTask} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Create Task
            </button>
          </div>
        )}

        {/* Scheduled Tasks */}
        <section className="glass-card p-4">
          <h3 className="text-base font-semibold text-foreground mb-3">
            Scheduled <span className="text-xs text-muted-foreground font-normal ml-1">({scheduledTasks.length})</span>
          </h3>
          <div className="space-y-2">
            {scheduledTasks.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No scheduled tasks. Assign dates from the Schedule page.</p>
            )}
            {scheduledTasks.slice(0, scheduledLimit).map((task) => renderTaskCard(task, { showDate: true, showUnschedule: true }))}
            {scheduledTasks.length > scheduledLimit && (
              <button onClick={() => setScheduledLimit((l) => l + 5)} className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                See more ({scheduledTasks.length - scheduledLimit} remaining)
              </button>
            )}
          </div>
        </section>

        {/* Unscheduled Tasks */}
        <section className="glass-card p-4">
          <h3 className="text-base font-semibold text-foreground mb-3">
            Unscheduled <span className="text-xs text-muted-foreground font-normal ml-1">({unscheduledTasks.length})</span>
          </h3>
          <div className="space-y-2">
            {unscheduledTasks.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">All tasks are scheduled.</p>
            )}
            {unscheduledTasks.slice(0, unscheduledLimit).map((task) => renderTaskCard(task))}
            {unscheduledTasks.length > unscheduledLimit && (
              <button onClick={() => setUnscheduledLimit((l) => l + 5)} className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                See more ({unscheduledTasks.length - unscheduledLimit} remaining)
              </button>
            )}
          </div>
        </section>

        {/* Abandoned Tasks */}
        {abandonedTasks.length > 0 && (
          <section className="glass-card p-4">
            <h3 className="text-base font-semibold text-muted-foreground mb-3">
              Abandoned <span className="text-xs text-muted-foreground font-normal ml-1">({abandonedTasks.length})</span>
            </h3>
            <div className="space-y-2">
              {abandonedTasks.slice(0, abandonedLimit).map((task) => (
                <div key={task.id} className="group flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3 opacity-60 hover:opacity-100 transition-opacity">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate line-through">{task.title}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[task.priority])}>{task.priority}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                      {task.deadline && <span className="font-mono">Deadline: {task.deadline}</span>}
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => updateTask(task.id, { status: "idle" })} className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">Restore</TooltipContent>
                  </Tooltip>
                  <button onClick={() => permanentDeleteTask(task.id)} className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {abandonedTasks.length > abandonedLimit && (
                <button onClick={() => setAbandonedLimit((l) => l + 3)} className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                  See more ({abandonedTasks.length - abandonedLimit} remaining)
                </button>
              )}
            </div>
          </section>
        )}

        {editingTask && (
          <TaskEditPopup
            task={editingTask}
            onClose={() => setEditingTask(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
