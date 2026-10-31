import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, ThreeEvent } from "@react-three/fiber";
import { Environment, Html, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import type { Task } from "@/context/AppContext";
import { activityYear, BOX_LENGTH, boxesAround, boxStart, boxEnd, isoDay, spanDays, STRIDE, taskSlice, TunnelSpan } from "@/lib/tunnel";
import { Button } from "@/components/ui/button";
import { Film, ImageOff } from "lucide-react";

export type TunnelMedia = { path: string; day: number; video: boolean };
type Palette = { background: string; floor: string; wall: string; grid: string; primary: string; text: string; muted: string; photo: string; info: string };
export function readPalette(root: HTMLElement): Palette {
  const css = getComputedStyle(root);
  const c = (key: string) => new THREE.Color(`hsl(${css.getPropertyValue(key).trim().split(/\s+/).join(", ")})`).getStyle();
  return { background: c("--tunnel-night"), floor: c("--tunnel-floor"), wall: c("--tunnel-wall"), grid: c("--tunnel-grid"),
    primary: c("--primary"), text: c("--foreground"), muted: c("--muted-foreground"), photo: c("--tunnel-photo"), info: c("--info") };
}
function useTexture(draw: (c: CanvasRenderingContext2D) => void, deps: unknown[], width = 512, height = 256) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (ctx) draw(ctx);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
    // The draw function deliberately follows the explicit dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
function Panel({ title, detail, color, palette, position, onClick }: { title: string; detail: string; color: string; palette: Palette; position: [number, number, number]; onClick: () => void }) {
  const texture = useTexture(c => {
    c.fillStyle = palette.floor; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = color; c.lineWidth = 3; c.strokeRect(2, 2, 508, 252);
    c.fillStyle = color; c.fillRect(0, 0, 7, 256);
    c.font = "18px monospace"; c.fillText(detail, 30, 48);
    c.fillStyle = palette.text; c.font = "bold 28px sans-serif";
    const words = title.split(/\s+/); let line = "", y = 105;
    for (const word of words) { const next = `${line} ${word}`.trim(); if (c.measureText(next).width > 445 && line) { c.fillText(line, 30, y); y += 38; line = word; if (y > 205) break; } else line = next; }
    c.fillText(line.slice(0, 36), 30, y);
  }, [title, detail, color, palette]);
  return <mesh position={position} rotation={[0, position[0] < 0 ? .36 : -.36, 0]} onClick={e => { e.stopPropagation(); onClick(); }}>
    <planeGeometry args={[3.45, 1.72]} /><meshBasicMaterial map={texture} side={THREE.DoubleSide} />
  </mesh>;
}
function Activity({ start, tasks, z, palette, onDay }: { start: number; tasks: Task[]; z: number; palette: Palette; onDay: (day: number) => void }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => activityYear(new Date(start * 86400000).getUTCFullYear(), tasks), [start, tasks]);
  useEffect(() => {
    const m = mesh.current; if (!m) return;
    const transform = new THREE.Object3D();
    cells.forEach((cell, i) => {
      transform.position.set((i % 7 - 3) * .76, -3.7, z - .7 - Math.floor(i / 7) * .43);
      transform.rotation.x = -Math.PI / 2; transform.updateMatrix(); m.setMatrixAt(i, transform.matrix);
      m.setColorAt(i, new THREE.Color(cell.complete ? palette.primary : cell.count ? palette.info : palette.grid));
    });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cells, z, palette]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, 365]} onClick={(e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation(); if (e.instanceId !== undefined) onDay(cells[e.instanceId].day);
  }}><planeGeometry args={[.65, .34]} /><meshBasicMaterial side={THREE.DoubleSide} /></instancedMesh>;
}
function Passage({ day, span, anchor, tasks, media, urls, mode, palette, onTask, onMedia, onDay, onReady }: {
  day: number; span: TunnelSpan; anchor: number; tasks: Task[]; media: TunnelMedia[]; urls: Record<string, string>; mode: string; palette: Palette;
  onTask: (task: Task) => void; onMedia: (media: TunnelMedia) => void; onDay: (day: number) => void; onReady: () => void;
}) {
  const ready = useRef(false);
  const boxes = useMemo(() => boxesAround(day, span, anchor), [day, span, anchor]);
  const indexOf = (d: number) => span === "year" ? new Date(d * 86400000).getUTCFullYear() - new Date(anchor * 86400000).getUTCFullYear()
    : Math.floor((d - (span === "day" ? anchor : boxStart(anchor, span, anchor))) / spanDays(span));
  const base = boxStart(day, span, anchor);
  const target = -indexOf(base) * STRIDE - (day - base) / (boxEnd(base, span) - base) * BOX_LENGTH + 2;
  const previousSpan = useRef(span);
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useFrame(({ camera }, dt) => {
    if (!ready.current || previousSpan.current !== span || reduced) camera.position.z = target;
    else camera.position.z = THREE.MathUtils.damp(camera.position.z, target, 8, Math.min(dt, .05));
    camera.position.y = .25; camera.lookAt(0, -.2, camera.position.z - 25);
    previousSpan.current = span;
    if (!ready.current) { ready.current = true; onReady(); }
  });
  const floorTexture = useTexture(c => {
    c.fillStyle = palette.floor; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = palette.grid; c.lineWidth = 1;
    for (let x = 0; x <= 512; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
    for (let y = 0; y <= 256; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  }, [palette]);
  return <>
    <color attach="background" args={[palette.background]} /><fog attach="fog" args={[palette.background, 22, 125]} />
    <ambientLight intensity={.9} /><directionalLight position={[0, 8, 4]} intensity={1.6} />
    <Environment resolution={64}><Lightformer intensity={1.5} position={[0, 5, -10]} scale={[12, 12, 1]} /><Lightformer intensity={1} color={palette.primary} position={[5, 0, -8]} rotation-y={-Math.PI / 2} scale={[16, 8, 1]} /></Environment>
    {boxes.map(box => {
      const z = -indexOf(box.start) * STRIDE;
      const slices = mode === "tasks" ? tasks.map(t => taskSlice(t, box.start, box.end)).filter((s): s is NonNullable<typeof s> => !!s).sort((a, b) => a.from - b.from) : [];
      const memories = media.filter(m => m.day >= box.start && m.day < box.end).slice(0, 12);
      return <group key={`${span}-${box.start}`}>
        <mesh position={[0, -3.8, z - 12]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 24]} /><meshStandardMaterial map={floorTexture} roughness={.85} side={THREE.DoubleSide} /></mesh>
        {[-6, 6].map(x => <mesh key={x} position={[x, 0, z - 12]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[24, 7.6]} /><meshStandardMaterial color={palette.wall} map={floorTexture} side={THREE.DoubleSide} /></mesh>)}
        <mesh position={[0, 3.8, z - 12]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[12, 24]} /><meshStandardMaterial map={floorTexture} side={THREE.DoubleSide} /></mesh>
        {[-6, 6].map(x => <mesh key={`edge${x}`} position={[x, 0, z]}><boxGeometry args={[.06, 7.6, .08]} /><meshBasicMaterial color={palette.primary} /></mesh>)}
        <mesh position={[0, 3.8, z]}><boxGeometry args={[12, .05, .08]} /><meshBasicMaterial color={palette.primary} /></mesh>
        <mesh position={[0, -3.78, z - 25]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12, 2]} /><meshBasicMaterial color={palette.background} /></mesh>
        <Html position={[0, 2.85, z - 2]} center distanceFactor={13}><div className="tunnel-caption">{span === "year" ? new Date(box.start * 86400000).getUTCFullYear() : isoDay(box.start)}{span !== "day" && span !== "year" ? ` — ${isoDay(box.end - 1)}` : ""}</div></Html>
        {span === "day" && [0, 6, 12, 18].map(hour => <Html key={hour} position={[0, -3.55, z - hour - .4]} rotation={[-Math.PI / 2, 0, 0]} transform distanceFactor={7}><div className="tunnel-caption">{`${String(hour).padStart(2, "0")}:00`}</div></Html>)}
        {span === "year" && <Activity start={box.start} tasks={mode === "tasks" ? tasks : []} z={z} palette={palette} onDay={onDay} />}
        {slices.slice(0, span === "year" ? 4 : 24).map((slice, i) => {
          const x = i % 2 ? 3.9 : -3.9;
          const color = slice.task.status === "complete" ? palette.primary : slice.task.isEvent ? palette.info : palette.text;
          const taskZ = z - slice.from * BOX_LENGTH - .7;
          return <group key={slice.task.id}>
            <Panel title={slice.task.title} detail={`${slice.continuation ? "CONTINUED · " : ""}${slice.timed ? slice.task.time : "UNTIMED"} · ${slice.task.estimatedTime ?? 30} min`} color={color} palette={palette} position={[x, (Math.floor(i / 2) % 2) * 1.8 - .7, taskZ]} onClick={() => onTask(slice.task)} />
            <mesh position={[x > 0 ? 5.65 : -5.65, -2.7, z - (slice.from + slice.to) / 2 * BOX_LENGTH]} onClick={e => { e.stopPropagation(); onTask(slice.task); }}><boxGeometry args={[.12, .2, Math.max(.2, (slice.to - slice.from) * BOX_LENGTH)]} /><meshBasicMaterial color={color} /></mesh>
          </group>;
        })}
        {memories.map((m, i) => <Suspense key={m.path} fallback={null}><Html transform position={[i % 2 ? 5.65 : -5.65, 1.45, z - (m.day - box.start + .5) / (box.end - box.start) * 22 - (i % 3) * .8]} rotation={[0, i % 2 ? -1.05 : 1.05, 0]} distanceFactor={5}>
          <div className="tunnel-wall-media"><Button variant="ghost" aria-label={`Open ${m.video ? "video" : "photo"} ${m.path}`} onClick={() => onMedia(m)}>
            {m.video ? <><Film />{m.path.split("/").pop()}</> : urls[m.path] ? <img src={urls[m.path]} alt={m.path.split("/").pop()} /> : <ImageOff />}
          </Button></div>
        </Html></Suspense>)}
      </group>;
    })}
  </>;
}
export default function TunnelScene(props: React.ComponentProps<typeof Passage>) {
  return <Canvas dpr={[1, 1.35]} camera={{ fov: 65, near: .1, far: 200, position: [0, .25, 2] }} gl={{ antialias: true, alpha: false }}><Passage {...props} /></Canvas>;
}