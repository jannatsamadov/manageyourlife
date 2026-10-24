// Galaxy overview (T-72): every area of life is a nebula on the spiral arms of one galaxy, its goals are stars inside
// it — red and faint at 0 %, white-gold and bright when done. Click an area to fly there, a star to enter its system.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { percent, seeded, type TreeNode } from "@/lib/strategy";
import { glowTexture } from "../solar/shaders";

export type GalaxyProps = {
  areas: TreeNode[];
  looseGoals: TreeNode[];
  focusId: string | null;
  onFocus: (areaId: string | null) => void;
  onOpenGoal: (goalId: string) => void;
};

const ARMS = 4;
const RADIUS = 30;
const TWIST = 0.26;
const RED = new THREE.Color("#ff4a1c");
const WHITE = new THREE.Color("#fff1d0");
const noRaycast = () => null;

type Ctx = {
  frozen: MutableRefObject<boolean>;
  areaObjects: Map<string, THREE.Object3D>;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  enter: (goalId: string, at: THREE.Object3D) => void;
};
const GalaxyContext = createContext<Ctx | null>(null);
const useGalaxy = () => useContext(GalaxyContext)!;

function gaussian(rand: () => number) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const armAngle = (arm: number, r: number) => (arm * Math.PI * 2) / ARMS + r * TWIST;

// Areas sit on the arms, one per arm, then further out.
function placeAreas(areas: TreeNode[]) {
  const places = new Map<string, THREE.Vector3>();
  areas.forEach((a, i) => {
    const arm = i % ARMS;
    const r = 9 + Math.floor(i / ARMS) * 9 + arm * 1.6;
    const ang = armAngle(arm, r);
    places.set(a.node.id, new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
  });
  return places;
}

const heat = (v: number) => new THREE.Color().lerpColors(RED, WHITE, v);

// ── The disk: ~18k soft points along log-spiral arms, warm core, cool arms, tinted near each area ──
function Disk({ tints }: { tints: { pos: THREE.Vector3; color: THREE.Color }[] }) {
  const { geometry, material } = useMemo(() => {
    const rand = seeded("galaxy-disk");
    const n = 18000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const core = new THREE.Color("#ffdcae");
    const arm = new THREE.Color("#7f9dff");
    const c = new THREE.Color();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const bulge = rand() < 0.18;
      const r = bulge ? Math.abs(gaussian(rand)) * 3.2 : Math.pow(rand(), 1.35) * RADIUS + 1;
      const ang = bulge ? rand() * Math.PI * 2 : armAngle(i % ARMS, r) + gaussian(rand) * (0.12 + 0.18 / (1 + r * 0.15));
      const jitter = 0.35 + r * 0.045;
      p.set(Math.cos(ang) * r + gaussian(rand) * jitter, gaussian(rand) * (bulge ? 0.9 : 0.28 * (1.3 - r / RADIUS)), Math.sin(ang) * r + gaussian(rand) * jitter);
      pos.set([p.x, p.y, p.z], i * 3);
      c.lerpColors(core, arm, Math.min(1, r / (RADIUS * 0.75)));
      for (const t of tints) {
        const d = p.distanceTo(t.pos);
        if (d < 6) c.lerp(t.color, (1 - d / 6) * 0.65);
      }
      // arms a little brighter than the dense core, so the spiral reads from afar
      const k = (0.45 + rand() * 0.75) * (bulge ? 0.75 : 1.25);
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
      size[i] = rand() < 0.02 ? 2.6 + rand() * 2 : 0.7 + rand() * 1.3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 140 * Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
    // the tints only colour the disk; recolouring when an area changes colour is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tints.map((t) => `${t.pos.x.toFixed(1)}:${t.color.getHexString()}`).join("|")]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points geometry={geometry} material={material} raycast={noRaycast} />;
}

function Core() {
  return (
    <group>
      <sprite scale={[9, 9, 1]} raycast={noRaycast}>
        <spriteMaterial map={glowTexture()} color="#ffd9a6" transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={[26, 26, 1]} raycast={noRaycast}>
        <spriteMaterial map={glowTexture()} color="#ffb877" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}

function GoalStar({ goal, offset, showLabel }: { goal: TreeNode; offset: THREE.Vector3; showLabel: boolean }) {
  const g = useGalaxy();
  const ref = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.SpriteMaterial>(null!);
  const id = goal.node.id;
  const v = goal.node.status === "dropped" ? 0 : goal.value;
  const color = useMemo(() => heat(v), [v]);
  const core = useMemo(() => heat(v).multiplyScalar(1.2 + 2.5 * v), [v]);
  useFrame(() => {
    ref.current.scale.setScalar(g.hovered === id ? 1.35 : 1);
    glow.current.opacity = 0.3 + 0.55 * v;
  });
  return (
    <group ref={ref} position={offset}>
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); g.setHovered(id); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { g.setHovered(null); document.body.style.cursor = ""; }}
        onClick={(e) => { e.stopPropagation(); g.enter(id, ref.current); }}
      >
        <sphereGeometry args={[0.16 + 0.14 * v, 20, 16]} />
        <meshBasicMaterial color={core} toneMapped={false} />
      </mesh>
      <sprite scale={[1.4 + 2.6 * v, 1.4 + 2.6 * v, 1]} raycast={noRaycast}>
        <spriteMaterial ref={glow} map={glowTexture()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      {(showLabel || g.hovered === id) && (
        <Html position={[0, -0.55, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="select-none whitespace-nowrap text-[11px] text-white/70 [text-shadow:0_1px_4px_#000]">
            {goal.node.title}
            {g.hovered === id && <span className="ml-1.5 text-white/45">{percent(goal.value)}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

function AreaCloud({ area, pos }: { area: TreeNode; pos: THREE.Vector3 }) {
  const g = useGalaxy();
  const ref = useRef<THREE.Group>(null!);
  const id = area.node.id;
  const color = useMemo(() => new THREE.Color(area.color || "#7c9cff"), [area.color]);
  const focused = g.focusId === id;
  useEffect(() => {
    g.areaObjects.set(id, ref.current);
    return () => void g.areaObjects.delete(id);
  }, [id, g.areaObjects]);
  // Goals of the area: a small cluster around its centre.
  const offsets = useMemo(() => area.children.map((goal, j) => {
    const rand = seeded(goal.node.id);
    const a = rand() * Math.PI * 2;
    const d = j === 0 ? 0.4 : 0.9 + j * 0.5;
    return new THREE.Vector3(Math.cos(a) * d, (rand() - 0.5) * 0.5, Math.sin(a) * d);
  }), [area.children]);
  const glow = 0.1 + 0.28 * area.value;
  return (
    <group ref={ref} position={pos}>
      {[0, 1, 2].map((k) => {
        const rand = seeded(`${id}:${k}`);
        const s = 5 + rand() * 4;
        return (
          <sprite key={k} position={[(rand() - 0.5) * 2.2, (rand() - 0.5) * 0.4, (rand() - 0.5) * 2.2]} scale={[s, s * (0.6 + rand() * 0.4), 1]} raycast={noRaycast}>
            <spriteMaterial map={glowTexture()} color={color} transparent opacity={glow * (k === 0 ? 1 : 0.6)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        );
      })}
      {area.children.map((goal, j) => <GoalStar key={goal.node.id} goal={goal} offset={offsets[j]} showLabel={focused} />)}
      <Html position={[0, 2.4, 0]} center zIndexRange={[25, 0]}>
        <button
          onClick={(e) => { e.stopPropagation(); g.onFocus(focused ? null : id); }}
          className={`flex select-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs backdrop-blur-sm transition-colors [text-shadow:0_1px_4px_#000] ${focused ? "bg-white/15 text-white" : "text-white/75 hover:text-white"}`}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: area.color }} />
          {area.node.title}
        </button>
      </Html>
    </group>
  );
}

function Spin({ group }: { group: MutableRefObject<THREE.Group> }) {
  const { frozen } = useGalaxy();
  useFrame((_, dt) => {
    if (!frozen.current) group.current.rotation.y += Math.min(dt, 0.1) * 0.012;
  });
  return null;
}

function Rig() {
  const g = useGalaxy();
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  useEffect(() => {
    if (!controls) return;
    const obj = g.focusId ? g.areaObjects.get(g.focusId) : undefined;
    g.frozen.current = !!obj;
    if (!obj) {
      controls.setLookAt(0, 26, 40, 0, 0, 0, true);
      return;
    }
    const p = obj.getWorldPosition(new THREE.Vector3());
    const out = p.clone().setY(0).normalize();
    controls.setLookAt(p.x + out.x * 7, p.y + 6, p.z + out.z * 7, p.x, p.y, p.z, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.focusId, controls]);
  return null;
}

function Scene({ areas, looseGoals, ctx }: { areas: TreeNode[]; looseGoals: TreeNode[]; ctx: Ctx }) {
  const group = useRef<THREE.Group>(null!);
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const places = useMemo(() => placeAreas(areas), [areas]);
  const tints = useMemo(() => areas.map((a) => ({ pos: places.get(a.node.id)!, color: new THREE.Color(a.color || "#7c9cff") })), [areas, places]);
  const looseOffsets = useMemo(() => looseGoals.map((goal) => {
    const rand = seeded(goal.node.id);
    const a = rand() * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 4.5, 0, Math.sin(a) * 4.5);
  }), [looseGoals]);
  // Diving into a system: fly to the star first, then open it.
  const value: Ctx = {
    ...ctx,
    enter: (goalId, at) => {
      ctx.frozen.current = true;
      const p = at.getWorldPosition(new THREE.Vector3());
      if (!controls) return ctx.enter(goalId, at);
      controls.setLookAt(p.x + 0.8, p.y + 0.5, p.z + 1.2, p.x, p.y, p.z, true).then(() => ctx.enter(goalId, at));
    },
  };
  return (
    <GalaxyContext.Provider value={value}>
      <group ref={group} rotation={[0, 0.6, 0]}>
        <Disk tints={tints} />
        <Core />
        {areas.map((a) => <AreaCloud key={a.node.id} area={a} pos={places.get(a.node.id)!} />)}
        {looseGoals.map((goal, i) => <GoalStar key={goal.node.id} goal={goal} offset={looseOffsets[i]} showLabel={false} />)}
      </group>
      <Spin group={group} />
      <Rig />
    </GalaxyContext.Provider>
  );
}

export default function Galaxy({ areas, looseGoals, focusId, onFocus, onOpenGoal }: GalaxyProps) {
  const frozen = useRef(false);
  const areaObjects = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const ctx: Ctx = { frozen, areaObjects, hovered, setHovered, focusId, onFocus, enter: (id) => onOpenGoal(id) };
  useEffect(() => () => void (document.body.style.cursor = ""), []);
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 60, 90], fov: 45, near: 0.1, far: 3000 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => onFocus(null)}
      aria-label="Galaxy"
    >
      <color attach="background" args={["#020309"]} />
      {/* speed 0: drei's Stars pulse all together — with bloom the whole sky blinked */}
      <Stars radius={260} depth={140} count={6000} factor={5} saturation={0.25} fade speed={0} />
      <Scene areas={areas} looseGoals={looseGoals} ctx={ctx} />
      <CameraControls makeDefault minDistance={1} maxDistance={160} smoothTime={0.7} />
      <Effects />
    </Canvas>
  );
}

// Rendered once (see SolarSystem). The bloom starts above the brightest single disk points, so the slowly turning
// disk does not shimmer; only the dense core and the goal stars glow.
const Effects = memo(function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={1.2} luminanceThreshold={1.5} luminanceSmoothing={0.4} radius={0.8} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.72} />
    </EffectComposer>
  );
});
