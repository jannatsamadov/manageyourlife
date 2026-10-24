// Spiral calendar (P-55): the React Bits "InfiniteSpiral" turned into time. One card a day and one turn a week,
// the future above and the past below (grey). Zoomed out, the cards give way to the calendar line, and long goals
// and missions run beside it as coloured lines (start → due), up to many years on screen.
import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, ZoomIn, ZoomOut } from "lucide-react";
import type { Task } from "@/context/AppContext";
import type { TreeNode } from "@/lib/strategy";
import { localDay } from "@/hooks/useGoogleEvents";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./SpiralCalendar.css";

// The owner's settings on reactbits.dev (edge fade 0 = no fade; auto speed off: a calendar must not drift from today) …
const CARD_W = 164, CARD_H = 72, PERSPECTIVE = 875, GRAYSCALE = 0.75;
// … and the component's defaults.
const RADIUS = 170, SPACING = 60, PER_TURN = 7, CARD_RADIUS = 10, CENTER_SCALE = 1.2, EDGE_BLUR = 6;

const DAY = 86400000;
const S_MIN = 0.12, S_MAX = 96; // zoom = px per day: ~18 years … a few days on screen
const CARDS_GONE = 13, CARDS_FULL = 22; // the cards fade into lines between these zooms
const TITLES_FROM = 34; // task titles on the cards from this zoom, coloured dots below it
const LONG_DAYS = 28; // a goal or mission this long (or a goal still open) gets a line
const OPEN_TAIL = 90; // an open goal fades out this many days after today
const LANE_GAP = 5, LANES = 8;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const smoothstep = (min: number, max: number, v: number) => {
  const x = clamp((v - min) / (max - min || 1), 0, 1);
  return x * x * (3 - 2 * x);
};

// Days counted from 1970-01-01 in the user's own calendar.
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const localDayOf = (timestamp: string) => dayOf(localDay(new Date(timestamp)));
const fmt = (n: number) => {
  const d = new Date(n * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

type Span = { id: string; title: string; color: string; start: number; end: number | null; done: boolean; lane: number };
type Hit = { span: Span; x: number; y: number };

const laneOffset = (lane: number) => (lane % 2 ? -1 : 1) * (Math.floor(lane / 2) + 1) * LANE_GAP;

function walk(t: TreeNode, f: (n: TreeNode) => void) {
  f(t);
  t.children.forEach((c) => walk(c, f));
}

// Long goals and missions. Start: the start date, else the first sign of the work (created, earliest task).
// End: the day it was done, else the due date, else open (goals only).
function spansOf(roots: TreeNode[], hidden: Set<string>, today: number): Span[] {
  const spans: Span[] = [];
  const visit = (t: TreeNode) => {
    if (t.node.status === "dropped" || (t.kind === "goal" && hidden.has(t.node.id))) return;
    if (t.kind === "goal" || t.kind === "mission") {
      let first = localDayOf(t.node.created_at);
      walk(t, (n) => n.tasks.forEach((k) => { if (k.date) first = Math.min(first, dayOf(k.date)); }));
      const done = t.node.status === "done";
      const end = done ? localDayOf(t.node.done_at ?? t.node.updated_at) : t.node.due_date ? dayOf(t.node.due_date) : null;
      const start = Math.min(t.node.start_date ? dayOf(t.node.start_date) : first, end ?? Infinity);
      if (end === null ? t.kind === "goal" && start <= today + OPEN_TAIL : end - start >= LONG_DAYS) {
        spans.push({ id: t.node.id, title: t.node.title, color: t.color, start, end, done, lane: 0 });
      }
    }
    if (t.kind === "area" || t.kind === "goal") t.children.forEach(visit);
  };
  roots.forEach(visit);
  // Lanes beside the calendar line, alternating sides; a lane is reused once its line has ended.
  spans.sort((a, b) => a.start - b.start);
  const ends: number[] = [];
  for (const s of spans) {
    let lane = ends.findIndex((e) => e < s.start);
    if (lane < 0) lane = ends.length < LANES ? ends.length : ends.indexOf(Math.min(...ends));
    ends[lane] = s.end ?? today + OPEN_TAIL;
    s.lane = lane;
  }
  return spans;
}

export default function SpiralCalendar({ tasks, roots, byId, hidden, onOpenDay }: {
  tasks: Task[];
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  hidden: Set<string>;
  onOpenDay: (day: string) => void;
}) {
  const today = useMemo(() => dayOf(localDay(new Date())), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cards = useRef(new Map<number, HTMLButtonElement>());
  const refFns = useRef(new Map<number, (el: HTMLButtonElement | null) => void>());
  // c = the day at the middle of the screen, z = log(px per day); t… = where they are heading.
  const view = useRef({ c: today, tc: today, z: Math.log(SPACING), tz: Math.log(SPACING), fit: 1, pressed: false, dragging: false, moved: false, downY: 0, lastY: 0, pinch: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spansRef = useRef<Span[]>([]);
  const hits = useRef<Hit[]>([]);
  const wake = useRef(() => {});
  const [win, setWin] = useState<[number, number]>([today - 12, today + 12]);
  const winRef = useRef(win);
  const [titles, setTitles] = useState(true);
  const titlesRef = useRef(true);
  const [label, setLabel] = useState("");
  const labelRef = useRef("");
  const [hover, setHover] = useState<Hit | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!t.date || t.status === "abandoned") continue;
      const d = dayOf(t.date);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    m.forEach((list) => list.sort((a, b) => a.position - b.position));
    return m;
  }, [tasks]);

  const spans = useMemo(() => spansOf(roots, hidden, today), [roots, hidden, today]);
  useEffect(() => {
    spansRef.current = spans;
    wake.current();
  }, [spans]);

  const colorOf = (t: Task) => (t.nodeId && byId.get(t.nodeId)?.color) || "hsl(var(--muted-foreground))";

  // One stable ref per day card; a new card stays hidden until the next frame places it.
  const refFor = (d: number) => {
    let f = refFns.current.get(d);
    if (!f) {
      f = (el) => {
        if (el) {
          el.style.visibility = "hidden";
          cards.current.set(d, el);
          wake.current();
        } else {
          cards.current.delete(d);
          refFns.current.delete(d);
        }
      };
      refFns.current.set(d, f);
    }
    return f;
  };

  const zoomAt = (factor: number, clientY?: number) => {
    const v = view.current;
    const s0 = Math.exp(v.tz), s1 = clamp(s0 * factor, S_MIN, S_MAX);
    // The day under the pointer stays under it.
    if (clientY !== undefined && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      v.tc += ((clientY - r.top - r.height / 2) / v.fit) * (1 / s1 - 1 / s0);
    }
    v.tz = Math.log(s1);
    wake.current();
  };

  const goToday = () => {
    view.current.tc = today;
    wake.current();
  };

  useEffect(() => {
    const root = rootRef.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const v = view.current;
    let frame = 0, prev = 0, w = 1, h = 1;
    let fg = "", muted = "", primary = "", font = "sans-serif";

    const theme = () => {
      const css = getComputedStyle(root);
      fg = `hsl(${css.getPropertyValue("--foreground").trim()})`;
      muted = `hsl(${css.getPropertyValue("--muted-foreground").trim()})`;
      primary = `hsl(${css.getPropertyValue("--primary").trim()})`;
      font = css.fontFamily;
    };

    const draw = () => {
      const s = Math.exp(v.z);
      const fit = Math.min(1, w / (CARD_W * 2.8), h / (CARD_H * 2.35));
      v.fit = fit;
      const R = Math.min(RADIUS, Math.max(72, w * 0.36)) * fit;
      const sy = s * fit; // px per day on screen
      const P = PER_TURN * Math.max(s, SPACING) * fit; // px per turn: a week when close, fixed when far
      const cx = w / 2, cy = h / 2, half = h / 2;
      const cardsA = smoothstep(CARDS_GONE, CARDS_FULL, s);
      const linesA = 1 - smoothstep(CARDS_GONE + 3, CARDS_FULL + 8, s);
      const yOf = (d: number) => (v.c - d) * sy;
      const at = (y: number, off = 0) => {
        const th = (2 * Math.PI * y) / P;
        const slope = (Math.cos(th) * R * 2 * Math.PI) / P;
        const n = Math.hypot(1, slope);
        return { x: cx + Math.sin(th) * R + off / n, y: cy + y - (off * slope) / n, depth: (Math.cos(th) + 1) / 2 };
      };

      // Day cards, placed like the original spiral places its images.
      const size = clamp(s / SPACING, 0.35, 1.25);
      cards.current.forEach((el, d) => {
        const y = yOf(d);
        if (cardsA < 0.01 || Math.abs(y) > half + CARD_H * 1.5) {
          el.style.visibility = "hidden";
          return;
        }
        const th = (2 * Math.PI * y) / P;
        const x = Math.sin(th) * R, z = Math.cos(th) * R;
        const focus = 1 - Math.min(Math.abs(y) / Math.max(0.65 * P, 1), 1);
        const scale = (1 + (CENTER_SCALE - 1) * focus) * fit * size;
        const depthScale = clamp(PERSPECTIVE / Math.max(PERSPECTIVE - z, 1), 0.72, 1.45);
        const blur = size > 0.6 ? EDGE_BLUR * smoothstep(0.35, 1, Math.min(Math.abs(y) / half, 1)) : 0;
        el.style.visibility = "visible";
        el.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale * depthScale})`;
        el.style.opacity = cardsA.toFixed(3);
        el.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";
        el.style.zIndex = String(Math.round(((z / Math.max(R, 1) + 1) / 2) * 100000));
        el.style.pointerEvents = cardsA > 0.5 ? "auto" : "none";
      });

      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      const STEP = 3;
      const yToday = yOf(today);

      // The calendar line: the future in the text colour, the past muted, the back of the coil fainter.
      let p = at(-half - STEP);
      for (let y = -half; y <= half + STEP; y += STEP) {
        const q = at(y);
        ctx.globalAlpha = (0.1 + 0.4 * q.depth) * (1 - 0.4 * cardsA);
        ctx.strokeStyle = y < yToday ? fg : muted;
        ctx.lineWidth = (0.75 + 1.25 * q.depth) * (1 + 0.5 * linesA);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        p = q;
      }

      // Long goals and missions beside it.
      const found: Hit[] = [];
      if (linesA > 0.01) {
        for (const sp of spansRef.current) {
          const off = laneOffset(sp.lane) * fit;
          const yEnd = yOf(sp.end ?? today + OPEN_TAIL);
          const top = Math.max(yEnd, -half - STEP), bottom = Math.min(yOf(sp.start), half + STEP);
          if (top >= bottom) continue;
          ctx.strokeStyle = ctx.fillStyle = sp.color;
          let a = at(bottom, off);
          for (let y = bottom - STEP; ; y -= STEP) {
            const yy = Math.max(y, top);
            const b = at(yy, off);
            const fade = sp.end === null && yy < yToday ? clamp((yy - yEnd) / Math.max(yToday - yEnd, 1), 0, 1) : 1;
            const alpha = linesA * (0.3 + 0.7 * b.depth) * (sp.done ? 0.45 : 1) * fade;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = Math.max(1, (1.4 + 1.6 * b.depth) * fit);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            if (alpha > 0.15) found.push({ span: sp, x: b.x, y: b.y });
            a = b;
            if (yy === top) break;
          }
          for (const d of sp.end === null ? [sp.start] : [sp.start, sp.end]) {
            const y = yOf(d);
            if (Math.abs(y) > half) continue;
            const q = at(y, off);
            ctx.globalAlpha = linesA * (0.4 + 0.6 * q.depth) * (sp.done ? 0.45 : 1);
            ctx.beginPath();
            ctx.arc(q.x, q.y, d === sp.end ? 3 : 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      hits.current = found;

      // Years on the left, months on the right, each tied to its point on the line.
      const left = Math.max(8, cx - R - 150 * fit), right = Math.min(w - 8, cx + R + 150 * fit);
      const firstDay = new Date(Math.floor(v.c - half / sy) * DAY), lastDay = v.c + half / sy;
      const monthPx = 30.44 * sy;
      ctx.textBaseline = "middle";
      for (let yr = firstDay.getUTCFullYear(), mo = firstDay.getUTCMonth(); ; mo++) {
        if (mo === 12) { mo = 0; yr++; }
        const d = Math.floor(Date.UTC(yr, mo, 1) / DAY);
        if (d > lastDay) break;
        const isYear = mo === 0;
        const y = yOf(d);
        if (Math.abs(y) > half || (!isYear && monthPx < 22)) continue;
        const q = at(y);
        const text = isYear ? String(yr) : MONTHS[mo];
        ctx.font = isYear ? `600 13px ${font}` : `11px ${font}`;
        const tw = ctx.measureText(text).width;
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(isYear ? left + tw + 6 : right - tw - 6, cy + y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.globalAlpha = isYear ? 0.9 : 0.55;
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(q.x, q.y, isYear ? 3 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = isYear ? "left" : "right";
        ctx.fillText(text, isYear ? left : right, cy + y);
      }

      // Today, once the cards are gone.
      if (cardsA < 0.9 && Math.abs(yToday) < half) {
        const q = at(yToday);
        ctx.fillStyle = primary;
        ctx.globalAlpha = 0.3 * (1 - cardsA);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1 - cardsA;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // React only hears about it when the set of days, the card detail or the heading changes.
      if (cardsA > 0) {
        const pad = (half + CARD_H * 1.5) / sy;
        const lo = Math.floor(v.c - pad), hi = Math.ceil(v.c + pad);
        const [a, b] = winRef.current;
        if (lo < a || hi > b || b - a > 3 * (hi - lo) + 14) {
          const extra = Math.ceil((hi - lo) / 2);
          winRef.current = [lo - extra, hi + extra];
          setWin(winRef.current);
        }
      } else if (winRef.current[1] >= winRef.current[0]) {
        winRef.current = [0, -1];
        setWin(winRef.current);
      }
      const withTitles = s >= TITLES_FROM;
      if (withTitles !== titlesRef.current) setTitles((titlesRef.current = withTitles));
      const mid = new Date(Math.round(v.c) * DAY);
      const heading = s >= 1 ? `${MONTHS[mid.getUTCMonth()]} ${mid.getUTCFullYear()}` : String(mid.getUTCFullYear());
      if (heading !== labelRef.current) setLabel((labelRef.current = heading));
    };

    const tick = (time: number) => {
      const dt = Math.min((time - prev) / 1000, 0.05);
      prev = time;
      v.c += (v.tc - v.c) * (1 - Math.exp(-dt * (v.dragging ? 22 : 11)));
      v.z += (v.tz - v.z) * (1 - Math.exp(-dt * 11));
      const settled = !v.dragging && Math.abs(v.tc - v.c) * Math.exp(v.z) < 0.05 && Math.abs(v.tz - v.z) < 1e-3;
      if (settled) {
        v.c = v.tc;
        v.z = v.tz;
      }
      draw();
      frame = settled ? 0 : requestAnimationFrame(tick);
    };
    wake.current = () => {
      if (frame) return;
      prev = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const resize = () => {
      const r = root.getBoundingClientRect();
      w = Math.max(r.width, 1);
      h = Math.max(r.height, 1);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      theme();
      wake.current();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    // Light / dark switch.
    const themeObserver = new MutationObserver(() => {
      theme();
      wake.current();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

    // Wheel = move through time; Ctrl + wheel or a trackpad pinch = zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-px * 0.0025), e.clientY);
      else v.tc -= px / (Math.exp(v.tz) * v.fit);
      wake.current();
    };
    root.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      wake.current = () => {};
      resizeObserver.disconnect();
      themeObserver.disconnect();
      root.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const hoverAt = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: Hit | null = null, bestD = 64;
    for (const hit of hits.current) {
      const d = (hit.x - x) ** 2 + (hit.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = hit;
      }
    }
    setHover((cur) => (cur?.span.id === best?.span.id ? cur : best && { span: best.span, x, y }));
  };

  // Zoomed out, a click dives into that point of time.
  const dive = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = view.current;
    if (Math.exp(v.z) >= (CARDS_GONE + CARDS_FULL) / 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.tc = v.c - (e.clientY - r.top - r.height / 2) / (Math.exp(v.z) * v.fit);
    v.tz = Math.log(SPACING);
    setHover(null);
    wake.current();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = view.current;
    const step = Math.max(1, Math.round(SPACING / Math.exp(v.tz)));
    const keys: Record<string, () => void> = {
      ArrowUp: () => (v.tc += step),
      ArrowDown: () => (v.tc -= step),
      PageUp: () => (v.tc += step * 7),
      PageDown: () => (v.tc -= step * 7),
      "+": () => zoomAt(2),
      "=": () => zoomAt(2),
      "-": () => zoomAt(0.5),
      t: goToday,
      Home: goToday,
    };
    const f = keys[e.key];
    if (!f) return;
    e.preventDefault();
    f();
    wake.current();
  };

  const days: number[] = [];
  for (let d = win[0]; d <= win[1]; d++) days.push(d);

  const rootStyle = {
    perspective: `${PERSPECTIVE}px`,
    "--infinite-spiral-card-width": `${CARD_W}px`,
    "--infinite-spiral-card-height": `${CARD_H}px`,
    "--infinite-spiral-card-radius": `${CARD_RADIUS}px`,
    "--infinite-spiral-grayscale": GRAYSCALE,
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  } as React.CSSProperties;

  const control = "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground";

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      <div
        ref={rootRef}
        className="infinite-spiral outline-none"
        style={rootStyle}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const v = view.current;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          v.moved = false;
          if (pointers.current.size === 2) {
            v.pinch = spread();
            v.moved = true;
            return;
          }
          v.pressed = true;
          v.downY = v.lastY = e.clientY;
        }}
        onPointerMove={(e) => {
          const v = view.current;
          if (!pointers.current.has(e.pointerId)) return hoverAt(e);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const d = spread();
            if (v.pinch) zoomAt(d / v.pinch, [...pointers.current.values()].reduce((s, p) => s + p.y, 0) / 2);
            v.pinch = d;
            return;
          }
          if (!v.pressed) return;
          const dy = e.clientY - v.lastY;
          v.lastY = e.clientY;
          if (!v.dragging) {
            if (Math.abs(e.clientY - v.downY) < 4) return;
            v.dragging = v.moved = true;
            v.tc = v.c;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.style.cursor = "grabbing";
            setHover(null);
          }
          v.tc += dy / (Math.exp(v.z) * v.fit);
          wake.current();
        }}
        onPointerUp={(e) => {
          const v = view.current;
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) v.pinch = 0;
          if (!pointers.current.size) v.pressed = v.dragging = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grab";
          wake.current();
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          view.current.pinch = 0;
          view.current.pressed = view.current.dragging = false;
        }}
        onPointerLeave={() => setHover(null)}
        onClickCapture={(e) => {
          if (!view.current.moved) return;
          e.preventDefault();
          e.stopPropagation();
          view.current.moved = false;
        }}
        onClick={dive}
      >
        <canvas ref={canvasRef} className="infinite-spiral__lines" />
        <div className="infinite-spiral__stage" role="list" aria-label="Calendar">
          {days.map((d) => {
            const date = new Date(d * DAY);
            const list = byDay.get(d) ?? [];
            const newYear = date.getUTCMonth() === 0 && date.getUTCDate() === 1;
            return (
              <button
                key={d}
                ref={refFor(d)}
                type="button"
                role="listitem"
                aria-label={fmt(d)}
                onClick={() => onOpenDay(isoOf(d))}
                className={cn("infinite-spiral__item spiral-day", d === today && "is-today", d < today && "is-past")}
                style={{ width: CARD_W, height: CARD_H, borderRadius: CARD_RADIUS }}
              >
                <div className="spiral-day__body h-full">
                  {titles ? (
                    <>
                      <div className="flex items-baseline gap-1.5 leading-none">
                        <span className="text-[15px] font-semibold tabular-nums">{date.getUTCDate()}</span>
                        <span className="text-[10px] text-muted-foreground">{WEEKDAYS[date.getUTCDay()]}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {MONTHS[date.getUTCMonth()]}{newYear && ` ${date.getUTCFullYear()}`}
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {list.slice(0, 2).map((t, i) => (
                          <div key={t.id} className="flex items-center gap-1 text-[10px] leading-tight">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(t) }} />
                            <span className={cn("min-w-0 flex-1 truncate", t.status === "complete" && "text-muted-foreground line-through")}>{t.title}</span>
                            {i === 1 && list.length > 2 && <span className="shrink-0 text-[9px] text-muted-foreground">+{list.length - 2}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full items-center gap-2">
                      <span className="text-[28px] font-semibold leading-none tabular-nums">{date.getUTCDate()}</span>
                      <div className="flex flex-wrap gap-1">
                        {list.slice(0, 8).map((t) => (
                          <span key={t.id} className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(t), opacity: t.status === "complete" ? 0.4 : 1 }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-3 z-10 text-sm font-semibold tabular-nums text-foreground">{label}</div>
      <div className="absolute right-3 top-2 z-10 flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={goToday} className={control}><Crosshair className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Today (T)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => zoomAt(0.5)} className={control}><ZoomOut className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (−, Ctrl + wheel)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => zoomAt(2)} className={control}><ZoomIn className="h-4 w-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (+, Ctrl + wheel)</TooltipContent>
        </Tooltip>
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[16rem] rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="flex items-center gap-1.5 font-medium">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hover.span.color }} />
            <span className="truncate">{hover.span.title}</span>
          </div>
          <div className="tabular-nums text-muted-foreground">
            {fmt(hover.span.start)} – {hover.span.end === null ? "…" : fmt(hover.span.end)}
          </div>
        </div>
      )}
    </div>
  );
}
