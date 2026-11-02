// Signature element: a miniature front elevation drawn from the real positions — focus maker in the data hue, the
// main competitor in red, the rest grey, structure (shelves / pallets) dark grey.
import type { StripRect } from '../../app/workspace';

const FILL: Record<StripRect['c'], string> = { f: 'var(--chart-1)', k: 'var(--chart-competitor)', o: 'var(--chart-muted)', s: 'var(--faint)' };

export function ShelfStrip({ rects, width = 120, height = 40, label }: { rects: StripRect[]; width?: number; height?: number; label?: string }) {
  return <svg className="strip" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label || 'Planogram front elevation'}>
    {rects.map((r, i) => <rect key={i} x={r.x * (width - 4) + 2} y={r.y * (height - 4) + 2} width={Math.max(0.6, r.w * (width - 4) - (r.c === 's' ? 0 : 0.4))} height={Math.max(r.c === 's' ? 1 : 0.6, r.h * (height - 4) - (r.c === 's' ? 0 : 0.4))} style={{ fill: FILL[r.c] }} />)}
  </svg>;
}
