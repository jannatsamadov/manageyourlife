import { useEffect, useState } from "react";
import { Inbox as InboxIcon, Loader2, ListTodo, StickyNote, Trash2, ExternalLink, Paperclip, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useAppState } from "@/context/AppContext";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type InboxItem = Tables<"inbox_items">;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Typed here",
  telegram: "Telegram",
  google_tasks: "Google Tasks",
  obsidian: "Obsidian",
  files: "Files",
  mcp: "MCP",
};

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

// Plain text with clickable links (rendered as React nodes, never as HTML).
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

const metaOf = (item: InboxItem) => (item.meta ?? {}) as { links?: string[]; forwarded_from?: string | null };
const attachmentsOf = (item: InboxItem) => (Array.isArray(item.attachments) ? item.attachments : []) as { type?: string; file_name?: string | null }[];

// First line → title; the full text stays in the body.
function splitTitle(content: string, max: number) {
  const first = content.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const title = first.length > max ? first.slice(0, max - 1).trimEnd() + "…" : first;
  return { title, rest: first.length > max ? content.trim() : content.trim().slice(first.length).trim() };
}

function firstLink(item: InboxItem) {
  return item.source_url || metaOf(item).links?.[0] || item.content.match(URL_RE)?.[0] || "";
}

export default function Inbox() {
  const { user } = useAuth();
  const { addTask } = useAppState();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("inbox_items")
        .select("*")
        .is("sorted_at", null)
        .order("created_at", { ascending: false });
      if (error) toast({ title: "Failed to load the Inbox", description: error.message, variant: "destructive" });
      else setItems(data);
      setLoading(false);
    })();
  }, [user]);

  const capture = async () => {
    const content = draft.trim();
    if (!user || !content) return;
    const { data, error } = await supabase
      .from("inbox_items")
      .insert({ user_id: user.id, source: "manual", content })
      .select()
      .single();
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      return;
    }
    setItems((prev) => [data, ...prev]);
    setDraft("");
  };

  const markSorted = async (item: InboxItem, resultType: "task" | "note", resultId: string) => {
    const { error } = await supabase
      .from("inbox_items")
      .update({ sorted_at: new Date().toISOString(), result_type: resultType, result_id: resultId })
      .eq("id", item.id);
    if (error) throw error;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  const toTask = async (item: InboxItem) => {
    setBusy(item.id);
    try {
      const { title, rest } = splitTitle(item.content, 120);
      const kind = attachmentsOf(item)[0]?.type;
      const task = await addTask({
        title: title || (kind ? `Telegram ${kind}` : "Inbox item"),
        description: rest,
        estimatedTime: null,
        status: "idle",
        startTime: null,
        endTime: null,
        date: "",
        deadline: "",
        position: 0,
        link: firstLink(item),
        priority: "medium",
      });
      if (!task) return;
      await markSorted(item, "task", task.id);
      toast({ title: "Moved to tasks", description: task.title });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const toNote = async (item: InboxItem) => {
    if (!user) return;
    setBusy(item.id);
    try {
      const { title } = splitTitle(item.content, 80);
      const source = item.source_url ? `\n\nSource: ${item.source_url}` : "";
      const { data, error } = await supabase
        .from("notes")
        .insert({ user_id: user.id, title: title || "Inbox note", content: item.content.trim() + source })
        .select("id, title")
        .single();
      if (error) throw error;
      await markSorted(item, "note", data.id);
      toast({ title: "Moved to notes", description: data.title });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // Kept as a sorted "deleted" row, so a re-import (Google Tasks) does not bring it back.
  const remove = async (item: InboxItem) => {
    const { error } = await supabase
      .from("inbox_items")
      .update({ sorted_at: new Date().toISOString(), result_type: "deleted", result_id: null })
      .eq("id", item.id);
    if (error) {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({
      title: "Deleted",
      action: (
        <ToastAction
          altText="Undo"
          onClick={async () => {
            const { error: undoError } = await supabase
              .from("inbox_items")
              .update({ sorted_at: null, result_type: null })
              .eq("id", item.id);
            if (undoError) toast({ title: "Undo failed", description: undoError.message, variant: "destructive" });
            else setItems((prev) => [item, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at)));
          }}
        >
          Undo
        </ToastAction>
      ),
    });
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <InboxIcon className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">Inbox</h1>
        {!loading && <span className="text-xs text-muted-foreground">({items.length})</span>}
      </div>

      <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              capture();
            }
          }}
          rows={1}
          placeholder="Capture a thought… (Enter to save)"
          className="flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          onClick={capture}
          disabled={!draft.trim()}
          className="pb-1.5 text-muted-foreground hover:text-primary disabled:opacity-40"
          aria-label="Save to Inbox"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 px-4 text-center text-sm text-muted-foreground">
          Inbox is empty.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const meta = metaOf(item);
            const files = attachmentsOf(item);
            return (
              <div key={item.id} className="glass-card space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">{SOURCE_LABELS[item.source] ?? item.source}</span>
                  <span>
                    {new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {meta.forwarded_from && <span>· from {meta.forwarded_from}</span>}
                  {item.source_url && (
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                      <ExternalLink className="h-3 w-3" />
                      original
                    </a>
                  )}
                </div>

                {item.content && (
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    <Linkified text={item.content} />
                  </p>
                )}

                {(files.length > 0 || (meta.links?.length ?? 0) > 0) && (
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        <Paperclip className="h-3 w-3" />
                        {f.file_name || f.type}
                      </span>
                    ))}
                    {meta.links
                      ?.filter((l) => !item.content.includes(l))
                      .map((l) => (
                        <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
                          {l}
                        </a>
                      ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-1">
                  {busy === item.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  <Action label="Make it a task" onClick={() => toTask(item)} disabled={!!busy}>
                    <ListTodo className="h-4 w-4" />
                  </Action>
                  <Action label="Make it a note" onClick={() => toNote(item)} disabled={!!busy}>
                    <StickyNote className="h-4 w-4" />
                  </Action>
                  <Action label="Delete" onClick={() => remove(item)} disabled={!!busy} danger>
                    <Trash2 className="h-4 w-4" />
                  </Action>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Action({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${danger ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
