// What a day went to (#196, owner 2026-11-21): the top level of the strategy tree (an area) gives the colour — only a
// few hues can be told apart at a glance across a year — and the level under it (a goal) a texture. Missions and
// steps take their goal's mark; tasks with no goal are grey. A day's tasks add up per mark: planned minutes and the
// minutes done (a task with no estimate counts as half an hour).
import type { TreeNode } from "@/lib/strategy";

export type TunnelMark = {
  id: string; // the area or goal it stands for
  color: string; // "#rrggbb"
  pattern: number; // 0 = plain (the area itself), 1…PATTERNS = a goal's texture
  label: string; // "Area · Goal"
  order: number; // a day's slices go in this order (areas, then their goals, as in the tree): the same order every day, not the same place
};
export type MixPart = { mark: TunnelMark | null; planned: number; done: number }; // minutes

export const PATTERNS = 6;
export const DEFAULT_MINUTES = 30;
export const NO_GOAL = "#8b93a1";

// Each strategy node → its mark (the goal's, or the area's for the area itself).
export function marksOf(byId: Map<string, TreeNode>) {
  const out = new Map<string, TunnelMark>();
  const down = (t: TreeNode, mark: TunnelMark) => {
    out.set(t.node.id, mark);
    t.children.forEach((c) => down(c, mark));
  };
  let a = 0;
  for (const area of byId.values()) {
    if (area.parent) continue;
    const order = a++ * 100;
    out.set(area.node.id, { id: area.node.id, color: area.color, pattern: 0, label: area.node.title, order });
    area.children.forEach((goal, g) =>
      down(goal, { id: goal.node.id, color: goal.color, pattern: 1 + (g % PATTERNS), label: `${area.node.title} · ${goal.node.title}`, order: order + 1 + g }),
    );
  }
  return out;
}

// A day's tasks per mark, in the tree's order (no goal last).
export function mixOf(tasks: { minutes: number | null; done: boolean; mark: TunnelMark | null }[]): MixPart[] {
  const parts = new Map<string, MixPart>();
  for (const t of tasks) {
    const key = t.mark?.id ?? "";
    let p = parts.get(key);
    if (!p) parts.set(key, (p = { mark: t.mark, planned: 0, done: 0 }));
    const m = t.minutes && t.minutes > 0 ? t.minutes : DEFAULT_MINUTES;
    p.planned += m;
    if (t.done) p.done += m;
  }
  return [...parts.values()].sort((a, b) => (a.mark?.order ?? Infinity) - (b.mark?.order ?? Infinity));
}

// How full a day was, GitHub-like 0–4: the hours done and half the hours still open.
export function levelOf(parts: MixPart[]) {
  const h = parts.reduce((s, p) => s + p.done + 0.5 * (p.planned - p.done), 0) / 60;
  return h <= 0 ? 0 : h < 1 ? 1 : h < 2.5 ? 2 : h < 4 ? 3 : 4;
}

// Lines or dots that read on a colour: dark on a light one, light on a dark one.
export function inkOn(hex: string, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const luma = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luma > 0.55 ? `rgba(0,0,0,${0.34 * alpha})` : `rgba(255,255,255,${0.42 * alpha})`;
}

// A goal's texture over a rectangle. The grid is the canvas's, so a texture runs on across the parts it is split into.
export function drawPattern(g: CanvasRenderingContext2D, kind: number, x: number, y: number, w: number, h: number, ink: string, step: number) {
  if (kind <= 0 || w <= 0 || h <= 0) return;
  const x1 = x + w, y1 = y + h;
  const from = (v: number, s: number) => Math.floor(v / s) * s;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = Math.max(1, step * 0.16);
  g.beginPath();
  let fill = false;
  switch (kind) {
    case 1: // stripes ⟋
      for (let k = from(x + y, step); k <= x1 + y1; k += step) { g.moveTo(k - y1, y1); g.lineTo(k - y, y); }
      break;
    case 2: { // dots, staggered
      const r = step * 0.17, dy = step * 0.866;
      for (let j = Math.floor(y / dy); j * dy <= y1 + r; j++) {
        for (let i = Math.floor(x / step) - 1; i * step <= x1 + step; i++) {
          const cx = i * step + (j % 2 ? step / 2 : 0), cy = j * dy;
          g.moveTo(cx + r, cy);
          g.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
      fill = true;
      break;
    }
    case 3: // rows
      for (let yy = from(y, step) + step / 2; yy <= y1; yy += step) { g.moveTo(x, yy); g.lineTo(x1, yy); }
      break;
    case 4: // cross-hatch
      for (let k = from(x + y, step); k <= x1 + y1; k += step) { g.moveTo(k - y1, y1); g.lineTo(k - y, y); }
      for (let k = from(x - y1, step); k <= x1 - y; k += step) { g.moveTo(k + y, y); g.lineTo(k + y1, y1); }
      break;
    case 5: // columns
      for (let xx = from(x, step) + step / 2; xx <= x1; xx += step) { g.moveTo(xx, y); g.lineTo(xx, y1); }
      break;
    default: { // checks
      const s = step / 2;
      for (let j = Math.floor(y / s); j * s < y1; j++) {
        for (let i = Math.floor(x / s); i * s < x1; i++) if ((i + j) % 2 === 0) g.rect(i * s, j * s, s, s);
      }
      fill = true;
    }
  }
  if (fill) g.fill();
  else g.stroke();
  g.restore();
}

// A small square of a mark for the page (the hover card), drawn once per colour and texture.
const swatches = new Map<string, string>();
export function swatchOf(mark: TunnelMark | null) {
  const color = mark?.color ?? NO_GOAL, pattern = mark?.pattern ?? 0;
  const key = `${color}|${pattern}`;
  let url = swatches.get(key);
  if (url === undefined) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    if (!g) return "";
    g.fillStyle = color;
    g.fillRect(0, 0, 32, 32);
    drawPattern(g, pattern, 0, 0, 32, 32, inkOn(color, 1.4), 9);
    url = c.toDataURL();
    swatches.set(key, url);
  }
  return url;
}
