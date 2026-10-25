// Depth calendar (owner, 2026-10-25): the React Bits "DepthCarousel" turned into time. We look ahead: the days stand
// one behind the other, up toward the horizon, the future in a soft colour haze; the day in focus is in front. As
// time moves on (wheel, drag, arrows, autoplay) the days come toward us and pass through. A card holds the day's
// tasks and its memory (a note Memories/<date>.md and the photos sent to the bot that day; the first picture fills
// the card). Click a day → it comes to the front; click the front day → the day opens.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import gsap from "gsap";
import { BookHeart, ChevronDown, ChevronUp, Crosshair, Pause, Play } from "lucide-react";
import type { Task } from "@/context/AppContext";
import type { TreeNode } from "@/lib/strategy";
import { useAuth } from "@/context/AuthContext";
import { localDay } from "@/hooks/useGoogleEvents";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ensureMemory, loadMemories } from "@/lib/memories";
import { vault } from "@/lib/vault";
import { cn } from "@/lib/utils";
import "./DepthCalendar.css";

// The owner's settings on reactbits.dev (tilt turned upward; blur 0 → a little, owner: "the back a bit blurred") …
const CARD_W = 420, CARD_H = 220, RADIUS = 44, VISIBLE = 5, DURATION = 1150, FALLOFF = 0.22, DEPTH = 170, SPREAD = 130,
  TILT = 17, PERSPECTIVE = 1100, BLUR = 2;
// … and the component's defaults.
const EASE = "power3.out", AUTOPLAY_DELAY = 3200;
// Upward the stack needs height, not width: the day in front sits low (ANCHOR of the height), the horizon is at
// ORIGIN, and the step up per day (at most SPREAD) is what lets the 5th day still show under the top edge.
const ANCHOR = 0.68, ORIGIN = 0.25, MIN_RISE = 40;
const AHEAD = 14; // autoplay walks this many days ahead of today, then starts again at today
// Soft colours of the future (owner: light blue, or another positive colour — light green, orange — nothing sharp).
const HAZES = [
  { name: "Sky", color: "#a8d5f7" },
  { name: "Mint", color: "#b3e5c9" },
  { name: "Peach", color: "#f8caa2" },
];

const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
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

// Where the top (edge −1) or bottom (+1) of day d lands on screen, in px from the top: the same transform as layout()
// under CSS perspective.
function edgeY(h: number, sc: number, rise: number, d: number, edge: number) {
  const rx = (TILT * clamp(d, 0, 1) * Math.PI) / 180;
  const y = ANCHOR * h + sc * (-rise * d + (edge * CARD_H * Math.cos(rx)) / 2);
  const z = sc * (-DEPTH * d + (edge * CARD_H * Math.sin(rx)) / 2);
  return ORIGIN * h + ((y - ORIGIN * h) * PERSPECTIVE) / (PERSPECTIVE - z);
}

// The biggest cards (≤ 1) and step up (≤ SPREAD) that keep the front day and the 5th day ahead on screen.
function fit(w: number, h: number) {
  for (let sc = clamp(w / (CARD_W + 120), 0.4, 1); ; sc -= 0.05) {
    const fits = (rise: number) => edgeY(h, sc, rise, VISIBLE, -1) >= 0.05 * h && edgeY(h, sc, rise, 0, 1) <= 0.98 * h;
    if (fits(MIN_RISE) || sc <= 0.4) {
      let lo = MIN_RISE, hi = SPREAD;
      if (fits(hi)) lo = hi;
      else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      return { sc: Math.max(sc, 0.4), rise: lo };
    }
  }
}

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
  const cards = useRef(new Map<number, Card>());
  const refFns = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const posRef = useRef(today);
  const focusRef = useRef(today);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const scaleRef = useRef(1);
  const riseRef = useRef(SPREAD);
  const dragRef = useRef<{ y: number; startPos: number; lastY: number; lastT: number; v: number; moved: boolean; id: number } | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const reducedRef = useRef(false);

  const [focus, setFocusState] = useState(today);
  const [center, setCenter] = useState(today); // the rendered days are around this one
  const centerRef = useRef(today);
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
    m.forEach((list) => list.sort((a, b) => a.position - b.position));
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

  // ── React Bits DepthCarousel: layout, tween, focus (sideways → upward, loop → endless days) ──
  const layout = useCallback((pos: number) => {
    const sc = scaleRef.current;
    for (const [day, card] of cards.current) {
      const d = day - pos;
      const back = Math.max(0, d);
      const shown = Math.abs(d) <= VISIBLE + 0.5;

      const tz = -DEPTH * d;
      const ty = -riseRef.current * d; // up toward the horizon (the original goes sideways: translateX)
      const rx = TILT * clamp(d, 0, 1); // leaning back (the original turns: rotateY)

      let opacity = d < 0 ? Math.max(0, 1 + d) : 1;
      if (!shown) opacity = 0;

      const brightness = Math.max(0.15, 1 - back * FALLOFF);
      const blurPx = BLUR > 0 ? Math.min(BLUR, (back / Math.max(1, VISIBLE)) * BLUR) : 0;
      const zi = Math.round(2000 - d * 20);

      const el = card.el;
      el.style.transform = `translate(-50%, -50%) scale(${sc}) translateY(${ty.toFixed(2)}px) translateZ(${tz.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg)`;
      el.style.opacity = opacity.toFixed(3);
      el.style.filter = `blur(${blurPx.toFixed(2)}px)`;
      el.style.zIndex = String(zi);
      el.style.pointerEvents = shown && opacity > 0.05 ? "auto" : "none";
      el.style.visibility = "visible";
      // The day itself dims with the distance; the haze over it does not, so the far future looks light, not dark.
      if (card.content) card.content.style.filter = `brightness(${brightness.toFixed(3)})`;
      if (card.haze) card.haze.style.opacity = clamp(back * FALLOFF * 1.25, 0, 0.86).toFixed(3);
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

  const setFocus = useCallback((day: number, animate = true) => {
    tweenTo(day, animate);
    if (day !== focusRef.current) {
      focusRef.current = day;
      setFocusState(day);
    }
  }, [tweenTo]);

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
      // The original fits the width (cards + spread sideways); upward the stack has to fit the height.
      const f = fit(width, height);
      scaleRef.current = f.sc;
      riseRef.current = f.rise;
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

  // Autoplay (owner's setting): one day closer every few seconds, paused while the pointer or focus is inside;
  // after two weeks ahead it starts again at today.
  useEffect(() => {
    reducedRef.current = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!autoplay || reducedRef.current) return;
    const root = rootRef.current;
    let hovered = false;
    let focused = false;
    const timer = window.setInterval(() => {
      if (hovered || focused) return;
      if (focusRef.current >= today + AHEAD || focusRef.current < today) setFocus(today, false);
      else navigateBy(1);
    }, Math.max(AUTOPLAY_DELAY, 600));
    autoTimerRef.current = timer;
    const onEnter = () => (hovered = true);
    const onLeave = () => (hovered = false);
    const onFocusIn = () => (focused = true);
    const onFocusOut = () => (focused = false);
    root?.addEventListener("mouseenter", onEnter);
    root?.addEventListener("mouseleave", onLeave);
    root?.addEventListener("focusin", onFocusIn);
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      clearInterval(timer);
      root?.removeEventListener("mouseenter", onEnter);
      root?.removeEventListener("mouseleave", onLeave);
      root?.removeEventListener("focusin", onFocusIn);
      root?.removeEventListener("focusout", onFocusOut);
    };
  }, [autoplay, today, navigateBy, setFocus]);

  useEffect(() => () => {
    tweenRef.current?.kill();
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
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

  return (
    <div className="glass-card relative h-[calc(100vh-12rem)] min-h-[420px] overflow-hidden">
      <div
        ref={rootRef}
        className="depth-cal"
        style={{ "--dc-perspective": `${PERSPECTIVE}px`, "--haze": haze.color, perspectiveOrigin: `50% ${ORIGIN * 100}%` } as React.CSSProperties}
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
        <div className="depth-cal__stage">
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
                style={{ width: CARD_W, height: CARD_H, borderRadius: RADIUS, top: `${ANCHOR * 100}%` }}
              >
                <div className="depth-cal__content">
                  {picture && <img className="depth-cal__img" src={picture} alt="" draggable={false} />}
                  <div className="depth-cal__body">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-semibold leading-none tabular-nums">{date.getUTCDate()}</span>
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
                    <div className="mt-3 space-y-1">
                      {list.slice(0, 4).map((t, i) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm leading-tight">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(t) }} />
                          <span className={cn("min-w-0 flex-1 truncate", t.status === "complete" && "line-through opacity-60")}>{t.title}</span>
                          {i === 3 && list.length > 4 && <span className="shrink-0 text-xs opacity-60">+{list.length - 4}</span>}
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
