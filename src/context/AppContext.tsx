import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { queueCalendarSync } from "@/lib/gcal";

export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  description: string;
  estimatedTime: number | null;
  status: "idle" | "active" | "complete" | "abandoned";
  startTime: number | null;
  endTime: number | null;
  date: string;
  deadline: string;
  position: number;
  link: string;
  priority: TaskPriority;
  // Optional soft-delete timestamp
  deletedAt?: string | null;
}

export interface Goal {
  id: string;
  title: string;
  checkpoints: Checkpoint[];
}

export interface Checkpoint {
  id: string;
  title: string;
  completed: boolean;
  month: string;
}

export interface StrategyData {
  vision: string;
  mission: string;
  goals: Goal[];
}

export interface Opportunity {
  id: string;
  name: string;
  description: string;
  estimatedTime: number | null;
  deadline: string;
  link: string;
  priority: "high" | "medium" | "low";
}

interface AppState {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  strategy: StrategyData;
  setStrategy: React.Dispatch<React.SetStateAction<StrategyData>>;
  opportunities: Opportunity[];
  setOpportunities: React.Dispatch<React.SetStateAction<Opportunity[]>>;
  loading: boolean;
  addTask: (task: Omit<Task, "id"> & Partial<Pick<Task, "link" | "priority">>) => Promise<Task | undefined>;
  deleteTask: (id: string) => Promise<void>;
  permanentDeleteTask: (id: string) => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  addOpportunity: (opp: Omit<Opportunity, "id">) => Promise<void>;
  updateOpportunity: (id: string, updates: Partial<Opportunity>) => Promise<void>;
  deleteOpportunity: (id: string) => Promise<void>;
  reorderTasks: (date: string, taskIds: string[]) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

const defaultStrategy: StrategyData = {
  vision: "Build a life of purposeful impact and financial freedom",
  mission: "Execute daily with discipline, learn continuously, and create value for others",
  goals: [
    {
      id: "g1",
      title: "Launch Personal Brand",
      checkpoints: [
        { id: "c1", title: "Define niche & audience", completed: true, month: "2026-01" },
        { id: "c2", title: "Create content strategy", completed: true, month: "2026-02" },
        { id: "c3", title: "Publish 30 pieces of content", completed: false, month: "2026-03" },
        { id: "c4", title: "Reach 1K followers", completed: false, month: "2026-04" },
      ],
    },
    {
      id: "g2",
      title: "Master Full-Stack Development",
      checkpoints: [
        { id: "c5", title: "Complete React advanced course", completed: true, month: "2026-01" },
        { id: "c6", title: "Build 3 portfolio projects", completed: false, month: "2026-02" },
        { id: "c7", title: "Contribute to open source", completed: false, month: "2026-03" },
      ],
    },
    {
      id: "g3",
      title: "Financial Independence",
      checkpoints: [
        { id: "c8", title: "Set up emergency fund", completed: true, month: "2026-01" },
        { id: "c9", title: "Start investment portfolio", completed: false, month: "2026-02" },
        { id: "c10", title: "Generate first side income", completed: false, month: "2026-03" },
      ],
    },
  ],
};

function dbTaskToLocal(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    estimatedTime: row.estimated_time,
    status: row.status as Task["status"],
    startTime: row.actual_start ? new Date(row.actual_start).getTime() : null,
    endTime: row.actual_end ? new Date(row.actual_end).getTime() : null,
    date: row.date,
    deadline: row.deadline ?? "",
    position: row.position ?? 0,
    link: row.link ?? "",
    priority: (row.priority as TaskPriority) ?? "medium",
    deletedAt: row.deleted_at ?? null,
  };
}

function dbOppToLocal(row: any): Opportunity {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    estimatedTime: row.estimated_time,
    deadline: row.deadline,
    link: row.link || "",
    priority: row.priority as Opportunity["priority"],
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [strategy, setStrategy] = useState<StrategyData>(defaultStrategy);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data on login
  useEffect(() => {
    if (!user) {
      setTasks([]);
      setOpportunities([]);
      setLoading(false);
      return;
    }

    const fetchAll = async () => {
      setLoading(true);
      const [tasksRes, oppsRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .eq("user_id", user.id)
          .is("deleted_at", null)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase.from("opportunities").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
      ]);

      if (tasksRes.error) {
        toast({ title: "Failed to load tasks", description: tasksRes.error.message, variant: "destructive" });
      } else {
        setTasks((tasksRes.data || []).map(dbTaskToLocal));
      }

      if (oppsRes.error) {
        toast({ title: "Failed to load opportunities", description: oppsRes.error.message, variant: "destructive" });
      } else {
        setOpportunities((oppsRes.data || []).map(dbOppToLocal));
      }

      setLoading(false);
    };

    fetchAll();
  }, [user]);

  const addTask = useCallback(async (task: Omit<Task, "id"> & Partial<Pick<Task, "link" | "priority">>) => {
    if (!user) return;
    const { data, error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title: task.title,
      description: task.description,
      estimated_time: task.estimatedTime,
      status: task.status,
      actual_start: task.startTime ? new Date(task.startTime).toISOString() : null,
      actual_end: task.endTime ? new Date(task.endTime).toISOString() : null,
      date: task.date || null,
      deadline: task.deadline || "",
      link: task.link ?? "",
      priority: task.priority ?? "medium",
      deleted_at: null,
    } as any).select().single();

    if (error) {
      toast({ title: "Failed to save task", description: error.message, variant: "destructive" });
    } else if (data) {
      const saved = dbTaskToLocal(data);
      setTasks((prev) => [...prev, saved]);
      if (saved.date) queueCalendarSync(saved.id);
      return saved;
    }
  }, [user]);

  const deleteTask = useCallback(async (id: string) => {
    const { error } = await supabase.from("tasks").update({ status: "abandoned" }).eq("id", id);
    if (error) {
      toast({ title: "Failed to abandon task", description: error.message, variant: "destructive" });
    } else {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "abandoned" as const } : t));
      queueCalendarSync(id);
    }
  }, []);

  const permanentDeleteTask = useCallback(async (id: string) => {
    const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    if (error) {
      toast({ title: "Failed to move to trash", description: error.message, variant: "destructive" });
    } else {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      queueCalendarSync(id);
    }
  }, []);

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const dbUpdates: any = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.startTime !== undefined) dbUpdates.actual_start = updates.startTime ? new Date(updates.startTime).toISOString() : null;
    if (updates.endTime !== undefined) dbUpdates.actual_end = updates.endTime ? new Date(updates.endTime).toISOString() : null;
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.estimatedTime !== undefined) dbUpdates.estimated_time = updates.estimatedTime;
    if (updates.date !== undefined) dbUpdates.date = updates.date || null;
    if (updates.deadline !== undefined) dbUpdates.deadline = updates.deadline || "";
    if (updates.position !== undefined) dbUpdates.position = updates.position;
    if (updates.link !== undefined) dbUpdates.link = updates.link;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;

    const { error } = await supabase.from("tasks").update(dbUpdates).eq("id", id);
    if (error) {
      toast({ title: "Failed to update task", description: error.message, variant: "destructive" });
    } else {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
      queueCalendarSync(id);
    }
  }, []);

  const addOpportunity = useCallback(async (opp: Omit<Opportunity, "id">) => {
    if (!user) return;
    const { data, error } = await supabase.from("opportunities").insert({
      user_id: user.id,
      name: opp.name,
      description: opp.description,
      estimated_time: opp.estimatedTime,
      deadline: opp.deadline,
      link: opp.link,
      priority: opp.priority,
    } as any).select().single();

    if (error) {
      toast({ title: "Failed to save opportunity", description: error.message, variant: "destructive" });
    } else if (data) {
      setOpportunities((prev) => [...prev, dbOppToLocal(data)]);
    }
  }, [user]);

  const updateOpportunity = useCallback(async (id: string, updates: Partial<Opportunity>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.estimatedTime !== undefined) dbUpdates.estimated_time = updates.estimatedTime;
    if (updates.deadline !== undefined) dbUpdates.deadline = updates.deadline;
    if (updates.link !== undefined) dbUpdates.link = updates.link;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;

    const { error } = await supabase.from("opportunities").update(dbUpdates).eq("id", id);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    } else {
      setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, ...updates } : o)));
    }
  }, []);

  const reorderTasks = useCallback(async (date: string, taskIds: string[]) => {
    for (let i = 0; i < taskIds.length; i++) {
      const { error } = await supabase.from("tasks").update({ position: i }).eq("id", taskIds[i]);
      if (error) {
        toast({ title: "Failed to reorder", description: error.message, variant: "destructive" });
        return;
      }
    }
    setTasks((prev) =>
      prev.map((t) => {
        const idx = taskIds.indexOf(t.id);
        if (idx >= 0 && t.date === date) return { ...t, position: idx };
        return t;
      }).sort((a, b) => {
        if (a.date !== b.date) return (a.date || "").localeCompare(b.date || "");
        return (a.position ?? 0) - (b.position ?? 0);
      })
    );
  }, []);

  const deleteOpportunity = useCallback(async (id: string) => {
    const { error } = await supabase.from("opportunities").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete opportunity", description: error.message, variant: "destructive" });
    } else {
      setOpportunities((prev) => prev.filter((o) => o.id !== id));
    }
  }, []);

  return (
    <AppContext.Provider value={{ tasks, setTasks, strategy, setStrategy, opportunities, setOpportunities, loading, addTask, deleteTask, permanentDeleteTask, updateTask, addOpportunity, updateOpportunity, deleteOpportunity, reorderTasks }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
