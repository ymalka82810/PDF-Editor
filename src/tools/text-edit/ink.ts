/** צבע הטקסט וצבע הרקע של אזור בעמוד, לפי הפיקסלים של ה-canvas המצויר (מועבר מ-legacy/template-render.js) */

import type { Rect } from '../../core/types';

const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(list: number[][]) {
  return [0, 1, 2].map((i) => {
    const v = list.map((p) => p[i]).sort((a, b) => a - b);
    return v[v.length >> 1] ?? 255;
  });
}

/**
 * box בפיקסלים של ה-canvas. הרקע: החציון של הטבעת סביב האזור. הדיו: הממוצע של 8% הפיקסלים הרחוקים ביותר מהרקע.
 * בשולי האותיות יש החלקה (anti-aliasing), לכן דיו כהה מאוד מעוגל לשחור.
 */
export function analyzeInk(canvas: HTMLCanvasElement, box: Rect): { bg: string; fg: string } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x) - pad);
  const y0 = Math.max(0, Math.floor(box.y) - pad);
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w) + pad);
  const y1 = Math.min(canvas.height, Math.ceil(box.y + box.h) + pad);
  if (!ctx || x1 - x0 < 2 || y1 - y0 < 2) return { bg: '#ffffff', fg: '#000000' };
  const W = x1 - x0;
  const H = y1 - y0;
  const data = ctx.getImageData(x0, y0, W, H).data;
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const ring: number[][] = [];
  for (let x = 0; x < W; x++) ring.push(px(x, 0), px(x, H - 1));
  for (let y = 0; y < H; y++) ring.push(px(0, y), px(W - 1, y));
  const bg = median(ring);

  const inside: [number, number[]][] = [];
  for (let y = pad; y < H - pad; y++) for (let x = pad; x < W - pad; x++) inside.push([dist(px(x, y), bg), px(x, y)]);
  inside.sort((a, b) => b[0] - a[0]);
  const top = inside.slice(0, Math.max(1, Math.floor(inside.length * 0.08)));
  let fg =
    top[0] && top[0][0] > 40 ? [0, 1, 2].map((i) => top.reduce((s, x) => s + x[1][i], 0) / top.length) : [0, 0, 0];
  if (Math.max(...fg) < 80 && Math.max(...fg) - Math.min(...fg) < 24) fg = [0, 0, 0];
  return { bg: hex(bg), fg: hex(fg) };
}
