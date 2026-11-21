// Tunnel view engine (P-62: T-94 2026-11-21, scope B #191). A passage of tiles you glide through; the owner's
// reference is React Bits Pro "Passage Gallery" (paid — its behaviour is matched here, the code is our own). Time runs
// along the passage (scale.ts): a box is a day, a week, a month or a year, a dark band between two boxes. The tiles on
// the walls, floor and ceiling are the tasks, the memory photos and videos, long tasks as rails on the ceiling and
// accent tiles in the goal colours. The camera cruises; hold to boost, wheel / drag to travel, ctrl + wheel (a pinch)
// to zoom between the spans, the view turns toward the pointer, the tile under it lifts, a click flies a tile out to
// full view (click again or Escape puts it back), a click on an empty cell asks for a task there. "Glass" (owner,
// 2026-11-21: "boş glass view … rəng olmasa"): the walls have no colour, only the hairline grid on the card behind.
import * as THREE from "three";
import { HOUR_FROM, HOURS, SPANS, Scale, type Span } from "./scale";

// The reference's defaults (pro.reactbits.dev → Passage Gallery).
const GAP = 0.1, RADIUS = 0.06, ACCENT_FILL = 0.06, LINE_OPACITY = 0.12, FOG = 1, SPEED = 0.6, BOOST = 10, BLUR = 1,
  LOOK = 1, FOV = 72, HOVER = 1, MAX_DPR = 2;
const AHEAD = 34, BEHIND = 3; // rows kept alive in front of / behind the camera
const SHELL = AHEAD + BEHIND + 12; // the walls' length, moved along with the camera
const FOG_NEAR = 3, FOG_FAR = 30 / FOG;
const LIFT = 0.006; // tiles sit this far off their wall
const FOCUS_DIST = 1.25;
const WRAP_BOXES = 14; // cruising this many days (weeks …) beyond where the owner went fades back to today
const BOOST_AFTER = 300, CLICK_WITHIN = 450; // ms: holding longer boosts; let go sooner and it is still a click
const MAX_BANDS = 8;
const PLAYING = 3; // videos playing at once

export type TunnelTask = {
  id: string;
  title: string;
  time: string | null; // "HH:MM"
  minutes: number | null;
  color: string | null;
  goal: string | null;
  done: boolean;
  event: boolean;
};
export type TunnelMedia = { path: string; url: string | null; video: boolean };
export type TunnelDay = {
  day: number; // epoch day
  dayNum: number;
  weekday: string;
  month: string;
  today: boolean;
  tasks: TunnelTask[];
  media: TunnelMedia[];
  count: number; // tasks planned that day (for the year's activity tiles)
  done: number;
};
export type TunnelLong = { task: TunnelTask; from: number; to: number; lane: number }; // planned day → deadline
export type TunnelBox = { title: string; sub: string; days: TunnelDay[]; long: TunnelLong[]; colors: string[] };
export type TunnelPick =
  | { kind: "task"; day: number; task: TunnelTask }
  | { kind: "long"; task: TunnelTask }
  | { kind: "media"; day: number; media: TunnelMedia; index: number; count: number }
  | { kind: "day"; day: number };
export type TunnelPlace = { day: number; minutes: number | null; band: boolean };
export type TunnelTheme = { bg: string; fg: string; primary: string; font: string };
export type PassageEvents = {
  getBox: (scale: Scale, b: number) => TunnelBox;
  onFocus: (pick: TunnelPick | null) => void;
  onHover: (pick: TunnelPick | null) => void;
  onMove: (place: TunnelPlace) => void;
  onRange: (fromDay: number, toDay: number) => void;
  onPick: (pick: TunnelPick) => void; // a day's label, a long task's rail
  onEmpty: (cell: { day: number; minutes: number | null; x: number; y: number }) => void;
  onZoom: (dir: 1 | -1, day: number) => void; // ctrl + wheel: 1 = out (day → week …), -1 = in
};

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);

// Any CSS colour → "#rrggbb" (the canvas does the parsing); unknown → the fallback.
const probe = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function hex(css: string | null | undefined, fallback: string) {
  if (!css || !probe) return fallback;
  probe.fillStyle = "#010203";
  probe.fillStyle = css;
  const out = String(probe.fillStyle);
  if (out === "#010203" && css.toLowerCase() !== "#010203") return fallback;
  return out.startsWith("#") ? out : `#${new THREE.Color(out).getHexString()}`;
}
const mix = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const luma = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// ── shaders ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SHELL_VERT = /* glsl */ `
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uWall; uniform vec3 uNight; uniform vec3 uLine; uniform vec3 uNightLine;
uniform float uLineOpacity; uniform float uNightAlpha; uniform float uGlass;
uniform vec2 uBands[${MAX_BANDS}]; uniform int uBandCount;
uniform float uAxis; uniform float uAcrossOrigin; uniform float uAcrossCell;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uDim; uniform vec3 uDimTo;
varying vec3 vWorld;
varying float vDepth;
float gridLine(float g) {
  float d = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-4);
  return 1.0 - min(d, 1.0);
}
void main() {
  float row = -vWorld.z;
  float night = 0.0;
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    if (i >= uBandCount) break;
    vec2 b = uBands[i];
    float w = min(1.0, (b.y - b.x) * 0.35);
    night = max(night, smoothstep(b.x - 0.1, b.x + w, row) * (1.0 - smoothstep(b.y - w, b.y + 0.05, row)));
  }
  float across = ((uAxis < 0.5 ? vWorld.x : vWorld.y) - uAcrossOrigin) / uAcrossCell;
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  float line = max(gridLine(row), gridLine(across)) * (1.0 - smoothstep(uFogNear, uFogFar * 0.85, vDepth));
  vec3 lineCol = mix(uLine, uNightLine, night);
  vec4 acc; // premultiplied
  if (uGlass > 0.5) {
    // glass: no colour of its own — the night band a dark veil, the grid hairlines, both fading into the distance
    float la = clamp(line * uLineOpacity * 1.6, 0.0, 1.0);
    float na = night * uNightAlpha;
    acc = vec4(lineCol, 1.0) * la + vec4(uNight, 1.0) * na * (1.0 - la);
    acc *= 1.0 - fog;
  } else {
    vec3 col = mix(uWall, uNight, night);
    col = mix(col, lineCol, line * uLineOpacity);
    acc = vec4(mix(col, uFogColor, fog), 1.0);
  }
  acc = mix(acc, vec4(uDimTo, 1.0), uDim);
  gl_FragColor = vec4(acc.a > 0.0 ? acc.rgb / acc.a : vec3(0.0), acc.a);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}`;
const TILE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const TILE_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uHasMap; uniform float uLabel; uniform float uOpacity;
uniform vec3 uColA; uniform vec3 uColB; uniform vec2 uSize; uniform float uRadius;
uniform float uHover; uniform float uFocused; uniform vec2 uUvScale; uniform vec2 uUvOffset;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uDim; uniform vec3 uDimTo; uniform float uGlass;
varying vec2 vUv;
varying float vDepth;
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-5);
  float a = 1.0 - smoothstep(-aa, aa, d);
  vec3 col;
  if (uHasMap > 0.5) {
    vec4 t = texture2D(uMap, vUv * uUvScale + uUvOffset);
    if (uLabel > 0.5) { col = t.a > 0.0 ? t.rgb / t.a : vec3(0.0); a *= t.a; }
    else col = t.rgb;
  } else {
    col = mix(uColA, uColB, clamp((vUv.x + 1.0 - vUv.y) * 0.5, 0.0, 1.0));
  }
  a *= mix(uOpacity, 1.0, uFocused);
  col = mix(col, vec3(1.0), uHover * 0.12);
  float fog = smoothstep(uFogNear, uFogFar, vDepth) * (1.0 - uFocused);
  if (uLabel > 0.5 || uGlass > 0.5) a *= 1.0 - fog; else col = mix(col, uFogColor, fog);
  col = mix(col, uDimTo, uDim * (1.0 - uFocused));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}`;
const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tScene; uniform vec2 uCenter; uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 dir = vUv - uCenter;
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0;
    float w = 1.0 - 0.6 * t;
    acc += texture2D(tScene, vUv - dir * uStrength * t) * w;
    total += w;
  }
  gl_FragColor = acc / total;
  #include <colorspace_fragment>
}`;

// ── tiles ────────────────────────────────────────────────────────────────────────────────────────────────────────
type Surface = "F" | "C" | "L" | "R"; // floor, ceiling, left wall, right wall
const SURFACES: Surface[] = ["F", "C", "L", "R"]; // the shell's order too
type Spot = { pos: THREE.Vector3; quat: THREE.Quaternion; normal: THREE.Vector3; w: number; h: number };
type TileUniforms = {
  uMap: { value: THREE.Texture | null }; uHasMap: { value: number }; uLabel: { value: number }; uOpacity: { value: number };
  uColA: { value: THREE.Color }; uColB: { value: THREE.Color }; uSize: { value: THREE.Vector2 }; uRadius: { value: number };
  uHover: { value: number }; uFocused: { value: number }; uUvScale: { value: THREE.Vector2 }; uUvOffset: { value: THREE.Vector2 };
};
type Tile = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  u: TileUniforms;
  home: Spot;
  pick: TunnelPick | null;
  hover: number;
  hoverable: boolean;
  imageAspect: number | null; // photos / videos: the picture's own shape
  own: THREE.Texture | null; // a texture this tile made (task cards, labels) — disposed with it
  redraw?: (scale: number) => HTMLCanvasElement; // task cards: drawn again sharper when opened
  media?: string;
  hiRes?: THREE.Texture | null;
};
type Box = { b: number; sig: string; tiles: Tile[]; stale: boolean };
type MediaTex = {
  tex: THREE.Texture | null; aspect: number; uses: number; state: "loading" | "ready" | "failed";
  waiters: Set<Tile>; used: number; video: HTMLVideoElement | null; rows: Set<Tile>;
};

// A box's cells: which are taken (rows are the box's own, 0 … rows-1).
class Grid {
  private used = new Set<string>();
  constructor(readonly rows: number, readonly lanes: number, readonly wallRows: number) {}
  width(s: Surface) {
    return s === "F" || s === "C" ? this.lanes : this.wallRows;
  }
  free(s: Surface, a: number, r: number, len = 1, span = 1) {
    if (r < 0 || r + len > this.rows || a < 0 || a + span > this.width(s)) return false;
    for (let i = 0; i < len; i++) for (let j = 0; j < span; j++) if (this.used.has(`${s}${a + j}:${r + i}`)) return false;
    return true;
  }
  take(s: Surface, a: number, r: number, len = 1, span = 1) {
    for (let i = 0; i < len; i++) for (let j = 0; j < span; j++) this.used.add(`${s}${a + j}:${r + i}`);
  }
}

const PHOTO_PX = 768, PHOTO_FOCUS_PX = 2048, CARD_PX = 440, CARD_FOCUS_SCALE = 3;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}
function scaled(img: HTMLImageElement, max: number) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export class Passage {
  private host: HTMLElement;
  private events: PassageEvents;
  private reduced: boolean;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
  private plane = new THREE.PlaneGeometry(1, 1);
  private shared = {
    uFogColor: { value: new THREE.Color() },
    uFogNear: { value: FOG_NEAR },
    uFogFar: { value: FOG_FAR },
    uDim: { value: 0 },
    uDimTo: { value: new THREE.Color() },
    uGlass: { value: 1 },
  };
  private shellUniforms = {
    uWall: { value: new THREE.Color() }, uNight: { value: new THREE.Color() },
    uLine: { value: new THREE.Color() }, uNightLine: { value: new THREE.Color() },
    uLineOpacity: { value: LINE_OPACITY }, uNightAlpha: { value: 0.5 },
    uBands: { value: Array.from({ length: MAX_BANDS }, () => new THREE.Vector2(-1e6, -1e6)) }, uBandCount: { value: 0 },
  };
  private shell: THREE.Mesh[] = [];
  private ring: Tile[] = [];
  private boxes = new Map<number, Box>();
  private picks: THREE.Object3D[] = [];
  private tileOf = new Map<THREE.Object3D, Tile>();
  private media = new Map<string, MediaTex>();
  private raycaster = new THREE.Raycaster();
  private rt: THREE.WebGLRenderTarget;
  private blurScene = new THREE.Scene();
  private blurCam = new THREE.Camera();
  private blurMat: THREE.ShaderMaterial;
  private ro: ResizeObserver;
  private io: IntersectionObserver;

  private scale: Scale;
  private today: number;
  private nowMinutes: number;
  private gallery = false;

  // the passage's shape: `lanes` across the floor, the height follows the screen's shape
  private W = 5;
  private H = 3;
  private wallRows = 3;
  private ch = 1;
  private eye: number[] = [];

  // theme (hex)
  private c = { wall: "#111", night: "#000", line: "#fff", nightLine: "#fff", fg: "#fff", primary: "#10b981", accent2: "#7dd3fc", bg: "#111", font: "system-ui, sans-serif", dark: true };

  // motion
  private pos = 0;
  private vel = 0;
  private glide = 0;
  private dragMove = 0;
  private speedSeen = 0;
  private paused = false;
  private held = false; // a question is open over the tunnel (a new task): no cruising
  private boosting = false;
  private lookX = 0;
  private lookY = 0;
  private home = -2;
  private anchor = -2; // where the owner last moved to; cruising WRAP_BOXES beyond it fades back home
  private wrapping = false;
  private zoomAcc = 0;
  private zoomAt = 0;

  // pointer
  private ndc = new THREE.Vector2();
  private pointerIn = false;
  private pointerMoved = false;
  private press: {
    x: number; y: number; id: number; touch: boolean; moved: boolean; boosted: boolean; timer: number;
    lastV: number; lastAt: number; last: number; at: number; tile: Tile | null;
  } | null = null;
  private hovered: Tile | null = null;
  private animating = new Set<Tile>();
  private focus: { tile: Tile; t: number; dir: 1 | -1 } | null = null;

  private raf = 0;
  private lastT = 0;
  private dirty = true;
  private visible = true;
  private lastMove = "";
  private lastRange = "";
  private videoCheck = 0;
  private disposed = false;

  constructor(host: HTMLElement, events: PassageEvents, opts: { theme: TunnelTheme; reduced: boolean; span: Span; today: number; nowMinutes: number; gallery: boolean }) {
    this.host = host;
    this.events = events;
    this.reduced = opts.reduced;
    this.today = opts.today;
    this.nowMinutes = opts.nowMinutes;
    this.gallery = opts.gallery;
    this.scale = new Scale(opts.span, opts.today);

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;transition:opacity .3s ease";
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.rt.texture }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 } },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    quad.frustumCulled = false;
    this.blurScene.add(quad);

    this.applyTheme(opts.theme);
    this.measure();
    this.buildShell();
    this.buildRing();
    this.placeAtToday();

    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMovePointer);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onCancel);
    this.canvas.addEventListener("pointerleave", this.onLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting && !document.hidden;
      this.lastT = 0;
    });
    this.io.observe(host);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ── public ─────────────────────────────────────────────────────────────────────────────────────────────────────
  get span() {
    return this.scale.span;
  }
  travel(rows: number) {
    if (this.focus) this.close();
    this.glide += rows;
    this.anchor = this.pos + this.glide;
    this.dirty = true;
  }
  goTo(row: number) {
    if (this.focus) this.close();
    this.anchor = row;
    if (Math.abs(row - this.pos) > 50) this.jump(row);
    else {
      this.glide = row - this.pos;
      this.dirty = true;
    }
  }
  jumpBoxes(n: number) {
    const cur = this.scale.boxAt(this.pos + 2.5);
    this.goTo(this.scale.start(cur + n) - 2);
  }
  goHome() {
    this.goTo(this.home);
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.dirty = true;
  }
  setHeld(h: boolean) {
    this.held = h;
    this.dirty = true;
  }
  setNow(today: number, minutes: number) {
    this.nowMinutes = minutes;
    if (today !== this.today) {
      this.today = today;
      this.scale = new Scale(this.scale.span, today);
      this.rebuildAll();
    }
    this.placeRing();
    this.dirty = true;
  }
  setTheme(theme: TunnelTheme) {
    this.applyTheme(theme);
    for (const t of this.ring) {
      t.u.uColA.value.set(this.c.primary);
      t.u.uColB.value.set(this.c.primary);
    }
    this.rebuildAll();
  }
  setGallery(g: boolean) {
    if (g === this.gallery) return;
    this.gallery = g;
    this.rebuildAll();
  }
  // Zoom to another span with `day` in front: fly a little (in or back), fade, build the passage again.
  setSpan(span: Span, day: number, minutes: number | null = null) {
    if (span === this.scale.span) return;
    if (this.focus) {
      this.finishClose();
      this.events.onFocus(null);
    }
    const inward = SPANS.indexOf(span) < SPANS.indexOf(this.scale.span);
    this.glide = inward ? 3 : -3;
    this.wrapping = true;
    this.canvas.style.opacity = "0";
    window.setTimeout(() => {
      if (this.disposed) return;
      this.scale = new Scale(span, this.today);
      this.measure();
      this.buildShell();
      this.placeAtToday();
      const row = span === "day" ? this.scale.rowOf(day, minutes ?? HOUR_FROM * 60) : this.scale.rowOf(day);
      this.pos = row - 2;
      this.anchor = this.pos;
      this.glide = 0;
      this.vel = 0;
      this.rebuildAll();
      this.placeRing();
      this.canvas.style.opacity = "1";
      window.setTimeout(() => (this.wrapping = false), 300);
    }, this.reduced ? 0 : 300);
  }
  // The data behind the boxes changed: rebuild the boxes whose content differs.
  refresh() {
    for (const [b, box] of this.boxes) {
      const data = this.events.getBox(this.scale, b);
      if (this.sig(data) === box.sig) continue;
      if (this.focus && box.tiles.includes(this.focus.tile)) box.stale = true;
      else this.rebuildBox(b, data);
    }
    this.dirty = true;
  }
  close() {
    if (!this.focus || this.focus.dir < 0) return;
    this.focus.dir = -1;
    this.events.onFocus(null);
    this.dirty = true;
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMovePointer);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    if (this.press) clearTimeout(this.press.timer);
    for (const b of [...this.boxes.keys()]) this.dropBox(b);
    for (const t of this.ring) this.freeTile(t);
    for (const m of this.media.values()) this.freeMedia(m);
    for (const m of this.shell) (m.material as THREE.Material).dispose();
    this.shell.forEach((m) => m.geometry.dispose());
    this.plane.dispose();
    this.blurMat.dispose();
    this.rt.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ── theme & shape ──────────────────────────────────────────────────────────────────────────────────────────────
  private applyTheme(theme: TunnelTheme) {
    const bg = hex(theme.bg, "#0f1217");
    const fg = hex(theme.fg, "#e6e9ee");
    const primary = hex(theme.primary, "#10b981");
    const dark = luma(bg) < 0.5;
    this.c = {
      bg,
      fg,
      primary,
      accent2: mix(primary, "#ffffff", 0.45),
      dark,
      font: theme.font || "system-ui, sans-serif",
      wall: dark ? mix(bg, fg, 0.06) : bg, // only when not glass
      night: dark ? "#000000" : "#0e1424",
      line: fg,
      nightLine: dark ? fg : "#ffffff",
    };
    const s = this.shellUniforms;
    s.uWall.value.set(this.c.wall);
    s.uNight.value.set(this.c.night);
    s.uLine.value.set(this.c.line);
    s.uNightLine.value.set(this.c.nightLine);
    s.uNightAlpha.value = dark ? 0.5 : 0.55;
    this.shared.uDimTo.value.set(dark ? "#000000" : "#ffffff");
    this.dirty = true;
  }

  private get glass() {
    return this.shared.uGlass.value > 0.5;
  }

  private measure() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    // The cross-section has the screen's shape; the walls get as many rows as fit.
    const lanes = this.scale.lanes;
    this.W = lanes;
    this.H = clamp((lanes * h) / w, 1.4, 12);
    this.wallRows = Math.max(1, Math.round(this.H));
    this.ch = this.H / this.wallRows;
    const n = this.wallRows;
    this.eye = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a + 0.5 - n / 2) - Math.abs(b + 0.5 - n / 2) || a - b);
  }

  private resize() {
    const oldRows = this.wallRows, oldH = this.H;
    this.measure();
    if (oldRows !== this.wallRows || Math.abs(oldH - this.H) > 1e-3) {
      this.buildShell();
      this.placeRing();
      this.rebuildAll();
    }
    this.dirty = true;
  }

  private placeAtToday() {
    const s = this.scale;
    const start = s.span === "day" ? s.start(0) : s.rowOf(this.today);
    this.home = start - 2;
    this.pos = this.home;
    this.anchor = this.home;
  }

  private buildShell() {
    for (const m of this.shell) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.shell = [];
    const { W, H } = this;
    const cw = W / this.scale.lanes;
    const make = (geo: THREE.PlaneGeometry, axis: number, origin: number, cell: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.shellUniforms, ...this.shared, uAxis: { value: axis }, uAcrossOrigin: { value: origin }, uAcrossCell: { value: cell } },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        premultipliedAlpha: true,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = -1; // under every tile
      this.scene.add(m);
      this.shell.push(m);
      return m;
    };
    const floor = make(new THREE.PlaneGeometry(W, SHELL), 0, -W / 2, cw);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -H / 2;
    const ceiling = make(new THREE.PlaneGeometry(W, SHELL), 0, -W / 2, cw);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H / 2;
    const left = make(new THREE.PlaneGeometry(SHELL, H), 1, -H / 2, this.ch);
    left.rotation.y = Math.PI / 2;
    left.position.x = -W / 2;
    const right = make(new THREE.PlaneGeometry(SHELL, H), 1, -H / 2, this.ch);
    right.rotation.y = -Math.PI / 2;
    right.position.x = W / 2;
  }

  // ── tiles ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private spot(s: Surface, across: number, row: number, len: number, span = 1): Spot {
    const { W, H, ch } = this;
    const cw = W / this.scale.lanes;
    const z = -(row + len / 2);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), normal = new THREE.Vector3();
    let w = 1, h = 1;
    if (s === "F" || s === "C") {
      const top = s === "C";
      pos.set(-W / 2 + (across + span / 2) * cw, top ? H / 2 - LIFT : -H / 2 + LIFT, z);
      quat.setFromEuler(new THREE.Euler(top ? Math.PI / 2 : -Math.PI / 2, 0, 0));
      normal.set(0, top ? -1 : 1, 0);
      w = span * cw - GAP * cw;
      h = len - GAP;
    } else {
      const left = s === "L";
      pos.set(left ? -W / 2 + LIFT : W / 2 - LIFT, -H / 2 + (across + span / 2) * ch, z);
      quat.setFromEuler(new THREE.Euler(0, left ? Math.PI / 2 : -Math.PI / 2, 0));
      normal.set(left ? 1 : -1, 0, 0);
      w = len - GAP;
      h = span * ch - GAP * ch;
    }
    return { pos, quat, normal, w, h };
  }

  private makeTile(spot: Spot, o: { map?: THREE.Texture | null; label?: boolean; colA?: string; colB?: string; opacity?: number; pick?: TunnelPick | null; hoverable?: boolean }) {
    const u: TileUniforms = {
      uMap: { value: o.map ?? null }, uHasMap: { value: o.map ? 1 : 0 }, uLabel: { value: o.label ? 1 : 0 }, uOpacity: { value: o.opacity ?? 1 },
      uColA: { value: new THREE.Color(o.colA ?? this.c.primary) }, uColB: { value: new THREE.Color(o.colB ?? o.colA ?? this.c.primary) },
      uSize: { value: new THREE.Vector2(spot.w, spot.h) }, uRadius: { value: (RADIUS * Math.min(spot.w, spot.h)) / 2 },
      uHover: { value: 0 }, uFocused: { value: 0 }, uUvScale: { value: new THREE.Vector2(1, 1) }, uUvOffset: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...u, ...this.shared },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    const mesh = new THREE.Mesh(this.plane, mat);
    const tile: Tile = { mesh, u, home: spot, pick: o.pick ?? null, hover: 0, hoverable: o.hoverable ?? true, imageAspect: null, own: o.map ?? null };
    this.placeHome(tile);
    this.scene.add(mesh);
    if (tile.hoverable) {
      this.picks.push(mesh);
      this.tileOf.set(mesh, tile);
    }
    return tile;
  }

  private placeHome(t: Tile) {
    const { home } = t;
    const lift = 0.05 * HOVER * t.hover;
    const grow = 1 + 0.03 * HOVER * t.hover;
    t.mesh.position.copy(home.pos).addScaledVector(home.normal, lift);
    t.mesh.quaternion.copy(home.quat);
    this.setSize(t, home.w * grow, home.h * grow);
  }

  private setSize(t: Tile, w: number, h: number) {
    t.mesh.scale.set(w, h, 1);
    t.u.uSize.value.set(w, h);
    t.u.uRadius.value = (RADIUS * Math.min(w, h)) / 2;
    if (t.imageAspect) {
      // cover: fill the tile, crop the rest
      const ta = w / h, ia = t.imageAspect;
      if (ia > ta) {
        t.u.uUvScale.value.set(ta / ia, 1);
        t.u.uUvOffset.value.set((1 - ta / ia) / 2, 0);
      } else {
        t.u.uUvScale.value.set(1, ia / ta);
        t.u.uUvOffset.value.set(0, (1 - ia / ta) / 2);
      }
    }
  }

  private freeTile(t: Tile) {
    this.scene.remove(t.mesh);
    t.mesh.material.dispose();
    t.own?.dispose();
    t.hiRes?.dispose();
    if (t.hoverable) {
      const i = this.picks.indexOf(t.mesh);
      if (i >= 0) this.picks.splice(i, 1);
      this.tileOf.delete(t.mesh);
    }
    if (t.media) {
      const m = this.media.get(t.media);
      if (m) {
        m.uses--;
        m.waiters.delete(t);
        m.rows.delete(t);
      }
    }
    this.animating.delete(t);
    if (this.hovered === t) this.hovered = null;
  }

  private texture(canvas: HTMLCanvasElement, label = false) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.premultiplyAlpha = label;
    return tex;
  }

  // ── canvases ───────────────────────────────────────────────────────────────────────────────────────────────────
  private canvasFor(w: number, h: number, px: number) {
    const s = px / Math.max(w, h);
    const c = document.createElement("canvas");
    c.width = Math.max(8, Math.round(w * s));
    c.height = Math.max(8, Math.round(h * s));
    return c;
  }

  private drawTask(t: TunnelTask, w: number, h: number, px: number) {
    const c = this.canvasFor(w, h, px);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const base = hex(t.color, this.c.primary);
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, mix(base, "#ffffff", 0.1));
    grad.addColorStop(1, mix(base, "#000000", 0.4));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    if (t.done) {
      g.fillStyle = "rgba(18,20,26,0.5)";
      g.fillRect(0, 0, W, H);
    }
    const ink = !t.done && luma(base) > 0.66 ? "#14161b" : "#ffffff";
    const u = Math.min(W, H) / 100;
    const pad = 9 * u;
    const font = this.c.font;
    g.fillStyle = ink;
    g.textBaseline = "top";

    // time · how long; an event gets a ring, a done task a tick
    const meta = [t.time?.slice(0, 5), t.minutes ? duration(t.minutes) : null].filter(Boolean).join(" · ");
    g.globalAlpha = 0.85;
    g.font = `600 ${11 * u}px ${font}`;
    if (meta) g.fillText(meta, pad, pad);
    const r = 5.5 * u, cx = W - pad - r, cy = pad + r;
    g.lineWidth = 1.6 * u;
    g.strokeStyle = ink;
    if (t.done) {
      g.beginPath();
      g.moveTo(cx - r * 0.6, cy);
      g.lineTo(cx - r * 0.1, cy + r * 0.5);
      g.lineTo(cx + r * 0.7, cy - r * 0.5);
      g.stroke();
    } else if (t.event) {
      g.beginPath();
      g.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
      g.stroke();
    }

    // the title, as big as fits; at the smallest size the rest is cut with "…"
    g.globalAlpha = t.done ? 0.75 : 1;
    const top = pad + (meta ? 17 * u : 0);
    const bottom = H - pad - (t.goal ? 14 * u : 0);
    const maxW = W - pad * 2;
    let size = 19 * u, lines: string[] = [];
    for (; size >= 10 * u; size -= u) {
      g.font = `650 ${size}px ${font}`;
      const fit = Math.max(1, Math.floor((bottom - top) / (size * 1.18)));
      lines = wrap(g, t.title, maxW, Infinity);
      if (lines.length <= fit) break;
      if (size - u < 10 * u) lines = wrap(g, t.title, maxW, fit);
    }
    lines.forEach((l, i) => {
      const y = top + i * size * 1.18;
      g.fillText(l, pad, y);
      if (t.done) g.fillRect(pad, y + size * 0.55, g.measureText(l).width, Math.max(1, 1.2 * u));
    });

    if (t.goal) {
      g.globalAlpha = 0.72;
      g.font = `500 ${9.5 * u}px ${font}`;
      g.fillText(ellipsis(g, t.goal, maxW), pad, H - pad - 10 * u);
    }
    return c;
  }

  // A label on the floor: a big number (or word) and two small lines beside it.
  private drawLabel(big: string, line1: string, line2: string, w: number, h: number, today: boolean, px = 900) {
    const c = this.canvasFor(w, h, px);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const font = this.c.font;
    g.fillStyle = today ? this.c.primary : this.c.fg;
    g.textBaseline = "alphabetic";
    let bigSize = H * 0.62;
    g.font = `700 ${bigSize}px ${font}`;
    let bigW = g.measureText(big).width;
    const small = H * 0.2;
    g.font = `600 ${small}px ${font}`;
    const subW = Math.max(g.measureText(line1).width, g.measureText(line2).width);
    const gap = line1 || line2 ? H * 0.12 : 0;
    const room = W * 0.94 - subW - gap;
    if (bigW > room) {
      bigSize *= room / bigW;
      bigW = room;
    }
    const x0 = (W - bigW - gap - subW) / 2;
    const base = H * 0.76;
    g.globalAlpha = 0.92;
    g.font = `700 ${bigSize}px ${font}`;
    g.fillText(big, x0, base);
    g.font = `600 ${small}px ${font}`;
    g.globalAlpha = 0.8;
    if (line1) g.fillText(line1, x0 + bigW + gap, base - H * 0.27);
    g.globalAlpha = 0.55;
    if (line2) g.fillText(line2, x0 + bigW + gap, base);
    return c;
  }

  private drawText(text: string, w: number, h: number, alpha = 0.5, size = 0.24) {
    const c = this.canvasFor(w, h, 256);
    const g = c.getContext("2d")!;
    g.fillStyle = this.c.fg;
    g.globalAlpha = alpha;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${Math.min(c.height, c.width) * size}px ${this.c.font}`;
    g.fillText(text, c.width / 2, c.height / 2);
    return c;
  }

  // A year's day: its activity (GitHub-like levels) behind its number and the first titles.
  private drawYearDay(d: TunnelDay, level: number, w: number, h: number) {
    const c = this.canvasFor(w, h, 200);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const fill = level ? rgba(this.c.primary, [0, 0.3, 0.5, 0.72, 0.95][level]) : rgba(this.c.fg, 0.07);
    g.fillStyle = fill;
    g.fillRect(0, 0, W, H);
    const u = Math.min(W, H) / 100;
    const ink = level >= 3 && luma(this.c.primary) > 0.6 ? "#14161b" : this.c.fg;
    g.fillStyle = d.today ? (level >= 3 ? "#ffffff" : this.c.primary) : ink;
    g.textBaseline = "top";
    g.globalAlpha = 0.95;
    g.font = `700 ${22 * u}px ${this.c.font}`;
    g.fillText(d.dayNum === 1 ? `1 ${d.month}` : String(d.dayNum), 8 * u, 7 * u);
    g.globalAlpha = 0.85;
    g.font = `500 ${12 * u}px ${this.c.font}`;
    d.tasks.slice(0, 3).forEach((t, i) => g.fillText(ellipsis(g, t.title, W - 16 * u), 8 * u, 38 * u + i * 16 * u));
    return c;
  }

  private drawMediaWaiting(w: number, h: number, video: boolean) {
    const c = this.canvasFor(w, h, 192);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    g.fillStyle = rgba(this.c.fg, 0.09);
    g.fillRect(0, 0, W, H);
    g.fillStyle = rgba(this.c.fg, 0.32);
    const s = Math.min(W, H) * 0.32, x = W / 2 - s / 2, y = H / 2 - s / 2;
    g.beginPath();
    if (video) {
      g.moveTo(x + s * 0.2, y);
      g.lineTo(x + s, y + s / 2);
      g.lineTo(x + s * 0.2, y + s);
    } else {
      g.moveTo(x, y + s);
      g.lineTo(x + s * 0.4, y + s * 0.45);
      g.lineTo(x + s * 0.62, y + s * 0.7);
      g.lineTo(x + s * 0.78, y + s * 0.55);
      g.lineTo(x + s, y + s);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(x + s * 0.78, y + s * 0.18, s * 0.11, 0, Math.PI * 2);
    }
    g.fill();
    return c;
  }

  // ── boxes ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private sig(d: TunnelBox) {
    return JSON.stringify([
      d.title, d.sub, d.colors, d.long,
      d.days.map((x) => [x.day, x.today, x.tasks, x.media.map((m) => [m.path, !!m.url]), x.count, x.done]),
      this.wallRows, this.H, this.gallery,
    ]);
  }

  private syncBoxes() {
    const s = this.scale;
    const from = s.boxAt(this.pos - BEHIND);
    const to = s.boxAt(this.pos + AHEAD);
    for (const b of [...this.boxes.keys()]) if (b < from || b > to) {
      if (this.focus && this.boxes.get(b)!.tiles.includes(this.focus.tile)) continue;
      this.dropBox(b);
    }
    for (let b = from; b <= to; b++) if (!this.boxes.has(b)) this.buildBox(b, this.events.getBox(s, b));
    const key = `${s.span}:${from}:${to}`;
    if (key !== this.lastRange) {
      this.lastRange = key;
      // the night bands in sight: after every box, and the one before the first
      const bands = this.shellUniforms.uBands.value;
      let n = 0;
      for (let b = from - 1; b <= to && n < MAX_BANDS; b++, n++) bands[n].set(s.start(b) + s.rows(b), s.start(b + 1));
      this.shellUniforms.uBandCount.value = n;
      this.events.onRange(s.dayRange(from)[0], s.dayRange(to)[1]);
    }
  }

  private nightAt(row: number) {
    const bands = this.shellUniforms.uBands.value;
    let night = 0;
    for (let i = 0; i < this.shellUniforms.uBandCount.value; i++) {
      const b = bands[i];
      const w = Math.min(1, (b.y - b.x) * 0.35);
      const up = clamp((row - (b.x - 0.1)) / (w + 0.1), 0, 1), down = clamp((b.y + 0.05 - row) / (w + 0.05), 0, 1);
      night = Math.max(night, Math.min(up, down));
    }
    return night;
  }

  private rebuildAll() {
    if (this.focus) {
      this.finishClose();
      this.events.onFocus(null);
    }
    for (const b of [...this.boxes.keys()]) this.dropBox(b);
    this.lastRange = "";
    this.syncBoxes();
    this.dirty = true;
  }

  private rebuildBox(b: number, data: TunnelBox) {
    this.dropBox(b);
    this.buildBox(b, data);
  }

  private dropBox(b: number) {
    const box = this.boxes.get(b);
    if (!box) return;
    box.tiles.forEach((t) => this.freeTile(t));
    this.boxes.delete(b);
    this.pruneMedia();
  }

  private buildBox(b: number, data: TunnelBox) {
    const s = this.scale;
    const box: Box = { b, sig: this.sig(data), tiles: [], stale: false };
    this.boxes.set(b, box);
    const base = s.start(b);
    const g = new Grid(s.rows(b), s.lanes, this.wallRows);
    const rand = rng(b * 7919 + SPANS.indexOf(s.span) * 104729 + 17);
    const add = (t: Tile) => box.tiles.push(t);
    const place = (sf: Surface, a: number, r: number, len = 1, span = 1) => {
      g.take(sf, a, r, len, span);
      return this.spot(sf, a, base + r, len, span);
    };
    const labelSpan = Math.min(3, s.lanes);
    const labelLane = Math.floor((s.lanes - labelSpan) / 2);

    // a week's, month's or year's name on the floor of the dark band in front of it
    if (s.span !== "day") {
      const sp = this.spot("F", labelLane, base - 1, 1, labelSpan);
      add(this.makeTile(sp, { map: this.texture(this.drawLabel(data.title, data.sub, "", sp.w, sp.h, false), true), label: true, hoverable: false }));
    }

    // long tasks (planned day → deadline) as rails on the ceiling, one lane each
    this.addRails(data, b, g, add);

    if (s.span === "day") this.layoutDay(data.days[0], b, g, place, add, rand);
    else if (s.span === "year") this.layoutYear(data, b, g, place, add, rand);
    else this.layoutDays(data, b, g, place, add, rand);

    // accent tiles in the box's goal colours (the theme's when it has none)
    const palette = data.colors.length ? data.colors.map((c) => hex(c, this.c.primary)) : [this.c.primary, this.c.accent2];
    const cells = g.rows * (s.lanes * 2 + this.wallRows * 2);
    const count = Math.round(cells * ACCENT_FILL * (s.span === "year" ? 0.5 : 1));
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const sf = SURFACES[Math.floor(rand() * 4)];
      const a = Math.floor(rand() * g.width(sf));
      const r = Math.floor(rand() * g.rows);
      if (!g.free(sf, a, r)) continue;
      const colA = palette[Math.floor(rand() * palette.length)];
      const colB = mix(colA, rand() > 0.5 ? "#ffffff" : palette[(palette.indexOf(colA) + 1) % palette.length], 0.5);
      add(this.makeTile(place(sf, a, r), { colA, colB, opacity: this.glass ? 0.82 : 1 }));
      i++;
    }
  }

  private addRails(data: TunnelBox, b: number, g: Grid, add: (t: Tile) => void) {
    const s = this.scale;
    const boxStart = s.start(b), next = s.start(b + 1);
    for (const l of data.long) {
      const from = s.rowOf(l.from, s.span === "day" ? HOUR_FROM * 60 : null);
      const to = s.span === "year" ? s.rowOf(l.to) + 1 : s.rowOf(l.to + 1, s.span === "day" ? HOUR_FROM * 60 : null);
      const a = Math.max(from, boxStart), z = Math.min(to, next);
      if (z - a < 0.2) continue;
      const lane = l.lane % s.lanes;
      const sp = this.spot("C", lane, a, z - a);
      sp.w = Math.min(sp.w, 0.28 * (this.W / s.lanes)); // a rail, not a tile
      for (let r = Math.floor(a - boxStart); r < Math.ceil(z - boxStart); r++) if (r >= 0 && r < g.rows) g.take("C", lane, r);
      const col = hex(l.task.color, this.c.primary);
      const t = this.makeTile(sp, { colA: col, colB: mix(col, "#ffffff", 0.35), opacity: 0.9, pick: { kind: "long", task: l.task } });
      t.u.uRadius.value = sp.w / 2;
      add(t);
    }
  }

  // tasks on the walls at eye level, both sides in turn
  private onWalls(g: Grid, row: number, len: number, i: number, order: number[]) {
    const sides: Surface[] = i % 2 ? ["R", "L"] : ["L", "R"];
    for (const dr of order) {
      const r = row + dr;
      for (const sf of sides) for (const a of this.eye) if (g.free(sf, a, r, len)) return { sf, a, r };
    }
    return null;
  }
  // anywhere in this row (walls first, then the ceiling, then the floor)
  private inRow(g: Grid, r: number, i: number) {
    const w = this.onWalls(g, r, 1, i, [0]);
    if (w) return w;
    for (const sf of ["C", "F"] as Surface[]) for (let a = 0; a < g.lanes; a++) if (g.free(sf, a, r)) return { sf, a, r };
    return null;
  }

  private addTask(t: TunnelTask, day: number, at: { sf: Surface; a: number; r: number }, len: number, place: (sf: Surface, a: number, r: number, len?: number) => Spot, add: (t: Tile) => void) {
    const sp = place(at.sf, at.a, at.r, len);
    const px = CARD_PX * Math.sqrt(Math.min(2, Math.max(sp.w, sp.h) / Math.min(sp.w, sp.h)));
    const tile = this.makeTile(sp, { map: this.texture(this.drawTask(t, sp.w, sp.h, px)), pick: { kind: "task", day, task: t } });
    tile.redraw = (scale) => this.drawTask(t, sp.w, sp.h, CARD_PX * scale);
    add(tile);
  }

  // Media spread over rows: each one near its row, any side.
  private addMedia(list: { m: TunnelMedia; day: number; row: number }[], g: Grid, place: (sf: Surface, a: number, r: number) => Spot, add: (t: Tile) => void, rand: () => number, spread: number) {
    list.forEach(({ m, day, row }, i) => {
      const sides = [...SURFACES].sort(() => rand() - 0.5);
      let at: { sf: Surface; a: number; r: number } | null = null;
      for (let dr = 0; dr <= spread && !at; dr++) {
        for (const r of dr ? [row + dr, row - dr] : [row]) {
          for (const sf of sides) {
            const cells = Array.from({ length: g.width(sf) }, (_, j) => j).sort(() => rand() - 0.5);
            const a = cells.find((j) => g.free(sf, j, r));
            if (a !== undefined) {
              at = { sf, a, r };
              break;
            }
          }
          if (at) break;
        }
      }
      if (at) add(this.mediaTile(place(at.sf, at.a, at.r), m, { kind: "media", day, media: m, index: i, count: list.length }));
    });
  }

  // day: 06:00 near → 24:00 far; the date at the entrance, the hours along the floor's left edge
  private layoutDay(d: TunnelDay, b: number, g: Grid, place: (sf: Surface, a: number, r: number, len?: number, span?: number) => Spot, add: (t: Tile) => void, rand: () => number) {
    const s = this.scale;
    const span = Math.min(3, s.lanes), lane = Math.floor((s.lanes - span) / 2);
    const ls = place("F", lane, 0, 1, span);
    add(this.makeTile(ls, { map: this.texture(this.drawLabel(String(d.dayNum), d.today ? "Today" : d.weekday, d.month, ls.w, ls.h, d.today), true), label: true, pick: { kind: "day", day: d.day } }));
    for (let hour = 9; hour < HOUR_FROM + HOURS; hour += 3) {
      const hs = place("F", 0, hour - HOUR_FROM);
      add(this.makeTile(hs, { map: this.texture(this.drawText(`${String(hour).padStart(2, "0")}:00`, hs.w, hs.h), true), label: true, hoverable: false }));
    }
    // a timed task at its hour (as long as its estimate, up to 3 h), the rest from the morning on
    const near = [0, 1, -1, 2, -2, 3, 4, 5, 6, 7, 8];
    const timed = d.tasks.filter((t) => t.time).sort((a, b2) => a.time!.localeCompare(b2.time!));
    timed.forEach((t, i) => {
      const row = clamp(Math.floor((minutesOf(t.time!) - HOUR_FROM * 60) / 60), 0, HOURS - 1);
      const len = clamp(Math.round((t.minutes ?? 60) / 60), 1, Math.min(3, HOURS - row));
      const at = this.onWalls(g, row, len, i, [0]) ?? this.onWalls(g, row, 1, i, near) ?? this.inRow(g, row, i);
      if (at) this.addTask(t, d.day, at, g.free(at.sf, at.a, at.r, len) ? len : 1, place, add);
    });
    const forward = Array.from({ length: HOURS }, (_, i) => i);
    d.tasks.filter((t) => !t.time).forEach((t, i) => {
      const at = this.onWalls(g, 0, 1, i + timed.length, forward);
      if (at) this.addTask(t, d.day, at, 1, place, add);
    });
    // the memory photos / videos spread over the day
    const n = d.media.length;
    this.addMedia(
      d.media.map((m, i) => ({ m, day: d.day, row: clamp(Math.floor(((i + 0.5) * HOURS) / n + (rand() - 0.5) * 2), 0, HOURS - 1) })),
      g, place, add, rand, HOURS,
    );
  }

  // week / month: a row a day — its label on the floor, its tasks on the walls, its photos around
  private layoutDays(data: TunnelBox, b: number, g: Grid, place: (sf: Surface, a: number, r: number, len?: number, span?: number) => Spot, add: (t: Tile) => void, rand: () => number) {
    const s = this.scale;
    const week = s.span === "week";
    const [from] = s.dayRange(b);
    const media: { m: TunnelMedia; day: number; row: number }[] = [];
    for (const d of data.days) {
      const r = d.day - from;
      const count = d.count ? ` · ${d.count}` : "";
      if (week) {
        const span = Math.min(3, s.lanes), lane = Math.floor((s.lanes - span) / 2);
        const ls = place("F", lane, r, 1, span);
        add(this.makeTile(ls, { map: this.texture(this.drawLabel(String(d.dayNum), d.today ? "Today" : d.weekday, `${d.month}${count}`, ls.w, ls.h, d.today), true), label: true, pick: { kind: "day", day: d.day } }));
      } else {
        const lane = Math.floor(s.lanes / 2);
        const ls = place("F", lane, r);
        add(this.makeTile(ls, { map: this.texture(this.drawLabel(String(d.dayNum), d.weekday.slice(0, 3), count.slice(3), ls.w, ls.h, d.today, 420), true), label: true, pick: { kind: "day", day: d.day } }));
      }
      const cap = week ? Infinity : 4;
      d.tasks.slice(0, cap).forEach((t, i) => {
        const at = this.inRow(g, r, i);
        if (at) this.addTask(t, d.day, at, 1, place, add);
      });
      for (const m of d.media) media.push({ m, day: d.day, row: r });
    }
    this.addMedia(media, g, place, add, rand, 0);
  }

  // year: a row a week, the 7 days across the floor — the activity of the year
  private layoutYear(data: TunnelBox, b: number, g: Grid, place: (sf: Surface, a: number, r: number, len?: number, span?: number) => Spot, add: (t: Tile) => void, rand: () => number) {
    const s = this.scale;
    const base = s.start(b);
    const media: { m: TunnelMedia; day: number; row: number }[] = [];
    for (const d of data.days) {
      const r = Math.round(s.rowOf(d.day) - base);
      const lane = s.laneOf(d.day);
      const value = d.done + 0.5 * (d.count - d.done);
      const level = value <= 0 ? 0 : value < 1 ? 1 : value < 2.5 ? 2 : value < 4 ? 3 : 4;
      const sp = place("F", lane, r);
      const pick: TunnelPick = { kind: "day", day: d.day };
      if (d.tasks.length || d.today || d.dayNum === 1) {
        add(this.makeTile(sp, { map: this.texture(this.drawYearDay(d, level, sp.w, sp.h), true), label: true, pick }));
      } else {
        const col = level ? this.c.primary : this.c.fg;
        add(this.makeTile(sp, { colA: col, colB: col, opacity: level ? [0, 0.3, 0.5, 0.72, 0.95][level] : 0.07, pick }));
      }
      // the month's name on the left wall where it starts
      if (d.dayNum === 1) {
        const a = this.eye[0];
        if (g.free("L", a, r)) {
          const ms = place("L", a, r);
          add(this.makeTile(ms, { map: this.texture(this.drawText(d.month, ms.w, ms.h, 0.75, 0.34), true), label: true, hoverable: false }));
        }
      }
      for (const m of d.media) media.push({ m, day: d.day, row: r });
    }
    this.addMedia(media, g, place, add, rand, 1);
  }

  // ── media (photos, videos) ─────────────────────────────────────────────────────────────────────────────────────
  private mediaTile(sp: Spot, m: TunnelMedia, pick: TunnelPick) {
    const waiting = this.texture(this.drawMediaWaiting(sp.w, sp.h, m.video), true);
    const tile = this.makeTile(sp, { map: waiting, label: true, pick });
    tile.media = m.path;
    let entry = this.media.get(m.path);
    if (!entry && m.url) {
      const e: MediaTex = { tex: null, aspect: 1, uses: 0, state: "loading", waiters: new Set(), used: performance.now(), video: null, rows: new Set() };
      entry = e;
      this.media.set(m.path, e);
      const ready = (tex: THREE.Texture, aspect: number) => {
        if (this.disposed) return tex.dispose();
        e.tex = tex;
        e.aspect = aspect || 1;
        e.state = "ready";
        e.waiters.forEach((t) => this.showMedia(t, e));
        e.waiters.clear();
        this.dirty = true;
      };
      const failed = () => {
        e.state = "failed"; // the bucket must allow this site (CORS, #193) — the tile keeps its stand-in
        e.waiters.clear();
      };
      if (m.video) {
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        v.addEventListener("loadeddata", () => {
          const tex = new THREE.VideoTexture(v);
          tex.colorSpace = THREE.SRGBColorSpace;
          ready(tex, v.videoWidth / v.videoHeight);
        }, { once: true });
        v.addEventListener("error", failed, { once: true });
        v.src = m.url;
        e.video = v;
      } else {
        loadImage(m.url).then((img) => ready(this.texture(scaled(img, PHOTO_PX)), img.naturalWidth / img.naturalHeight)).catch(failed);
      }
    }
    if (entry) {
      entry.uses++;
      entry.used = performance.now();
      if (entry.video) entry.rows.add(tile);
      if (entry.state === "ready") this.showMedia(tile, entry);
      else if (entry.state === "loading") entry.waiters.add(tile);
    }
    return tile;
  }

  private showMedia(t: Tile, e: MediaTex) {
    if (!e.tex) return;
    t.own?.dispose();
    t.own = null;
    t.u.uMap.value = e.tex;
    t.u.uLabel.value = 0;
    t.imageAspect = e.aspect;
    this.setSize(t, t.mesh.scale.x, t.mesh.scale.y);
  }

  private freeMedia(m: MediaTex) {
    m.tex?.dispose();
    if (m.video) {
      m.video.pause();
      m.video.removeAttribute("src");
      m.video.load();
    }
  }

  // Keep up to 60 unused media for the way back; free the oldest beyond that.
  private pruneMedia() {
    const idle = [...this.media.entries()].filter(([, m]) => m.uses <= 0 && m.state !== "loading").sort((a, b) => a[1].used - b[1].used);
    for (const [path, m] of idle.slice(0, Math.max(0, idle.length - 60))) {
      this.freeMedia(m);
      this.media.delete(path);
    }
  }

  // The nearest few videos ahead play (muted, looping); the rest wait.
  private playVideos() {
    const want: { m: MediaTex; d: number }[] = [];
    for (const m of this.media.values()) {
      if (!m.video || m.state !== "ready") continue;
      let d = Infinity;
      for (const t of m.rows) {
        if (this.focus?.tile === t) d = -100;
        else d = Math.min(d, Math.abs(-t.home.pos.z - this.pos - 4));
      }
      want.push({ m, d });
    }
    want.sort((a, b) => a.d - b.d);
    want.forEach(({ m, d }, i) => {
      const play = i < PLAYING && d < 12;
      if (play && m.video!.paused) m.video!.play().catch(() => undefined);
      else if (!play && !m.video!.paused) m.video!.pause();
    });
    return want.some(({ m }) => !m.video!.paused);
  }

  // the "now" ring around the passage (the time in the day span, today's row in the others)
  private buildRing() {
    for (let i = 0; i < 4; i++) {
      const t = this.makeTile({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), normal: new THREE.Vector3(), w: 1, h: 1 }, { colA: this.c.primary, hoverable: false });
      this.ring.push(t);
    }
    this.placeRing();
  }

  private placeRing() {
    const { W, H } = this;
    const s = this.scale;
    const z = -(s.span === "day" ? s.rowOf(this.today, this.nowMinutes) : s.rowOf(this.today));
    const th = 0.035;
    const faces: [Surface, number, number][] = [["F", W, th], ["C", W, th], ["L", th, H], ["R", th, H]];
    faces.forEach(([sf, w, h], i) => {
      const t = this.ring[i];
      if (!t) return;
      const sp = this.spot(sf, 0, 0, 1);
      sp.pos.z = z;
      if (sf === "F" || sf === "C") sp.pos.x = 0;
      else sp.pos.y = 0;
      sp.pos.addScaledVector(sp.normal, LIFT);
      t.home = { ...sp, w, h };
      this.placeHome(t);
      t.u.uRadius.value = 0;
    });
  }

  // ── focus (fly-out) ────────────────────────────────────────────────────────────────────────────────────────────
  private open(t: Tile) {
    if (!t.pick) return;
    this.focus = { tile: t, t: 0, dir: 1 };
    t.mesh.renderOrder = 999;
    t.mesh.material.depthTest = false;
    t.u.uFocused.value = 1;
    t.hover = 0;
    t.u.uHover.value = 0;
    this.animating.delete(t);
    this.boosting = false;
    this.glide = 0;
    const pick = t.pick;
    if (t.redraw) {
      t.hiRes = this.texture(t.redraw(CARD_FOCUS_SCALE));
      t.u.uMap.value = t.hiRes;
    } else if (pick.kind === "media" && !pick.media.video && pick.media.url && this.media.get(t.media!)?.state === "ready") {
      loadImage(pick.media.url)
        .then((img) => {
          if (this.focus?.tile !== t || this.disposed) return;
          t.hiRes = this.texture(scaled(img, PHOTO_FOCUS_PX));
          t.u.uMap.value = t.hiRes;
          this.dirty = true;
        })
        .catch(() => undefined);
    }
    this.events.onFocus(pick);
    this.events.onHover(null);
    this.dirty = true;
  }

  private finishClose() {
    const f = this.focus;
    if (!f) return;
    const t = f.tile;
    this.focus = null;
    t.mesh.renderOrder = 0;
    t.mesh.material.depthTest = true;
    t.u.uFocused.value = 0;
    if (t.hiRes) {
      t.hiRes.dispose();
      t.hiRes = null;
      t.u.uMap.value = t.media ? this.media.get(t.media)?.tex ?? t.own : t.own;
    }
    this.shared.uDim.value = 0;
    this.placeHome(t);
    const stale = [...this.boxes.values()].filter((b) => b.stale).map((b) => b.b);
    for (const b of stale) this.rebuildBox(b, this.events.getBox(this.scale, b));
  }

  private stepFocus(dt: number) {
    const f = this.focus;
    if (!f) return false;
    const dur = this.reduced ? 0.2 : f.dir > 0 ? 0.75 : 0.6;
    f.t = clamp(f.t + (dt / dur) * f.dir, 0, 1);
    const e = easeInOut(f.t);
    const t = f.tile;
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const visH = 2 * FOCUS_DIST * Math.tan((FOV * Math.PI) / 360);
    const visW = visH * cam.aspect;
    const aspect = t.imageAspect ?? t.home.w / t.home.h;
    const h = Math.min(visH * 0.72, (visW * 0.86) / aspect);
    const w = h * aspect;
    const target = cam.position.clone().addScaledVector(fwd, FOCUS_DIST).addScaledVector(up, visH * 0.035);
    t.mesh.position.copy(t.home.pos).lerp(target, e);
    t.mesh.quaternion.copy(t.home.quat).slerp(cam.quaternion, e);
    this.setSize(t, t.home.w + (w - t.home.w) * e, t.home.h + (h - t.home.h) * e);
    this.shared.uDim.value = 0.55 * e;
    if (f.dir < 0 && f.t === 0) this.finishClose();
    return true;
  }

  // ── pointer ────────────────────────────────────────────────────────────────────────────────────────────────────
  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerIn = true;
    this.pointerMoved = true;
    this.dirty = true;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    this.setPointer(e);
    const touch = e.pointerType !== "mouse";
    // The tile is the one under the finger when it goes down: the passage keeps moving until it comes up.
    const press = {
      x: e.clientX, y: e.clientY, id: e.pointerId, touch, moved: false, boosted: false, timer: 0,
      lastV: 0, lastAt: performance.now(), last: touch ? e.clientX : e.clientY, at: performance.now(),
      tile: this.focus ? null : this.tileAt(),
    };
    press.timer = window.setTimeout(() => {
      if (this.press === press && !press.moved && !this.focus) {
        press.boosted = true;
        this.boosting = true;
        this.canvas.style.cursor = "grabbing";
      }
    }, BOOST_AFTER);
    this.press = press;
  };

  private onMovePointer = (e: PointerEvent) => {
    this.setPointer(e);
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > (p.touch ? 12 : 6) && !this.focus) {
      p.moved = true;
      clearTimeout(p.timer);
      if (p.boosted) {
        p.boosted = false;
        this.boosting = false;
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.events.onHover(null);
    }
    if (!p.moved) return;
    // mouse drags vertically (down = forward), touch sideways (left = forward)
    const cur = p.touch ? e.clientX : e.clientY;
    const span = p.touch ? this.canvas.clientWidth : this.canvas.clientHeight;
    const rows = ((p.touch ? p.last - cur : cur - p.last) * 8) / Math.max(span, 1);
    const now = performance.now();
    p.lastV = rows / Math.max((now - p.lastAt) / 1000, 1e-3);
    p.lastAt = now;
    p.last = cur;
    this.dragMove += rows;
  };

  private onUp = (e: PointerEvent) => {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer);
    this.press = null;
    this.canvas.style.cursor = "";
    const held = performance.now() - p.at;
    if (p.boosted) {
      this.boosting = false;
      if (held > CLICK_WITHIN) return; // a real hold: it was a boost, not a click
    }
    if (p.moved) {
      if (performance.now() - p.lastAt < 80) this.glide += clamp(p.lastV * 0.3, -6, 6); // a flick keeps going
      this.anchor = this.pos + this.glide;
      return;
    }
    this.click(p.tile, p.x, p.y);
  };

  private onCancel = (e: PointerEvent) => {
    if (this.press?.id === e.pointerId) {
      clearTimeout(this.press.timer);
      this.press = null;
      this.boosting = false;
    }
  };

  private onLeave = () => {
    this.pointerIn = false;
    if (!this.press) this.boosting = false;
    this.setHovered(null);
    this.dirty = true;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const px = e.deltaMode === 1 ? raw * 32 : e.deltaMode === 2 ? raw * 400 : raw;
    if (e.ctrlKey) {
      // ctrl + wheel (a trackpad pinch): out to the wider span, in to the narrower one
      const now = performance.now();
      if (now - this.zoomAt < 700) return;
      this.zoomAcc += px;
      if (Math.abs(this.zoomAcc) > 60) {
        const dir = this.zoomAcc > 0 ? 1 : -1;
        this.zoomAcc = 0;
        this.zoomAt = now;
        this.events.onZoom(dir, this.scale.at(this.pos + 2).day);
      }
      return;
    }
    this.travel(clamp(px / 100, -4, 4));
  };

  private onVisibility = () => {
    this.visible = !document.hidden;
    this.lastT = 0;
  };

  private tileAt(): Tile | null {
    if (!this.pointerIn) return null;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.picks, false)[0];
    return hit ? this.tileOf.get(hit.object) ?? null : null;
  }

  // The cell of the wall under the pointer → the day (and, in the day span, the hour) it stands for.
  private cellAt(): { day: number; minutes: number | null } | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.shell, false)[0];
    if (!hit) return null;
    const s = this.scale;
    const sf = SURFACES[this.shell.indexOf(hit.object as THREE.Mesh)];
    const row = Math.floor(-hit.point.z);
    const b = s.boxAt(row);
    const local = row - s.start(b);
    const lane = sf === "F" ? Math.floor((hit.point.x + this.W / 2) / (this.W / s.lanes)) : null;
    if (s.span === "year" && lane === null) return null;
    const day = s.dayOfCell(b, local, lane);
    if (day === null) return null;
    return { day, minutes: s.span === "day" ? (HOUR_FROM + local) * 60 : null };
  }

  private click(pressed: Tile | null, x: number, y: number) {
    if (this.focus) {
      this.close();
      return;
    }
    const t = pressed && this.tileOf.get(pressed.mesh) === pressed ? pressed : this.tileAt(); // still alive?
    if (t?.pick) {
      if (t.pick.kind === "day" || t.pick.kind === "long") this.events.onPick(t.pick);
      else this.open(t);
      return;
    }
    // an empty cell (or an accent tile): a new task there
    const cell = this.cellAt();
    if (!cell) return;
    const r = this.host.getBoundingClientRect();
    this.events.onEmpty({ ...cell, x: x - r.left, y: y - r.top });
  }

  private setHovered(t: Tile | null) {
    if (t === this.hovered) return;
    if (this.hovered) this.animating.add(this.hovered);
    this.hovered = t;
    if (t) this.animating.add(t);
    this.canvas.style.cursor = t?.pick ? "pointer" : "";
    this.events.onHover(t?.pick && (t.pick.kind === "task" || t.pick.kind === "long") ? t.pick : null);
  }

  // ── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.visible) return;
    const dt = this.lastT ? Math.min((now - this.lastT) / 1000, 0.05) : 1 / 60;
    this.lastT = now;
    const busy = this.step(dt);
    if (busy || this.dirty) {
      this.render();
      this.dirty = false;
    }
  };

  private step(dt: number) {
    let busy = false;
    const still = !!this.focus || this.held;

    // speed: cruise (not when paused, opened, asked or for reduced motion), ×BOOST while held
    const cruise = this.paused || this.reduced || still ? 0 : SPEED;
    const target = this.boosting && !still ? SPEED * BOOST : cruise;
    this.vel = damp(this.vel, target, this.boosting ? 2.2 : 3, dt);
    if (Math.abs(this.vel - target) < 1e-4) this.vel = target;
    let move = this.vel * dt + this.dragMove;
    this.dragMove = 0;
    if (this.glide) {
      const g = this.glide * (1 - Math.exp(-dt * 6));
      move += g;
      this.glide -= g;
      if (Math.abs(this.glide) < 1e-3) {
        move += this.glide;
        this.glide = 0;
      }
    }
    this.pos += move;
    const speed = Math.abs(move) / Math.max(dt, 1e-3);
    this.speedSeen = damp(this.speedSeen, speed, 8, dt);
    if (move !== 0 || this.speedSeen > 1e-3) busy = true;

    // look toward the pointer (turn + shift), back to straight when it leaves
    const lx = this.pointerIn && !still && !this.reduced ? this.ndc.x : 0;
    const ly = this.pointerIn && !still && !this.reduced ? this.ndc.y : 0;
    this.lookX = damp(this.lookX, lx, 3.5, dt);
    this.lookY = damp(this.lookY, ly, 3.5, dt);
    if (Math.abs(this.lookX - lx) + Math.abs(this.lookY - ly) > 1e-4) busy = true;
    const cam = this.camera;
    cam.position.set(this.lookX * 0.22 * LOOK, this.lookY * 0.14 * LOOK * Math.min(1, this.H / 3), -this.pos);
    cam.rotation.set(this.lookY * 0.09 * LOOK, -this.lookX * 0.13 * LOOK, 0);
    cam.updateMatrixWorld();

    // the walls come along; without glass the fog takes the night's colour inside a dark band
    for (const m of this.shell) m.position.z = -this.pos - (SHELL / 2 - BEHIND - 6);
    this.syncBoxes();
    if (this.glass) this.renderer.setClearColor(0x000000, 0);
    else {
      const fog = new THREE.Color(this.c.wall).lerp(new THREE.Color(this.c.night), this.nightAt(this.pos + 4) * 0.9);
      this.shared.uFogColor.value.copy(fog);
      this.renderer.setClearColor(fog, 1);
    }

    // cruising far ahead fades back to today
    const far = WRAP_BOXES * (this.scale.span === "day" ? HOURS + 4 : 1) * (this.scale.span === "year" ? 0.5 : 1);
    if (!this.paused && !this.wrapping && !still && !this.press && this.pos > Math.max(this.home, this.anchor) + far) {
      this.anchor = this.home;
      this.jump(this.home);
    }

    if (this.stepFocus(dt)) busy = true;

    // hover: the tile under the pointer brightens and lifts
    if (this.pointerIn && !still && !this.press?.moved && (this.pointerMoved || busy)) {
      this.pointerMoved = false;
      const t = this.tileAt();
      this.setHovered(t && t.hoverable ? t : null);
    }
    for (const t of this.animating) {
      const goal = t === this.hovered ? 1 : 0;
      t.hover = damp(t.hover, goal, 12, dt);
      if (Math.abs(t.hover - goal) < 0.002) {
        t.hover = goal;
        this.animating.delete(t);
      }
      t.u.uHover.value = t.hover * HOVER;
      if (this.focus?.tile !== t) this.placeHome(t);
      busy = true;
    }

    // videos: the nearest few play
    this.videoCheck -= dt;
    if (this.videoCheck <= 0) {
      this.videoCheck = 0.25;
      this.videosOn = this.playVideos();
    }
    if (this.videosOn) busy = true;

    const place = this.scale.at(this.pos + 2);
    const key = `${place.day}:${place.minutes === null ? "" : Math.floor(place.minutes / 60)}:${place.band}`;
    if (key !== this.lastMove) {
      this.lastMove = key;
      this.events.onMove(place);
    }
    return busy;
  }
  private videosOn = false;

  private jump(row: number) {
    if (this.wrapping) return;
    this.wrapping = true;
    this.canvas.style.opacity = "0";
    window.setTimeout(() => {
      if (this.disposed) return;
      this.pos = row;
      this.glide = 0;
      this.vel = 0;
      this.syncBoxes();
      this.dirty = true;
      this.canvas.style.opacity = "1";
      window.setTimeout(() => (this.wrapping = false), 300);
    }, 300);
  }

  private render() {
    const r = this.renderer;
    const strength = this.reduced ? 0 : BLUR * clamp((this.speedSeen - SPEED * 1.6) / (SPEED * BOOST * 0.7), 0, 1);
    if (strength > 0.01 && !this.wrapping) {
      r.setRenderTarget(this.rt);
      r.clear();
      r.render(this.scene, this.camera);
      r.setRenderTarget(null);
      // blur away from the vanishing point
      const v = new THREE.Vector3(this.camera.position.x, this.camera.position.y, this.camera.position.z - 200).project(this.camera);
      this.blurMat.uniforms.uCenter.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
      this.blurMat.uniforms.uStrength.value = strength * 0.085;
      r.render(this.blurScene, this.blurCam);
    } else {
      r.render(this.scene, this.camera);
    }
  }
}

// ── text ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    // a word longer than the line is cut
    while (g.measureText(word).width > maxW && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && g.measureText(word.slice(0, cut)).width > maxW) cut--;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= maxW) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsis(g, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxW);
    return kept;
  }
  return lines;
}

function ellipsis(g: CanvasRenderingContext2D, text: string, maxW: number) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
