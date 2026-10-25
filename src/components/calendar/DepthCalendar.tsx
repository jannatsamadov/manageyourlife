// Depth calendar (owner, 2026-10-25): the React Bits "DepthCarousel" turned into time — an abstract road into the
// future. The days stand on a flat road one behind the other, hinged at their bottom edge and leaning back, and run
// to a vanishing point on the horizon (one-point perspective: nothing is lifted by hand, the perspective lifts them);
// the far ones dissolve in a soft colour haze. As time moves on (autoplay rolls slowly; wheel, drag, arrows) the days
// come toward us and pass through. A card holds the day's tasks and its memory (a note Memories/<date>.md and the
// photos sent to the bot that day; the first picture fills the card). Click a day → it comes to the front; click the
// front day → the day opens.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import gsap from "gsap";
import { BookHeart, ChevronDown, ChevronUp, Crosshair, Pause, Play } from "lucide-react";
import type { Task } from "@/context/AppContext";
import type { TreeNode } from "@/lib/strategy";
import { useAuth } from "@/context/AuthContext";
import { localDay } from "@/hooks/useGoogleEvents";
import { TimeTag } from "@/components/TimingFields";
import { byTime } from "@/lib/timing";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ensureMemory, loadMemories } from "@/lib/memories";
import { vault } from "@/lib/vault";
import { cn } from "@/lib/utils";
import "./DepthCalendar.css";

// The owner's settings (reactbits.dev, then for the road, 2026-10-25: depth 420, perspective 1200–1500, tilt 18,
// 7–14 days, the card shape of the spiral view 164:72; "the back a bit blurred") …
const CARD_W = 420, CARD_H = 184, RADIUS = 44, VISIBLE = 14, DURATION = 1150, FALLOFF = 0.22, DEPTH = 420, TILT = 18,
  PERSPECTIVE = 1300, BLUR = 2.5;
// … and the component's defaults.
const EASE = "power3.out", AUTOPLAY_DELAY = 3200;
// The road: the front day's bottom edge at BOTTOM of the height, the horizon (eye level, vanishing point) at HORIZON.
const BOTTOM = 0.92, HORIZON = 0.18;
// The owner's falloff was for 5 days; spread over the longer road so the haze grows to the same at its far end.
const FALLOFF_STEP = (FALLOFF * 5) / VISIBLE;
const AHEAD = 14; // autoplay rolls this many days ahead of today, then starts again at today
// Colours of the future: soft, nothing sharp (owner: light blue, light green, orange — and a neutral one).
const HAZES = [
  { name: "Sky", color: "#a8d5f7" },
  { name: "Mint", color: "#b3e5c9" },
  { name: "Peach", color: "#f8caa2" },
  { name: "Neutral", color: "#d6d3d1" },
];

const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const smoothstep = (min: number, max: number, v: number) => {
  const x = clamp((v - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
};
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

type Card = { el: HTMLDivElement; content: HTMLElement | null; haze: HTMLElement | null };

// The front card as big as the width allows and at most about a third of the height (the road needs the rest).
const fitScale = (w: number, h: number) => clamp(Math.min(w / (CARD_W + 120), (0.36 * h) / CARD_H), 0.4, 1);

function Icon({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} className={cn("rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground", active && "text-primary")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function DepthCalendar({ tasks, byId, onOpenDay }: {
  tasks: Task[];
  byId: Map<string, TreeNode>;
  onOpenDay: (day: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = useMemo(() => dayOf(localDay(new Date())), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<number, Card>());
  const refFns = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const posRef = useRef(today);
  const focusRef = useRef(today);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const scaleRef = useRef(1);
  const dragRef = useRef<{ y: number; startPos: number; lastY: number; lastT: number; v: number; moved: boolean; id: number } | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedRef = useRef(false);

  const [focus, setFocusState] = useState(today);
  const [center, setCenter] = useState(today); // the rendered days are around this one
  const centerRef = useRef(today);
  const [size, setSize] = useState({ w: 0, h: 0, sc: 1 }); // for the road's edge lines
  const [autoplay, setAutoplay] = useState(() => remember.get("depth.autoplay") !== "off");
  const [haze, setHaze] = useState(() => HAZES.find((h) => h.name === remember.get("depth.haze")) ?? HAZES[0]);

  const byDay = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!t.date || t.status === "abandoned") continue;
      const d = dayOf(t.date);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    m.forEach((list) => list.sort(byTime)); // timed ones (events, time blocks) first, by time
    return m;
  }, [tasks]);
  const colorOf = (t: Task) => (t.nodeId && byId.get(t.nodeId)?.color) || "hsl(var(--muted-foreground))";

  const days = useMemo(() => Array.from({ length: VISIBLE + 14 }, (_, i) => center - 6 + i), [center]);

  // Memories and the links of the pictures on screen (signed links live an hour).
  const memories = useQuery({ queryKey: ["memories", user?.id], queryFn: loadMemories, enabled: !!user, staleTime: 60_000 });
  const pictures = useMemo(() => {
    const out: string[] = [];
    for (const d of days) {
      const first = memories.data?.get(isoOf(d))?.images[0];
      if (first) out.push(first);
    }
    return out;
  }, [days, memories.data]);
  const urls = useQuery({
    queryKey: ["vault-urls", user?.id, pictures],
    enabled: !!user && pictures.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => (await vault<{ urls: Record<string, string> }>("urls", { paths: pictures })).urls,
  });

  // ── React Bits DepthCarousel: layout, tween, focus (sideways → a road to the horizon, loop → endless days) ──
  const layout = useCallback((pos: number) => {
    const sc = scaleRef.current;
    for (const [day, card] of cards.current) {
      const d = day - pos;
      const back = Math.max(0, d);
      const shown = d > -1 && d <= VISIBLE + 0.5;

      const tz = -DEPTH * d; // straight back along the road (the original also goes sideways: translateX)
      const rx = TILT * clamp(d, 0, 1); // leaning back on its bottom edge (the original turns: rotateY)

      // Passing days fade as they come through us; the last ones melt into the horizon.
      let opacity = d < 0 ? Math.max(0, 1 + d) : 1 - smoothstep(VISIBLE - 3, VISIBLE + 0.5, d);
      if (!shown) opacity = 0;

      const brightness = Math.max(0.15, 1 - back * FALLOFF_STEP);
      const blurPx = BLUR > 0 ? Math.min(BLUR, (back / Math.max(1, VISIBLE)) * BLUR) : 0;
      const zi = Math.round(2000 - d * 20);

      const el = card.el;
      el.style.transform = `translate(-50%, -100%) scale(${sc}) translateZ(${tz.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg)`;
      el.style.opacity = opacity.toFixed(3);
      el.style.filter = blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : "none";
      el.style.zIndex = String(zi);
      el.style.pointerEvents = shown && opacity > 0.05 ? "auto" : "none";
      el.style.visibility = shown ? "visible" : "hidden";
      // The day itself dims with the distance; the haze over it does not, so the far future looks light, not dark.
      if (card.content) card.content.style.filter = `brightness(${brightness.toFixed(3)})`;
      if (card.haze) card.haze.style.opacity = clamp(back * FALLOFF_STEP * 1.25, 0, 0.86).toFixed(3);
    }
    // Days come and go around the one in front.
    const near = Math.round(pos);
    if (Math.abs(near - centerRef.current) > 3) {
      centerRef.current = near;
      setCenter(near);
    }
  }, []);

  const tweenTo = useCallback((target: number, animate: boolean) => {
    tweenRef.current?.kill();
    const proxy = { p: posRef.current };
    const dur = animate && !reducedRef.current ? DURATION / 1000 : 0;
    tweenRef.current = gsap.to(proxy, {
      p: target,
      duration: dur,
      ease: EASE,
      onUpdate: () => {
        posRef.current = proxy.p;
        layout(proxy.p);
      },
      onComplete: () => layout(posRef.current),
    });
  }, [layout]);

  const markFocus = useCallback((day: number) => {
    if (day !== focusRef.current) {
      focusRef.current = day;
      setFocusState(day);
    }
  }, []);

  const setFocus = useCallback((day: number, animate = true) => {
    tweenTo(day, animate);
    markFocus(day);
  }, [tweenTo, markFocus]);

  const navigateBy = useCallback((step: number) => setFocus(focusRef.current + step, true), [setFocus]);

  // One stable ref per day card; a new card is placed before it is painted.
  const refFor = (d: number) => {
    let f = refFns.current.get(d);
    if (!f) {
      f = (el) => {
        if (el) {
          el.style.visibility = "hidden";
          cards.current.set(d, { el, content: el.querySelector(".depth-cal__content"), haze: el.querySelector(".depth-cal__haze") });
          layout(posRef.current);
        } else {
          cards.current.delete(d);
          refFns.current.delete(d);
        }
      };
      refFns.current.set(d, f);
    }
    return f;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      scaleRef.current = fitScale(width, height);
      setSize({ w: width, h: height, sc: scaleRef.current });
      layout(posRef.current);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [layout]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      tweenRef.current?.kill();
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const delta = e.deltaMode === 1 ? raw * 24 : raw;
      const step = clamp(delta / (CARD_W * 0.9), -0.6, 0.6);
      posRef.current += step;
      layout(posRef.current);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => setFocus(Math.round(posRef.current), true), 130);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [layout, setFocus]);

  // Drag down = pull the coming days toward you (the original drags sideways).
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    tweenRef.current?.kill();
    dragRef.current = { y: e.clientY, startPos: posRef.current, lastY: e.clientY, lastT: performance.now(), v: 0, moved: false, id: e.pointerId };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const stepPx = Math.max(CARD_H * 0.55 * scaleRef.current, 40);
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 4) {
      drag.moved = true;
      rootRef.current?.setPointerCapture(drag.id);
    }
    if (!drag.moved) return;
    const now = performance.now();
    const dt = Math.max(now - drag.lastT, 1);
    drag.v = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = now;
    posRef.current = drag.startPos + dy / stepPx;
    layout(posRef.current);
  }, [layout]);
  const onPointerEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      dragRef.current = null;
      return;
    }
    const stepPx = Math.max(CARD_H * 0.55 * scaleRef.current, 40);
    setFocus(Math.round(posRef.current + (drag.v * 180) / stepPx), true);
    setTimeout(() => (dragRef.current = null)); // the click after a drag is not a click
  }, [setFocus]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      navigateBy(1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      navigateBy(-1);
    }
  }, [navigateBy]);

  const onCardClick = (day: number) => {
    if (dragRef.current?.moved) return;
    if (day === focusRef.current) onOpenDay(isoOf(day));
    else setFocus(day, true);
  };

  // Autoplay (owner: "roll slowly, not a card at once every 3.2 s"): the road moves on all the time, one day per
  // AUTOPLAY_DELAY; it waits while the pointer or the focus is inside or a move is running; after AHEAD days it fades
  // back to today.
  useEffect(() => {
    reducedRef.current = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!autoplay || reducedRef.current) return;
    const root = rootRef.current;
    const stage = stageRef.current;
    let hovered = false;
    let focused = false;
    let wrapping = false;
    let last = performance.now();
    let raf = 0;
    const perDay = AUTOPLAY_DELAY / 1000;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const busy = hovered || focused || wrapping || !!dragRef.current || !!tweenRef.current?.isActive();
      if (!busy) {
        if (posRef.current >= today + AHEAD || posRef.current < today - 0.5) {
          // Back to today without rolling back through the days: fade out, jump, fade in.
          wrapping = true;
          if (stage) stage.style.opacity = "0";
          window.setTimeout(() => {
            posRef.current = today;
            layout(today);
            markFocus(today);
            if (stage) stage.style.opacity = "1";
            window.setTimeout(() => (wrapping = false), 500);
          }, 500);
        } else {
          posRef.current += dt / perDay;
          layout(posRef.current);
          markFocus(Math.round(posRef.current));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onEnter = () => (hovered = true);
    const onLeave = () => (hovered = false);
    const onFocusIn = () => (focused = true);
    const onFocusOut = () => (focused = false);
    root?.addEventListener("mouseenter", onEnter);
    root?.addEventListener("mouseleave", onLeave);
    root?.addEventListener("focusin", onFocusIn);
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      if (stage) stage.style.opacity = "1";
      root?.removeEventListener("mouseenter", onEnter);
      root?.removeEventListener("mouseleave", onLeave);
      root?.removeEventListener("focusin", onFocusIn);
      root?.removeEventListener("focusout", onFocusOut);
    };
  }, [autoplay, today, layout, markFocus]);

  useEffect(() => () => {
    tweenRef.current?.kill();
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
  }, []);

  const toggleAutoplay = () => {
    setAutoplay((v) => {
      remember.set("depth.autoplay", v ? "off" : "on");
      return !v;
    });
  };
  const pickHaze = (h: (typeof HAZES)[number]) => {
    setHaze(h);
    remember.set("depth.haze", h.name);
  };
  const openMemory = async (day: number) => {
    try {
      const path = await ensureMemory(isoOf(day), fmt(day));
      qc.invalidateQueries({ queryKey: ["memories", user?.id] });
      navigate(`/notes?open=${encodeURIComponent(path)}`);
    } catch (e) {
      toast({ title: "Not opened", description: (e as Error).message, variant: "destructive" });
    }
  };

  // The road's edges: from the front day's bottom corners to the vanishing point (leading lines).
  const road = size.w > 0 && (() => {
    const half = (CARD_W * size.sc) / 2 + 24;
    const cx = size.w / 2, hy = HORIZON * size.h;
    return { left: `${cx - half},${size.h} ${cx},${hy}`, right: `${cx + half},${size.h} ${cx},${hy}`, fill: `${cx - half},${size.h} ${cx},${hy} ${cx + half},${size.h}` };
  })();

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      <div
        ref={rootRef}
        className="depth-cal"
        style={{ "--dc-perspective": `${PERSPECTIVE}px`, "--haze": haze.color, "--horizon": `${HORIZON * 100}%`, perspectiveOrigin: `50% ${HORIZON * 100}%` } as React.CSSProperties}
        role="group"
        aria-roledescription="carousel"
        aria-label="Days ahead"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        {road && (
          <svg className="depth-cal__road" width={size.w} height={size.h} aria-hidden>
            <defs>
              <linearGradient id="depth-road" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" style={{ stopColor: "var(--haze)", stopOpacity: 0.16 }} />
                <stop offset="1" style={{ stopColor: "var(--haze)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <polygon points={road.fill} fill="url(#depth-road)" />
            <polyline points={road.left} />
            <polyline points={road.right} />
          </svg>
        )}
        <div className="depth-cal__stage" ref={stageRef}>
          {days.map((d) => {
            const date = new Date(d * DAY);
            const list = byDay.get(d) ?? [];
            const memory = memories.data?.get(isoOf(d));
            const picture = memory?.images[0] && urls.data?.[memory.images[0]];
            return (
              <div
                key={d}
                ref={refFor(d)}
                role="button"
                aria-label={fmt(d)}
                aria-hidden={focus !== d}
                onClick={() => onCardClick(d)}
                className={cn("depth-cal__card group", d === today && "is-today", d < today && "is-past", picture && "has-picture")}
                style={{ width: CARD_W, height: CARD_H, borderRadius: RADIUS, top: `${BOTTOM * 100}%` }}
              >
                <div className="depth-cal__content">
                  {picture && <img className="depth-cal__img" src={picture} alt="" draggable={false} />}
                  <div className="depth-cal__body">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-semibold leading-none tabular-nums">{date.getUTCDate()}</span>
                      <span className="text-sm opacity-80">{WEEKDAYS[date.getUTCDay()]}</span>
                      <span className="text-sm opacity-60">
                        {MONTHS[date.getUTCMonth()]}{date.getUTCFullYear() !== new Date(today * DAY).getUTCFullYear() && ` ${date.getUTCFullYear()}`}
                      </span>
                      {d === today && <span className="depth-cal__today">Today</span>}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openMemory(d); }}
                            className={cn("ml-auto rounded-full p-1.5 transition-opacity hover:bg-white/15", memory?.note ? "opacity-80" : "opacity-0 group-hover:opacity-80")}
                          >
                            <BookHeart className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Memory</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="mt-2 space-y-1">
                      {list.slice(0, 3).map((t, i) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm leading-tight">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(t) }} />
                          <TimeTag task={t} className="text-xs opacity-70" />
                          <span className={cn("min-w-0 flex-1 truncate", t.status === "complete" && "line-through opacity-60")}>{t.title}</span>
                          {i === 2 && list.length > 3 && <span className="shrink-0 text-xs opacity-60">+{list.length - 3}</span>}
                        </div>
                      ))}
                    </div>
                    {memory?.excerpt && <p className="depth-cal__memory">{memory.excerpt}</p>}
                  </div>
                </div>
                <span className="depth-cal__haze" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-3 z-[3000] text-sm font-semibold tabular-nums text-foreground">{fmt(focus)}</div>
      <div className="absolute right-3 top-2 z-[3000] flex items-center gap-0.5">
        {HAZES.map((h) => (
          <Tooltip key={h.name}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => pickHaze(h)}
                className={cn("mx-0.5 h-4 w-4 rounded-full border transition-transform", haze.name === h.name ? "scale-110 border-foreground/60" : "border-transparent opacity-70 hover:opacity-100")}
                style={{ background: h.color }}
              />
            </TooltipTrigger>
            <TooltipContent>{h.name}</TooltipContent>
          </Tooltip>
        ))}
        <Icon label={autoplay ? "Pause" : "Play"} onClick={toggleAutoplay} active={autoplay}>
          {autoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Icon>
        <Icon label="Today" onClick={() => setFocus(today, true)}><Crosshair className="h-4 w-4" /></Icon>
      </div>
      <div className="absolute bottom-4 right-3 z-[3000] flex flex-col gap-1">
        <Icon label="Later" onClick={() => navigateBy(1)}><ChevronUp className="h-4 w-4" /></Icon>
        <Icon label="Earlier" onClick={() => navigateBy(-1)}><ChevronDown className="h-4 w-4" /></Icon>
      </div>
    </div>
  );
}
