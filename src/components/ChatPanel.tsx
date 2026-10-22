import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAppState } from "@/context/AppContext";
import { getSettings } from "@/lib/settings";
import { toast } from "@/hooks/use-toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hey! I'm your personal assistant. Paste a link, describe a task, or tell me about an opportunity — I'll add it to your board automatically." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  const { setTasks } = useAppState();

  const refreshData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const tasksRes = await supabase.from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
    if (tasksRes.data) {
      setTasks(tasksRes.data.map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        estimatedTime: row.estimated_time,
        status: row.status as "idle" | "active" | "complete",
        startTime: row.actual_start ? new Date(row.actual_start).getTime() : null,
        endTime: row.actual_end ? new Date(row.actual_end).getTime() : null,
        date: row.date,
        deadline: row.deadline ?? "",
        position: row.position ?? 0,
        link: row.link ?? "",
        priority: (row.priority as "high" | "medium" | "low") ?? "medium",
      })));
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || fabRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const history = messages.filter(m => m.role !== "assistant" || messages.indexOf(m) !== 0);

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ message: text, history, model: getSettings().aiModel, today: format(new Date(), "yyyy-MM-dd") }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);

      if (data.action === "task_created" || data.action === "tasks_created") {
        await refreshData();
        toast({
          title: data.action === "tasks_created" ? "Tasks Created" : "Task Created",
          description: data.reply,
        });
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Sorry, something went wrong: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        ref={fabRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300",
          open
            ? "bg-muted text-muted-foreground rotate-90"
            : "bg-primary text-primary-foreground hover:scale-105"
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-24 right-6 z-50 flex w-80 sm:w-96 flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
          style={{ height: "min(500px, 70vh)" }}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
              <MessageCircle className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground">AI Assistant</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 chat-scroll" ref={scrollRef}>
            <div className="flex flex-col gap-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-secondary text-secondary-foreground"
                  )}
                >
                  {msg.content}
                </div>
              ))}
              {loading && (
                <div className="self-start flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  AI is thinking…
                </div>
              )}
            </div>
          </div>

          <div className="flex items-end gap-2 border-t border-border px-3 py-2.5">
            <label className="flex cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground transition-colors pb-2">
              <Plus className="h-5 w-5" />
              <input type="file" className="hidden" />
            </label>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Message... (Shift+Enter for new line)"
              rows={1}
              className="flex-1 min-h-[36px] max-h-40 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground py-2"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="flex items-center justify-center text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 pb-2"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
