// Comments of an item (#200), in the item drawer under its notes: oldest first, the box for a new one at the end.
// Ctrl+Enter sends; the author edits or deletes their own (the pencil and the bin show on hover).
import { useState } from "react";
import { Check, Pencil, Send, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { type ItemComment, useCommentActions, useItemComments } from "@/core/comments";
import { localDay } from "@/views/query";
import { dayLabel, Tip } from "@/views/fields";

const VIA: Record<string, { label: string; tip: string }> = {
  mcp: { label: "MCP", tip: "Written by an AI client through the MCP" },
  ai: { label: "AI", tip: "Written by the app's AI" },
  telegram: { label: "Telegram", tip: "Sent from Telegram" },
};

const two = (n: number) => String(n).padStart(2, "0");
const stamp = (ts: string, today: string) => {
  const d = new Date(ts);
  return `${dayLabel(localDay(d), today)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

function Box({ initial = "", onSave, onCancel }: { initial?: string; onSave: (text: string) => Promise<boolean>; onCancel?: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSave(t);
    setBusy(false);
    if (ok && !onCancel) setText("");
  };
  const icon = "rounded p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex items-end gap-1">
      <textarea
        value={text}
        autoFocus={!!onCancel}
        placeholder="Comment…"
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
        className="w-full resize-y rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary/50"
      />
      <div className="flex flex-col">
        {onCancel && (
          <Tip label="Cancel"><button type="button" onClick={onCancel} className={icon}><X className="h-3.5 w-3.5" /></button></Tip>
        )}
        <Tip label={onCancel ? "Save (Ctrl+Enter)" : "Send (Ctrl+Enter)"}>
          <button type="button" disabled={!text.trim() || busy} onClick={save} className={icon}>
            {onCancel ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </Tip>
      </div>
    </div>
  );
}

function CommentRow({ c, mine, today, actions }: {
  c: ItemComment; mine: boolean; today: string; actions: ReturnType<typeof useCommentActions>;
}) {
  const [editing, setEditing] = useState(false);
  const via = VIA[c.via];
  return (
    <div className="group space-y-0.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{stamp(c.created_at, today)}</span>
        {c.updated_at !== c.created_at && <Tip label={`Edited ${stamp(c.updated_at, today)}`}><span>· edited</span></Tip>}
        {via && <Tip label={via.tip}><span className="rounded bg-muted px-1">{via.label}</span></Tip>}
        {mine && !editing && (
          <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Tip label="Edit">
              <button type="button" onClick={() => setEditing(true)} className="rounded p-1 hover:bg-muted/60 hover:text-foreground"><Pencil className="h-3 w-3" /></button>
            </Tip>
            <Tip label="Delete">
              <button type="button" onClick={() => { if (window.confirm("Delete this comment?")) actions.remove(c.id); }} className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            </Tip>
          </span>
        )}
      </div>
      {editing ? (
        <Box
          initial={c.body}
          onCancel={() => setEditing(false)}
          onSave={async (t) => {
            const ok = t === c.body || (await actions.edit(c.id, t));
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
      )}
    </div>
  );
}

export function Comments({ itemId, today }: { itemId: string; today: string }) {
  const { user } = useAuth();
  const comments = useItemComments(itemId);
  const actions = useCommentActions(itemId);
  const list = comments.data ?? [];
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Comments {list.length > 0 && <span className="normal-case">{list.length}</span>}
      </h3>
      {list.map((c) => <CommentRow key={c.id} c={c} mine={!!user && c.created_by === user.id} today={today} actions={actions} />)}
      <Box key={itemId} onSave={actions.add} />
    </section>
  );
}
