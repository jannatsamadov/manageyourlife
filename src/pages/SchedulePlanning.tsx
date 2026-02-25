import { useState, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, ExternalLink, GripVertical } from "lucide-react";
import { useAppState, type TaskPriority, type Task } from "@/context/AppContext";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type View = "month" | "week";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function getWeekDates(date: Date) {
  const day = date.getDay();
  const start = new Date(date);
  start.setDate(start.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function formatEstimated(mins: number | null): string {
  if (!mins) return "";
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ""}`.trim();
  return `${mins}m`;
}

const priorityColors: Record<TaskPriority, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/10 text-warning",
  low: "bg-info/10 text-info",
};

function getTaskProgress(task: Task): number {
  if (!task.estimatedTime) return 0;
  const dl = task.deadline || task.date;
  if (!dl) return 0;
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const deadline = new Date(dl);
  const daysUntil = Math.ceil((deadline.getTime() - todayDate.getTime()) / 86400000);
  const fullTime = (task.estimatedTime / 60) * 100;
  const remaining = Math.max(0, daysUntil) * 8;
  if (remaining >= fullTime) return 0;
  return Math.min(1, (fullTime - remaining) / fullTime);
}

export default function SchedulePlanning() {
  const { tasks, updateTask, addTask, deleteTask } = useAppState();
  const [view, setView] = useState<View>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    estimatedTime: "",
    deadline: "",
    link: "",
    priority: "medium" as TaskPriority,
  });
  const dragNavTimer = useRef<ReturnType<typeof setTimeout>>();

  const { showProgressBars, blinkEffect } = getSettings();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date().toISOString().slice(0, 10);

  const calendarEvents = useMemo(() => {
    const map: Record<string, { id: string; title: string; priority: TaskPriority; link: string }[]> = {};
    tasks.forEach((t) => {
      if (!t.date) return;
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push({ id: t.id, title: t.title, priority: t.priority, link: t.link });
    });
    return map;
  }, [tasks]);

  const unscheduledTasks = useMemo(
    () => tasks.filter((t) => !t.date && t.status !== "complete").sort((a, b) => (a.deadline || "z").localeCompare(b.deadline || "z") || a.position - b.position),
    [tasks]
  );

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("application/schedule-id", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    clearTimeout(dragNavTimer.current);
    const id = e.dataTransfer.getData("application/schedule-id");
    if (!id) return;
    updateTask(id, { date: targetDate });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const navigateMonth = useCallback((dir: number) => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  }, []);

  const navigateWeek = useCallback((dir: number) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + dir * 7);
      return d;
    });
  }, []);

  const handleEdgeDragOver = (e: React.DragEvent, dir: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragNavTimer.current) return;
    dragNavTimer.current = setTimeout(() => {
      if (view === "month") navigateMonth(dir);
      else navigateWeek(dir);
      dragNavTimer.current = undefined;
    }, 600);
  };

  const handleEdgeDragLeave = () => {
    clearTimeout(dragNavTimer.current);
    dragNavTimer.current = undefined;
  };

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

  const handleUnschedule = (id: string) => {
    updateTask(id, { date: "" });
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-5xl space-y-8 animate-fade-in">
        <section>
          <h2 className="text-xl font-bold text-foreground mb-4">Schedule</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h3>
                <div className="flex gap-1">
                  <button onClick={() => (view === "month" ? navigateMonth(-1) : navigateWeek(-1))} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => setCurrentDate(new Date())} className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Today</button>
                  <button onClick={() => (view === "month" ? navigateMonth(1) : navigateWeek(1))} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(["month", "week"] as View[]).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1.5 text-xs font-medium capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {view === "month" && (
              <div className="relative glass-card overflow-hidden">
                {/* Edge zones for drag navigation */}
                <div className="absolute left-0 top-0 bottom-0 w-8 z-10" onDragOver={(e) => handleEdgeDragOver(e, -1)} onDragLeave={handleEdgeDragLeave} />
                <div className="absolute right-0 top-0 bottom-0 w-8 z-10" onDragOver={(e) => handleEdgeDragOver(e, 1)} onDragLeave={handleEdgeDragLeave} />
                <div className="grid grid-cols-7">
                  {dayNames.map((d) => (
                    <div key={d} className="border-b border-border px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: getFirstDayOfMonth(year, month) }).map((_, i) => (
                    <div key={`e-${i}`} className="min-h-[90px] border-b border-r border-border" onDrop={(e) => { e.preventDefault(); }} onDragOver={handleDragOver} />
                  ))}
                  {Array.from({ length: getDaysInMonth(year, month) }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const dayEvents = calendarEvents[dateStr] || [];
                    const isToday = dateStr === today;
                    return (
                      <div key={day} className="min-h-[90px] border-b border-r border-border p-1.5" onDrop={(e) => handleDrop(e, dateStr)} onDragOver={handleDragOver}>
                        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium", isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{day}</span>
                        <div className="mt-0.5 space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <div
                              key={ev.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, ev.id)}
                              className={cn(
                                "truncate rounded px-1 py-0.5 text-[10px] font-medium cursor-grab active:cursor-grabbing",
                                ev.link ? priorityColors[ev.priority] : "bg-primary/10 text-primary"
                              )}
                            >
                              {ev.title}
                            </div>
                          ))}
                          {dayEvents.length > 3 && <span className="text-[9px] text-muted-foreground">+{dayEvents.length - 3}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {view === "week" && (
              <div className="relative glass-card overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-8 z-10" onDragOver={(e) => handleEdgeDragOver(e, -1)} onDragLeave={handleEdgeDragLeave} />
                <div className="absolute right-0 top-0 bottom-0 w-8 z-10" onDragOver={(e) => handleEdgeDragOver(e, 1)} onDragLeave={handleEdgeDragLeave} />
                <div className="grid grid-cols-7">
                  {getWeekDates(currentDate).map((date) => {
                    const dateStr = date.toISOString().slice(0, 10);
                    const dayEvents = calendarEvents[dateStr] || [];
                    const isToday = dateStr === today;
                    return (
                      <div key={dateStr} className="border-r border-border last:border-r-0" onDrop={(e) => handleDrop(e, dateStr)} onDragOver={handleDragOver}>
                        <div className={cn("border-b border-border px-2 py-2 text-center", isToday && "bg-primary/5")}>
                          <p className="text-[10px] text-muted-foreground">{dayNames[date.getDay()]}</p>
                          <p className={cn("mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isToday ? "bg-primary text-primary-foreground" : "text-foreground")}>{date.getDate()}</p>
                        </div>
                        <div className="min-h-[200px] p-1.5 space-y-0.5">
                          {dayEvents.map((ev) => (
                            <div
                              key={ev.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, ev.id)}
                              className={cn(
                                "rounded px-1.5 py-1 text-[10px] cursor-grab active:cursor-grabbing",
                                ev.link ? priorityColors[ev.priority] : "bg-primary/10 text-primary"
                              )}
                            >
                              <div className="flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5 flex-shrink-0" />
                                <span className="truncate">{ev.title}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Upcoming</h3>
              <p className="text-xs text-muted-foreground">Create tasks, drag to calendar to schedule</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>

          {showForm && (
            <div className="mb-4 p-4 rounded-lg border border-border bg-muted/20 space-y-3">
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

          <div className="space-y-2">
            {unscheduledTasks.length === 0 && (
              <div className="rounded-lg border border-dashed border-border py-8 text-center">
                <p className="text-sm text-muted-foreground">No unscheduled tasks. Add one above, then drag to calendar.</p>
              </div>
            )}
            {unscheduledTasks.map((task) => {
              const progressPct = getTaskProgress(task);
              return (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      className="group relative flex items-center gap-3 rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors overflow-hidden"
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
                      <GripVertical className="relative h-4 w-4 text-muted-foreground/60 shrink-0 z-[1]" />
                      <div className="relative flex-1 min-w-0 z-[1]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{task.title}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[task.priority])}>{task.priority}</span>
                          {task.estimatedTime && <span className="text-[10px] text-muted-foreground">Est: {formatEstimated(task.estimatedTime)}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                          {task.deadline && <span className="font-mono">Deadline: {task.deadline}</span>}
                          {task.link && <a href={task.link} target="_blank" rel="noopener" className="flex items-center gap-0.5 text-primary hover:underline" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-3 w-3" />Link</a>}
                        </div>
                      </div>
                      <button onClick={() => deleteTask(task.id)} className="relative rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive z-[1]">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TooltipTrigger>
                  {task.description && <TooltipContent side="bottom" className="max-w-xs text-sm">{task.description}</TooltipContent>}
                </Tooltip>
              );
            })}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
