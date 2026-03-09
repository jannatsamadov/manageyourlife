import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { X, Save, AlertTriangle, Trash2, Plus, CheckSquare } from "lucide-react";
import { Task, TaskPriority, useAppState } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  position: number;
}

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

interface TaskEditPopupProps {
  task: Task;
  onClose: () => void;
}

export default function TaskEditPopup({ task, onClose }: TaskEditPopupProps) {
  const { tasks, updateTask } = useAppState();
  const { user } = useAuth();
  const popupRef = useRef<HTMLDivElement>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");

  const [editForm, setEditForm] = useState<EditForm>({
    title: task.title,
    description: task.description,
    estimatedTime: task.estimatedTime ? String(task.estimatedTime) : "",
    date: task.date || "",
    deadline: task.deadline || "",
    link: task.link || "",
    priority: task.priority || "medium",
    status: task.status,
  });

  // Fetch subtasks
  useEffect(() => {
    const fetchSubtasks = async () => {
      const { data } = await (supabase
        .from("subtasks" as any)
        .select("*")
        .eq("parent_task_id", task.id)
        .order("position", { ascending: true }) as any);
      if (data) setSubtasks(data.map((s: any) => ({ id: s.id, title: s.title, completed: s.completed, position: s.position })));
    };
    fetchSubtasks();
  }, [task.id]);

  // Conflict detection
  const conflict = useMemo(() => {
    if (!editForm.date) return null;
    const otherTasks = tasks.filter(
      (t) => t.date === editForm.date && t.id !== task.id && t.status !== "abandoned" && t.status !== "complete"
    );
    const totalMins = otherTasks.reduce((sum, t) => sum + (t.estimatedTime || 0), 0);
    const thisMins = editForm.estimatedTime ? parseInt(editForm.estimatedTime) || 0 : 0;
    const combined = totalMins + thisMins;
    if (combined > 480) {
      return `${Math.round(combined / 60 * 10) / 10}h scheduled (exceeds 8h limit)`;
    }
    return null;
  }, [editForm.date, editForm.estimatedTime, tasks, task.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const toggleSubtask = useCallback(async (id: string, completed: boolean) => {
    await (supabase.from("subtasks" as any).update({ completed } as any).eq("id", id) as any);
    setSubtasks((prev) => prev.map((s) => s.id === id ? { ...s, completed } : s));
  }, []);

  const deleteSubtask = useCallback(async (id: string) => {
    await (supabase.from("subtasks" as any).delete().eq("id", id) as any);
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const addSubtask = useCallback(async () => {
    if (!newSubtask.trim() || !user) return;
    const { data } = await (supabase.from("subtasks" as any).insert({
      user_id: user.id,
      parent_task_id: task.id,
      title: newSubtask.trim(),
      completed: false,
      position: subtasks.length,
    } as any).select().single() as any);
    if (data) {
      setSubtasks((prev) => [...prev, { id: data.id, title: data.title, completed: data.completed, position: data.position }]);
      setNewSubtask("");
    }
  }, [newSubtask, user, task.id, subtasks.length]);

  const saveEdit = async () => {
    const updates: Partial<Task> = {};
    if (editForm.title.trim() && editForm.title !== task.title) updates.title = editForm.title.trim();
    if (editForm.description !== task.description) updates.description = editForm.description;
    const newEst = editForm.estimatedTime ? parseInt(editForm.estimatedTime) : null;
    if (newEst !== task.estimatedTime) updates.estimatedTime = newEst;
    if (editForm.date !== (task.date || "")) updates.date = editForm.date;
    if (editForm.deadline !== (task.deadline || "")) updates.deadline = editForm.deadline;
    if (editForm.link !== (task.link || "")) updates.link = editForm.link;
    if (editForm.priority !== (task.priority || "medium")) updates.priority = editForm.priority;
    if (editForm.status !== task.status) {
      updates.status = editForm.status;
      if (editForm.status === "active" && task.status === "idle") updates.startTime = Date.now();
      if (editForm.status === "complete" && task.status !== "complete") updates.endTime = Date.now();
    }
    if (Object.keys(updates).length > 0) {
      await updateTask(task.id, updates);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={popupRef}
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-foreground">Edit Task</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[75vh] overflow-y-auto chat-scroll">
          <input
            value={editForm.title}
            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            placeholder="Title"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            placeholder="Description"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Scheduled Date</label>
              <input
                type="date"
                value={editForm.date}
                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
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

          {/* Conflict warning */}
          {conflict && (
            <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Conflict detected: {conflict}</span>
            </div>
          )}

          {/* Subtasks Section */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtasks</span>
              {subtasks.length > 0 && (
                <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                  {subtasks.filter(s => s.completed).length}/{subtasks.length}
                </span>
              )}
            </div>
            {subtasks.map((st) => (
              <div key={st.id} className="flex items-center gap-2 py-1 group">
                <input
                  type="checkbox"
                  checked={st.completed}
                  onChange={() => toggleSubtask(st.id, !st.completed)}
                  className="accent-primary h-3.5 w-3.5 shrink-0"
                />
                <span className={cn("text-sm flex-1", st.completed && "line-through text-muted-foreground")}>{st.title}</span>
                <button
                  onClick={() => deleteSubtask(st.id)}
                  className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="Add subtask..."
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button onClick={addSubtask} className="rounded p-1 text-muted-foreground hover:text-primary">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Time info */}
          {task.startTime && (
            <div className="text-xs text-muted-foreground font-mono space-y-0.5 pt-1 border-t border-border">
              <p>Started: {new Date(task.startTime).toLocaleString()}</p>
              {task.endTime && <p>Ended: {new Date(task.endTime).toLocaleString()}</p>}
              {task.startTime && task.endTime && (
                <p className="text-primary">Duration: {formatDuration(task.endTime - task.startTime)}</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
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
  );
}
