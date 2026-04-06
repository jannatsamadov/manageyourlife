import { useState, useEffect, useCallback } from "react";
import { Inbox, Check, X, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useAppState } from "@/context/AppContext";
import { toast } from "@/hooks/use-toast";

interface ShareRow {
  id: string;
  task_id: string;
  sender_id: string;
  recipient_email: string;
  status: string;
  created_at: string;
  task_title?: string;
  sender_email?: string;
}

export default function IncomingShares() {
  const { user } = useAuth();
  const { addTask } = useAppState();
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    if (!user?.email) return;
    setLoading(true);

    // Get pending shares for this email
    const { data, error } = await (supabase
      .from("task_shares" as any)
      .select("*")
      .eq("recipient_email", user.email.toLowerCase())
      .eq("status", "pending")
      .order("created_at", { ascending: false }) as any);

    if (error || !data) {
      setLoading(false);
      return;
    }

    const rows = data as any[];
    if (rows.length === 0) {
      setShares([]);
      setLoading(false);
      return;
    }

    // Fetch task titles
    const taskIds = rows.map((r: any) => r.task_id);
    const { data: tasksData } = await (supabase
      .from("tasks")
      .select("id, title")
      .in("id", taskIds) as any);

    const taskMap: Record<string, string> = {};
    (tasksData || []).forEach((t: any) => { taskMap[t.id] = t.title; });

    setShares(rows.map((r: any) => ({
      ...r,
      task_title: taskMap[r.task_id] || "Unknown Task",
    })));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchShares(); }, [fetchShares]);

  // Poll every 30s for new shares
  useEffect(() => {
    const interval = setInterval(fetchShares, 30000);
    return () => clearInterval(interval);
  }, [fetchShares]);

  const acceptShare = async (share: ShareRow) => {
    if (!user) return;
    setAccepting(share.id);

    // Fetch the original task details
    const { data: taskData } = await (supabase
      .from("tasks")
      .select("*")
      .eq("id", share.task_id)
      .single() as any);

    if (!taskData) {
      toast({ title: "Task tapılmadı", variant: "destructive" });
      setAccepting(null);
      return;
    }

    const t = taskData as any;

    // Create a copy for the recipient
    await addTask({
      title: t.title,
      description: t.description || "",
      estimatedTime: t.estimated_time,
      status: "idle",
      startTime: null,
      endTime: null,
      date: t.date || "",
      deadline: t.deadline || "",
      position: 0,
      link: t.link || "",
      priority: t.priority || "medium",
    });

    // Mark share as accepted
    await (supabase
      .from("task_shares" as any)
      .update({ status: "accepted", recipient_id: user.id } as any)
      .eq("id", share.id) as any);

    setShares((prev) => prev.filter((s) => s.id !== share.id));
    setAccepting(null);
    toast({ title: "Task qəbul edildi!" });
  };

  const rejectShare = async (shareId: string) => {
    await (supabase
      .from("task_shares" as any)
      .update({ status: "rejected", recipient_id: user?.id } as any)
      .eq("id", shareId) as any);

    setShares((prev) => prev.filter((s) => s.id !== shareId));
    toast({ title: "Task rədd edildi" });
  };

  const pendingCount = shares.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Inbox className="h-4 w-4" />
          {pendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground animate-pulse">
              {pendingCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">Gələn Tasklar</h4>
          <p className="text-xs text-muted-foreground">Sizə göndərilmiş tasklar</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">Gələn task yoxdur</p>
          ) : (
            shares.map((share) => (
              <div key={share.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{share.task_title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {share.recipient_email !== user?.email ? share.recipient_email : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => acceptShare(share)}
                    disabled={accepting === share.id}
                    className="rounded-md p-1.5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    title="Qəbul et"
                  >
                    {accepting === share.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => rejectShare(share.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Rədd et"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
