// Tunnel calendar (P-62, T-94): the React side of the tunnel of time — data in, controls and tooltips around it.
// The passage itself is drawn by ./tunnel/engine.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Images, ListTodo, ZoomIn, ZoomOut } from "lucide-react";
import type { Task } from "@/context/AppContext";
import type { TreeNode } from "@/lib/strategy";
import { useAuth } from "@/context/AuthContext";
import { spansOf } from "@/lib/spans";
import { ensureMemory, loadMemories } from "@/lib/memories";
import { vault } from "@/lib/vault";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TunnelEngine, stopFrac, type DayStat, type TunnelCard, type TunnelEvents, type TunnelHover, type TunnelMode } from "./tunnel/engine";
import { STOPS, dayOf, fmtDay, fractionOf, isoOf, nowTime } from "./tunnel/time";
import "./TunnelCalendar.css";

const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const PHOTO_BLOCK = 14; // photo links are asked for two weeks at a time around the focus
const NO_COLOR = "#7d8a9c";
const MEMORY_COLOR = "#f3b6c8";

export default function TunnelCalendar({ tasks, roots, byId, hidden, onOpenDay, onOpenTask }: {
  tasks: Task[];
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  hidden: Set<string>;
  onOpenDay: (day: string) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = useMemo(() => Math.floor(nowTime()), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TunnelEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [heading, setHeading] = useState("");
  const [stop, setStop] = useState(() => {
    const s = Number(remember.get("tunnel.stop"));
    return Number.isInteger(s) && s >= 0 && s < STOPS.length ? s : 3;
  });
  const [hover, setHover] = useState<TunnelHover>(null);
  const [mode, setMode] = useState<TunnelMode>(() => (remember.get("tunnel.mode") === "gallery" ? "gallery" : "tasks"));
  const [focusDay, setFocusDay] = useState(today);
  const block = Math.floor(focusDay / PHOTO_BLOCK);

  // ── Data ──
  const live = useMemo(() => tasks.filter((t) => (t.date || t.deadline) && t.status !== "abandoned"), [tasks]);
  const byDay = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of live) {
      const d = dayOf(t.date || t.deadline);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    return m;
  }, [live]);

  const memories = useQuery({ queryKey: ["memories", user?.id], queryFn: loadMemories, enabled: !!user, staleTime: 60_000 });
  const pictures = useMemo(() => {
    const out: string[] = [];
    for (let d = block * PHOTO_BLOCK - 21; d <= block * PHOTO_BLOCK + 49; d++) {
      const first = memories.data?.get(isoOf(d))?.images[0];
      if (first) out.push(first);
    }
    return out;
  }, [block, memories.data]);
  const urls = useQuery({
    queryKey: ["vault-urls", user?.id, pictures],
    enabled: !!user && pictures.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => (await vault<{ urls: Record<string, string> }>("urls", { paths: pictures })).urls,
  });

  const stats = useMemo(() => {
    const m = new Map<number, DayStat>();
    const of = (d: number) => {
      let s = m.get(d);
      if (!s) m.set(d, (s = { total: 0, done: 0, open: 0, photos: 0 }));
      return s;
    };
    byDay.forEach((list, d) => {
      const s = of(d);
      s.total = list.length;
      s.done = list.filter((t) => t.status === "complete").length;
      s.open = s.total - s.done;
    });
    memories.data?.forEach((mem, iso) => {
      const n = mem.images.length + (mem.note ? 1 : 0);
      if (n) of(dayOf(iso)).photos = n;
    });
    return m;
  }, [byDay, memories.data]);

  const spans = useMemo(() => spansOf(roots, hidden, today), [roots, hidden, today]);

  const cards = useMemo(() => {
    const out: TunnelCard[] = [];
    for (const t of live) {
      const node = t.nodeId ? byId.get(t.nodeId) : undefined;
      const deadline = !t.date && !!t.deadline;
      const time = deadline ? fractionOf(t.deadlineTime) : fractionOf(t.time);
      const clock = (deadline ? t.deadlineTime : t.time)?.slice(0, 5) ?? "";
      const when = deadline ? `Due${clock ? ` ${clock}` : ""}` : clock;
      out.push({
        id: t.id,
        kind: "task",
        day: dayOf(t.date || t.deadline),
        time,
        title: t.title,
        meta: [when, node?.node.title].filter(Boolean).join(" · "),
        color: node?.color || NO_COLOR,
        done: t.status === "complete",
        event: !!t.isEvent,
        deadline,
      });
    }
    memories.data?.forEach((mem, iso) => {
      if (!mem.note && !mem.images.length) return;
      out.push({
        id: `memory:${iso}`,
        kind: "memory",
        day: dayOf(iso),
        time: null,
        title: mem.excerpt || "Memory",
        meta: "",
        color: MEMORY_COLOR,
        image: mem.images[0] ? urls.data?.[mem.images[0]] ?? null : null,
        tall: mem.images.length > 0,
      });
    });
    return out;
  }, [live, byId, memories.data, urls.data]);

  // ── The engine ──
  const openMemory = async (day: number) => {
    try {
      const path = await ensureMemory(isoOf(day), fmtDay(day));
      qc.invalidateQueries({ queryKey: ["memories", user?.id] });
      navigate(`/notes?open=${encodeURIComponent(path)}`);
    } catch (e) {
      toast({ title: "Not opened", description: (e as Error).message, variant: "destructive" });
    }
  };
  const handlers = useRef({ openDay: (_d: number) => {}, openCard: (_c: TunnelCard) => {} });
  handlers.current = {
    openDay: (d) => onOpenDay(isoOf(d)),
    openCard: (c) => {
      if (c.kind === "memory") openMemory(c.day);
      else if (onOpenTask) onOpenTask(c.id);
      else onOpenDay(isoOf(c.day));
    },
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const events: TunnelEvents = {
      heading: (text, s) => {
        setHeading(text);
        setStop(s);
      },
      zoom: (frac) => {
        if (markerRef.current) markerRef.current.style.top = `${(frac * 100).toFixed(2)}%`;
      },
      focusDay: setFocusDay,
      hover: setHover,
      openDay: (d) => handlers.current.openDay(d),
      openCard: (c) => handlers.current.openCard(c),
    };
    let engine: TunnelEngine;
    try {
      engine = new TunnelEngine(host, events, { stop });
    } catch {
      setFailed(true);
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setData({ stats, spans, cards, mode });
  }, [stats, spans, cards, mode]);

  useEffect(() => remember.set("tunnel.stop", String(stop)), [stop]);

  const toggleMode = () => {
    setMode((m) => {
      const next = m === "tasks" ? "gallery" : "tasks";
      remember.set("tunnel.mode", next);
      return next;
    });
  };

  const control = "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground";
  const hoverTasks = hover?.kind === "day" ? byDay.get(hover.day) ?? [] : [];

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      {failed ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">3-D view is not available in this browser.</div>
      ) : (
        <div ref={hostRef} className="tunnel" tabIndex={0} role="application" aria-label="Tunnel of time" />
      )}

      <div className="pointer-events-none absolute left-4 top-3 z-10">
        <div className="text-sm font-semibold tabular-nums text-foreground drop-shadow">{heading}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-primary/80">{STOPS[stop].name}</div>
      </div>

      <div className="absolute right-3 top-2 z-10 flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={toggleMode} className={cn(control, mode === "gallery" && "text-primary")}>
              {mode === "gallery" ? <Images className="h-4 w-4" /> : <ListTodo className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{mode === "gallery" ? "Memories only — show tasks too" : "Tasks and memories — memories only"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => engineRef.current?.goNow()} className={control}><Crosshair className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Now (T)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => engineRef.current?.zoomBy(0.4)} className={control}><ZoomOut className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (−, wheel)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => engineRef.current?.zoomBy(2.5)} className={control}><ZoomIn className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (+, wheel toward a point)</TooltipContent>
        </Tooltip>
      </div>

      {!failed && (
        <div className="tunnel-ladder" aria-label="Zoom">
          {STOPS.map((s, i) => (
            <Tooltip key={s.name}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => engineRef.current?.goStop(i)}
                  className={cn("tunnel-ladder__step", i === stop && "is-on")}
                  style={{ top: `${stopFrac(i) * 100}%` }}
                  aria-label={s.name}
                >
                  <span className="tunnel-ladder__name">{s.name}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{s.name} ({i + 1}) · wheel = zoom, drag = move in time, Shift + wheel = move</TooltipContent>
            </Tooltip>
          ))}
          <div ref={markerRef} className="tunnel-ladder__marker" />
        </div>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[16rem] rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.kind === "day" ? (
            <>
              <div className="font-medium tabular-nums">{fmtDay(hover.day)}{hover.day === today && <span className="ml-1.5 text-primary">Today</span>}</div>
              {hoverTasks.length > 0 ? (
                <div className="mt-0.5 space-y-0.5">
                  {hoverTasks.slice(0, 4).map((t) => (
                    <div key={t.id} className={cn("flex items-center gap-1.5", t.status === "complete" && "text-muted-foreground line-through")}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: (t.nodeId && byId.get(t.nodeId)?.color) || NO_COLOR }} />
                      <span className="truncate">{t.title}</span>
                    </div>
                  ))}
                  {hoverTasks.length > 4 && <div className="text-muted-foreground">+{hoverTasks.length - 4}</div>}
                </div>
              ) : (
                <div className="text-muted-foreground">{stats.get(hover.day)?.photos ? "Memory" : "Free"}</div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 font-medium">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hover.span.color }} />
                <span className="truncate">{hover.span.title}</span>
              </div>
              <div className="tabular-nums text-muted-foreground">
                {fmtDay(hover.span.start)} – {hover.span.end === null ? "…" : fmtDay(hover.span.end)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
