import { useState, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, Clock, Plus, Trash2, ExternalLink, GripVertical, CalendarX, RefreshCw, Loader2, RotateCcw, X, Play, CheckCircle2, Timer, Filter } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function formatDayLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function isTaskOverdue(task: Task): boolean {
  if (!task.deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.deadline < today && task.status !== "complete";
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

const today = new Date().toISOString().slice(0, 10);

export default function SchedulePlanning() {
  const { tasks, updateTask, addTask, deleteTask, permanentDeleteTask, reorderTasks } = useAppState();
  const [view, setView] = useState<View>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>("all");
  const [deadlineFilter, setDeadlineFilter] = useState<"any" | "overdue" | "due3" | "due7" | "due14" | "noDeadline">("any");
  const [scheduledDaysShown, setScheduledDaysShown] = useState(4);
  const [previousDaysShown, setPreviousDaysShown] = useState(0);
  const [form, setForm] = useState({
    title: "",
    description: "",
    estimatedTime: "",
    deadline: "",
    link: "",
    priority: "medium" as TaskPriority,
  });
  const dragNavTimer = useRef<ReturnType<typeof setTimeout>>();
  const [syncing, setSyncing] = useState(false);

  const normalizedTaskQuery = taskQuery.trim().toLowerCase();
  const taskMatchesQuery = useCallback((t: Task) => {
    if (priorityFilter !== "all" && (t.priority || "medium") !== priorityFilter) return false;

    const todayDate = new Date(new Date().toISOString().slice(0, 10));
    const dueDays = t.deadline ? Math.ceil((new Date(t.deadline).getTime() - todayDate.getTime()) / 86400000) : null;
    if (deadlineFilter === "noDeadline" && t.deadline) return false;
    if (deadlineFilter !== "any" && deadlineFilter !== "noDeadline") {
      if (!t.deadline || dueDays === null) return false;
      if (deadlineFilter === "overdue" && !(t.deadline < today)) return false;
      if (deadlineFilter === "due3" && !(dueDays >= 0 && dueDays <= 3)) return false;
      if (deadlineFilter === "due7" && !(dueDays >= 0 && dueDays <= 7)) return false;
      if (deadlineFilter === "due14" && !(dueDays >= 0 && dueDays <= 14)) return false;
    }

    if (!normalizedTaskQuery) return true;
    const hay = `${t.title ?? ""}\n${t.description ?? ""}\n${t.link ?? ""}`.toLowerCase();
    return hay.includes(normalizedTaskQuery);
  }, [deadlineFilter, normalizedTaskQuery, priorityFilter]);

  const visibleTasks = useMemo(() => tasks.filter(taskMatchesQuery), [tasks, taskMatchesQuery]);

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

  const { showProgressBars, blinkEffect } = getSettings();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarEvents = useMemo(() => {
    const map: Record<string, { id: string; title: string; status: Task["status"]; deadline: string }[]> = {};
    visibleTasks.forEach((t) => {
      if (!t.date) return;
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push({ id: t.id, title: t.title, status: t.status, deadline: t.deadline });
    });
    return map;
  }, [visibleTasks]);

  const [unscheduledLimit, setUnscheduledLimit] = useState(3);
  const [abandonedLimit, setAbandonedLimit] = useState(3);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const scheduledTasks = useMemo(
    () => visibleTasks
      .filter((t) => !!t.date && t.status !== "abandoned")
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.position - b.position),
    [visibleTasks]
  );

  const scheduledDatesOrdered = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, []);

  const visibleScheduledDates = useMemo(
    () => scheduledDatesOrdered.slice(0, scheduledDaysShown),
    [scheduledDatesOrdered, scheduledDaysShown]
  );

  const scheduledTasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    visibleScheduledDates.forEach((d) => { map[d] = []; });
    scheduledTasks.forEach((t) => {
      if (visibleScheduledDates.includes(t.date)) map[t.date].push(t);
    });
    return map;
  }, [scheduledTasks, visibleScheduledDates]);

  const previousDatesOrdered = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (i + 1));
      return d.toISOString().slice(0, 10);
    });
  }, []);

  const visiblePreviousDates = useMemo(
    () => previousDatesOrdered.slice(0, previousDaysShown),
    [previousDatesOrdered, previousDaysShown]
  );

  const previousTasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    visiblePreviousDates.forEach((d) => { map[d] = []; });
    scheduledTasks.forEach((t) => {
      if (visiblePreviousDates.includes(t.date)) map[t.date].push(t);
    });
    return map;
  }, [scheduledTasks, visiblePreviousDates]);

  const handleDropOnUnscheduled = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("application/task-id") || e.dataTransfer.getData("application/schedule-id");
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (task && !task.date) return;
    updateTask(id, { date: "" });
  };

  const startTask = useCallback((id: string) => updateTask(id, { status: "active", startTime: Date.now() }), [updateTask]);
  const completeTask = useCallback((id: string) => updateTask(id, { status: "complete", endTime: Date.now() }), [updateTask]);

  const handleScheduledDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("application/schedule-id", taskId);
    e.dataTransfer.setData("application/task-id", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDropOnScheduledTask = (e: React.DragEvent, targetTaskId: string, targetDate: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("application/task-id") || e.dataTransfer.getData("application/schedule-id");
    if (!sourceId) return;
    const sourceTask = tasks.find((t) => t.id === sourceId);
    if (!sourceTask) return;
    const sourceDate = sourceTask.date || today;
    if (sourceDate === targetDate) {
      if (sourceId === targetTaskId) return;
      const dayTasks = scheduledTasksByDate[targetDate];
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

  const handleScheduledDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnDay = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("application/task-id") || e.dataTransfer.getData("application/schedule-id");
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (task?.date === targetDate) return;
    updateTask(id, { date: targetDate });
  };

  const handleCardDoubleClick = useCallback((task: Task) => {
    if (task.link) window.open(task.link, "_blank", "noopener");
  }, []);

  const unscheduledTasks = useMemo(
    () => visibleTasks
      .filter((t) => !t.date && t.status !== "complete" && t.status !== "abandoned")
      .sort((a, b) => (a.deadline || "z").localeCompare(b.deadline || "z") || a.position - b.position),
    [visibleTasks]
  );

  const abandonedTasks = useMemo(
    () => visibleTasks
      .filter((t) => t.status === "abandoned")
      .sort((a, b) => (b.deadline || "").localeCompare(a.deadline || "")),
    [visibleTasks]
  );

  const selectedDayTasks = useMemo(
    () => selectedDay ? visibleTasks.filter((t) => t.date === selectedDay).sort((a, b) => a.position - b.position) : [],
    [visibleTasks, selectedDay]
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

  const openEditPopup = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) setEditingTask(task);
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mx-auto max-w-5xl space-y-8 animate-fade-in">
        {/* Add Task */}
        <section className="glass-card p-4 -mt-2">
          <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
            <div className="min-w-[220px]">
              <h3 className="text-lg font-semibold text-foreground">Tasks</h3>
              <p className="text-xs text-muted-foreground">Create tasks, drag to calendar to schedule</p>
            </div>

            <div className="flex items-center gap-2 flex-1 justify-end min-w-[260px]">
              <input
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-full sm:w-72 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {taskQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setTaskQuery("")}
                  className="rounded-lg border border-border px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors",
                      (priorityFilter !== "all" || deadlineFilter !== "any") && "text-foreground border-primary/30"
                    )}
                    title="Filters"
                  >
                    <Filter className="h-4 w-4" />
                    Filter
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Priority</div>
                      <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as "all" | TaskPriority)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="All priorities" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Time to deadline</div>
                      <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as typeof deadlineFilter)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Any deadline" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="overdue">Overdue</SelectItem>
                          <SelectItem value="due3">Due in 3 days</SelectItem>
                          <SelectItem value="due7">Due in 7 days</SelectItem>
                          <SelectItem value="due14">Due in 14 days</SelectItem>
                          <SelectItem value="noDeadline">No deadline</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5 opacity-70">
                      <div className="text-xs font-medium text-muted-foreground">Project</div>
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                        Coming soon
                      </div>
                    </div>

                    {(priorityFilter !== "all" || deadlineFilter !== "any") && (
                      <button
                        type="button"
                        onClick={() => { setPriorityFilter("all"); setDeadlineFilter("any"); }}
                        className="w-full rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <button
                onClick={() => setShowForm(!showForm)}
                className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add Task
              </button>
            </div>
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
        </section>

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
                              className={cn(
                                "truncate rounded px-1 py-0.5 text-[10px] font-medium cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-primary/40",
                                calendarEventColor(ev.status, ev.deadline)
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
                              className={cn(
                                "rounded px-1.5 py-1 text-[10px] cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-primary/40",
                                calendarEventColor(ev.status, ev.deadline)
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

        {/* Upcoming + Previous tasks — Daily Plan style with Start/Done and time logging */}
        <section className="glass-card px-4 pb-4 pt-2 -mt-2">
          <div className="flex justify-center mt-1 -mb-5">
            <button
              type="button"
              onClick={() => setPreviousDaysShown((n) => n + 3)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              Previous tasks
            </button>
          </div>
          <div className="space-y-6">
            {previousDaysShown > 0 && visiblePreviousDates.map((dateStr) => {
              const dayTasks = previousTasksByDate[dateStr] || [];
              if (dayTasks.length === 0) return null;
              return (
                <div
                  key={`prev-${dateStr}`}
                  className="space-y-2 rounded-lg border border-transparent p-2 transition-colors hover:border-border/50 min-h-[60px]"
                  onDrop={(e) => handleDropOnDay(e, dateStr)}
                  onDragOver={handleScheduledDragOver}
                >
                  <div className="mb-2 flex items-center justify-between border-b border-border pb-2 min-h-[24px]">
                    <h4 className="text-sm font-semibold text-muted-foreground">{formatDayLabel(dateStr)}</h4>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {dayTasks.filter((t) => t.status === "complete").length}/{dayTasks.length} done
                    </div>
                  </div>
                  {dayTasks.map((task) => {
                    const overdue = isTaskOverdue(task);
                    const progressPct = getTaskProgress(task);
                    return (
                      <Tooltip key={task.id}>
                        <TooltipTrigger asChild>
                          <div
                            draggable={task.status !== "complete"}
                            onDragStart={(e) => task.status !== "complete" && handleScheduledDragStart(e, task.id)}
                            onDrop={(e) => { e.stopPropagation(); task.status !== "complete" && handleDropOnScheduledTask(e, task.id, dateStr); }}
                            onDragOver={handleScheduledDragOver}
                            onClick={() => openEditPopup(task.id)}
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
                                <p className={cn("font-medium truncate", task.status === "complete" && "line-through text-muted-foreground")}>{task.title}</p>
                                {task.link && (
                                  <a href={task.link} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="shrink-0 text-primary hover:text-primary/80">
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0", priorityColors[task.priority || "medium"])}>{task.priority || "medium"}</span>
                              </div>
                              {(task.status === "active" || task.status === "complete") && (task.startTime || task.endTime) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                  {task.startTime && <span>Started {formatTime(task.startTime)}</span>}
                                  {task.endTime && <span>Ended {formatTime(task.endTime)}</span>}
                                  {task.startTime && task.endTime && <span className="text-primary">{formatDuration(task.endTime - task.startTime)}</span>}
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
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button onClick={(e) => { e.stopPropagation(); updateTask(task.id, { date: "" }); }} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-warning">
                                    <CalendarX className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">Unschedule</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        </TooltipTrigger>
                        {task.description && <TooltipContent side="bottom" className="max-w-xs text-sm whitespace-pre-wrap">{task.description}</TooltipContent>}
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
            {scheduledTasks.length === 0 && previousDaysShown === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No scheduled tasks. Drag tasks from below to the calendar.</p>
            )}
            {visibleScheduledDates.map((dateStr) => {
              const dayTasks = scheduledTasksByDate[dateStr] || [];
              if (dayTasks.length === 0) return null;
              return (
                <div
                  key={dateStr}
                  className="space-y-2 rounded-lg border border-transparent p-2 transition-colors hover:border-border/50 min-h-[60px]"
                  onDrop={(e) => handleDropOnDay(e, dateStr)}
                  onDragOver={handleScheduledDragOver}
                >
                  <div className="mb-2 flex items-center justify-between border-b border-border pb-2 min-h-[24px]">
                    <h4 className="text-sm font-semibold text-muted-foreground">{formatDayLabel(dateStr)}</h4>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {dayTasks.filter((t) => t.status === "complete").length}/{dayTasks.length} done
                    </div>
                  </div>
                  {dayTasks.map((task) => {
                    const overdue = isTaskOverdue(task);
                    const progressPct = getTaskProgress(task);
                    return (
                      <Tooltip key={task.id}>
                        <TooltipTrigger asChild>
                          <div
                            draggable={task.status !== "complete"}
                            onDragStart={(e) => task.status !== "complete" && handleScheduledDragStart(e, task.id)}
                            onDrop={(e) => { e.stopPropagation(); task.status !== "complete" && handleDropOnScheduledTask(e, task.id, dateStr); }}
                            onDragOver={handleScheduledDragOver}
                            onClick={() => openEditPopup(task.id)}
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
                              {(task.status === "active" || task.status === "complete") && (task.startTime || task.endTime) && (
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
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button onClick={(e) => { e.stopPropagation(); updateTask(task.id, { date: "" }); }} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-warning">
                                    <CalendarX className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">Unschedule</TooltipContent>
                              </Tooltip>
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
              );
            })}
            {scheduledDatesOrdered.length > scheduledDaysShown && (
              <button
                onClick={() => setScheduledDaysShown((n) => n + 3)}
                className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                See more (+3 days)
              </button>
            )}
          </div>
        </section>

        {/* Unscheduled Tasks — same card design; drop here to unschedule */}
        <section
          className="glass-card p-4 rounded-lg border border-border transition-colors"
          onDrop={handleDropOnUnscheduled}
          onDragOver={handleScheduledDragOver}
        >
          <h3 className="text-base font-semibold text-foreground mb-3">
            Unscheduled <span className="text-xs text-muted-foreground font-normal ml-1">({unscheduledTasks.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground mb-3">Drag to a day above or to the calendar to schedule. Drop here to unschedule.</p>
          <div className="space-y-2">
            {unscheduledTasks.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">All tasks are scheduled.</p>
            )}
            {unscheduledTasks.slice(0, unscheduledLimit).map((task) => {
              const overdue = isTaskOverdue(task);
              const progressPct = getTaskProgress(task);
              return (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <div
                      draggable={task.status !== "complete"}
                      onDragStart={(e) => task.status !== "complete" && handleScheduledDragStart(e, task.id)}
                      onClick={() => openEditPopup(task.id)}
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
                        {(task.status === "active" || task.status === "complete") && (task.startTime || task.endTime) && (
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
                <button onClick={() => setAbandonedLimit((l) => l + 5)} className="w-full rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                  See more ({abandonedTasks.length - abandonedLimit} remaining)
                </button>
              )}
            </div>
          </section>
        )}

        {/* Day popup */}
        {selectedDay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedDay(null)}>
            <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-5 space-y-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  {new Date(selectedDay + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </h3>
                <button onClick={() => setSelectedDay(null)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedDayTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No tasks on this day</p>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {selectedDayTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => { setSelectedDay(null); openEditPopup(task.id); }}
                      className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 cursor-pointer hover:border-primary/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{task.title}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[task.priority])}>{task.priority}</span>
                          {task.estimatedTime && <span className="text-[10px] text-muted-foreground">Est: {formatEstimated(task.estimatedTime)}</span>}
                        </div>
                        {task.description && <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>}
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                          {task.deadline && <span className="font-mono">Deadline: {task.deadline}</span>}
                          <span className="capitalize">Status: {task.status}</span>
                          {task.link && <a href={task.link} target="_blank" rel="noopener" className="flex items-center gap-0.5 text-primary hover:underline" onClick={(e) => e.stopPropagation()}><ExternalLink className="h-3 w-3" />Link</a>}
                        </div>
                      </div>
                    </div>
                  ))}
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
