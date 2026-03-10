import { useState, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Clock, Trash2, ExternalLink, GripVertical, Play, CheckCircle2, Timer, RefreshCw, Loader2, X } from "lucide-react";
import { useAppState, type TaskPriority, type Task } from "@/context/AppContext";
import { getSettings } from "@/lib/settings";
import { isGCalAvailable, createEvent } from "@/lib/gcal";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TaskEditPopup from "@/components/TaskEditPopup";

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

const priorityColors: Record<TaskPriority, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/10 text-warning",
  low: "bg-info/10 text-info",
};

function calendarEventColor(status: Task["status"], deadline: string): string {
  if (status === "complete") return "bg-primary/15 text-primary";
  if (status === "active") return "bg-primary/20 text-primary animate-pulse";
  if (deadline && deadline < new Date().toISOString().slice(0, 10)) return "bg-destructive/15 text-destructive";
  return "bg-primary/10 text-primary";
}

function isTaskOverdue(task: Task): boolean {
  if (!task.deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.deadline < today && task.status !== "complete";
}

export default function SchedulePlanning() {
  const { tasks, updateTask, deleteTask, reorderTasks } = useAppState();
  const [view, setView] = useState<View>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const dragNavTimer = useRef<ReturnType<typeof setTimeout>>();
  const [syncing, setSyncing] = useState(false);

  const { showProgressBars, blinkEffect } = getSettings();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date().toISOString().slice(0, 10);

  const syncToGCal = async () => {
    const ok = await isGCalAvailable();
    if (!ok) {
      toast({ title: "Not connected", description: "Sign in with Google to enable calendar sync", variant: "destructive" });
      return;
    }
    setSyncing(true);
    let created = 0;
    let errors = 0;
    const scheduled = tasks.filter((t) => !!t.date && t.status !== "complete");
    for (const task of scheduled) {
      try {
        await createEvent({ title: task.title, description: task.description, date: task.date, estimatedTime: task.estimatedTime });
        created++;
      } catch {
        errors++;
      }
    }
    setSyncing(false);
    toast({
      title: "Sync complete",
      description: `${created} events pushed to Google Calendar${errors ? `, ${errors} failed` : ""}`,
    });
  };

  const calendarEvents = useMemo(() => {
    const map: Record<string, { id: string; title: string; status: Task["status"]; deadline: string }[]> = {};
    tasks.forEach((t) => {
      if (!t.date) return;
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push({ id: t.id, title: t.title, status: t.status, deadline: t.deadline });
    });
    return map;
  }, [tasks]);

  const selectedDayTasks = useMemo(
    () => selectedDay ? tasks.filter((t) => t.date === selectedDay).sort((a, b) => a.position - b.position) : [],
    [tasks, selectedDay]
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

  const openEditPopup = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) setEditingTask(task);
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
    if (!sourceId || sourceId === targetTaskId) return;
    const dayTasks = selectedDayTasks;
    const sourceIdx = dayTasks.findIndex((t) => t.id === sourceId);
    const targetIdx = dayTasks.findIndex((t) => t.id === targetTaskId);
    if (sourceIdx < 0 || targetIdx < 0) return;
    const reordered = [...dayTasks];
    const [removed] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, removed);
    reorderTasks(targetDate, reordered.map((t) => t.id));
  };

  const handleReorderOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
        {/* Calendar */}
        <section>
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
              <div className="flex items-center gap-2">
                <button
                  onClick={syncToGCal}
                  disabled={syncing}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-50"
                  title="Sync to Google Calendar"
                >
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync
                </button>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {(["month", "week"] as View[]).map((v) => (
                    <button key={v} onClick={() => setView(v)} className={cn("px-3 py-1.5 text-xs font-medium capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {view === "month" && (
              <div className="relative glass-card overflow-hidden">
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
                      <div key={day} className="min-h-[90px] border-b border-r border-border p-1.5 cursor-pointer hover:bg-muted/30 transition-colors" onDrop={(e) => handleDrop(e, dateStr)} onDragOver={handleDragOver} onClick={() => setSelectedDay(dateStr)}>
                        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium", isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{day}</span>
                        <div className="mt-0.5 space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <div
                              key={ev.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, ev.id)}
                              onClick={(e) => { e.stopPropagation(); openEditPopup(ev.id); }}
                              className={cn("truncate rounded px-1 py-0.5 text-[10px] font-medium cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-primary/40", calendarEventColor(ev.status, ev.deadline))}
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
                      <div key={dateStr} className="border-r border-border last:border-r-0 cursor-pointer hover:bg-muted/30 transition-colors" onDrop={(e) => handleDrop(e, dateStr)} onDragOver={handleDragOver} onClick={() => setSelectedDay(dateStr)}>
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
                              onClick={(e) => { e.stopPropagation(); openEditPopup(ev.id); }}
                              className={cn("rounded px-1.5 py-1 text-[10px] cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-primary/40", calendarEventColor(ev.status, ev.deadline))}
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

        {/* Selected Day Task List (Daily-Plan style) */}
        {selectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedDay(null)}>
            <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl p-5 space-y-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedDayTasks.filter((t) => t.status === "complete").length}/{selectedDayTasks.length} done
                  </p>
                </div>
                <button onClick={() => setSelectedDay(null)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedDayTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No tasks on this day</p>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {selectedDayTasks.map((task) => {
                    const overdue = isTaskOverdue(task);
                    return (
                      <div
                        key={task.id}
                        draggable={task.status !== "complete"}
                        onDragStart={(e) => task.status !== "complete" && handleReorderStart(e, task.id)}
                        onDrop={(e) => { e.stopPropagation(); task.status !== "complete" && handleDropOnTask(e, task.id, selectedDay); }}
                        onDragOver={handleReorderOver}
                        onClick={() => { setSelectedDay(null); openEditPopup(task.id); }}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-lg border p-3 transition-all overflow-hidden select-none cursor-pointer",
                          task.status !== "complete" && "cursor-grab active:cursor-grabbing",
                          task.status === "idle" && !overdue && "border-border bg-card",
                          task.status === "active" && !overdue && "task-card-active",
                          task.status === "complete" && "task-card-complete",
                          overdue && "task-card-overdue"
                        )}
                      >
                        {task.status !== "complete" && (
                          <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn("font-medium truncate", task.status === "complete" && "line-through text-muted-foreground")}>
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
                        <div className="flex items-center gap-1.5">
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit popup */}
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
