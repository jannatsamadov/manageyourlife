import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { X, Save, AlertTriangle, Trash2, Plus, CheckSquare, FileText, Send } from "lucide-react";
import { Task, TaskPriority, useAppState } from "@/context/AppContext";
import ShareTaskDialog from "@/components/ShareTaskDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { useStrategyNodes } from "@/hooks/useStrategy";
import { buildForest, pickList } from "@/lib/strategy";
import { vault } from "@/lib/vault";

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
  const { tasks, updateTask } = useAppState();
  const { user } = useAuth();
  const popupRef = useRef<HTMLDivElement>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  const [editForm, setEditForm] = useState<EditForm>({
    title: task.title,
    description: task.description,
    estimatedTime: task.estimatedTime ? String(task.estimatedTime) : "",
    date: task.date || "",
    deadline: task.deadline || "",
    link: task.link || "",
    priority: task.priority || "medium",
    status: task.status,
    nodeId: task.nodeId ?? "",
  });
  // Which goal / mission / step this task serves (Strategy page).
  const { data: strategyNodes } = useStrategyNodes();
  const strategyRoots = useMemo(() => buildForest(strategyNodes ?? [], []).roots, [strategyNodes]);

  // Fetch subtasks with note titles
  useEffect(() => {
    const fetchSubtasks = async () => {
      const { data } = await (supabase
        .from("subtasks" as any)
        .select("*")
        .eq("parent_task_id", task.id)
        .order("position", { ascending: true }) as any);
      if (!data) return;

      const items = data as any[];
      // Get unique note IDs to fetch titles
      const noteIds = [...new Set(items.filter(s => s.note_id).map(s => s.note_id))];
      let noteTitles: Record<string, string> = {};
      if (noteIds.length > 0) {
        // Notes are vault files (P-57); the id survives renames.
        const { data: notes } = await supabase
          .from("vault_files")
          .select("id, title")
          .in("id", noteIds as string[]);
        if (notes) {
          (notes as any[]).forEach(n => { noteTitles[n.id] = n.title; });
        }
      }

      setSubtasks(items.map((s: any) => ({
        id: s.id,
        title: s.title,
        completed: s.completed,
        position: s.position,
        note_id: s.note_id || null,
        note_title: s.note_id ? (noteTitles[s.note_id] || "Untitled Note") : undefined,
      })));
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

  // Toggle subtask - two-way sync for note-sourced subtasks
  const toggleSubtask = useCallback(async (id: string, completed: boolean) => {
    const subtask = subtasks.find(s => s.id === id);
    if (!subtask) return;

    // Update subtask in DB
    await (supabase.from("subtasks" as any).update({ completed } as any).eq("id", id) as any);
    setSubtasks((prev) => prev.map((s) => s.id === id ? { ...s, completed } : s));

    // Two-way sync: the same "- [ ]" line in the note file is ticked (server side, version-checked).
    if (subtask.note_id) {
      await vault("toggle_todo", { note_id: subtask.note_id, title: subtask.title, completed }).catch(() => {});
    }
  }, [subtasks]);

  // Delete subtask - only for non-note-sourced subtasks
  const deleteSubtask = useCallback(async (id: string) => {
    const subtask = subtasks.find(s => s.id === id);
    if (!subtask) return;

    // Note-sourced subtasks can't be deleted from task view (one-way: note controls structure)
    if (subtask.note_id) return;

    await (supabase.from("subtasks" as any).delete().eq("id", id) as any);
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  }, [subtasks]);

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
      setSubtasks((prev) => [...prev, { id: data.id, title: data.title, completed: data.completed, position: data.position, note_id: null }]);
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
            <button onClick={() => setShareOpen(true)} className="text-muted-foreground hover:text-primary shrink-0" title="Göndər">
              <Send className="h-4 w-4" />
            </button>
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
      <ShareTaskDialog task={task} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}
