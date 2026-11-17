// The tunnel of time (P-62, T-94): you stand inside a passage and look along time. Its depth is time; zoom is how
// much time a stretch of the passage holds — from several years ahead down to quarter hours, continuously. Nothing
// switches between "modes": every kind of mark (years, months, weeks, days, hours, quarter hours) is a ring around
// the passage and shows as soon as its rings stand far enough apart on screen, so zooming in lets finer rings grow
// out of the coarse ones and zooming out lets them melt away.
//  - Floor: one tile a day. Far out the tiles lie as a GitHub-like activity year (7 lanes, a row a week, bars as
//    high as the day is full); zooming in they unfold into a road of days, and closer still each day narrows to its
//    waking hours so a dark band of night lies between days.
//  - Ceiling: long goals and missions as light rails (start → due; the part already lived is brighter).
//  - Walls: the day's tasks and memories as cards, by day when a day is short on screen, at their hour when hours
//    are long enough; the cards glide between the two layouts.
// WebGL (three.js) draws the passage; the cards and labels are HTML placed in the same 3-D space (CSS3DRenderer), so
// text stays sharp and photos need no CORS.
import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, VignetteEffect } from "postprocessing";
import type { Span } from "@/lib/spans";
import { LANES, OPEN_TAIL } from "@/lib/spans";
import { LEVELS, STOPS, UNIT, headingOf, labelOf, marks, nowTime, weekdayOf, type Level } from "./time";

export type DayStat = { total: number; done: number; open: number; photos: number };
export type TunnelCard = {
  id: string;
  kind: "task" | "memory";
  day: number;
  time: number | null; // fraction of the day, null = no time
  title: string;
  meta: string;
  color: string;
  done?: boolean;
  event?: boolean;
  deadline?: boolean;
  image?: string | null;
  tall?: boolean;
};
export type TunnelMode = "tasks" | "gallery";
export type TunnelHover =
  | { kind: "day"; day: number; x: number; y: number }
  | { kind: "span"; span: Span; x: number; y: number }
  | null;
export type TunnelEvents = {
  heading: (text: string, stop: number) => void;
  zoom: (frac: number) => void;
  focusDay: (day: number) => void;
  hover: (h: TunnelHover) => void;
  openDay: (day: number) => void;
  openCard: (card: TunnelCard) => void;
};

// ── The passage ──
const W = 9, H = 5.6, HW = W / 2, HH = H / 2;
const DZ = 7; // the time in focus stands this far ahead of the eye
const FAR = 100, FOG_NEAR = 14;
const SPAN_DEPTH = 80; // a zoom stop's span fills this much of the passage
const CAM_Y = 0.35, TILT = -0.07;
const BG = "#0f1217"; // --background
const PRIMARY = "#19d39a";
export const kOfStop = (i: number) => SPAN_DEPTH / STOPS[i].span;
const Z_MIN = Math.log(kOfStop(0)), Z_MAX = Math.log(kOfStop(STOPS.length - 1));
export const stopFrac = (i: number) => (Math.log(kOfStop(i)) - Z_MIN) / (Z_MAX - Z_MIN);

// Rings: a level's rings show once they stand RING_MIN_PX apart on screen.
const RING_MIN_PX = 3.5, RING_POOL = 160;
const RING: Record<Level, { th: number; alpha: number; color: string }> = {
  year: { th: 0.08, alpha: 1, color: "#f4efe4" },
  month: { th: 0.045, alpha: 0.62, color: "#d6dfeb" },
  week: { th: 0.03, alpha: 0.42, color: "#a9bbd0" },
  day: { th: 0.02, alpha: 0.32, color: "#a9bbd0" },
  hour: { th: 0.014, alpha: 0.24, color: "#8fa3ba" },
  quarter: { th: 0.01, alpha: 0.13, color: "#8fa3ba" },
};
// Each level writes in its own place, so the levels never sit on each other.
type Align = "left" | "right" | "center";
const LABEL: Record<Level, { x: number; y: number; align: Align; size: number }> = {
  year: { x: 0, y: HH - 0.8, align: "center", size: 0.9 },
  month: { x: -HW + 0.35, y: HH - 0.45, align: "left", size: 0.42 },
  week: { x: HW - 0.35, y: HH - 0.45, align: "right", size: 0.3 },
  day: { x: -HW + 0.35, y: -HH + 0.45, align: "left", size: 0.36 },
  hour: { x: HW - 0.35, y: -HH + 0.42, align: "right", size: 0.26 },
  quarter: { x: HW - 0.35, y: -HH + 0.42, align: "right", size: 0.2 },
};
const LABEL_PX = 40, LABEL_BOX = 640; // labels are drawn this big and scaled down (sharp text)

// Floor tiles.
const CAP = 4200;
// Cards on the walls: turned ANG from facing you, so they read like pages opened from the wall.
const CARD_PX = 230, CW = 2.2, CARD_SCALE = CW / CARD_PX, ANG = 0.7;
const SLOT_H = 0.78, SLOT_TOP = 1.85, SLOTS = 4, SLOT_PX = SLOT_H / CARD_SCALE;
const COL_DAY = 0.2, COL_HOUR = 0.25 / 24, ALL_DAY_AT = 6.5 / 24;

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a || 1), 0, 1);
  return x * x * (3 - 2 * x);
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function frameGeometry(th: number) {
  const s = new THREE.Shape();
  s.moveTo(-HW, -HH).lineTo(HW, -HH).lineTo(HW, HH).lineTo(-HW, HH).closePath();
  const hole = new THREE.Path();
  hole.moveTo(-HW + th, -HH + th).lineTo(-HW + th, HH - th).lineTo(HW - th, HH - th).lineTo(HW - th, -HH + th).closePath();
  s.holes.push(hole);
  return new THREE.ShapeGeometry(s);
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.32)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const additive = (color: string, opacity: number, fog = true) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog });

// Labels come from one pool, taken afresh every frame.
type Label = { obj: CSS3DObject; el: HTMLDivElement; text: string; cls: string; color: string };
class LabelPool {
  items: Label[] = [];
  used = 0;
  constructor(private scene: THREE.Scene) {}
  begin() {
    this.used = 0;
  }
  take(text: string, cls: string, color = "") {
    let it = this.items[this.used];
    if (!it) {
      const el = document.createElement("div");
      el.style.width = `${LABEL_BOX}px`;
      const obj = new CSS3DObject(el);
      this.scene.add(obj);
      it = { obj, el, text: "", cls: "", color: "" };
      this.items.push(it);
    }
    this.used++;
    if (it.text !== text) it.el.textContent = it.text = text;
    if (it.cls !== cls) it.el.className = it.cls = cls;
    if (it.color !== color) it.el.style.color = it.color = color;
    it.obj.visible = true;
    return it;
  }
  end() {
    for (let i = this.used; i < this.items.length; i++) this.items[i].obj.visible = false;
  }
}

type Place = { t: number; side: number; slot: number };
type CardItem = { card: TunnelCard; sig: string; size: number; day: Place; hour: Place; obj: CSS3DObject | null };

export class TunnelEngine {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private css: CSS3DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.1, 200);
  private w = 1;
  private h = 1;
  private focal = 500;

  // f = time in focus, z = log(world units per day); t… = where they are heading, rate… = how fast.
  private f: number;
  private tf: number;
  private z: number;
  private tz: number;
  private rateF = 10;
  private rateZ = 9;
  private look = { x: 0, y: 0, tx: 0, ty: 0 };
  private now = nowTime();
  private today = Math.floor(this.now);
  private reduced = false;

  private stats = new Map<number, DayStat>();
  private mode: TunnelMode = "tasks";
  private spans: Span[] = [];
  private cardsIn: TunnelCard[] = [];
  private items: CardItem[] = [];
  private itemById = new Map<string, CardItem>();

  private shell: THREE.Mesh;
  private rings = {} as Record<Level, THREE.Mesh[]>;
  private ringGeos: THREE.BufferGeometry[] = [];
  private tiles: THREE.InstancedMesh;
  private tileDays = new Int32Array(CAP);
  private rails: { span: Span; past: THREE.Mesh; future: THREE.Mesh }[] = [];
  private railGeo = new THREE.BoxGeometry(1, 1, 1);
  private nowGate: THREE.Mesh;
  private nowVeil: THREE.Mesh;
  private nowLabel: CSS3DObject;
  private labels: LabelPool;
  private glowTex: THREE.Texture;

  private frame = 0;
  private last = 0;
  private hoverDay: number | null = null;
  private hoverSpan: string | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { id: number; y0: number; f0: number; lastY: number; lastT: number; v: number; moved: boolean } | null = null;
  private pinch = 0;
  private suppressClick = false;
  private emitted = { heading: "", stop: -1, day: NaN };
  private timer: ReturnType<typeof setInterval>;
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private m4 = new THREE.Matrix4();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private col = new THREE.Color();
  private C = {
    base: new THREE.Color("#1b212b"),
    weekend: new THREE.Color("#161b23"),
    done: new THREE.Color("hsl(160, 84%, 44%)"),
    plan: new THREE.Color("#8cc8f5"),
    miss: new THREE.Color("#c98a3a"),
    photo: new THREE.Color("#f3b6c8"),
    white: new THREE.Color("#ffffff"),
  };

  constructor(private host: HTMLDivElement, private events: TunnelEvents, opts: { stop: number }) {
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.f = this.tf = this.now;
    this.tz = Math.log(kOfStop(clamp(opts.stop, 0, STOPS.length - 1)));
    // First look: from years away down to the chosen stop.
    this.z = this.reduced ? this.tz : Z_MIN;
    this.rateZ = 1.7;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(BG);
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(4, this.renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(
      this.camera,
      new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.22, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 }),
      new VignetteEffect({ offset: 0.32, darkness: 0.62 }),
    ));
    this.css = new CSS3DRenderer();
    this.css.domElement.className = "tunnel__css";
    host.appendChild(this.renderer.domElement);
    host.appendChild(this.css.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, FOG_NEAR, FAR);
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, CAM_Y, 0);

    // The shell: walls, ceiling, floor (also what the pointer is aimed at).
    const LEN = FAR + 24;
    const wall = (c: string) => new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide });
    this.shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, LEN), [wall("#141922"), wall("#141922"), wall("#10141b"), wall("#0c0f14"), wall(BG), wall(BG)]);
    this.shell.position.z = -LEN / 2 + 8;
    scene.add(this.shell);
    // Light along the four edges.
    for (const [x, y] of [[-HW, -HH], [HW, -HH], [-HW, HH], [HW, HH]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, LEN), additive("#5d7390", y < 0 ? 0.5 : 0.3));
      edge.position.set(x + (x < 0 ? 0.015 : -0.015), y + (y < 0 ? 0.015 : -0.015), this.shell.position.z);
      scene.add(edge);
    }
    // The far future glows.
    this.glowTex = glowTexture();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 3.2, H * 2.8), new THREE.MeshBasicMaterial({
      map: this.glowTex, color: "#79b4e6", transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glow.position.set(0, 0, -(FAR - 3));
    scene.add(glow);

    for (const L of LEVELS) {
      const geo = frameGeometry(RING[L].th);
      this.ringGeos.push(geo);
      this.rings[L] = Array.from({ length: RING_POOL }, () => {
        const m = new THREE.Mesh(geo, additive(RING[L].color, 0));
        m.visible = false;
        scene.add(m);
        return m;
      });
    }

    const nowGeo = frameGeometry(0.06);
    this.ringGeos.push(nowGeo);
    this.nowGate = new THREE.Mesh(nowGeo, additive(PRIMARY, 0.95));
    this.nowVeil = new THREE.Mesh(new THREE.PlaneGeometry(W, H), additive(PRIMARY, 0.045));
    scene.add(this.nowGate, this.nowVeil);
    const nowEl = document.createElement("div");
    nowEl.className = "tun-now";
    nowEl.innerHTML = "<span>Now</span>";
    this.nowLabel = new CSS3DObject(nowEl);
    this.nowLabel.scale.setScalar(0.32 / LABEL_PX);
    scene.add(this.nowLabel);

    this.tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAP);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.setColorAt(0, this.C.base);
    this.tiles.frustumCulled = false;
    this.tiles.count = 0;
    scene.add(this.tiles);
    // Lights for the floor's bars only (r155+ intensities: π ≈ full colour).
    scene.add(new THREE.AmbientLight(0xffffff, 1.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(0.3, 1, 0.6);
    scene.add(sun);

    this.labels = new LabelPool(scene);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.timer = setInterval(() => {
      this.now = nowTime();
      this.today = Math.floor(this.now);
      this.wake();
    }, 30_000);

    host.addEventListener("wheel", this.onWheel, { passive: false });
    host.addEventListener("pointerdown", this.onDown);
    host.addEventListener("pointermove", this.onMove);
    host.addEventListener("pointerup", this.onUp);
    host.addEventListener("pointercancel", this.onUp);
    host.addEventListener("pointerleave", this.onLeave);
    host.addEventListener("click", this.onClick);
    host.addEventListener("keydown", this.onKey);
    this.wake();
  }

  // ── Public controls ──
  setData(d: { stats: Map<number, DayStat>; spans: Span[]; cards: TunnelCard[]; mode: TunnelMode }) {
    this.stats = d.stats;
    if (d.spans !== this.spans) this.setSpans(d.spans);
    if (d.cards !== this.cardsIn || d.mode !== this.mode) {
      this.mode = d.mode;
      this.setCards(d.cards);
    }
    this.wake();
  }

  zoomBy(factor: number, clientX?: number, clientY?: number) {
    const z1 = clamp(this.tz + Math.log(factor), Z_MIN, Z_MAX);
    const dz = z1 - this.tz;
    // Zooming in also draws you toward the time you point at.
    if (dz > 0 && clientX !== undefined && clientY !== undefined) {
      const tp = this.timeUnder(clientX, clientY);
      if (tp !== null) this.tf += (tp - this.tf) * (1 - Math.exp(-dz * 0.9));
    }
    this.tz = z1;
    this.rateF = this.rateZ = 9;
    this.wake();
  }

  goStop(i: number) {
    this.tz = Math.log(kOfStop(clamp(i, 0, STOPS.length - 1)));
    this.rateZ = 4.5;
    this.wake();
  }

  goNow() {
    this.tf = this.now;
    this.rateF = 6;
    this.wake();
  }

  // Fly to a time: the time first (cheap while zoomed out), then the zoom.
  flyTo(t: number, stop: number) {
    this.tf = t;
    this.tz = Math.max(this.tz, Math.log(kOfStop(stop)));
    this.rateF = 7;
    this.rateZ = 3.2;
    this.wake();
  }

  step(dir: number) {
    this.tf += dir * STOPS[this.stopOf(this.tz)].step;
    this.rateF = 8;
    this.wake();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    clearInterval(this.timer);
    this.ro.disconnect();
    const h = this.host;
    h.removeEventListener("wheel", this.onWheel);
    h.removeEventListener("pointerdown", this.onDown);
    h.removeEventListener("pointermove", this.onMove);
    h.removeEventListener("pointerup", this.onUp);
    h.removeEventListener("pointercancel", this.onUp);
    h.removeEventListener("pointerleave", this.onLeave);
    h.removeEventListener("click", this.onClick);
    h.removeEventListener("keydown", this.onKey);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.glowTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css.domElement.remove();
  }

  // ── Time ↔ depth ──
  private k() {
    return Math.exp(this.z);
  }
  private distOf(t: number) {
    return DZ + (t - this.f) * this.k();
  }
  private timeAt(d: number) {
    return this.f + (d - DZ) / this.k();
  }
  private stopOf(z: number) {
    let best = 0;
    for (let i = 1; i < STOPS.length; i++) {
      if (Math.abs(z - Math.log(kOfStop(i))) < Math.abs(z - Math.log(kOfStop(best)))) best = i;
    }
    return best;
  }

  // ── Data ──
  private setSpans(spans: Span[]) {
    for (const r of this.rails) {
      this.scene.remove(r.past, r.future);
      (r.past.material as THREE.Material).dispose();
      (r.future.material as THREE.Material).dispose();
    }
    this.spans = spans;
    this.rails = spans.map((span) => {
      const past = new THREE.Mesh(this.railGeo, additive(span.color || "#9fb2c8", span.done ? 0.55 : 0.95));
      const future = new THREE.Mesh(this.railGeo, additive(span.color || "#9fb2c8", 0.3));
      past.userData.span = future.userData.span = span;
      this.scene.add(past, future);
      return { span, past, future };
    });
  }

  private sigOf(c: TunnelCard) {
    return [c.kind, c.day, c.time, c.title, c.meta, c.color, c.done, c.event, c.deadline, c.image, c.tall, c.day < this.today].join("|");
  }

  // Both layouts are worked out once per data change; the frame only blends between them.
  private setCards(cards: TunnelCard[]) {
    this.cardsIn = cards;
    const shown = this.mode === "gallery" ? cards.filter((c) => c.kind === "memory") : cards;
    const byDay = new Map<number, TunnelCard[]>();
    for (const c of shown) {
      if (!byDay.has(c.day)) byDay.set(c.day, []);
      byDay.get(c.day)!.push(c);
    }
    const next: CardItem[] = [];
    for (const [day, list] of byDay) {
      list.sort((a, b) => (a.kind === "memory" ? 0 : 1) - (b.kind === "memory" ? 0 : 1) || (a.time ?? 2) - (b.time ?? 2));
      const size = (c: TunnelCard) => (c.tall ? 2 : 1);
      // By day: both walls filled evenly, columns of SLOTS around the middle of the day.
      const st = new Map<number, { c: number; used: number; total: number }>([[-1, { c: 0, used: 0, total: 0 }], [1, { c: 0, used: 0, total: 0 }]]);
      const dayPlaces = list.map((c) => {
        const side = st.get(-1)!.total <= st.get(1)!.total ? -1 : 1;
        const s = st.get(side)!;
        if (s.used + size(c) > SLOTS) { s.c++; s.used = 0; }
        const p = { side, col: s.c, slot: s.used };
        s.used += size(c);
        s.total += size(c);
        return p;
      });
      // By hour: one column per hour (sides taking turns), the ones without a time at the start of the day.
      const buckets = new Map<number, TunnelCard[]>();
      for (const c of list) {
        const key = c.time === null ? -1 : Math.floor(c.time * 24);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(c);
      }
      const hourPlace = new Map<TunnelCard, Place>();
      [...buckets.keys()].sort((a, b) => a - b).forEach((key, i) => {
        const group = buckets.get(key)!;
        const side = key < 0 ? -1 : i % 2 === (buckets.has(-1) ? 1 : 0) ? 1 : -1;
        const t0 = key < 0 ? day + ALL_DAY_AT : day + Math.min(...group.map((c) => c.time!));
        let c0 = 0, used = 0;
        for (const c of group) {
          if (used + size(c) > SLOTS) { c0++; used = 0; }
          hourPlace.set(c, { t: t0 + c0 * COL_HOUR, side, slot: used });
          used += size(c);
        }
      });
      list.forEach((c, i) => {
        const p = dayPlaces[i];
        const cols = st.get(p.side)!.c + 1;
        const prev = this.itemById.get(c.id);
        const sig = this.sigOf(c);
        let obj = prev?.obj ?? null;
        if (obj && prev!.sig !== sig) {
          this.scene.remove(obj);
          obj.element.remove();
          obj = null;
        }
        next.push({
          card: c,
          sig,
          size: size(c),
          day: { t: day + 0.5 + (p.col - (cols - 1) / 2) * COL_DAY, side: p.side, slot: p.slot },
          hour: hourPlace.get(c)!,
          obj,
        });
      });
    }
    const keep = new Set(next.map((it) => it.obj).filter(Boolean));
    for (const it of this.items) {
      if (it.obj && !keep.has(it.obj)) {
        this.scene.remove(it.obj);
        it.obj.element.remove();
      }
    }
    this.items = next;
    this.itemById = new Map(next.map((it) => [it.card.id, it]));
  }

  private makeCard(it: CardItem) {
    const c = it.card;
    const wrap = document.createElement("div");
    wrap.className = "tun-cardwrap";
    wrap.style.width = `${CARD_PX}px`;
    wrap.style.height = `${Math.round(it.size * SLOT_PX - 12)}px`;
    const cls = ["tun-card"];
    if (c.kind === "memory") cls.push("tun-card--memory", c.image ? "has-img" : "no-img");
    if (c.done) cls.push("is-done");
    if (c.event) cls.push("is-event");
    if (c.deadline) cls.push("is-deadline");
    if (c.day < this.today) cls.push("is-past");
    wrap.innerHTML = c.kind === "memory"
      ? `<div class="${cls.join(" ")}" data-card="${esc(c.id)}" style="--c:${esc(c.color)}">${c.image ? `<img src="${esc(c.image)}" alt="" draggable="false" loading="lazy">` : ""}<div class="tun-card__caption">${esc(c.title)}</div></div>`
      : `<div class="${cls.join(" ")}" data-card="${esc(c.id)}" style="--c:${esc(c.color)}"><div class="tun-card__meta"><i></i><span>${esc(c.meta)}</span></div><div class="tun-card__title">${esc(c.title)}</div></div>`;
    const obj = new CSS3DObject(wrap);
    obj.scale.setScalar(CARD_SCALE);
    this.scene.add(obj);
    it.obj = obj;
    return obj;
  }

  // ── Frame ──
  private wake() {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (time: number) => {
    const dt = Math.min((time - this.last) / 1000, 0.05);
    this.last = time;
    const speed = this.reduced ? 4 : 1;
    this.f += (this.tf - this.f) * (1 - Math.exp(-dt * this.rateF * speed));
    this.z += (this.tz - this.z) * (1 - Math.exp(-dt * this.rateZ * speed));
    const lk = 1 - Math.exp(-dt * 5);
    this.look.x += (this.look.tx - this.look.x) * lk;
    this.look.y += (this.look.ty - this.look.y) * lk;
    const settled = !this.drag
      && Math.abs(this.tf - this.f) * this.k() < 0.002
      && Math.abs(this.tz - this.z) < 1e-4
      && Math.abs(this.look.tx - this.look.x) < 1e-4
      && Math.abs(this.look.ty - this.look.y) < 1e-4;
    if (settled) {
      this.f = this.tf;
      this.z = this.tz;
      this.look.x = this.look.tx;
      this.look.y = this.look.ty;
    }
    this.update();
    this.composer.render(dt);
    this.css.render(this.scene, this.camera);
    this.frame = settled ? 0 : requestAnimationFrame(this.tick);
  };

  private update() {
    const k = this.k();
    this.camera.rotation.set(TILT + this.look.y, this.look.x, 0);
    this.labels.begin();
    this.updateRings(k);
    this.updateNow();
    this.updateTiles(k);
    this.updateRails();
    this.updateCards(k);
    this.labels.end();

    const stop = this.stopOf(this.z);
    const heading = headingOf(this.f, stop);
    if (heading !== this.emitted.heading || stop !== this.emitted.stop) {
      this.emitted.heading = heading;
      this.emitted.stop = stop;
      this.events.heading(heading, stop);
    }
    const day = Math.floor(this.f);
    if (day !== this.emitted.day) {
      this.emitted.day = day;
      this.events.focusDay(day);
    }
    this.events.zoom((this.z - Z_MIN) / (Z_MAX - Z_MIN));
  }

  private labelAlpha(size: number, d: number, sp: number) {
    const px = (this.focal * size) / d;
    return smoothstep(8, 13, px) * smoothstep(px * 0.9, px * 1.5, sp) * (1 - smoothstep(FOG_NEAR + 6, FAR - 20, d)) * smoothstep(1.2, 3, d);
  }

  private placeLabel(text: string, cls: string, x: number, y: number, d: number, size: number, align: Align, alpha: number, color = "") {
    const it = this.labels.take(text, `tun-label tun-label--${cls} is-${align}`, color);
    const s = size / LABEL_PX;
    it.obj.scale.setScalar(s);
    it.obj.position.set(align === "left" ? x + (LABEL_BOX / 2) * s : align === "right" ? x - (LABEL_BOX / 2) * s : x, y, -d);
    it.el.style.opacity = alpha.toFixed(3);
  }

  private updateRings(k: number) {
    for (const L of LEVELS) {
      const pool = this.rings[L], st = RING[L], lb = LABEL[L];
      const u = UNIT[L] * k; // world units between two marks
      const dMax = Math.min(FAR, Math.sqrt((this.focal * HH * u) / RING_MIN_PX));
      let n = 0;
      if (dMax > 0.8) {
        for (const t of marks(L, this.timeAt(0.3), this.timeAt(dMax), RING_POOL)) {
          const d = this.distOf(t);
          const sp = (this.focal * HH * u) / (d * (d + u)); // px to the next ring
          const a = st.alpha * smoothstep(RING_MIN_PX, RING_MIN_PX * 3, sp) * smoothstep(0.3, 1.6, d) * (t < this.now ? 0.6 : 1);
          if (a < 0.01 || n >= pool.length) continue;
          const mesh = pool[n++];
          mesh.visible = true;
          mesh.position.z = -d;
          (mesh.material as THREE.MeshBasicMaterial).opacity = a;
          const la = this.labelAlpha(lb.size, d, sp) * (t < this.now ? 0.65 : 1);
          if (la > 0.03) this.placeLabel(labelOf(L, t), L, lb.x, lb.y, d, lb.size, lb.align, la);
        }
      }
      for (let i = n; i < pool.length; i++) pool[i].visible = false;
    }
  }

  private updateNow() {
    const d = this.distOf(this.now);
    const on = d > 0.3 && d < FAR;
    this.nowGate.visible = this.nowVeil.visible = on;
    this.nowLabel.visible = on && d > 1.5 && d < 60;
    if (!on) return;
    this.nowGate.position.z = this.nowVeil.position.z = -d;
    this.nowLabel.position.set(0, -HH + 0.42, -d);
    this.nowLabel.element.style.opacity = (smoothstep(1.5, 3, d) * (1 - smoothstep(30, 60, d))).toFixed(3);
  }

  // The floor: a GitHub-like year far out (m = 0), a road of days closer (m = 1); nights open between days (lit).
  private updateTiles(k: number) {
    const m = smoothstep(0.35, 1.6, k), lit = smoothstep(4, 20, k);
    let d0 = Math.floor(this.timeAt(-1)) - 7, d1 = Math.ceil(this.timeAt(FAR + 2)) + 7;
    if (d1 - d0 >= CAP) d1 = d0 + CAP - 1;
    const cellW = (W - 0.6) / 7;
    const a = lerp(0.03, 7 / 24, lit), b = lerp(0.97, 23 / 24, lit);
    let n = 0;
    for (let d = d0; d <= d1; d++) {
      const wd = weekdayOf(d), ws = d - wd;
      const dn = this.distOf(lerp(ws + 0.5, d + a, m)), df = this.distOf(lerp(ws + 6.5, d + b, m));
      if (df < -1 || dn > FAR + 2) continue;
      const st = this.stats.get(d);
      const count = this.mode === "gallery" ? st?.photos ?? 0 : st?.total ?? 0;
      const hgt = 0.03 + (1 - m) * 0.2 * Math.min(count, 8);
      this.v3.set(lerp(-HW + 0.3 + (wd + 0.5) * cellW, 0, m), -HH + hgt / 2, -(dn + df) / 2);
      this.s3.set(lerp(cellW * 0.8, W - 0.5, m), hgt, Math.max(df - dn, 0.001));
      this.m4.compose(this.v3, this.q, this.s3);
      this.tiles.setMatrixAt(n, this.m4);
      this.tiles.setColorAt(n, this.tileColor(d, st));
      this.tileDays[n++] = d;
    }
    this.tiles.count = n;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    this.tiles.boundingSphere = null; // recomputed for the next pointer test
  }

  private tileColor(d: number, st: DayStat | undefined) {
    const c = this.col.copy(weekdayOf(d) >= 5 ? this.C.weekend : this.C.base);
    if (this.mode === "gallery") {
      if (st?.photos) c.lerp(this.C.photo, 0.35 + 0.65 * Math.min(1, st.photos / 3));
    } else if (st) {
      if (st.done) c.lerp(this.C.done, 0.35 + 0.65 * Math.min(1, st.done / 4));
      else if (st.open) c.lerp(d < this.today ? this.C.miss : this.C.plan, d < this.today ? 0.3 : 0.3 + 0.6 * Math.min(1, st.open / 4));
    }
    if (d === this.today) c.lerp(this.C.white, 0.35);
    if (d === this.hoverDay) c.lerp(this.C.white, 0.25);
    return c;
  }

  private updateRails() {
    const step = (W - 1.4) / (LANES - 1);
    const seg = (mesh: THREE.Mesh, t0: number, t1: number, x: number) => {
      const dn = Math.max(this.distOf(t0), -2), df = Math.min(this.distOf(t1), FAR + 5);
      mesh.visible = t1 > t0 && df > dn;
      if (!mesh.visible) return;
      mesh.position.set(x, HH - 0.05, -(dn + df) / 2);
      mesh.scale.set(0.16, 0.05, df - dn);
    };
    for (const { span, past, future } of this.rails) {
      const x = -HW + 0.7 + span.lane * step;
      const end = span.end ?? this.today + OPEN_TAIL;
      seg(past, span.start, Math.min(end, this.now), x);
      seg(future, Math.max(span.start, this.now), end, x);
      const hot = this.hoverSpan === span.id ? 1.5 : 1;
      (past.material as THREE.MeshBasicMaterial).opacity = (span.done ? 0.55 : 0.95) * hot;
      (future.material as THREE.MeshBasicMaterial).opacity = 0.3 * hot;
      // Its name rides along while you pass under it.
      const ds = this.distOf(span.start), de = this.distOf(end);
      if (de < 4 || ds > 40) continue;
      const d = clamp(ds, 6, de);
      const a = this.labelAlpha(0.2, d, 999) * 0.9;
      if (a > 0.03) this.placeLabel(span.title, "span", x, HH - 0.32 - (span.lane % 2) * 0.3, d, 0.2, "center", a, span.color);
    }
  }

  private updateCards(k: number) {
    const cA = smoothstep(1.8, 3.2, k), hb = smoothstep(26, 44, k);
    const reach = HW - 0.08 - (CW / 2) * Math.cos(ANG);
    for (const it of this.items) {
      const t = lerp(it.day.t, it.hour.t, hb);
      const d = this.distOf(t);
      const a = cA * smoothstep(0.8, 2.6, d) * (1 - smoothstep(28, 62, d));
      if (a < 0.02) {
        if (it.obj) it.obj.visible = false;
        continue;
      }
      const obj = it.obj ?? this.makeCard(it);
      const side = lerp(it.day.side, it.hour.side, hb);
      const slot = lerp(it.day.slot, it.hour.slot, hb);
      obj.visible = true;
      obj.position.set(side * reach, SLOT_TOP - (slot + it.size / 2) * SLOT_H, -d);
      obj.rotation.y = -side * ANG;
      obj.element.style.opacity = a.toFixed(3);
      obj.element.style.pointerEvents = a > 0.5 ? "auto" : "none";
    }
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.composer.setSize(this.w, this.h);
    this.css.setSize(this.w, this.h);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.focal = this.h / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.wake();
  }

  // ── Pointer ──
  private aim(clientX: number, clientY: number) {
    const r = this.host.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private timeUnder(clientX: number, clientY: number) {
    this.aim(clientX, clientY);
    const hit = this.ray.intersectObject(this.shell, false)[0];
    return hit ? this.timeAt(-hit.point.z) : null;
  }

  private dayUnder(clientX: number, clientY: number) {
    this.aim(clientX, clientY);
    const hit = this.ray.intersectObject(this.tiles, false)[0];
    return hit?.instanceId !== undefined ? this.tileDays[hit.instanceId] : null;
  }

  private spanUnder(clientX: number, clientY: number) {
    this.aim(clientX, clientY);
    const meshes = this.rails.flatMap((r) => [r.past, r.future]).filter((m) => m.visible);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.span as Span) : null;
  }

  private perPx() {
    return ((DZ / this.focal) * 2.4) / this.k(); // days per px of drag
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
      // Shift + wheel or a sideways swipe: move through time.
      this.tf -= (Math.abs(dx) > Math.abs(dy) ? dx : dy) * this.perPx() * 0.6;
      this.rateF = 14;
      this.wake();
    } else this.zoomBy(Math.exp(-dy * 0.0016), e.clientX, e.clientY);
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.drag = null;
      return;
    }
    this.drag = { id: e.pointerId, y0: e.clientY, f0: this.tf, lastY: e.clientY, lastT: performance.now(), v: 0, moved: false };
  };

  private onMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomBy(spread / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = spread;
      this.suppressClick = true;
      return;
    }
    const drag = this.drag;
    if (drag) {
      const dy = e.clientY - drag.y0;
      if (!drag.moved && Math.abs(dy) > 4) {
        drag.moved = true;
        this.host.setPointerCapture(drag.id);
        this.setHover(null, null, e);
      }
      if (drag.moved) {
        const now = performance.now();
        drag.v = (e.clientY - drag.lastY) / Math.max((now - drag.lastT) / 1000, 0.001);
        drag.lastY = e.clientY;
        drag.lastT = now;
        // Drag down = pull the coming time toward you.
        this.tf = drag.f0 + dy * this.perPx();
        this.rateF = 30;
        this.wake();
        return;
      }
    }
    if (e.pointerType === "mouse") {
      const r = this.host.getBoundingClientRect();
      this.look.tx = -(((e.clientX - r.left) / r.width) * 2 - 1) * 0.05;
      this.look.ty = -(((e.clientY - r.top) / r.height) * 2 - 1) * 0.035;
      const overCard = (e.target as HTMLElement).closest?.("[data-card]");
      const day = overCard ? null : this.dayUnder(e.clientX, e.clientY);
      const span = overCard || day !== null ? null : this.spanUnder(e.clientX, e.clientY);
      this.setHover(day, span, e);
      this.wake();
    }
  };

  private setHover(day: number | null, span: Span | null, e: PointerEvent) {
    const r = this.host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const changed = day !== this.hoverDay || (span?.id ?? null) !== this.hoverSpan;
    this.hoverDay = day;
    this.hoverSpan = span?.id ?? null;
    this.host.style.cursor = day !== null ? "pointer" : "";
    if (day !== null) this.events.hover({ kind: "day", day, x, y });
    else if (span) this.events.hover({ kind: "span", span, x, y });
    else if (changed) this.events.hover(null);
    if (changed) this.wake();
  }

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    const drag = this.drag;
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) {
        // A flick keeps going a little.
        this.tf += clamp(drag.v, -4000, 4000) * 0.22 * this.perPx();
        this.rateF = 5;
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
      }
      this.drag = null;
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
      this.wake();
    }
  };

  private onLeave = () => {
    this.look.tx = this.look.ty = 0;
    this.hoverDay = null;
    this.hoverSpan = null;
    this.events.hover(null);
    this.wake();
  };

  private onClick = (e: MouseEvent) => {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const cardEl = (e.target as HTMLElement).closest?.("[data-card]") as HTMLElement | null;
    if (cardEl) {
      const it = this.itemById.get(cardEl.dataset.card!);
      if (it) this.events.openCard(it.card);
      return;
    }
    const day = this.dayUnder(e.clientX, e.clientY);
    if (day === null) return;
    // Close enough to see the day → open it; else fly there.
    if (this.tz >= Math.log(kOfStop(3)) - 0.6) this.events.openDay(day);
    else this.flyTo(day, 3);
  };

  private onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowUp: () => this.step(1),
      ArrowRight: () => this.step(1),
      ArrowDown: () => this.step(-1),
      ArrowLeft: () => this.step(-1),
      PageUp: () => this.step(5),
      PageDown: () => this.step(-5),
      "+": () => this.zoomBy(2),
      "=": () => this.zoomBy(2),
      "-": () => this.zoomBy(0.5),
      t: () => this.goNow(),
      Home: () => this.goNow(),
    };
    const n = Number(e.key);
    const f = keys[e.key] ?? (n >= 1 && n <= STOPS.length ? () => this.goStop(n - 1) : null);
    if (!f) return;
    e.preventDefault();
    f();
  };
}
