// "AI sort" for the Inbox (P-70 phase 3, T-114; GTD clarify): Gemini proposes a type, a parent, a clearer title and
// dates for the capture items (the ticked ones, else every capture in the view); the user unticks what they don't want
// and applies the rest in one step. Nothing changes before Apply.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Item, ItemPatch } from "@/core/items";
import { ITEM_TYPES, type ItemType } from "@/core/types";
import { type Ctx, minutesLabel } from "@/views/query";
import { dayLabel, pathOf, PriorityIcon, Tip, TypeIcon } from "@/views/fields";

type Suggestion = {
  id: string; type: ItemType; parent_id: string | null; title: string | null; planned_on: string | null; due_on: string | null;
  priority: number | null; estimate_min: number | null; reason: string;
};

const patchOf = (s: Suggestion): ItemPatch => ({
  type: s.type,
  ...(s.parent_id && { parent_id: s.parent_id }),
  ...(s.title && { title: s.title }),
  ...(s.planned_on && { planned_on: s.planned_on }),
  ...(s.due_on && { due_on: s.due_on }),
  ...(s.priority && { priority: s.priority }),
  ...(s.estimate_min && { estimate_min: s.estimate_min }),
});

export function AiSort({ captures, ctx, onApply }: {
  captures: Item[]; ctx: Ctx; onApply: (changes: { item: Item; patch: ItemPatch }[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<Suggestion[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());

  const run = async () => {
    setOpen(true); setBusy(true); setError(null); setList([]); setOff(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ mode: "sort_inbox", ids: captures.slice(0, 40).map((i) => i.id), today: ctx.today }),
      });
      const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setList(data.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chosen = list.filter((s) => !off.has(s.id) && ctx.byId.get(s.id));
  const apply = async () => {
    setBusy(true);
    const ok = await onApply(chosen.map((s) => ({ item: ctx.byId.get(s.id)!, patch: patchOf(s) })));
    setBusy(false);
    if (ok) setOpen(false);
  };

  if (!captures.length) return null;
  return (
    <>
      <Tip label={`Sort ${Math.min(captures.length, 40)} Inbox item${captures.length === 1 ? "" : "s"} with AI (Gemini); you check before anything changes`}>
        <button type="button" onClick={run}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          <Sparkles className="h-3.5 w-3.5" /><span className="hidden sm:inline">AI sort</span>
        </button>
      </Tip>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>AI sort</DialogTitle></DialogHeader>
          {busy && !list.length && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!busy && !error && !list.length && <p className="text-sm text-muted-foreground">No proposals.</p>}
          {list.length > 0 && (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {list.map((s) => {
                const item = ctx.byId.get(s.id);
                if (!item) return null;
                const parent = s.parent_id ? ctx.byId.get(s.parent_id) : undefined;
                const on = !off.has(s.id);
                return (
                  <label key={s.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/30">
                    <input type="checkbox" checked={on} className="mt-1 accent-primary"
                      onChange={() => setOff((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <Tip label={ITEM_TYPES[s.type]?.label ?? s.type}><span><TypeIcon type={s.type} /></span></Tip>
                        <span className="truncate font-medium">{s.title ?? item.title}</span>
                        {s.priority && <PriorityIcon priority={s.priority} />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {s.title && s.title !== item.title && <span className="max-w-[16rem] truncate line-through opacity-60">{item.title}</span>}
                        {parent && <span className="truncate">in {[...pathOf(parent, ctx, 2), parent].map((p) => p.title).join(" › ")}</span>}
                        {s.planned_on && <span>day {dayLabel(s.planned_on, ctx.today)}</span>}
                        {s.due_on && <span>due {dayLabel(s.due_on, ctx.today)}</span>}
                        {s.estimate_min && <span>{minutesLabel(s.estimate_min)}</span>}
                      </div>
                      {s.reason && <div className="text-xs text-muted-foreground/80">{s.reason}</div>}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          {list.length > 0 && (
            <div className="flex justify-end">
              <button type="button" onClick={apply} disabled={busy || !chosen.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Apply {chosen.length}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
