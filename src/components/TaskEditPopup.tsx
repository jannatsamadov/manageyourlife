import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { X, Save, AlertTriangle, Trash2, Plus, CheckSquare, FileText } from "lucide-react";
import { Task, TaskPriority, useTasks } from "@/core/tasks";
import TimingFields from "@/components/TimingFields";
import { useItemActions, useItems } from "@/core/items";
import { type NoteTodo, useNoteLinkActions, useNoteTodos } from "@/core/notes";
import { cn } from "@/lib/utils";
import { useStrategyNodes } from "@/core/strategy";
import { buildForest, pickList } from "@/lib/strategy";

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
  note_id: string | null;
  note_title?: string;
}

interface EditForm {
  title: string;
  description: string;
  estimatedTime: string;
  date: string;
  deadline: string;
  isEvent: boolean;
  time: string;
  deadlineTime: string;
  link: string;
  priority: TaskPriority;
  status: Task["status"];
  nodeId: string;
}

interface TaskEditPopupProps {
  task: Task;
  onClose: () => void;
}

export default function TaskEditPopup({ task, onClose }: TaskEditPopupProps) {
  const { tasks, updateTask } = useTasks();
  const popupRef = useRef<HTMLDivElement>(null);
  const [newSubtask, setNewSubtask] = useState("");

  const [editForm, setEditForm] = useState<EditForm>({
    title: task.title,
    description: task.description,
    estimatedTime: task.estimatedTime ? String(task.estimatedTime) : "",
    date: task.date || "",
    deadline: task.deadline || "",
    isEvent: !!task.isEvent,
    time: task.time || "",
    deadlineTime: task.deadlineTime || "",
    link: task.link || "",
    priority: task.priority || "medium",
    status: task.status,
    nodeId: task.nodeId ?? "",
  });
  // Which goal / mission / step this task serves (Strategy page).
  const { data: strategyNodes } = useStrategyNodes();
  const strategyRoots = useMemo(() => buildForest(strategyNodes ?? [], []).roots, [strategyNodes]);

  // Its steps (task items inside it) and the to-dos of its linked notes (read from the files; ticking one ticks the
  // line in the note).
  const items = useItems();
  const { create, update, remove } = useItemActions();
  const noteTodos = useNoteTodos(task.id);
  const { toggleTodo } = useNoteLinkActions();
  const steps = useMemo<Subtask[]>(() => (items.data ?? [])
    .filter((i) => i.parent_id === task.id && i.type === "task" && !i.deleted_at)
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ id: i.id, title: i.title, completed: i.status === "done", position: i.position, note_id: null })), [items.data, task.id]);
  const subtasks = useMemo<Subtask[]>(() => [...(noteTodos.data ?? []), ...steps], [noteTodos.data, steps]);

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
    const todo = noteTodos.data?.find((t) => t.id === id);
    if (todo) return toggleTodo(todo as NoteTodo, completed, task.id);
    await update(id, { status: completed ? "done" : "todo" });
  }, [noteTodos.data, toggleTodo, update, task.id]);

  // A note's to-dos are changed in the note; only the task's own steps are deleted here.
  const deleteSubtask = useCallback(async (id: string) => {
    if (steps.some((s) => s.id === id)) await remove([id]);
  }, [steps, remove]);

  const addSubtask = useCallback(async () => {
    if (!newSubtask.trim()) return;
    if (await create({ type: "task", parent_id: task.id, title: newSubtask.trim(), position: steps.length })) setNewSubtask("");
  }, [newSubtask, create, task.id, steps.length]);

  const saveEdit = async () => {
    const updates: Partial<Task> = {};
    if (editForm.title.trim() && editForm.title !== task.title) updates.title = editForm.title.trim();
    if (editForm.description !== task.description) updates.description = editForm.description;
    const newEst = editForm.estimatedTime ? parseInt(editForm.estimatedTime) : null;
    if (newEst !== task.estimatedTime) updates.estimatedTime = newEst;
    if (editForm.date !== (task.date || "")) updates.date = editForm.date;
    if (editForm.deadline !== (task.deadline || "")) updates.deadline = editForm.deadline;
    if (editForm.isEvent !== !!task.isEvent) updates.isEvent = editForm.isEvent;
    if (editForm.time !== (task.time || "")) updates.time = editForm.time || null;
    if (editForm.deadlineTime !== (task.deadlineTime || "")) updates.deadlineTime = editForm.deadlineTime || null;
    if (editForm.link !== (task.link || "")) updates.link = editForm.link;
    if (editForm.priority !== (task.priority || "medium")) updates.priority = editForm.priority;
    if (editForm.nodeId !== (task.nodeId ?? "")) updates.nodeId = editForm.nodeId || null;
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

  // Group subtasks: note-sourced vs manual
  const noteSubtasks = subtasks.filter(s => s.note_id);
  const manualSubtasks = subtasks.filter(s => !s.note_id);

  // Group note subtasks by note
  const noteGroups = useMemo(() => {
    const groups: Record<string, { noteTitle: string; items: Subtask[] }> = {};
    noteSubtasks.forEach(s => {
      const nid = s.note_id!;
      if (!groups[nid]) groups[nid] = { noteTitle: s.note_title || "Untitled Note", items: [] };
      groups[nid].items.push(s);
    });
    return groups;
  }, [noteSubtasks]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={popupRef}
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-foreground">Edit Task</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
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
          {/* When it happens (P-60): event / deadline / planned, and only that kind's fields. */}
          <TimingFields value={editForm} onChange={(v) => setEditForm({ ...editForm, ...v })} />
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Strategy</label>
              <select
                value={editForm.nodeId}
                onChange={(e) => setEditForm({ ...editForm, nodeId: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">—</option>
                {strategyRoots.map((root) => root.kind === "area" ? (
                  <optgroup key={root.node.id} label={root.node.title}>
                    {pickList(root).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </optgroup>
                ) : (
                  pickList(root).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)
                ))}
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

            {/* Note-sourced subtasks grouped by note */}
            {Object.entries(noteGroups).map(([noteId, group]) => (
              <div key={noteId} className="mb-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText className="h-3 w-3 text-info" />
                  <span className="text-[10px] font-medium text-info truncate">{group.noteTitle}</span>
                </div>
                {group.items.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 py-1 pl-4 group">
                    <input
                      type="checkbox"
                      checked={st.completed}
                      onChange={() => toggleSubtask(st.id, !st.completed)}
                      className="accent-primary h-3.5 w-3.5 shrink-0"
                    />
                    <span className={cn("text-sm flex-1", st.completed && "line-through text-muted-foreground")}>{st.title}</span>
                    <span className="text-[9px] text-muted-foreground/50 italic shrink-0">synced</span>
                  </div>
                ))}
              </div>
            ))}

            {/* Manual subtasks */}
            {manualSubtasks.map((st) => (
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
