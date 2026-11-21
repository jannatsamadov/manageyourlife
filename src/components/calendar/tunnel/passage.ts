// Tunnel view engine (P-62 / T-94, 2026-11-21). A passage of tiles you glide through; the owner's reference is React
// Bits Pro "Passage Gallery" (paid — its behaviour is matched here, the code is our own). Time runs along the passage:
// a box = a day, from 06:00 near to 24:00 far, one row of cells per hour, and a dark band between two days (the
// night). The tiles on the walls, floor and ceiling are the day's tasks at their hour, its memory photos and accent
// tiles in the goal colours. The camera cruises; hold to boost, wheel / drag to travel, the view turns toward the
// pointer, the tile under it lifts, a click flies a tile out to full view (click again or Escape puts it back).
import * as THREE from "three";

export const HOUR_FROM = 6; // the box starts at 06:00 …
export const HOURS = 18; // … and runs to 24:00, a row per hour
export const NIGHT_ROWS = 4; // the dark band between two days
export const PERIOD = HOURS + NIGHT_ROWS;

// The reference's defaults (pro.reactbits.dev → Passage Gallery).
const LANES = 5, GAP = 0.1, RADIUS = 0.06, ACCENT_FILL = 0.06, LINE_OPACITY = 0.12, FOG = 1, SPEED = 0.6, BOOST = 10,
  BLUR = 1, LOOK = 1, FOV = 72, HOVER = 1, MAX_DPR = 2;
const AHEAD = 34, BEHIND = 3; // rows kept alive in front of / behind the camera
const SHELL = AHEAD + BEHIND + 12; // the walls' length, moved along with the camera
const FOG_NEAR = 3, FOG_FAR = 30 / FOG;
const LIFT = 0.006; // tiles sit this far off their wall
const FOCUS_DIST = 1.25;
const MAX_PHOTOS = 24; // per day
const WRAP_DAYS = 14; // cruising this far ahead fades back to today (as the Depth view does)

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
export type TunnelPhoto = { path: string; url: string | null };
export type TunnelDay = {
  tasks: TunnelTask[];
  photos: TunnelPhoto[];
  dayNum: number;
  weekday: string;
  month: string;
  today: boolean;
  colors: string[];
};
export type TunnelPick =
  | { kind: "task"; k: number; task: TunnelTask }
  | { kind: "photo"; k: number; photo: TunnelPhoto; index: number; count: number }
  | { kind: "day"; k: number };
export type TunnelTheme = { bg: string; fg: string; primary: string; font: string };
export type PassageEvents = {
  getDay: (k: number) => TunnelDay; // k = days from today
  onFocus: (pick: TunnelPick | null) => void;
  onHover: (pick: TunnelPick | null) => void;
  onMove: (row: number) => void;
  onRange: (from: number, to: number) => void;
  onPick: (pick: TunnelPick) => void; // a day's label clicked
};

// ── time ↔ rows ──────────────────────────────────────────────────────────────────────────────────────────────────
// Row 0 = today 06:00. Minutes before 06:00 belong to the night band in front of the day.
export function rowAt(k: number, minutes: number) {
  if (minutes >= HOUR_FROM * 60) return k * PERIOD + Math.min(minutes - HOUR_FROM * 60, HOURS * 60) / 60;
  return (k - 1) * PERIOD + HOURS + (minutes / (HOUR_FROM * 60)) * NIGHT_ROWS;
}
export function timeAt(row: number) {
  const k = Math.floor(row / PERIOD);
  const phase = row - k * PERIOD;
  if (phase < HOURS) return { k, minutes: HOUR_FROM * 60 + phase * 60 };
  return { k: k + 1, minutes: ((phase - HOURS) / NIGHT_ROWS) * HOUR_FROM * 60 };
}
const nightOf = (row: number) => {
  const p = ((row % PERIOD) + PERIOD) % PERIOD;
  return smooth(HOURS - 0.15, HOURS + 1.1, p) * (1 - smooth(PERIOD - 1.1, PERIOD - 0.05, p));
};

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
function smooth(a: number, b: number, v: number) {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}
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
const mix = (a: string, b: string, t: number) => {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
};
const luma = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
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
uniform float uLineOpacity; uniform float uPeriod; uniform float uDayRows;
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
  float p = mod(row, uPeriod);
  float night = smoothstep(uDayRows - 0.15, uDayRows + 1.1, p) * (1.0 - smoothstep(uPeriod - 1.1, uPeriod - 0.05, p));
  float across = ((uAxis < 0.5 ? vWorld.x : vWorld.y) - uAcrossOrigin) / uAcrossCell;
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  float line = max(gridLine(row), gridLine(across)) * (1.0 - smoothstep(uFogNear, uFogFar * 0.85, vDepth));
  vec3 col = mix(uWall, uNight, night);
  col = mix(col, mix(uLine, uNightLine, night), line * uLineOpacity);
  col = mix(col, uFogColor, fog);
  col = mix(col, uDimTo, uDim);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
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
uniform sampler2D uMap; uniform float uHasMap; uniform float uLabel;
uniform vec3 uColA; uniform vec3 uColB; uniform vec2 uSize; uniform float uRadius;
uniform float uHover; uniform float uFocused; uniform vec2 uUvScale; uniform vec2 uUvOffset;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uDim; uniform vec3 uDimTo;
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
  col = mix(col, vec3(1.0), uHover * 0.12);
  float fog = smoothstep(uFogNear, uFogFar, vDepth) * (1.0 - uFocused);
  if (uLabel > 0.5) a *= 1.0 - fog; else col = mix(col, uFogColor, fog);
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
type Spot = { pos: THREE.Vector3; quat: THREE.Quaternion; normal: THREE.Vector3; w: number; h: number };
type TileUniforms = {
  uMap: { value: THREE.Texture | null }; uHasMap: { value: number }; uLabel: { value: number };
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
  imageAspect: number | null; // photos: the picture's own shape
  own: THREE.Texture | null; // a texture this tile made (task cards, labels) — disposed with it
  redraw?: (scale: number) => HTMLCanvasElement; // task cards: drawn again sharper when opened
  photo?: string;
  hiRes?: THREE.Texture | null;
};
type DayBlock = { k: number; sig: string; tiles: Tile[]; stale: boolean };
type PhotoTex = { tex: THREE.Texture | null; aspect: number; uses: number; state: "loading" | "ready" | "failed"; waiters: Set<Tile>; used: number };

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
  };
  private shellUniforms = {
    uWall: { value: new THREE.Color() }, uNight: { value: new THREE.Color() },
    uLine: { value: new THREE.Color() }, uNightLine: { value: new THREE.Color() },
    uLineOpacity: { value: LINE_OPACITY }, uPeriod: { value: PERIOD }, uDayRows: { value: HOURS },
  };
  private shell: THREE.Mesh[] = [];
  private ring: Tile[] = [];
  private days = new Map<number, DayBlock>();
  private picks: THREE.Object3D[] = [];
  private tileOf = new Map<THREE.Object3D, Tile>();
  private photos = new Map<string, PhotoTex>();
  private raycaster = new THREE.Raycaster();
  private rt: THREE.WebGLRenderTarget;
  private blurScene = new THREE.Scene();
  private blurCam = new THREE.Camera();
  private blurMat: THREE.ShaderMaterial;
  private ro: ResizeObserver;
  private io: IntersectionObserver;

  // the passage's shape: LANES across the floor, the height follows the screen's shape
  private W = LANES;
  private H = 3;
  private wallRows = 3;
  private ch = 1;

  // theme (hex)
  private c = { wall: "#111", night: "#000", line: "#fff", nightLine: "#fff", fg: "#fff", primary: "#10b981", accent2: "#7dd3fc", bg: "#111", font: "system-ui, sans-serif", dark: true };

  // motion
  private pos = 0;
  private vel = 0;
  private glide = 0;
  private dragMove = 0;
  private speedSeen = 0;
  private paused = false;
  private boosting = false;
  private lookX = 0;
  private lookY = 0;
  private home = -2;
  private anchor = -2; // where the owner last moved to; cruising WRAP_DAYS beyond it fades back home
  private nowRow = 0;
  private wrapping = false;

  // pointer
  private ndc = new THREE.Vector2();
  private pointerIn = false;
  private pointerMoved = false;
  private press: { x: number; y: number; id: number; touch: boolean; moved: boolean; boosted: boolean; timer: number; lastV: number; lastAt: number; last: number } | null = null;
  private hovered: Tile | null = null;
  private animating = new Set<Tile>();
  private focus: { tile: Tile; t: number; dir: 1 | -1 } | null = null;

  private raf = 0;
  private lastT = 0;
  private dirty = true;
  private visible = true;
  private lastMove = NaN;
  private lastRange = "";
  private disposed = false;

  constructor(host: HTMLElement, events: PassageEvents, opts: { theme: TunnelTheme; reduced: boolean; start: number; now: number }) {
    this.host = host;
    this.events = events;
    this.reduced = opts.reduced;
    this.pos = opts.start;
    this.home = opts.start;
    this.anchor = opts.start;
    this.nowRow = opts.now;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;transition:opacity .45s ease";
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.rt.texture }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 } },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    quad.frustumCulled = false;
    this.blurScene.add(quad);

    this.applyTheme(opts.theme);
    this.measure();
    this.buildShell();
    this.buildRing();

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
  travel(rows: number) {
    if (this.focus) this.close();
    this.glide += rows;
    this.anchor = this.pos + this.glide;
    this.dirty = true;
  }
  goTo(row: number) {
    if (this.focus) this.close();
    this.anchor = row;
    if (Math.abs(row - this.pos) > PERIOD * 2.5) this.jump(row);
    else {
      this.glide = row - this.pos;
      this.dirty = true;
    }
  }
  jumpDays(n: number) {
    const cur = Math.floor((this.pos + 2.5) / PERIOD);
    this.goTo((cur + n) * PERIOD - 2);
  }
  goHome() {
    this.goTo(this.home);
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.dirty = true;
  }
  setNow(row: number) {
    this.nowRow = row;
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
  // The data behind the days changed: rebuild the days whose content differs.
  refresh() {
    for (const [k, block] of this.days) {
      const data = this.events.getDay(k);
      if (this.sig(data) === block.sig) continue;
      if (this.focus && block.tiles.includes(this.focus.tile)) block.stale = true;
      else this.rebuildDay(k, data);
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
    for (const k of [...this.days.keys()]) this.dropDay(k);
    for (const t of this.ring) this.freeTile(t);
    for (const p of this.photos.values()) p.tex?.dispose();
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
      // a dark theme lifts the day's walls a little so the night between days reads as darker
      wall: dark ? mix(bg, fg, 0.06) : bg,
      night: dark ? mix(bg, "#000000", 0.75) : "#0e1424",
      line: fg,
      nightLine: dark ? fg : "#ffffff",
    };
    const s = this.shellUniforms;
    s.uWall.value.set(this.c.wall);
    s.uNight.value.set(this.c.night);
    s.uLine.value.set(this.c.line);
    s.uNightLine.value.set(this.c.nightLine);
    this.shared.uDimTo.value.set(dark ? "#000000" : "#ffffff");
    this.dirty = true;
  }

  private measure() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.round(w * dpr), Math.round(h * dpr));
    // The cross-section has the screen's shape; the walls get as many rows as fit.
    this.H = clamp((LANES * h) / w, 1.4, 12);
    this.wallRows = Math.max(1, Math.round(this.H));
    this.ch = this.H / this.wallRows;
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

  private buildShell() {
    for (const m of this.shell) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.shell = [];
    const { W, H } = this;
    const make = (geo: THREE.PlaneGeometry, axis: number, origin: number, cell: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.shellUniforms, ...this.shared, uAxis: { value: axis }, uAcrossOrigin: { value: origin }, uAcrossCell: { value: cell } },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
      });
      const m = new THREE.Mesh(geo, mat);
      this.scene.add(m);
      this.shell.push(m);
      return m;
    };
    const floor = make(new THREE.PlaneGeometry(W, SHELL), 0, -W / 2, W / LANES);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -H / 2;
    const ceiling = make(new THREE.PlaneGeometry(W, SHELL), 0, -W / 2, W / LANES);
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
    const cw = W / LANES;
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

  private makeTile(spot: Spot, o: { map?: THREE.Texture | null; label?: boolean; colA?: string; colB?: string; pick?: TunnelPick | null; hoverable?: boolean }) {
    const u: TileUniforms = {
      uMap: { value: o.map ?? null }, uHasMap: { value: o.map ? 1 : 0 }, uLabel: { value: o.label ? 1 : 0 },
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
    if (t.photo) {
      const p = this.photos.get(t.photo);
      if (p) {
        p.uses--;
        p.waiters.delete(t);
      }
    }
    this.animating.delete(t);
    if (this.hovered === t) this.hovered = null;
  }

  private texture(canvas: HTMLCanvasElement, label = false) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
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

    // the title, as big as fits
    g.globalAlpha = t.done ? 0.75 : 1;
    const top = pad + (meta ? 17 * u : 0);
    const bottom = H - pad - (t.goal ? 14 * u : 0);
    const maxW = W - pad * 2;
    // the biggest size at which the whole title fits; at the smallest one the rest is cut with "…"
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

  private drawDayLabel(d: TunnelDay, w: number, h: number) {
    const c = this.canvasFor(w, h, 900);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const ink = d.today ? this.c.primary : this.c.fg;
    const font = this.c.font;
    g.fillStyle = ink;
    g.textBaseline = "alphabetic";
    const big = H * 0.62;
    g.font = `700 ${big}px ${font}`;
    const num = String(d.dayNum);
    const numW = g.measureText(num).width;
    g.font = `600 ${H * 0.2}px ${font}`;
    const sub1 = d.today ? "Today" : d.weekday;
    const sub2 = d.month;
    const subW = Math.max(g.measureText(sub1).width, g.measureText(sub2).width);
    const gap = H * 0.12;
    const x0 = (W - numW - gap - subW) / 2;
    const base = H * 0.76;
    g.globalAlpha = 0.92;
    g.font = `700 ${big}px ${font}`;
    g.fillText(num, x0, base);
    g.font = `600 ${H * 0.2}px ${font}`;
    g.globalAlpha = 0.8;
    g.fillText(sub1, x0 + numW + gap, base - H * 0.27);
    g.globalAlpha = 0.55;
    g.fillText(sub2, x0 + numW + gap, base);
    return c;
  }

  private drawHour(hour: number, w: number, h: number) {
    const c = this.canvasFor(w, h, 256);
    const g = c.getContext("2d")!;
    g.fillStyle = this.c.fg;
    g.globalAlpha = 0.5;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${c.height * 0.24}px ${this.c.font}`;
    g.fillText(`${String(hour).padStart(2, "0")}:00`, c.width / 2, c.height / 2);
    return c;
  }

  private drawPhotoWaiting(w: number, h: number) {
    const c = this.canvasFor(w, h, 192);
    const g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    g.fillStyle = mix(this.c.wall, this.c.fg, 0.1);
    g.fillRect(0, 0, W, H);
    g.strokeStyle = this.c.fg;
    g.fillStyle = this.c.fg;
    g.globalAlpha = 0.3;
    g.lineWidth = Math.min(W, H) * 0.025;
    const s = Math.min(W, H) * 0.32, x = W / 2 - s / 2, y = H / 2 - s / 2;
    g.beginPath();
    g.moveTo(x, y + s);
    g.lineTo(x + s * 0.4, y + s * 0.45);
    g.lineTo(x + s * 0.62, y + s * 0.7);
    g.lineTo(x + s * 0.78, y + s * 0.55);
    g.lineTo(x + s, y + s);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(x + s * 0.78, y + s * 0.18, s * 0.11, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // ── days ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private sig(d: TunnelDay) {
    return JSON.stringify([d.tasks, d.photos.map((p) => [p.path, !!p.url]), d.dayNum, d.today, d.colors, this.wallRows, this.H]);
  }

  private syncDays() {
    const from = Math.floor((this.pos - BEHIND) / PERIOD);
    const to = Math.floor((this.pos + AHEAD) / PERIOD);
    for (const k of [...this.days.keys()]) if (k < from || k > to) {
      if (this.focus && this.days.get(k)!.tiles.includes(this.focus.tile)) continue;
      this.dropDay(k);
    }
    for (let k = from; k <= to; k++) if (!this.days.has(k)) this.buildDay(k, this.events.getDay(k));
    const key = `${from}:${to}`;
    if (key !== this.lastRange) {
      this.lastRange = key;
      this.events.onRange(from, to);
    }
  }

  private rebuildAll() {
    if (this.focus) {
      this.finishClose();
      this.events.onFocus(null);
    }
    for (const k of [...this.days.keys()]) this.dropDay(k);
    this.syncDays();
    this.dirty = true;
  }

  private rebuildDay(k: number, data: TunnelDay) {
    this.dropDay(k);
    this.buildDay(k, data);
  }

  private dropDay(k: number) {
    const block = this.days.get(k);
    if (!block) return;
    block.tiles.forEach((t) => this.freeTile(t));
    this.days.delete(k);
    this.prunePhotos();
  }

  private buildDay(k: number, d: TunnelDay) {
    const block: DayBlock = { k, sig: this.sig(d), tiles: [], stale: false };
    this.days.set(k, block);
    const base = k * PERIOD;
    const n = this.wallRows;
    const rand = rng(k * 7919 + 104729);
    const used = new Set<string>();
    const key = (s: Surface, a: number, r: number) => `${s}${a}:${r}`;
    const width = (s: Surface) => (s === "F" || s === "C" ? LANES : n);
    const free = (s: Surface, a: number, r: number, len = 1, span = 1) => {
      if (r < 0 || r + len > HOURS || a < 0 || a + span > width(s)) return false;
      for (let i = 0; i < len; i++) for (let j = 0; j < span; j++) if (used.has(key(s, a + j, r + i))) return false;
      return true;
    };
    const take = (s: Surface, a: number, r: number, len = 1, span = 1) => {
      for (let i = 0; i < len; i++) for (let j = 0; j < span; j++) used.add(key(s, a + j, r + i));
      return this.spot(s, a, base + r, len, span);
    };
    // the wall rows nearest the eye first
    const eye = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a + 0.5 - n / 2) - Math.abs(b + 0.5 - n / 2) || a - b);

    // the day's label on the floor at its entrance, the hours along the left edge of the floor
    const span = Math.min(3, LANES);
    const lane = Math.floor((LANES - span) / 2);
    const ls = take("F", lane, 0, 1, span);
    const labelTex = this.texture(this.drawDayLabel(d, ls.w, ls.h), true);
    block.tiles.push(this.makeTile(ls, { map: labelTex, label: true, pick: { kind: "day", k } }));
    for (let hour = 9; hour < HOUR_FROM + HOURS; hour += 3) {
      const hs = take("F", 0, hour - HOUR_FROM);
      block.tiles.push(this.makeTile(hs, { map: this.texture(this.drawHour(hour, hs.w, hs.h), true), label: true, hoverable: false }));
    }

    // tasks: a timed one at its hour (as long as its estimate, up to 3 h), the rest from the morning on — on the
    // walls at eye level, both sides in turn
    const addTask = (t: TunnelTask, s: Surface, a: number, r: number, len: number) => {
      const sp = take(s, a, r, len);
      const canvas = this.drawTask(t, sp.w, sp.h, CARD_PX * Math.min(2, Math.max(sp.w, sp.h) / Math.min(sp.w, sp.h)) ** 0.5);
      const tile = this.makeTile(sp, { map: this.texture(canvas), pick: { kind: "task", k, task: t } });
      tile.redraw = (scale) => this.drawTask(t, sp.w, sp.h, CARD_PX * scale);
      block.tiles.push(tile);
    };
    const onWalls = (row: number, len: number, i: number, order: number[]) => {
      const sides: Surface[] = i % 2 ? ["R", "L"] : ["L", "R"];
      for (const dr of order) {
        const r = row + dr;
        for (const s of sides) for (const a of eye) if (free(s, a, r, len)) return { s, a, r };
      }
      return null;
    };
    const anywhere = (row: number) => {
      for (let dr = 0; dr < HOURS; dr++) for (const r of [row + dr, row - dr]) for (const s of ["F", "C"] as Surface[])
        for (let a = 0; a < LANES; a++) if (free(s, a, r)) return { s, a, r };
      return null;
    };
    const near = [0, 1, -1, 2, -2, 3, 4, 5, 6, 7, 8];
    const timed = d.tasks.filter((t) => t.time).sort((a, b) => a.time!.localeCompare(b.time!));
    const untimed = d.tasks.filter((t) => !t.time);
    timed.forEach((t, i) => {
      const row = clamp(Math.floor((minutesOf(t.time!) - HOUR_FROM * 60) / 60), 0, HOURS - 1);
      const len = clamp(Math.round((t.minutes ?? 60) / 60), 1, Math.min(3, HOURS - row));
      const at = onWalls(row, len, i, [0]) ?? onWalls(row, 1, i, near);
      if (at) addTask(t, at.s, at.a, at.r, free(at.s, at.a, at.r, len) ? len : 1);
      else {
        const any = anywhere(row);
        if (any) addTask(t, any.s, any.a, any.r, 1);
      }
    });
    const forward = Array.from({ length: HOURS }, (_, i) => i);
    untimed.forEach((t, i) => {
      const at = onWalls(0, 1, i + timed.length, forward) ?? anywhere(0);
      if (at) addTask(t, at.s, at.a, at.r, 1);
    });

    // memory photos spread over the day, on every side
    const photos = d.photos.slice(0, MAX_PHOTOS);
    photos.forEach((p, i) => {
      const target = clamp(Math.floor(((i + 0.5) * HOURS) / photos.length + (rand() - 0.5) * 2), 0, HOURS - 1);
      const sides = (["C", "L", "R", "F"] as Surface[]).sort(() => rand() - 0.5);
      let at: { s: Surface; a: number; r: number } | null = null;
      for (let dr = 0; dr < HOURS && !at; dr++) {
        for (const r of dr ? [target + dr, target - dr] : [target]) {
          for (const s of sides) {
            const cells = Array.from({ length: width(s) }, (_, j) => j).sort(() => rand() - 0.5);
            const a = cells.find((j) => free(s, j, r));
            if (a !== undefined) {
              at = { s, a, r };
              break;
            }
          }
          if (at) break;
        }
      }
      if (!at) return;
      const sp = take(at.s, at.a, at.r);
      block.tiles.push(this.photoTile(sp, p, { kind: "photo", k, photo: p, index: i, count: photos.length }));
    });

    // accent tiles in the day's goal colours (the theme's when the day has none)
    const palette = d.colors.length ? d.colors.map((c) => hex(c, this.c.primary)) : [this.c.primary, this.c.accent2];
    const cells = HOURS * (LANES * 2 + n * 2);
    const count = Math.round(cells * ACCENT_FILL);
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const s = (["F", "C", "L", "R"] as Surface[])[Math.floor(rand() * 4)];
      const a = Math.floor(rand() * width(s));
      const r = Math.floor(rand() * HOURS);
      if (!free(s, a, r)) continue;
      const colA = palette[Math.floor(rand() * palette.length)];
      const colB = mix(colA, rand() > 0.5 ? "#ffffff" : palette[(palette.indexOf(colA) + 1) % palette.length], 0.5);
      block.tiles.push(this.makeTile(take(s, a, r), { colA, colB }));
      i++;
    }
  }

  private photoTile(sp: Spot, p: TunnelPhoto, pick: TunnelPick) {
    const waiting = this.texture(this.drawPhotoWaiting(sp.w, sp.h));
    const tile = this.makeTile(sp, { map: waiting, pick });
    tile.photo = p.path;
    let entry = this.photos.get(p.path);
    if (!entry && p.url) {
      const e: PhotoTex = { tex: null, aspect: 1, uses: 0, state: "loading", waiters: new Set(), used: performance.now() };
      entry = e;
      this.photos.set(p.path, e);
      loadImage(p.url)
        .then((img) => {
          if (this.disposed) return;
          e.tex = this.texture(scaled(img, PHOTO_PX));
          e.aspect = img.naturalWidth / img.naturalHeight || 1;
          e.state = "ready";
          e.waiters.forEach((t) => this.showPhoto(t, e));
          e.waiters.clear();
          this.dirty = true;
        })
        .catch(() => {
          e.state = "failed"; // the bucket must allow this site (CORS) — the tile keeps its stand-in
          e.waiters.clear();
        });
    }
    if (entry) {
      entry.uses++;
      entry.used = performance.now();
      if (entry.state === "ready") this.showPhoto(tile, entry);
      else if (entry.state === "loading") entry.waiters.add(tile);
    }
    return tile;
  }

  private showPhoto(t: Tile, e: PhotoTex) {
    if (!e.tex) return;
    t.own?.dispose();
    t.own = null;
    t.u.uMap.value = e.tex;
    t.imageAspect = e.aspect;
    this.setSize(t, t.mesh.scale.x, t.mesh.scale.y);
  }

  // Keep up to 60 unused photo textures for the way back; free the oldest beyond that.
  private prunePhotos() {
    const idle = [...this.photos.entries()].filter(([, p]) => p.uses <= 0 && p.state !== "loading").sort((a, b) => a[1].used - b[1].used);
    for (const [path, p] of idle.slice(0, Math.max(0, idle.length - 60))) {
      p.tex?.dispose();
      this.photos.delete(path);
    }
  }

  // the "now" ring around the passage
  private buildRing() {
    for (let i = 0; i < 4; i++) {
      const t = this.makeTile({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), normal: new THREE.Vector3(), w: 1, h: 1 }, { colA: this.c.primary, hoverable: false });
      t.u.uRadius.value = 0;
      this.ring.push(t);
    }
    this.placeRing();
  }

  private placeRing() {
    const { W, H } = this;
    const z = -this.nowRow;
    const th = 0.035;
    const faces: [Surface, number, number][] = [["F", W, th], ["C", W, th], ["L", th, H], ["R", th, H]];
    faces.forEach(([s, w, h], i) => {
      const t = this.ring[i];
      if (!t) return;
      const sp = this.spot(s, 0, 0, 1);
      sp.pos.z = z;
      if (s === "F" || s === "C") sp.pos.x = 0;
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
    if (t.redraw) {
      t.hiRes = this.texture(t.redraw(CARD_FOCUS_SCALE));
      t.u.uMap.value = t.hiRes;
    } else if (t.pick.kind === "photo" && t.pick.photo.url && this.photos.get(t.photo!)?.state === "ready") {
      loadImage(t.pick.photo.url)
        .then((img) => {
          if (this.focus?.tile !== t || this.disposed) return;
          t.hiRes = this.texture(scaled(img, PHOTO_FOCUS_PX));
          t.u.uMap.value = t.hiRes;
          this.dirty = true;
        })
        .catch(() => undefined);
    }
    this.events.onFocus(t.pick);
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
      t.u.uMap.value = t.photo ? this.photos.get(t.photo)?.tex ?? t.own : t.own;
    }
    this.shared.uDim.value = 0;
    this.placeHome(t);
    const stale = [...this.days.values()].filter((b) => b.stale).map((b) => b.k);
    for (const k of stale) this.rebuildDay(k, this.events.getDay(k));
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
    const press = {
      x: e.clientX, y: e.clientY, id: e.pointerId, touch, moved: false, boosted: false, timer: 0,
      lastV: 0, lastAt: performance.now(), last: touch ? e.clientX : e.clientY,
    };
    press.timer = window.setTimeout(() => {
      if (this.press === press && !press.moved && !this.focus) {
        press.boosted = true;
        this.boosting = true;
        this.canvas.style.cursor = "grabbing";
      }
    }, 200);
    this.press = press;
  };

  private onMovePointer = (e: PointerEvent) => {
    this.setPointer(e);
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 && !this.focus) {
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
    if (p.boosted) {
      this.boosting = false;
      return;
    }
    if (p.moved) {
      if (performance.now() - p.lastAt < 80) this.glide += clamp(p.lastV * 0.3, -6, 6); // a flick keeps going
      this.anchor = this.pos + this.glide;
      return;
    }
    this.click();
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

  private click() {
    if (this.focus) {
      this.close();
      return;
    }
    const t = this.tileAt();
    if (!t?.pick) return;
    if (t.pick.kind === "day") this.events.onPick(t.pick);
    else this.open(t);
  }

  private setHovered(t: Tile | null) {
    if (t === this.hovered) return;
    if (this.hovered) this.animating.add(this.hovered);
    this.hovered = t;
    if (t) this.animating.add(t);
    this.canvas.style.cursor = t?.pick ? "pointer" : "";
    this.events.onHover(t?.pick && t.pick.kind === "task" ? t.pick : null);
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
    const focusOpen = !!this.focus;

    // speed: cruise (not when paused, opened or for reduced motion), ×BOOST while held
    const cruise = this.paused || this.reduced || focusOpen ? 0 : SPEED;
    const target = this.boosting && !focusOpen ? SPEED * BOOST : cruise;
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
    const lx = this.pointerIn && !focusOpen && !this.reduced ? this.ndc.x : 0;
    const ly = this.pointerIn && !focusOpen && !this.reduced ? this.ndc.y : 0;
    this.lookX = damp(this.lookX, lx, 3.5, dt);
    this.lookY = damp(this.lookY, ly, 3.5, dt);
    if (Math.abs(this.lookX - lx) + Math.abs(this.lookY - ly) > 1e-4) busy = true;
    const cam = this.camera;
    cam.position.set(this.lookX * 0.22 * LOOK, this.lookY * 0.14 * LOOK * Math.min(1, this.H / 3), -this.pos);
    cam.rotation.set(this.lookY * 0.09 * LOOK, -this.lookX * 0.13 * LOOK, 0);
    cam.updateMatrixWorld();

    // the walls come along; the fog takes the night's colour inside the dark band
    for (const m of this.shell) m.position.z = -this.pos - (SHELL / 2 - BEHIND - 6);
    const night = nightOf(this.pos + 4);
    const fog = new THREE.Color(this.c.wall).lerp(new THREE.Color(this.c.night), night * 0.9);
    this.shared.uFogColor.value.copy(fog);
    this.renderer.setClearColor(fog);

    this.syncDays();

    // cruising far ahead fades back to today
    if (!this.paused && !this.wrapping && !focusOpen && !this.press && this.pos > Math.max(this.home, this.anchor) + WRAP_DAYS * PERIOD) {
      this.anchor = this.home;
      this.jump(this.home);
    }

    if (this.stepFocus(dt)) busy = true;

    // hover: the tile under the pointer brightens and lifts
    if (this.pointerIn && !focusOpen && !this.press?.moved && (this.pointerMoved || busy)) {
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

    const at = Math.floor(this.pos + 2);
    if (at !== this.lastMove) {
      this.lastMove = at;
      this.events.onMove(this.pos + 2);
    }
    return busy;
  }

  private jump(row: number) {
    if (this.wrapping) return;
    this.wrapping = true;
    this.canvas.style.opacity = "0";
    window.setTimeout(() => {
      if (this.disposed) return;
      this.pos = row;
      this.glide = 0;
      this.vel = 0;
      this.syncDays();
      this.dirty = true;
      this.canvas.style.opacity = "1";
      window.setTimeout(() => (this.wrapping = false), 450);
    }, 450);
  }

  private render() {
    const r = this.renderer;
    const strength = this.reduced ? 0 : BLUR * clamp((this.speedSeen - SPEED * 1.6) / (SPEED * BOOST * 0.7), 0, 1);
    if (strength > 0.01) {
      r.setRenderTarget(this.rt);
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
