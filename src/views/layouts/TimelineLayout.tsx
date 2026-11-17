// Timeline (P-69, GitHub's Roadmap): a bar per item from its start (start / planned day) to its end (deadline /
// planned day) on a day axis; zoom month / quarter / year; today marked. Items without any date are counted, not drawn.
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Item } from "@/core/items";
import { addDays, daysBetween, type Group } from "../query";
import { dayLabel, Tip } from "../fields";
import { GroupHeader } from "./GroupHeader";
import { TitleCell } from "./TableLayout";
import type { LayoutProps } from "./common";

const PX = { month: 28, quarter: 9, year: 2.6 };
const LEFT = 280;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function spanOf(i: Item): { from: string; to: string } | null {
  const s = i.start_on ?? i.planned_on ?? i.due_on;
  const e = i.due_on ?? i.planned_on ?? i.start_on;
  if (!s || !e) return null;
  return s <= e ? { from: s, to: e } : { from: e, to: s };
}

const BAR: Record<string, string> = {
  doing: "bg-amber-400/80", waiting: "bg-sky-400/70", someday: "bg-muted-foreground/40",
  done: "bg-primary/35", dropped: "bg-muted-foreground/25", todo: "bg-primary/75",
};

export function TimelineLayout(props: LayoutProps) {
  const { groups, config, ctx, onOpen } = props;
  const zoom = config.zoom ?? "quarter";
  const px = PX[zoom];
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const dated: Group[] = useMemo(() => groups.map((g) => ({ ...g, items: g.items.filter((i) => spanOf(i)) })).filter((g) => g.items.length), [groups]);
  const undated = groups.reduce((n, g) => n + g.items.filter((i) => !spanOf(i)).length, 0);

  // The axis: every bar plus a margin, at least a few weeks around today; starts on the 1st of a month.
  const { start, days } = useMemo(() => {
    let lo = addDays(ctx.today, -14), hi = addDays(ctx.today, zoom === "month" ? 45 : zoom === "quarter" ? 120 : 365);
    for (const g of dated) for (const i of g.items) {
      const s = spanOf(i)!;
      if (s.from < lo) lo = s.from;
      if (s.to > hi) hi = s.to;
    }
    const first = `${lo.slice(0, 7)}-01`;
    return { start: first, days: daysBetween(first, addDays(hi, 14)) + 1 };
  }, [dated, ctx.today, zoom]);

  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let d = start;
    while (daysBetween(start, d) < days) {
      const [y, m] = d.split("-").map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const left = daysBetween(start, d) * px;
      out.push({ label: zoom === "year" ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`, left, width: Math.min(daysBetween(d, next), days - daysBetween(start, d)) * px });
      d = next;
    }
    return out;
  }, [start, days, px, zoom]);

  const todayX = daysBetween(start, ctx.today) * px;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 160);
  }, [todayX, zoom]);

  const width = days * px;

  return (
    <div className="rounded-lg border border-border">
      <div ref={scroller} className="overflow-x-auto">
        <div style={{ width: LEFT + width }} className="relative">
          {/* axis */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-card/95 text-[11px] text-muted-foreground">
            <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-card px-3 py-2" style={{ width: LEFT }}>
              {undated > 0 && <Tip label="Items of this view without a start, day or deadline"><span>{undated} without dates</span></Tip>}
            </div>
            <div className="relative" style={{ width }}>
              {months.map((m) => (
                <div key={m.left} className="absolute top-0 h-full truncate border-l border-border/60 px-1.5 py-2" style={{ left: m.left, width: m.width }}>{m.label}</div>
              ))}
            </div>
          </div>

          {/* rows */}
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-400/70" style={{ left: LEFT + todayX + px / 2 }} />
            {months.map((m) => (
              <div key={m.left} className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/30" style={{ left: LEFT + m.left }} />
            ))}
            {dated.map((g) => {
              const open = !folded.has(g.key);
              return (
                <div key={g.key}>
                  {config.group_by && (
                    <div className="border-b border-border/50 bg-muted/10">
                      <div className="sticky left-0 z-10" style={{ width: LEFT + 200 }}>
                        <GroupHeader by={config.group_by} group={g} ctx={ctx} open={open}
                          toggle={() => setFolded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} />
                      </div>
                    </div>
                  )}
                  {open && g.items.map((i) => {
                    const s = spanOf(i)!;
                    const left = daysBetween(start, s.from) * px;
                    const w = Math.max(px, (daysBetween(s.from, s.to) + 1) * px);
                    const label = s.from === s.to ? dayLabel(s.from, ctx.today) : `${dayLabel(s.from, ctx.today)} → ${dayLabel(s.to, ctx.today)}`;
                    return (
                      <div key={i.id} className="flex h-8 items-center border-b border-border/30 hover:bg-muted/20">
                        <div className="sticky left-0 z-10 flex h-full shrink-0 items-center border-r border-border bg-background px-2" style={{ width: LEFT }}>
                          <TitleCell item={i} {...props} />
                        </div>
                        <div className="relative h-full" style={{ width }}>
                          <Tip label={`${i.title} · ${label}`}>
                            <button
                              type="button"
                              onClick={() => onOpen(i.id)}
                              className={cn("absolute top-1.5 h-5 overflow-hidden rounded px-1.5 text-left text-[11px] leading-5 text-background", BAR[i.status] ?? BAR.todo, w < 24 && "px-0")}
                              style={{ left, width: Math.max(w, 6) }}
                            >
                              {w > 60 ? i.title : ""}
                            </button>
                          </Tip>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {dated.length === 0 && <div className="sticky left-0 px-3 py-8 text-sm text-muted-foreground" style={{ width: LEFT + 300 }}>No dated items in this view</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
