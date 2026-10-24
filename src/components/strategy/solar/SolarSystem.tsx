// Solar-system theme (P-24): a goal is a star, its missions are planets, their steps are moons, small tasks of the
// goal are dwarf planets in a belt. Everything starts dim and lights up as it gets done; the star itself goes from
// a dull red protostar to a white-gold sun as the whole goal moves.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, CameraControls, Html, Line, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Task } from "@/context/AppContext";
import { daysLeft, percent, seeded, type TreeNode } from "@/lib/strategy";
import { SUN_RADIUS, layoutSystem, lookFor, type BodyLook, type MoonLayout, type PlanetLayout } from "./layout";
import { atmosphereMaterial, glowTexture, nebulaMaterial, planetMaterial, raysTexture, ringMaterial, sunMaterial } from "./shaders";

// What every theme gets (P-24: progress in → picture out).
export type ThemeProps = {
  goal: TreeNode;
  area: TreeNode | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTask: (taskId: string) => void;
};

type Scene = {
  time: MutableRefObject<number>;
  heat: MutableRefObject<number>;
  objects: Map<string, THREE.Object3D>;
  selectedId: string | null;
  hovered: string | null;
  setHovered: Dispatch<SetStateAction<string | null>>;
  onSelect: (id: string | null) => void;
  onTask: (taskId: string) => void;
};
const SceneContext = createContext<Scene | null>(null);
const useScene = () => useContext(SceneContext)!;

const noRaycast = () => null;
const ease = (current: number, target: number, dt: number, rate = 2.5) => current + (target - current) * Math.min(1, dt * rate);

function useHover(id: string, onClick: () => void) {
  const { setHovered } = useScene();
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(id);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHovered((h) => (h === id ? null : h));
      document.body.style.cursor = "";
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onClick();
    },
  };
}

// ── Labels: few words — the name, how far it is, the due day if close ──
function Label({ y, title, value, due, done, strong }: { y: number; title: string; value?: number; due?: string | null; done?: boolean; strong?: boolean }) {
  const days = done ? null : daysLeft(due ?? null);
  const dueText = due && days !== null && days <= 30 ? `${due.slice(8, 10)}.${due.slice(5, 7)}` : null;
  return (
    <Html position={[0, y, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className={`select-none whitespace-nowrap text-center [text-shadow:0_1px_4px_#000] ${strong ? "text-[13px] font-semibold text-white" : "text-[11px] font-medium text-white/80"}`}>
        {title.length > 28 ? `${title.slice(0, 27)}…` : title}
        {value !== undefined && <span className="ml-1.5 text-white/45">{percent(value)}</span>}
        {dueText && <span className={`ml-1.5 ${days! < 0 ? "text-red-400" : days! <= 7 ? "text-amber-300" : "text-white/45"}`}>{dueText}</span>}
      </div>
    </Html>
  );
}

function SelectMarker({ size }: { size: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.04;
    ref.current.scale.set(s, s, s);
  });
  return (
    <Billboard>
      <mesh ref={ref} raycast={noRaycast}>
        <ringGeometry args={[size * 1.55, size * 1.62, 72]} />
        <meshBasicMaterial color="#dfe8ff" transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

function Halo({ size, color, strength = 1 }: { size: number; color: THREE.Color; strength?: number }) {
  return (
    <sprite scale={[size * 5.5, size * 5.5, 1]} raycast={noRaycast}>
      <spriteMaterial map={glowTexture()} color={color} transparent opacity={0.55 * strength} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  );
}

// A sphere (or a rock) that lights up with its value; the change is animated so finishing something is visible.
function Body({ id, size, look, value, rock, interactive = true, onClick }: {
  id: string; size: number; look: BodyLook; value: number; rock?: boolean; interactive?: boolean; onClick: () => void;
}) {
  const { heat, hovered, selectedId } = useScene();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => planetMaterial(look), [id, look.type]);
  useEffect(() => () => material.dispose(), [material]);
  const geometry = useMemo(() => {
    if (!rock) return new THREE.SphereGeometry(size, 64, 48);
    // irregular dwarf planet / asteroid
    const g = new THREE.IcosahedronGeometry(size, 2);
    const rand = seeded(id);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = 0.82 + 0.3 * Math.abs(Math.sin(v.x * 7.1 + rand() * 0.2) * Math.cos(v.y * 5.3) + Math.sin(v.z * 6.7) * 0.5);
      pos.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k);
    }
    g.computeVertexNormals();
    return g;
  }, [id, size, rock]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const spin = useRef<THREE.Mesh>(null!);
  const hover = useHover(id, onClick);
  useFrame(({ clock }, dt) => {
    const u = material.uniforms;
    u.uLit.value = ease(u.uLit.value, value, dt, 1.6);
    u.uSun.value = heat.current;
    u.uTime.value = clock.elapsedTime;
    u.uHover.value = ease(u.uHover.value, hovered === id || selectedId === id ? 1 : 0, dt, 8);
    spin.current.rotation.y += dt * (rock ? 0.4 : 0.06);
  });
  return <mesh ref={spin} geometry={geometry} material={material} {...(interactive ? hover : {})} raycast={interactive ? undefined : noRaycast} />;
}

function Atmosphere({ size, color, value }: { size: number; color: THREE.Color; value: number }) {
  // keyed by the colour value: the layout makes new Color objects on every data change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => atmosphereMaterial(color.clone()), [color.getHex()]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    material.uniforms.uStrength.value = ease(material.uniforms.uStrength.value, 0.18 + 1.25 * value, dt, 1.6);
  });
  return (
    <mesh material={material} raycast={noRaycast}>
      <sphereGeometry args={[size * 1.1, 48, 32]} />
    </mesh>
  );
}

function Ring({ size, color, seed, value }: { size: number; color: THREE.Color; seed: number; value: number }) {
  const inner = size * 1.38;
  const outer = size * 2.15;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => ringMaterial(color.clone(), inner, outer, seed), [color.getHex(), inner, outer, seed]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    material.uniforms.uLit.value = ease(material.uniforms.uLit.value, value, dt, 1.6);
  });
  return (
    <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <ringGeometry args={[inner, outer, 128, 1]} />
    </mesh>
  );
}

const circle = (r: number, n = 160) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
});

function OrbitPath({ radius, opacity = 0.1 }: { radius: number; opacity?: number }) {
  const points = useMemo(() => circle(radius), [radius]);
  return <Line points={points} color="#ffffff" lineWidth={1} transparent opacity={opacity} depthWrite={false} raycast={noRaycast} />;
}

// The lit part of the orbit trails behind the planet: its length is how far the mission has come.
function Trail({ radius, value, color }: { radius: number; value: number; color: THREE.Color }) {
  const { points, colors } = useMemo(() => {
    const length = value * Math.PI * 2;
    const n = Math.max(2, Math.ceil(length * 30));
    const pts: THREE.Vector3[] = [];
    const cols: [number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = -length + (i / n) * length;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      const k = Math.pow(i / n, 1.6) * (0.55 + 0.45 * value);
      cols.push([color.r * k, color.g * k, color.b * k]);
    }
    return { points: pts, colors: cols };
  }, [radius, value, color]);
  if (value <= 0.001) return null;
  return <Line points={points} vertexColors={colors} lineWidth={2} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} raycast={noRaycast} />;
}

function Moon({ m, showOrbit }: { m: MoonLayout; showOrbit: boolean }) {
  const scene = useScene();
  const ref = useRef<THREE.Group>(null!);
  const tree = m.tree;
  const id = tree?.node.id;
  useEffect(() => {
    if (!id) return;
    ref.current.userData.size = m.size;
    scene.objects.set(id, ref.current);
    return () => void scene.objects.delete(id);
  }, [id, m.size, scene.objects]);
  useFrame(() => {
    const a = m.phase + m.speed * scene.time.current;
    ref.current.position.set(Math.cos(a) * m.orbit, 0, Math.sin(a) * m.orbit);
  });
  return (
    <group rotation={[m.tilt, 0, 0]}>
      {showOrbit && <OrbitPath radius={m.orbit} opacity={0.06} />}
      <group ref={ref}>
        {tree ? (
          <>
            <Body id={tree.node.id} size={m.size} look={m.look} value={tree.node.status === "dropped" ? 0 : tree.value} onClick={() => scene.onSelect(tree.node.id)} />
            {tree.done && <Halo size={m.size} color={m.look.glow} strength={0.8} />}
            {(scene.hovered === id || scene.selectedId === id) && (
              <Label y={-m.size - 0.28} title={tree.node.title} value={tree.value} due={tree.node.due_date} done={tree.done} />
            )}
            {scene.selectedId === id && <SelectMarker size={m.size} />}
          </>
        ) : (
          // not created yet: a place kept for "at least N"
          <mesh raycast={noRaycast}>
            <sphereGeometry args={[m.size, 16, 12]} />
            <meshBasicMaterial color="#9aa6c8" wireframe transparent opacity={0.13} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// Daily tasks linked to a mission: tiny moonlets close to the planet.
function Moonlets({ tasks, radius }: { tasks: Task[]; radius: number }) {
  const scene = useScene();
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => {
    ref.current.rotation.y = scene.time.current * 0.5;
  });
  return (
    <group ref={ref} rotation={[0.35, 0, 0]}>
      {tasks.map((t, i) => {
        const a = (i / tasks.length) * Math.PI * 2;
        const done = t.status === "complete";
        return (
          <mesh key={t.id} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]} raycast={noRaycast}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshBasicMaterial color={done ? "#ffe9a8" : "#4b5165"} toneMapped={!done} />
          </mesh>
        );
      })}
    </group>
  );
}

function Planet({ p }: { p: PlanetLayout }) {
  const scene = useScene();
  const carrier = useRef<THREE.Group>(null!);
  const trail = useRef<THREE.Group>(null!);
  const tree = p.tree;
  const id = tree.node.id;
  const dropped = tree.node.status === "dropped";
  const value = dropped ? 0 : tree.value;
  useEffect(() => {
    carrier.current.userData.size = p.size;
    scene.objects.set(id, carrier.current);
    return () => void scene.objects.delete(id);
  }, [id, p.size, scene.objects]);
  useFrame(() => {
    const a = p.phase + p.speed * scene.time.current;
    carrier.current.position.set(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit);
    trail.current.rotation.y = -a;
  });
  const near = scene.hovered === id || scene.selectedId === id || tree.children.some((c) => c.node.id === scene.selectedId);
  return (
    <group rotation={[p.incl, 0, 0]}>
      <OrbitPath radius={p.orbit} />
      <group ref={trail}>
        <Trail radius={p.orbit} value={value} color={p.look.glow} />
      </group>
      <group ref={carrier}>
        <group rotation={[0, 0, p.axial]}>
          <Body id={id} size={p.size} look={p.look} value={value} onClick={() => scene.onSelect(id)} />
          <Atmosphere size={p.size} color={p.look.glow} value={value} />
          {p.ringed && <Ring size={p.size} color={p.look.glow} seed={p.look.seed} value={value} />}
        </group>
        {tree.done && <Halo size={p.size} color={p.look.glow} />}
        {p.moons.map((m, j) => <Moon key={m.tree?.node.id ?? `slot-${j}`} m={m} showOrbit={near} />)}
        {tree.tasks.length > 0 && <Moonlets tasks={tree.tasks} radius={p.size * (p.ringed ? 1.25 : 1.4)} />}
        <Label y={-p.size - 0.5} title={tree.node.title} value={value} due={tree.node.due_date} done={tree.done} />
        {scene.selectedId === id && <SelectMarker size={p.size} />}
      </group>
    </group>
  );
}

function Sun({ goal }: { goal: TreeNode }) {
  const scene = useScene();
  const material = useMemo(sunMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const group = useRef<THREE.Group>(null!);
  const corona = useRef<THREE.SpriteMaterial>(null!);
  const outer = useRef<THREE.Sprite>(null!);
  const rays = useRef<THREE.Sprite>(null!);
  const rayMat = useRef<THREE.SpriteMaterial>(null!);
  const red = useMemo(() => new THREE.Color("#ff4a1c"), []);
  const white = useMemo(() => new THREE.Color("#fff1d0"), []);
  const id = goal.node.id;
  const hover = useHover(id, () => scene.onSelect(id));
  useEffect(() => {
    group.current.userData.size = SUN_RADIUS;
    scene.objects.set(id, group.current);
    return () => void scene.objects.delete(id);
  }, [id, scene.objects]);
  useFrame(({ clock }, dt) => {
    const h = (scene.heat.current = ease(scene.heat.current, goal.value, dt, 1.2));
    const t = clock.elapsedTime;
    material.uniforms.uTime.value = t;
    material.uniforms.uHeat.value = h;
    material.uniforms.uBright.value = 0.85 + 2.3 * h;
    group.current.scale.setScalar(0.9 + 0.2 * h);
    corona.current.color.lerpColors(red, white, h);
    corona.current.opacity = 0.45 + 0.4 * h;
    const pulse = 1 + Math.sin(t * 0.8) * 0.03;
    outer.current.scale.setScalar(SUN_RADIUS * (7 + 7 * h) * pulse);
    rays.current.material.rotation = t * 0.02;
    rays.current.scale.setScalar(SUN_RADIUS * (5 + 6 * h));
    rayMat.current.opacity = 0.08 + 0.5 * h * h;
    rayMat.current.color.lerpColors(red, white, h);
  });
  return (
    <group ref={group}>
      <mesh material={material} {...hover}>
        <sphereGeometry args={[SUN_RADIUS, 96, 64]} />
      </mesh>
      <sprite scale={[SUN_RADIUS * 4.2, SUN_RADIUS * 4.2, 1]} raycast={noRaycast}>
        <spriteMaterial ref={corona} map={glowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={outer} raycast={noRaycast}>
        <spriteMaterial map={glowTexture()} color="#ff9a5a" transparent opacity={0.12} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={rays} raycast={noRaycast}>
        <spriteMaterial ref={rayMat} map={raysTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <Label y={-SUN_RADIUS * 1.35 - 0.6} title={goal.node.title} value={goal.value} due={goal.node.due_date} done={goal.done} strong />
    </group>
  );
}

// Small tasks of the goal itself: dwarf planets in a belt, with dust.
function Belt({ tasks, radius, color, goalId }: { tasks: Task[]; radius: number; color: string; goalId: string }) {
  const scene = useScene();
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => {
    ref.current.rotation.y = scene.time.current * 0.012;
  });
  const dust = useMemo(() => {
    const rand = seeded(`${goalId}:dust`);
    const n = 1400;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = radius + (rand() - 0.5) * 2.4 * (0.4 + rand());
      arr.set([Math.cos(a) * r, (rand() - 0.5) * 0.5, Math.sin(a) * r], i * 3);
    }
    return arr;
  }, [radius, goalId]);
  const rocks = useMemo(() => tasks.map((t) => {
    const rand = seeded(t.id);
    const a = rand() * Math.PI * 2;
    const r = radius + (rand() - 0.5) * 1.6;
    return { task: t, pos: [Math.cos(a) * r, (rand() - 0.5) * 0.5, Math.sin(a) * r] as [number, number, number], size: 0.14 + rand() * 0.08 };
  }), [tasks, radius]);
  return (
    <group ref={ref}>
      <points raycast={noRaycast}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.05} color="#8c93ad" transparent opacity={0.45} depthWrite={false} sizeAttenuation />
      </points>
      {rocks.map(({ task, pos, size }) => {
        const value = task.status === "complete" ? 1 : task.status === "active" ? 0.4 : 0;
        return (
          <group key={task.id} position={pos}>
            <Body id={task.id} size={size} look={lookFor(task.id, color, 0)} value={value} rock onClick={() => scene.onTask(task.id)} />
            {value === 1 && <Halo size={size} color={new THREE.Color("#ffd98a")} strength={0.6} />}
            {scene.hovered === task.id && <Label y={-size - 0.25} title={task.title} />}
          </group>
        );
      })}
    </group>
  );
}

function Sky({ color, seed }: { color: string; seed: number }) {
  const material = useMemo(() => nebulaMaterial(new THREE.Color(color), seed), [color, seed]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={noRaycast}>
      <sphereGeometry args={[600, 48, 32]} />
    </mesh>
  );
}

// Time runs while nothing is selected; selecting freezes the system so the camera can rest on a body.
function Clock() {
  const { time, selectedId } = useScene();
  useFrame((_, dt) => {
    if (!selectedId) time.current += Math.min(dt, 0.1);
  });
  return null;
}

function CameraRig({ goalId, outer }: { goalId: string; outer: number }) {
  const scene = useScene();
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const outerRef = useRef(outer);
  outerRef.current = outer;
  const overview = (smooth: boolean) => {
    const r = outerRef.current;
    controls?.setLookAt(0, r * 0.48, r * 0.92, 0, 0, 0, smooth);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => overview(false), [controls, goalId]);
  useEffect(() => {
    if (!controls) return;
    const obj = scene.selectedId ? scene.objects.get(scene.selectedId) : undefined;
    if (!obj) {
      overview(true);
      return;
    }
    const pos = obj.getWorldPosition(new THREE.Vector3());
    const size = (obj.userData.size as number) ?? 1;
    if (pos.lengthSq() < 0.01) {
      controls.setLookAt(0, SUN_RADIUS * 3, SUN_RADIUS * 8, 0, 0, 0, true);
      return;
    }
    // From the star's side, so the lit face shows.
    const d = Math.max(size * 7, 2.4);
    const dir = pos.clone().normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const cam = pos.clone().addScaledVector(dir, -d * 0.55).addScaledVector(side, d * 0.8).add(new THREE.Vector3(0, d * 0.45, 0));
    controls.setLookAt(cam.x, cam.y, cam.z, pos.x, pos.y, pos.z, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.selectedId, controls]);
  return null;
}

export default function SolarSystem({ goal, area, selectedId, onSelect, onTask }: ThemeProps) {
  const time = useRef(0);
  const heat = useRef(goal.value);
  const objects = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutSystem(goal), [goal]);
  const skyColor = area?.color || goal.color || "#7c9cff";
  const scene: Scene = { time, heat, objects, selectedId, hovered, setHovered, onSelect, onTask };
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 30, 50], fov: 42, near: 0.1, far: 3000 }}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelect(null)}
      aria-label={goal.node.title}
    >
      <SceneContext.Provider value={scene}>
        <color attach="background" args={["#020309"]} />
        <Sky color={skyColor} seed={seeded(area?.node.id ?? goal.node.id)() * 10} />
        <Stars radius={220} depth={120} count={7000} factor={5} saturation={0.3} fade speed={0.5} />
        <Clock />
        <Sun goal={goal} />
        {layout.planets.map((p) => <Planet key={p.tree.node.id} p={p} />)}
        <Belt tasks={goal.tasks} radius={layout.belt} color={goal.color} goalId={goal.node.id} />
        <CameraControls makeDefault minDistance={1.2} maxDistance={layout.outer * 3} smoothTime={0.7} />
        <CameraRig goalId={goal.node.id} outer={layout.outer} />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.8} luminanceSmoothing={0.25} radius={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.28} darkness={0.72} />
        </EffectComposer>
      </SceneContext.Provider>
    </Canvas>
  );
}
