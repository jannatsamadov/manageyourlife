// GLSL for the solar-system theme. Everything is procedural (3-D noise on the sphere): no image files, no seams.
import * as THREE from "three";

// 3-D simplex noise — Ian McEwan, Ashima Arts / Stefan Gustavson (MIT).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { f += a * snoise(p); p *= 2.03; a *= 0.5; }
  return f;
}
`;

const SPHERE_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vDir = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// ── Star: granulated surface; heat (= goal progress) turns a dim red protostar into a white-gold sun ──
export function sunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uBright: { value: 1 } },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHeat, uBright;
      varying vec3 vDir; varying vec3 vNormalW; varying vec3 vPosW;
      ${NOISE}
      void main() {
        vec3 p = vDir;
        float big = fbm(p * 2.6 + vec3(uTime * 0.035));
        float small = fbm(p * 9.0 - vec3(uTime * 0.06));
        float cells = big * 0.65 + small * 0.35;
        vec3 deep = mix(vec3(0.35, 0.03, 0.01), vec3(1.0, 0.42, 0.08), uHeat);
        vec3 hot = mix(vec3(1.0, 0.22, 0.04), vec3(1.0, 0.93, 0.78), uHeat);
        vec3 col = mix(deep, hot, smoothstep(-0.35, 0.55, cells));
        vec3 V = normalize(cameraPosition - vPosW);
        float mu = max(dot(normalize(vNormalW), V), 0.0);
        col *= 0.5 + 0.5 * pow(mu, 0.45);              // limb darkening
        col += hot * pow(1.0 - mu, 3.0) * 0.6;          // bright rim
        gl_FragColor = vec4(col * uBright, 1.0);
      }
    `,
  });
}

// ── Planet / moon / dwarf planet: dim grey when nothing is done, its own colours and inner glow as it lights up ──
// uType: 0 rocky, 1 gas giant (bands), 2 ice (caps)
export function planetMaterial(opts: { colors: [THREE.Color, THREE.Color, THREE.Color]; type: number; seed: number }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: opts.colors[0] },
      uB: { value: opts.colors[1] },
      uC: { value: opts.colors[2] },
      uType: { value: opts.type },
      uSeed: { value: opts.seed },
      uLit: { value: 0 },
      uSun: { value: 0.5 },
      uHover: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uA, uB, uC;
      uniform float uType, uSeed, uLit, uSun, uHover, uTime;
      varying vec3 vDir; varying vec3 vNormalW; varying vec3 vPosW;
      ${NOISE}
      void main() {
        vec3 p = vDir;
        vec3 s = vec3(uSeed * 7.13, uSeed * 3.71, uSeed * 5.29);
        vec3 col;
        if (uType < 0.5) {
          float land = fbm(p * 2.2 + s);
          float detail = fbm(p * 7.5 + s * 1.7);
          col = mix(uA, uB, smoothstep(-0.12, 0.22, land));
          col = mix(col, uC, smoothstep(0.25, 0.6, detail) * 0.55);
          float crater = smoothstep(0.55, 0.62, snoise(p * 11.0 + s)) * 0.25;
          col *= 1.0 - crater;
        } else if (uType < 1.5) {
          float warp = fbm(p * 2.4 + s + vec3(0.0, 0.0, uTime * 0.01));
          float y = p.y * 9.0 + warp * 2.6;
          float band = 0.5 + 0.5 * sin(y * 2.0) * cos(y * 0.73 + s.x);
          col = mix(uA, uB, band);
          col = mix(col, uC, smoothstep(0.35, 0.7, fbm(p * vec3(6.0, 18.0, 6.0) + s)) * 0.6);
        } else {
          float n = fbm(p * 3.4 + s);
          col = mix(uA, uB, n * 0.5 + 0.5);
          col = mix(col, uC, smoothstep(0.2, 0.5, fbm(p * 12.0 + s)) * 0.4);
          col = mix(col, vec3(0.92, 0.96, 1.0), smoothstep(0.72, 0.9, abs(p.y + n * 0.1)));
        }
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(-vPosW);                    // the star sits at the origin
        vec3 V = normalize(cameraPosition - vPosW);
        float diff = max(dot(N, L), 0.0);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
        float grey = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 base = mix(vec3(grey) * 0.5, col, uLit);
        vec3 lit = base * (0.07 + diff * (0.32 + 0.68 * uSun));
        vec3 glow = col * uLit * uLit * 0.62;          // a finished body shines by itself
        vec3 edge = rim * mix(vec3(0.16, 0.18, 0.24), col * 1.3, uLit) * (0.3 + 0.9 * uLit);
        vec3 outc = lit + glow + edge + vec3(0.6, 0.7, 1.0) * rim * uHover * 0.5;
        gl_FragColor = vec4(outc, 1.0);
      }
    `,
  });
}

// ── Atmosphere: soft halo at the edge, stronger as the body lights up ──
export function atmosphereMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uStrength: { value: 0.2 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.4);
        gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ── Ring of a mission with "at least N" (like Saturn): bands, brighter with progress ──
export function ringMaterial(color: THREE.Color, inner: number, outer: number, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: seed }, uLit: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vXY;
      void main() { vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uInner, uOuter, uSeed, uLit;
      varying vec2 vXY;
      void main() {
        float r = (length(vXY) - uInner) / (uOuter - uInner);
        float bands = 0.5 + 0.5 * sin(r * 70.0 + uSeed * 9.0) * sin(r * 17.0 + uSeed * 4.0);
        float gap = smoothstep(0.0, 0.02, abs(r - 0.62)) ;
        float edge = smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.86, r);
        float a = edge * gap * (0.35 + 0.65 * bands) * (0.14 + 0.6 * uLit);
        float grey = dot(uColor, vec3(0.299, 0.587, 0.114));
        vec3 c = mix(vec3(grey) * 0.5, uColor, uLit) * (0.8 + 0.6 * uLit);
        gl_FragColor = vec4(c * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ── Sky of an area: faint nebula in the area's colour, so each part of life has its own sky ──
export function nebulaMaterial(color: THREE.Color, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uSeed: { value: seed } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uSeed;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 s = vec3(uSeed * 3.1, uSeed * 1.7, uSeed * 2.3);
        float n = fbm(vDir * 1.6 + s);
        float m = fbm(vDir * 3.8 - s);
        float cloud = smoothstep(0.0, 0.75, n) * (0.55 + 0.45 * m);
        vec3 second = uColor.gbr * 0.6 + vec3(0.05, 0.02, 0.12);
        vec3 c = mix(second, uColor, smoothstep(-0.2, 0.5, m)) * cloud * 0.24;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// Soft round glow for sprites (corona, halos).
let glow: THREE.Texture | null = null;
export function glowTexture() {
  if (glow) return glow;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.22)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.05)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  return glow;
}

// Thin rays around a bright star.
let rays: THREE.Texture | null = null;
export function raysTexture() {
  if (rays) return rays;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.translate(size / 2, size / 2);
  for (let i = 0; i < 48; i++) {
    const len = size * (0.18 + 0.32 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.rotate((Math.PI * 2) / 48);
    g.fillStyle = grad;
    g.fillRect(0, -0.8, len, 1.6);
  }
  rays = new THREE.CanvasTexture(canvas);
  return rays;
}
