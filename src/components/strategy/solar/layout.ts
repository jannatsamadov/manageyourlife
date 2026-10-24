// Where everything sits in a goal's system: orbit radii from body sizes, looks and speeds from the node id.
import * as THREE from "three";
import { seeded, type TreeNode } from "@/lib/strategy";

export const SUN_RADIUS = 1.5;

export type BodyLook = { type: number; colors: [THREE.Color, THREE.Color, THREE.Color]; seed: number; glow: THREE.Color };

export type MoonLayout = { tree: TreeNode | null; orbit: number; size: number; phase: number; speed: number; tilt: number; look: BodyLook };

export type PlanetLayout = {
  tree: TreeNode;
  size: number;
  orbit: number;
  phase: number;
  speed: number;
  incl: number;
  axial: number;
  ringed: boolean;
  look: BodyLook;
  moons: MoonLayout[];
  extent: number;
};

const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);

// Three shades around the node's colour; rocky, gas giant or ice.
export function lookFor(id: string, color: string, type: number): BodyLook {
  const rand = seeded(id);
  const base = { h: 0, s: 0, l: 0 };
  new THREE.Color(color || "#8899ff").getHSL(base);
  const h = base.h + (rand() - 0.5) * 0.22;
  const colors: [THREE.Color, THREE.Color, THREE.Color] =
    type === 1 ? [hsl(h, 0.5, 0.56), hsl(h + 0.05, 0.55, 0.32), hsl(h - 0.06, 0.4, 0.78)]
    : type === 2 ? [hsl(h, 0.35, 0.62), hsl(h + 0.04, 0.45, 0.82), hsl(h - 0.03, 0.55, 0.42)]
    : [hsl(h, 0.32, 0.28), hsl(h + 0.07, 0.42, 0.5), hsl(h - 0.1, 0.2, 0.72)];
  return { type, colors, seed: rand() * 10, glow: hsl(h, 0.75, 0.62) };
}

export function layoutSystem(goal: TreeNode) {
  let r = SUN_RADIUS + 2.6;
  const planets: PlanetLayout[] = goal.children.map((m) => {
    const rand = seeded(m.node.id);
    const w = Math.min(Number(m.node.weight), 9);
    const size = 0.34 + 0.26 * Math.sqrt(w);
    const ringed = (m.node.target_count ?? 0) > 0;
    const type = ringed || w >= 3 ? 1 : rand() < 0.35 ? 2 : 0;
    const look = lookFor(m.node.id, m.color, type);

    const firstMoon = size * (ringed ? 2.5 : 1.8);
    const bodies: (TreeNode | null)[] = [...m.children, ...Array<null>(m.slots).fill(null)];
    const moons: MoonLayout[] = bodies.map((c, j) => {
      const mr = seeded(`${m.node.id}:${j}`);
      const orbit = firstMoon + j * 0.38;
      const msize = c ? Math.min(0.12 + 0.07 * Math.sqrt(Number(c.node.weight)), 0.3) : 0.12;
      return {
        tree: c,
        orbit,
        size: msize,
        phase: mr() * Math.PI * 2,
        speed: (0.7 + mr() * 0.4) / Math.sqrt(orbit),
        tilt: (mr() - 0.5) * 0.9,
        look: lookFor(c?.node.id ?? `${m.node.id}:slot${j}`, m.color, mr() < 0.3 ? 2 : 0),
      };
    });
    const extent = (moons.length ? moons[moons.length - 1].orbit + 0.3 : size * 1.6) + 0.2;
    r += extent;
    const orbit = r;
    r += extent + 1.2;
    return {
      tree: m,
      size,
      orbit,
      phase: rand() * Math.PI * 2,
      speed: (0.28 + rand() * 0.08) / Math.sqrt(orbit),
      incl: (rand() - 0.5) * 0.12,
      axial: (rand() - 0.5) * 0.7,
      ringed,
      look,
      moons,
      extent,
    };
  });
  // Small tasks of the goal itself: dwarf planets in a belt outside the last orbit.
  const belt = r + 1.5;
  return { planets, belt, outer: belt + 2 };
}
