// Tunnel view (P-62: T-94 2026-11-21, scope B #191): the days as a passage you glide through. The owner's reference is
// React Bits Pro "Passage Gallery" ("same quality, about one-to-one"); its behaviour is matched, the code is our own —
// the engine is tunnel/passage.ts, the spans tunnel/scale.ts. A box is a day, a month or a year (zoom with the
// magnifier buttons, ctrl + wheel / a pinch, +/−, or a click on a day — no Day/Month/Year switch: the page has its own
// views switch and two looked alike, owner 2026-11-21); tasks, memory photos and videos (Memories/<date>.md + what
// was sent to the bot, lib/memories.ts), long tasks as rails, accent tiles in the goal colours. Gallery mode:
// only the photos and videos. Click a task → it flies out → Open = the item drawer; click an empty cell → a task
// made there and opened in the item drawer, its title selected (closed unnamed → it goes to the trash again); a
// day's memory note opens in the side sheet, as notes do on the Notes page.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookHeart, ChevronDown, ChevronUp, Crosshair, Images, PanelRightOpen, Pause, Play, X, ZoomIn, ZoomOut } from "lucide-react";
import type { Task } from "@/core/tasks";
import type { TreeNode } from "@/lib/strategy";
import { useAuth } from "@/context/AuthContext";
import { localDay } from "@/hooks/useGoogleEvents";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import NotePanel from "@/components/vault/NotePanel";
import { useVault } from "@/hooks/useVault";
import { useItemDrawer } from "@/features/items/ItemDrawer";
import { ensureMemory, loadMemories } from "@/lib/memories";
import { vault } from "@/lib/vault";
import { cn } from "@/lib/utils";
import { SPANS, type Scale, type Span } from "./tunnel/scale";
import { marksOf, mixOf, swatchOf } from "./tunnel/marks";
import { Passage, type TunnelBox, type TunnelDay, type TunnelLong, type TunnelMedia, type TunnelPick, type TunnelPlace, type TunnelTask, type TunnelTheme } from "./tunnel/passage";

const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Photos and videos shown per day ([tasks mode, gallery mode]); in the year per week.
const MEDIA_CAP: Record<Span, [number, number]> = { day: [24, 40], month: [1, 3], year: [1, 4] };

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
const nowMinutes = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
const length = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);
// ISO week number of a Monday
const isoWeek = (monday: number) => {
  const thursday = monday + 3;
  const y = new Date(thursday * DAY).getUTCFullYear();
  return Math.floor((thursday - Math.floor(Date.UTC(y, 0, 1) / DAY)) / 7) + 1;
};

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

const NEW_TITLE = "New task";

export default function TunnelCalendar({ tasks, byId, onOpenDay, onAddTask, onDeleteTask }: {
  tasks: Task[];
  byId: Map<string, TreeNode>;
  onOpenDay: (day: string) => void;
  onAddTask: (t: { title: string; date: string; time: string | null }) => Promise<{ id: string } | undefined>;
  onDeleteTask: (id: string) => unknown;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const drawer = useItemDrawer();
  const notes = useVault();
  const today = useMemo(() => dayOf(localDay(new Date())), []);

  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Passage | null>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const [span, setSpanState] = useState<Span>(() => (SPANS as string[]).includes(remember.get("tunnel.span") ?? "") ? (remember.get("tunnel.span") as Span) : "day");
  const [gallery, setGallery] = useState(() => remember.get("tunnel.mode") === "gallery");
  const [focus, setFocus] = useState<TunnelPick | null>(null);
  const [hover, setHover] = useState<{ kind: "task"; task: TunnelTask } | { kind: "day"; day: number } | null>(null);
  const [place, setPlace] = useState<TunnelPlace>({ day: today, minutes: 6 * 60, band: false });
  const [range, setRange] = useState<[number, number]>([today - 1, today + 2]);
  // time flows unless stopped (a new key: "off" under the old one meant the old fast cruise was stopped)
  const [paused, setPaused] = useState(() => remember.get("tunnel.flow") === "off");
  const [making, setMaking] = useState(false); // a task for an empty cell is being made
  const freshRef = useRef<{ id: string; seen: boolean } | null>(null); // that task, until its drawer closes
  const [note, setNote] = useState<string | null>(null); // a memory note open in the side sheet

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

  // the area's colour and the goal's texture of every strategy node (#196)
  const marks = useMemo(() => marksOf(byId), [byId]);
  const toTask = (t: Task): TunnelTask => {
    const node = t.nodeId ? byId.get(t.nodeId) : undefined;
    return {
      id: t.id,
      title: t.title,
      time: t.time || null,
      minutes: t.estimatedTime,
      color: node?.color ?? null,
      goal: node?.node.title ?? null,
      mark: (t.nodeId && marks.get(t.nodeId)) || null,
      done: t.status === "complete",
      event: !!t.isEvent,
    };
  };

  // Long tasks (planned day → a later deadline) as rails, each in its own ceiling lane while it runs.
  const longs = useMemo(() => {
    const list = tasks
      .filter((t) => t.date && t.deadline && t.status !== "abandoned" && dayOf(t.deadline) > dayOf(t.date))
      .map((t) => ({ t, from: dayOf(t.date), to: dayOf(t.deadline) }))
      .sort((a, b) => a.from - b.from || b.to - a.to);
    const ends: number[] = [];
    return list.map(({ t, from, to }): TunnelLong => {
      let lane = ends.findIndex((e) => e < from);
      if (lane < 0) lane = ends.push(to) - 1;
      else ends[lane] = to;
      return { task: toTask(t), from, to, lane };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, byId]);

  // Memories: the photos and videos of a day, capped for the span.
  const memories = useQuery({ queryKey: ["memories", user?.id], queryFn: loadMemories, enabled: !!user, staleTime: 60_000 });
  const mediaOf = (d: number): Omit<TunnelMedia, "url">[] => {
    const m = memories.data?.get(isoOf(d));
    if (!m) return [];
    return [...m.images.map((path) => ({ path, video: false })), ...m.videos.map((path) => ({ path, video: true }))];
  };
  const capped = (d: number, perRow: Map<number, number> | null, scale: Scale | null, sp: Span = span) => {
    const cap = MEDIA_CAP[sp][gallery ? 1 : 0];
    const all = mediaOf(d);
    if (!perRow || !scale) return all.slice(0, cap);
    const row = scale.rowOf(d);
    const used = perRow.get(row) ?? 0;
    const take = all.slice(0, Math.max(0, cap - used));
    perRow.set(row, used + take.length);
    return take;
  };
  const scaleRef = useRef<Scale | null>(null); // the engine's current span (set by getBox)
  // the links of the ones in the passage (signed, an hour each)
  const pictures = useMemo(() => {
    const out: string[] = [];
    const perRow = span === "year" ? new Map<number, number>() : null;
    const scale = engineRef.current && span === "year" ? scaleRef.current : null;
    for (let d = range[0]; d < range[1] && out.length < 300; d++) out.push(...capped(d, perRow, scale).map((m) => m.path));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, memories.data, span, gallery]);
  const urls = useQuery({
    queryKey: ["vault-urls", user?.id, pictures],
    enabled: !!user && pictures.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => (await vault<{ urls: Record<string, string> }>("urls", { paths: pictures })).urls,
  });

  // What a box holds, for the engine (read through a ref so the engine always sees the latest data).
  const getBox = (scale: Scale, b: number): TunnelBox => {
    scaleRef.current = scale;
    const [from, to] = scale.dayRange(b);
    const perRow = scale.span === "year" ? new Map<number, number>() : null;
    const days: TunnelDay[] = [];
    const colors = new Set<string>();
    for (let d = from; d < to; d++) {
      const date = new Date(d * DAY);
      const list = byDay.get(d) ?? [];
      const items = gallery ? [] : list.map(toTask);
      items.forEach((t) => t.color && colors.size < 6 && colors.add(t.color));
      days.push({
        day: d,
        dayNum: date.getUTCDate(),
        weekday: WEEKDAYS[date.getUTCDay()],
        month: MONTHS[date.getUTCMonth()],
        today: d === today,
        tasks: items,
        media: capped(d, perRow, scale, scale.span).map((m) => ({ ...m, url: urls.data?.[m.path] ?? null })),
        count: list.length,
        done: list.filter((t) => t.status === "complete").length,
      });
    }
    const first = new Date(from * DAY);
    const last = new Date((to - 1) * DAY);
    const [title, sub] =
      scale.span === "month" ? [MONTH_NAMES[first.getUTCMonth()], String(last.getUTCFullYear())]
      : scale.span === "year" ? [String(first.getUTCFullYear()), ""]
      : ["", ""];
    return {
      title,
      sub,
      days,
      long: gallery ? [] : longs.filter((l) => l.from < to && l.to >= from),
      colors: [...colors],
    };
  };
  const getBoxRef = useRef(getBox);
  getBoxRef.current = getBox;
  const onOpenDayRef = useRef(onOpenDay);
  onOpenDayRef.current = onOpenDay;
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  const startRef = useRef({ span, gallery, paused });

  const zoomTo = (next: Span, day: number) => {
    const engine = engineRef.current;
    if (!engine || next === engine.span) return;
    setSpanState(next);
    remember.set("tunnel.span", next);
    engine.setSpan(next, day, next === "day" && day === today ? nowMinutes() : null);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // the canvas draws text in the app's font: wait for it
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      const start = startRef.current;
      const engine = new Passage(
        host,
        {
          getBox: (scale, b) => getBoxRef.current(scale, b),
          onFocus: setFocus,
          onHover: (pick) =>
            setHover(
              !pick ? null
              : pick.kind === "task" || pick.kind === "long" ? { kind: "task", task: pick.task }
              : pick.kind === "day" ? { kind: "day", day: pick.day }
              : null,
            ),
          onMove: setPlace,
          onRange: (a, b) => setRange((r) => (r[0] === a && r[1] === b ? r : [a, b])),
          onPick: (pick) => {
            if (pick.kind === "long") drawerRef.current.open(pick.task.id);
            else if (pick.kind === "day") {
              // a day: open it in the day span; elsewhere zoom in, the day in front
              const s = engineRef.current?.span ?? "day";
              if (s === "day") onOpenDayRef.current(isoOf(pick.day));
              else zoomRef.current(SPANS[SPANS.indexOf(s) - 1], pick.day);
            }
          },
          onEmpty: (cell) => makeAtRef.current(cell.day, cell.minutes),
          onZoom: (dir, day) => {
            const s = engineRef.current?.span ?? "day";
            const next = SPANS[SPANS.indexOf(s) + dir];
            if (next) zoomRef.current(next, day);
          },
        },
        { theme: readTheme(), reduced, span: start.span, today, nowMinutes: nowMinutes(), gallery: start.gallery },
      );
      engine.setPaused(start.paused);
      engineRef.current = engine;
    });
    // the theme can change while the view is open
    const mo = new MutationObserver(() => engineRef.current?.setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    // (the engine reads the clock itself: time flows in it, 2026-11-23)
    return () => {
      cancelled = true;
      mo.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  useEffect(() => {
    engineRef.current?.refresh();
  }, [byDay, byId, longs, memories.data, urls.data]);

  useEffect(() => {
    engineRef.current?.setPaused(paused);
    remember.set("tunnel.flow", paused ? "off" : "on");
  }, [paused]);

  useEffect(() => {
    engineRef.current?.setGallery(gallery);
    remember.set("tunnel.mode", gallery ? "gallery" : "tasks");
  }, [gallery]);

  // the passage stands still while a drawer or a note is open over it
  useEffect(() => {
    engineRef.current?.setHeld(making || !!note || !!drawer.id);
  }, [making, note, drawer.id]);

  // An empty cell → a task there, opened in the drawer with its title selected.
  const makeAt = async (day: number, minutes: number | null) => {
    if (making) return;
    setMaking(true);
    try {
      const saved = await onAddTask({ title: NEW_TITLE, date: isoOf(day), time: minutes === null ? null : hhmm(minutes) });
      if (saved) {
        freshRef.current = { id: saved.id, seen: false };
        drawer.open(saved.id, { fresh: true });
      }
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setMaking(false);
    }
  };
  const makeAtRef = useRef(makeAt);
  makeAtRef.current = makeAt;

  // its drawer closed with nothing written: it goes to the trash again
  useEffect(() => {
    const fresh = freshRef.current;
    if (!fresh) return;
    if (drawer.id === fresh.id) {
      fresh.seen = true;
      return;
    }
    if (!fresh.seen) return;
    freshRef.current = null;
    const t = tasks.find((x) => x.id === fresh.id);
    if (t && t.title === NEW_TITLE && !t.description && !t.nodeId) onDeleteTask(t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer.id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const engine = engineRef.current;
    if (!engine || note) return;
    const keys: Record<string, () => void> = {
      ArrowUp: () => engine.travel(1),
      ArrowRight: () => engine.travel(1),
      ArrowDown: () => engine.travel(-1),
      ArrowLeft: () => engine.travel(-1),
      PageUp: () => engine.jumpBoxes(1),
      PageDown: () => engine.jumpBoxes(-1),
      Home: () => engine.goHome(),
      Escape: () => engine.close(),
      " ": () => setPaused((p) => !p),
      "+": () => SPANS[SPANS.indexOf(span) - 1] && zoomTo(SPANS[SPANS.indexOf(span) - 1], place.day),
      "-": () => SPANS[SPANS.indexOf(span) + 1] && zoomTo(SPANS[SPANS.indexOf(span) + 1], place.day),
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

  // a day's memory note (made if missing) in the side sheet
  const openMemory = async (day: number) => {
    try {
      const path = await ensureMemory(isoOf(day), fmt(day));
      qc.invalidateQueries({ queryKey: ["memories", user?.id] });
      engineRef.current?.close();
      setNote(path);
    } catch (e) {
      toast({ title: "Not opened", description: (e as Error).message, variant: "destructive" });
    }
  };

  // where the camera is: the day (and the hour in the day span) just ahead
  const thisYear = new Date(today * DAY).getUTCFullYear();
  const dayText = (n: number, weekday = true) => {
    const d = new Date(n * DAY);
    return `${weekday ? `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ` : ""}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() !== thisYear ? ` ${d.getUTCFullYear()}` : ""}`;
  };
  const where =
    span === "day" ? `${dayText(place.day)} · ${hhmm(Math.floor((place.minutes ?? 0) / 60) * 60)}`
    : span === "year" ? `${dayText(place.day, false)} · Week ${isoWeek(place.day - ((place.day + 3) % 7))}`
    : dayText(place.day);
  // the day under the pointer: what it went to, per goal (#196)
  const dayParts = hover?.kind === "day" && !gallery ? mixOf((byDay.get(hover.day) ?? []).map(toTask)) : [];

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      <div
        ref={hostRef}
        className="absolute inset-0 outline-none"
        role="application"
        aria-roledescription="tunnel"
        aria-label="Days as a passage. Wheel or drag to travel, hold to speed up, ctrl and wheel to zoom, click a tile to open it, Escape to put it back."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
      />

      <div className="pointer-events-none absolute left-4 top-3 z-10 text-sm font-semibold tabular-nums text-foreground drop-shadow">{where}</div>
      <div className="absolute right-3 top-2 z-10 flex items-center gap-1">
        <Icon label="Memory" onClick={() => openMemory(place.day)}><BookHeart className="h-4 w-4" /></Icon>
        <Icon label="Gallery" onClick={() => setGallery((g) => !g)} active={gallery}><Images className="h-4 w-4" /></Icon>
        <Icon label={paused ? "Let time flow" : "Stop here"} onClick={() => setPaused((p) => !p)} active={!paused}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Icon>
        <Icon label="Now" onClick={() => engineRef.current?.goHome()}><Crosshair className="h-4 w-4" /></Icon>
      </div>
      <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-1">
        {SPANS[SPANS.indexOf(span) - 1] && (
          <Icon label="Zoom in" onClick={() => zoomTo(SPANS[SPANS.indexOf(span) - 1], place.day)}><ZoomIn className="h-4 w-4" /></Icon>
        )}
        {SPANS[SPANS.indexOf(span) + 1] && (
          <Icon label="Zoom out" onClick={() => zoomTo(SPANS[SPANS.indexOf(span) + 1], place.day)}><ZoomOut className="h-4 w-4" /></Icon>
        )}
        <Icon label="Next" onClick={() => engineRef.current?.jumpBoxes(1)}><ChevronUp className="h-4 w-4" /></Icon>
        <Icon label="Previous" onClick={() => engineRef.current?.jumpBoxes(-1)}><ChevronDown className="h-4 w-4" /></Icon>
      </div>

      {/* the task under the pointer, readable */}
      <div ref={hoverRef} className="pointer-events-none absolute left-0 top-0 z-10">
        {hover?.kind === "task" && !focus && (
          <div className="max-w-[260px] rounded-md border border-border bg-popover/90 px-2.5 py-1.5 text-xs text-popover-foreground shadow-md backdrop-blur">
            <div className="font-medium leading-snug">{hover.task.title}</div>
            {(hover.task.time || hover.task.goal) && (
              <div className="mt-0.5 text-muted-foreground">{[hover.task.time?.slice(0, 5), hover.task.goal].filter(Boolean).join(" · ")}</div>
            )}
          </div>
        )}
        {hover?.kind === "day" && !focus && dayParts.length > 0 && (
          <div className="w-[250px] rounded-md border border-border bg-popover/90 px-2.5 py-2 text-xs text-popover-foreground shadow-md backdrop-blur">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-medium">{dayText(hover.day)}</span>
              <span className="text-[10px] text-muted-foreground">done / planned</span>
            </div>
            {dayParts.map((p) => (
              <div key={p.mark?.id ?? "none"} className="flex items-center gap-2 py-0.5">
                <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] bg-cover" style={{ backgroundImage: `url(${swatchOf(p.mark)})` }} />
                <span className="min-w-0 flex-1 truncate">{p.mark?.label ?? "No goal"}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{length(p.done)} / {length(p.planned)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the opened tile's caption */}
      {focus && (focus.kind === "task" || focus.kind === "media") && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[min(100%,560px)] items-center gap-3 rounded-full border border-border bg-background/85 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-500">
            {focus.kind === "task" ? (
              <>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: focus.task.color ?? "hsl(var(--primary))" }} />
                <div className="min-w-0">
                  <div className={cn("truncate text-sm font-medium", focus.task.done && "line-through opacity-70")}>{focus.task.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[fmt(focus.day), focus.task.time?.slice(0, 5), focus.task.minutes ? length(focus.task.minutes) : null, focus.task.goal].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Icon label="Open" onClick={() => drawer.open(focus.task.id)}><PanelRightOpen className="h-4 w-4" /></Icon>
              </>
            ) : (
              <>
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{fmt(focus.day)}</span>
                  <span className="ml-2 tabular-nums text-muted-foreground">{focus.index + 1} / {focus.count}</span>
                </div>
                <Icon label="Memory" onClick={() => openMemory(focus.day)}><BookHeart className="h-4 w-4" /></Icon>
              </>
            )}
            <Icon label="Close" onClick={() => engineRef.current?.close()}><X className="h-4 w-4" /></Icon>
          </div>
        </div>
      )}

      {/* a memory note at the side, as on the Notes page */}
      <Sheet open={!!note} onOpenChange={(o) => !o && setNote(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-2xl">
          <SheetTitle className="sr-only">Memory</SheetTitle>
          {note && (
            <NotePanel
              key={note}
              path={note}
              file={notes.files.find((f) => f.path === note)}
              inSheet
              resolve={notes.resolve}
              onOpen={setNote}
              onClose={() => setNote(null)}
              onAction={(_a, f) => navigate(`/notes?open=${encodeURIComponent(f.path)}`)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
