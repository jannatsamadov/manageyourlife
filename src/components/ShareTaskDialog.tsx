import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import type { Task } from "@/context/AppContext";

interface ShareTaskDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ShareTaskDialog({ task, open, onOpenChange }: ShareTaskDialogProps) {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!user || !email.trim()) return;
    if (email.trim().toLowerCase() === user.email?.toLowerCase()) {
      toast({ title: "Özünüzə göndərə bilməzsiniz", variant: "destructive" });
      return;
    }

    setSending(true);
    const { error } = await (supabase.from("task_shares" as any).insert({
      task_id: task.id,
      sender_id: user.id,
      recipient_email: email.trim().toLowerCase(),
      status: "pending",
    } as any) as any);

    setSending(false);

    if (error) {
      toast({ title: "Göndərilmədi", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Task göndərildi!", description: `${email} ünvanına göndərildi` });
      setEmail("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Task Göndər</DialogTitle>
          <DialogDescription>
            Bu taskın surətini başqa istifadəçiyə göndərin
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
            {task.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Alıcının email-i</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="user@example.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!email.trim() || sending}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Göndər
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
