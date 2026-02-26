import { useState, useMemo, useRef, useEffect } from "react";
import { Trash2, Play, CheckCircle2, Timer, Loader2, GripVertical, X, ExternalLink, Save } from "lucide-react";
import { useAppState, Task, type TaskPriority } from "@/context/AppContext";
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

function getTaskProgress(task: Task): number {
  if (!task.estimatedTime) return 0;
  if (!task.deadline) return 0;
  const dl = task.deadline;
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const deadline = new Date(dl);
  const daysUntil = Math.ceil((deadline.getTime() - todayDate.getTime()) / 86400000);
  const fullTime = (task.estimatedTime / 60) * 100;
  const remaining = Math.max(0, daysUntil) * 8;
  if (remaining >= fullTime) return 0;
  return Math.min(1, (fullTime - remaining) / fullTime);
}

function isTaskOverdue(task: Task): boolean {
  if (!task.deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.deadline < today && task.status !== "complete";
}

const priorityColors: Record<TaskPriority, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-info/15 text-info",
};

interface EditForm {
  title: string;
  description: string;
  estimatedTime: string;
  date: string;
  deadline: string;
  link: string;
  priority: TaskPriority;
  status: Task["status"];
}

export default function DailyPlan() {
  const { tasks, loading, deleteTask, updateTask, reorderTasks } = useAppState();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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
      .filter((t) => {
        if (!t.date) return false;
        if (t.status !== "complete" && t.date < today) return true;
        return visibleDates.includes(t.date);
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0))
      .forEach((t) => {
        const key = t.date < today && t.status !== "complete" ? today : t.date;
        map[key]?.push(t);
      });
    return map;
  }, [tasks, visibleDates, today]);

  useEffect(() => {
    if (!selectedTask) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectedTask(null);
        setEditForm(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectedTask]);

  const openTaskPopup = (task: Task) => {
    const fresh = tasks.find((t) => t.id === task.id) || task;
    setSelectedTask(fresh);
    setEditForm({
      title: fresh.title,
      description: fresh.description,
      estimatedTime: fresh.estimatedTime ? String(fresh.estimatedTime) : "",
      date: fresh.date,
      deadline: fresh.deadline || "",
      link: fresh.link || "",
      priority: fresh.priority || "medium",
      status: fresh.status,
    });
  };

  const saveEdit = async () => {
    if (!selectedTask || !editForm) return;
    const updates: Partial<Task> = {};
    if (editForm.title.trim() && editForm.title !== selectedTask.title) updates.title = editForm.title.trim();
    if (editForm.description !== selectedTask.description) updates.description = editForm.description;
    const newEst = editForm.estimatedTime ? parseInt(editForm.estimatedTime) : null;
    if (newEst !== selectedTask.estimatedTime) updates.estimatedTime = newEst;
    if (editForm.date !== selectedTask.date) updates.date = editForm.date;
    if (editForm.deadline !== (selectedTask.deadline || "")) updates.deadline = editForm.deadline;
    if (editForm.link !== (selectedTask.link || "")) updates.link = editForm.link;
    if (editForm.priority !== (selectedTask.priority || "medium")) updates.priority = editForm.priority;
    if (editForm.status !== selectedTask.status) {
      updates.status = editForm.status;
      if (editForm.status === "active" && selectedTask.status === "idle") updates.startTime = Date.now();
      if (editForm.status === "complete" && selectedTask.status !== "complete") updates.endTime = Date.now();
    }
    if (Object.keys(updates).length > 0) {
      await updateTask(selectedTask.id, updates);
    }
    setSelectedTask(null);
    setEditForm(null);
  };

  const startTask = (id: string) => updateTask(id, { status: "active", startTime: Date.now() });
  const completeTask = (id: string) => updateTask(id, { status: "complete", endTime: Date.now() });

  const handleReorderStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("application/task-id", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnTask = (e: React.DragEvent, targetTaskId: string, targetDate: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("application/task-id");
    if (!sourceId) return;
    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;
    const sourceDate = sourceTask.date || today;

    if (sourceDate === targetDate) {
      if (sourceId === targetTaskId) return;
      const dayTasks = tasksByDate[targetDate];
      const sourceIdx = dayTasks.findIndex((t) => t.id === sourceId);
      const targetIdx = dayTasks.findIndex((t) => t.id === targetTaskId);
      if (sourceIdx < 0 || targetIdx < 0) return;
      const reordered = [...dayTasks];
      const [removed] = reordered.splice(sourceIdx, 1);
      reordered.splice(targetIdx, 0, removed);
      reorderTasks(targetDate, reordered.map((t) => t.id));
    } else {
      updateTask(sourceId, { date: targetDate });
    }
  };

  const handleDropOnDay = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("application/task-id");
    if (!sourceId) return;
    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;
    const sourceDate = sourceTask.date || today;
    if (sourceDate !== targetDate) {
      updateTask(sourceId, { date: targetDate });
    }
  };

  const handleReorderOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleCardDoubleClick = (task: Task) => {
    if (task.link) {
      window.open(task.link, "_blank", "noopener");
    }
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
    <TooltipProvider delayDuration={400}>
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

        <div className="space-y-8">
          {visibleDates.map((dateStr) => {
            const dayTasks = tasksByDate[dateStr] || [];
            const isToday = dateStr === today;
            if (dayTasks.length === 0 && !isToday) return null;
            return (
              <section key={dateStr} onDrop={(e) => handleDropOnDay(e, dateStr)} onDragOver={handleReorderOver}>
                {!isToday && (
                  <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      {formatDayLabel(dateStr)}
                    </h3>
                    {dayTasks.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {dayTasks.filter((t) => t.status === "complete").length}/{dayTasks.length}
                      </span>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {dayTasks.length === 0 && isToday && (
                    <div className="rounded-lg border border-dashed border-border py-8 text-center">
                      <p className="text-sm text-muted-foreground">No tasks for today. Add tasks from the Schedule page.</p>
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
                        onDragStart={(e) => task.status !== "complete" && handleReorderStart(e, task.id)}
                        onDrop={(e) => { e.stopPropagation(); task.status !== "complete" && handleDropOnTask(e, task.id, dateStr); }}
                        onDragOver={handleReorderOver}
                        onClick={() => openTaskPopup(task)}
                        onDoubleClick={() => handleCardDoubleClick(task)}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-lg border p-3 transition-all overflow-hidden select-none",
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
                            {task.link && (
                              <a href={task.link} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="shrink-0 text-primary hover:text-primary/80">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0", priorityColors[task.priority || "medium"])}>
                              {task.priority || "medium"}
                            </span>
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
                        <div className="relative flex items-center gap-1.5 z-[1]">
                          {task.estimatedTime && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                              <Timer className="h-2.5 w-2.5" />
                              {formatEstimated(task.estimatedTime)}
                            </span>
                          )}
                          {task.status === "idle" && (
                            <button onClick={(e) => { e.stopPropagation(); startTask(task.id); }} className="flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20">
                              <Play className="h-2.5 w-2.5" /> Start
                            </button>
                          )}
                          {task.status === "active" && (
                            <button onClick={(e) => { e.stopPropagation(); completeTask(task.id); }} className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Done
                            </button>
                          )}
                          {task.status !== "active" && (
                            <button onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                        </TooltipTrigger>
                        {task.description && (
                          <TooltipContent side="bottom" className="max-w-xs text-sm whitespace-pre-wrap">
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

      {selectedTask && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div ref={popupRef} className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-base font-semibold text-foreground">Edit Task</h3>
              <button onClick={() => { setSelectedTask(null); setEditForm(null); }} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="Title"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Description (supports plain text, markdown later)"
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Deadline</label>
                  <input
                    type="date"
                    value={editForm.deadline}
                    onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Estimated (min)</label>
                  <input
                    type="number"
                    value={editForm.estimatedTime}
                    onChange={(e) => setEditForm({ ...editForm, estimatedTime: e.target.value })}
                    placeholder="minutes"
                    min="1"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Task["status"] })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="idle">Idle</option>
                    <option value="active">Active</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as TaskPriority })}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <input
                value={editForm.link}
                onChange={(e) => setEditForm({ ...editForm, link: e.target.value })}
                placeholder="Link (optional)"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />

              {selectedTask.startTime && (
                <div className="text-xs text-muted-foreground font-mono space-y-0.5 pt-1 border-t border-border">
                  <p>Started: {new Date(selectedTask.startTime).toLocaleString()}</p>
                  {selectedTask.endTime && <p>Ended: {new Date(selectedTask.endTime).toLocaleString()}</p>}
                  {selectedTask.startTime && selectedTask.endTime && (
                    <p className="text-primary">Duration: {formatDuration(selectedTask.endTime - selectedTask.startTime)}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setSelectedTask(null); setEditForm(null); }}
                  className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
