// Tunnel view (P-62 / T-94, 2026-11-21): the days as a passage you glide through. The owner's reference is React
// Bits Pro "Passage Gallery" ("same quality, about one-to-one"); its behaviour is matched, the code is our own —
// the engine is tunnel/passage.ts. A box = a day (06:00 near → 24:00 far), the night a dark band between two days;
// tasks at their hour, the day's memory photos (Memories/<date>.md + the photos sent to the bot, as in the Depth
// view), accent tiles in the goal colours. Click a task → it flies out → Open = the item drawer.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookHeart, ChevronDown, ChevronUp, Crosshair, PanelRightOpen, Pause, Play, X } from "lucide-react";
import type { Task } from "@/core/tasks";
import type { TreeNode } from "@/lib/strategy";
import { useAuth } from "@/context/AuthContext";
import { localDay } from "@/hooks/useGoogleEvents";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useItemDrawer } from "@/features/items/ItemDrawer";
import { ensureMemory, loadMemories } from "@/lib/memories";
import { vault } from "@/lib/vault";
import { cn } from "@/lib/utils";
import { Passage, rowAt, timeAt, type TunnelDay, type TunnelPick, type TunnelTask, type TunnelTheme } from "./tunnel/passage";

const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const START = -2; // the camera starts just before today's entrance, the day ahead

const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const fmt = (n: number) => {
  const d = new Date(n * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const nowRow = () => {
  const n = new Date();
  return rowAt(0, n.getHours() * 60 + n.getMinutes());
};
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
const length = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);

// The app's colours, read from its CSS variables (shadcn: "H S% L%").
function readTheme(): TunnelTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const s = css.getPropertyValue(name).trim();
    return s ? (/^\d/.test(s) ? `hsl(${s})` : s) : fallback;
  };
  return {
    bg: v("--background", "#0f1217"),
    fg: v("--foreground", "#e6e9ee"),
    primary: v("--primary", "#10b981"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}

function Icon({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn("rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground", active && "text-primary")}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function TunnelCalendar({ tasks, byId, onOpenDay }: {
  tasks: Task[];
  byId: Map<string, TreeNode>;
  onOpenDay: (day: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const drawer = useItemDrawer();
  const today = useMemo(() => dayOf(localDay(new Date())), []);

  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Passage | null>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<TunnelPick | null>(null);
  const [hover, setHover] = useState<TunnelTask | null>(null);
  const [row, setRow] = useState(START + 2);
  const [range, setRange] = useState<[number, number]>([-1, 1]);
  const [paused, setPaused] = useState(() => remember.get("tunnel.autoplay") === "off");

  const byDay = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!t.date || t.status === "abandoned") continue;
      const d = dayOf(t.date);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    return m;
  }, [tasks]);

  // Memories (shared with the Depth view) and the links of the photos of the days in the passage (an hour each).
  const memories = useQuery({ queryKey: ["memories", user?.id], queryFn: loadMemories, enabled: !!user, staleTime: 60_000 });
  const pictures = useMemo(() => {
    const out: string[] = [];
    for (let k = range[0] - 1; k <= range[1] + 2; k++) out.push(...(memories.data?.get(isoOf(today + k))?.images.slice(0, 24) ?? []));
    return out;
  }, [range, memories.data, today]);
  const urls = useQuery({
    queryKey: ["vault-urls", user?.id, pictures],
    enabled: !!user && pictures.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => (await vault<{ urls: Record<string, string> }>("urls", { paths: pictures })).urls,
  });

  // What a day holds, for the engine (read through a ref so the engine always sees the latest data).
  const getDay = (k: number): TunnelDay => {
    const d = today + k;
    const date = new Date(d * DAY);
    const list = byDay.get(d) ?? [];
    const items: TunnelTask[] = list.map((t) => {
      const node = t.nodeId ? byId.get(t.nodeId) : undefined;
      return {
        id: t.id,
        title: t.title,
        time: t.time || null,
        minutes: t.estimatedTime,
        color: node?.color ?? null,
        goal: node?.node.title ?? null,
        done: t.status === "complete",
        event: !!t.isEvent,
      };
    });
    const images = memories.data?.get(isoOf(d))?.images ?? [];
    return {
      tasks: items,
      photos: images.map((path) => ({ path, url: urls.data?.[path] ?? null })),
      dayNum: date.getUTCDate(),
      weekday: WEEKDAYS[date.getUTCDay()],
      month: MONTHS[date.getUTCMonth()],
      today: k === 0,
      colors: [...new Set(items.map((t) => t.color).filter((c): c is string => !!c))],
    };
  };
  const getDayRef = useRef(getDay);
  getDayRef.current = getDay;
  const onOpenDayRef = useRef(onOpenDay);
  onOpenDayRef.current = onOpenDay;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // the canvas draws text in the app's font: wait for it
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      const engine = new Passage(
        host,
        {
          getDay: (k) => getDayRef.current(k),
          onFocus: setFocus,
          onHover: (pick) => setHover(pick?.kind === "task" ? pick.task : null),
          onMove: setRow,
          onRange: (a, b) => setRange((r) => (r[0] === a && r[1] === b ? r : [a, b])),
          onPick: (pick) => onOpenDayRef.current(isoOf(today + pick.k)),
        },
        { theme: readTheme(), reduced, start: START, now: nowRow() },
      );
      engine.setPaused(pausedRef.current);
      engineRef.current = engine;
    });
    // the theme can change while the view is open
    const mo = new MutationObserver(() => engineRef.current?.setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const tick = window.setInterval(() => engineRef.current?.setNow(nowRow()), 60_000);
    return () => {
      cancelled = true;
      mo.disconnect();
      window.clearInterval(tick);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [today]);

  useEffect(() => {
    engineRef.current?.refresh();
  }, [byDay, byId, memories.data, urls.data]);

  useEffect(() => {
    engineRef.current?.setPaused(paused);
    remember.set("tunnel.autoplay", paused ? "off" : "on");
  }, [paused]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const keys: Record<string, () => void> = {
      ArrowUp: () => engine.travel(1),
      ArrowRight: () => engine.travel(1),
      ArrowDown: () => engine.travel(-1),
      ArrowLeft: () => engine.travel(-1),
      PageUp: () => engine.jumpDays(1),
      PageDown: () => engine.jumpDays(-1),
      Home: () => engine.goHome(),
      Escape: () => engine.close(),
      " ": () => setPaused((p) => !p),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  // the hover label follows the pointer
  const onPointerMove = (e: React.PointerEvent) => {
    const el = hoverRef.current, host = hostRef.current;
    if (!el || !host) return;
    const r = host.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 16}px)`;
  };

  const openMemory = async (k: number) => {
    try {
      const path = await ensureMemory(isoOf(today + k), fmt(today + k));
      qc.invalidateQueries({ queryKey: ["memories", user?.id] });
      navigate(`/notes?open=${encodeURIComponent(path)}`);
    } catch (e) {
      toast({ title: "Not opened", description: (e as Error).message, variant: "destructive" });
    }
  };

  // where the camera is: the day and the hour just ahead
  const here = timeAt(row);
  const hereDay = new Date((today + here.k) * DAY);
  const thisYear = new Date(today * DAY).getUTCFullYear();
  const place = `${WEEKDAYS[hereDay.getUTCDay()].slice(0, 3)} ${hereDay.getUTCDate()} ${MONTHS[hereDay.getUTCMonth()]}${hereDay.getUTCFullYear() !== thisYear ? ` ${hereDay.getUTCFullYear()}` : ""} · ${hhmm(Math.floor(here.minutes / 60) * 60)}`;

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      <div
        ref={hostRef}
        className="absolute inset-0 outline-none"
        role="application"
        aria-roledescription="tunnel"
        aria-label="Days as a passage. Wheel or drag to travel, hold to speed up, click a tile to open it, Escape to put it back."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
      />

      <div className="pointer-events-none absolute left-4 top-3 z-10 text-sm font-semibold tabular-nums text-foreground drop-shadow">{place}</div>
      <div className="absolute right-3 top-2 z-10 flex items-center gap-0.5">
        <Icon label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)} active={!paused}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Icon>
        <Icon label="Today" onClick={() => engineRef.current?.goHome()}><Crosshair className="h-4 w-4" /></Icon>
      </div>
      <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-1">
        <Icon label="Next day" onClick={() => engineRef.current?.jumpDays(1)}><ChevronUp className="h-4 w-4" /></Icon>
        <Icon label="Previous day" onClick={() => engineRef.current?.jumpDays(-1)}><ChevronDown className="h-4 w-4" /></Icon>
      </div>

      {/* the task under the pointer, readable */}
      <div ref={hoverRef} className="pointer-events-none absolute left-0 top-0 z-10">
        {hover && !focus && (
          <div className="max-w-[260px] rounded-md border border-border bg-popover/90 px-2.5 py-1.5 text-xs text-popover-foreground shadow-md backdrop-blur">
            <div className="font-medium leading-snug">{hover.title}</div>
            {(hover.time || hover.goal) && (
              <div className="mt-0.5 text-muted-foreground">{[hover.time?.slice(0, 5), hover.goal].filter(Boolean).join(" · ")}</div>
            )}
          </div>
        )}
      </div>

      {/* the opened tile's caption */}
      {focus && focus.kind !== "day" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[min(100%,560px)] items-center gap-3 rounded-full border border-border bg-background/85 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-500">
            {focus.kind === "task" ? (
              <>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: focus.task.color ?? "hsl(var(--primary))" }} />
                <div className="min-w-0">
                  <div className={cn("truncate text-sm font-medium", focus.task.done && "line-through opacity-70")}>{focus.task.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[fmt(today + focus.k), focus.task.time?.slice(0, 5), focus.task.minutes ? length(focus.task.minutes) : null, focus.task.goal].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Icon label="Open" onClick={() => drawer.open(focus.task.id)}><PanelRightOpen className="h-4 w-4" /></Icon>
              </>
            ) : (
              <>
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{fmt(today + focus.k)}</span>
                  <span className="ml-2 tabular-nums text-muted-foreground">{focus.index + 1} / {focus.count}</span>
                </div>
                <Icon label="Memory" onClick={() => openMemory(focus.k)}><BookHeart className="h-4 w-4" /></Icon>
              </>
            )}
            <Icon label="Close" onClick={() => engineRef.current?.close()}><X className="h-4 w-4" /></Icon>
          </div>
        </div>
      )}
    </div>
  );
}
