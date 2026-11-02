// Support and snapping (legacy supportUnder / snapBox), unchanged arithmetic.
import { ov1 } from './geometry';
import type { Solid } from './scene';
import type { Box } from './types';

/** Highest load-bearing top under a footprint. Only real contact counts: overlap > 0.5 cm on both axes. */
export function supportUnder(fp: Box, exclude: Set<string> | null, cands: Solid[], maxY = Infinity) {
  let top = 0, hit: string | null = null;
  for (const c of cands) {
    if (exclude && exclude.has(c.id)) continue;
    const s = c.box;
    if (s.y1 > maxY + 0.6) continue;
    if (ov1(fp.x0, fp.x1, s.x0, s.x1) > 0.5 && ov1(fp.z0, fp.z1, s.z0, s.z1) > 0.5 && s.y1 > top + 1e-6) { top = s.y1; hit = c.id; }
  }
  return { top, hit };
}

export interface Guide { axis: 'x' | 'z'; v: number; a0: number; a1: number; y: number }
export interface SnapOptions { snapOn: boolean; snapEdge: boolean }

/** Snap a moved selection box. thr = threshold in cm (depends on zoom). Edge↔edge and centre↔centre; grid otherwise. */
export function snapBox(b: Box, targets: Solid[], thr: number, gridStep: number, opt: SnapOptions) {
  const res: { dx: number; dz: number; guides: Guide[] } = { dx: 0, dz: 0, guides: [] };
  if (!opt.snapOn) return res;
  const best: { x: { d: number; v: number; q: Box } | null; z: { d: number; v: number; q: Box } | null } = { x: null, z: null };
  if (opt.snapEdge) {
    const sx = [b.x0, (b.x0 + b.x1) / 2, b.x1], sz = [b.z0, (b.z0 + b.z1) / 2, b.z1];
    for (const t of targets) {
      const q = t.box;
      const near = ov1(b.z0 - 60, b.z1 + 60, q.z0, q.z1) > 0 || ov1(b.x0 - 60, b.x1 + 60, q.x0, q.x1) > 0;
      if (!near) continue;
      const tx = [q.x0, (q.x0 + q.x1) / 2, q.x1], tz = [q.z0, (q.z0 + q.z1) / 2, q.z1];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if ((i === 1) !== (j === 1)) continue;
        const ddx = tx[j] - sx[i];
        if (Math.abs(ddx) < thr && (!best.x || Math.abs(ddx) < Math.abs(best.x.d) - 1e-9)) best.x = { d: ddx, v: tx[j], q };
        const ddz = tz[j] - sz[i];
        if (Math.abs(ddz) < thr && (!best.z || Math.abs(ddz) < Math.abs(best.z.d) - 1e-9)) best.z = { d: ddz, v: tz[j], q };
      }
    }
  }
  if (best.x) { res.dx = best.x.d; const q = best.x.q; res.guides.push({ axis: 'x', v: best.x.v, a0: Math.min(b.z0, q.z0), a1: Math.max(b.z1, q.z1), y: Math.max(b.y0, q.y1 > b.y0 ? b.y0 : q.y1) }); }
  else if (gridStep > 0) res.dx = Math.round(b.x0 / gridStep) * gridStep - b.x0;
  if (best.z) { res.dz = best.z.d; const q = best.z.q; res.guides.push({ axis: 'z', v: best.z.v, a0: Math.min(b.x0, q.x0), a1: Math.max(b.x1, q.x1), y: b.y0 }); }
  else if (gridStep > 0) res.dz = Math.round(b.z0 / gridStep) * gridStep - b.z0;
  return res;
}
