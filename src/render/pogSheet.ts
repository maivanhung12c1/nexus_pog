// POG sheet PNG (legacy exportPOGSheet): front render + shelf heights + bay widths + facing labels + brand and SKU tables.
import { fmt, formLabel, L } from '../domain/i18n';
import { isStock, type Scene } from '../domain/scene';
import { shelfDirect } from '../domain/shelf/gondola';
import { shelfMetrics } from '../domain/shelf/metrics';
import { clamp } from '../domain/util';
import type { Viewport } from './viewport';

const loadImg = (src: string) => new Promise<HTMLImageElement>((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(im); im.src = src; });

export async function pogSheetPNG(vp: Viewport, s: Scene): Promise<string | null> {
  const sb = s.sceneBox(true);
  if (!sb) return null;
  const W = 2200, H = Math.round(clamp((W * (sb.y1 - sb.y0 + 20)) / (sb.x1 - sb.x0 + 20), 700, 2600));
  const url = vp.snapshot('front', W, H), cam = vp.lastSnap!;
  const im = await loadImg(url);
  const M = (m: { x: number; y: number }) => ({ x: W / 2 + (m.x - cam.cx) / cam.s, y: H / 2 - (m.y - cam.cy) / cam.s });
  const met = shelfMetrics(s), padL = 150, padT = 90, tblH = 60 + 28 * Math.min(12, met.brands.length) + 28 * Math.min(30, met.rows.length) + 60;
  const c = document.createElement('canvas');
  c.width = W + padL + 40; c.height = H + padT + tblH;
  const g = c.getContext('2d')!;
  const F = (w: number, sz: number) => `${w} ${sz}px "IBM Plex Sans", Segoe UI, Arial`;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#131416'; g.font = F(600, 34); g.fillText(s.d.meta.name || 'Planogram', padL, 50);
  g.font = F(400, 18); g.fillStyle = '#5b6068';
  g.fillText(`${fmt(met.totalLinear)} cm ${L('kệ', 'shelf')} · ${L('đã dùng', 'used')} ${fmt(met.usedLinear)} cm (${fmt(met.totalLinear ? (met.usedLinear / met.totalLinear) * 100 : 0)}%) · ${new Date().toISOString().slice(0, 10)}`, padL, 78);
  g.drawImage(im, padL, padT);
  g.font = F(600, 17);
  for (const x of met.shelves) { const p = M({ x: s.aabb(x.o).x0, y: x.top }); g.fillStyle = '#131416'; g.textAlign = 'right'; g.fillText(fmt(x.top) + ' cm', padL + p.x - 8, padT + p.y + 6); g.textAlign = 'left'; }
  for (const f of s.d.objects.filter((o) => o.type === 'fixture')) {
    const b = s.aabb(f), a = M({ x: b.x0, y: 0 }), e = M({ x: b.x1, y: 0 });
    g.strokeStyle = '#5b6068'; g.beginPath(); g.moveTo(padL + a.x, padT + a.y + 14); g.lineTo(padL + e.x, padT + e.y + 14); g.stroke();
    g.fillStyle = '#131416'; g.textAlign = 'center'; g.fillText(fmt(b.x1 - b.x0) + ' cm', padL + (a.x + e.x) / 2, padT + a.y + 36); g.textAlign = 'left';
  }
  g.font = F(600, 15);
  for (const x of s.d.objects.filter((o) => o.type === 'shelf')) for (const o of shelfDirect(s, x)) {
    if (!isStock(o)) continue;
    const b = s.aabb(o), p = M({ x: (b.x0 + b.x1) / 2, y: s.aabb(x).y0 }), f = o.type === 'array' ? o.n.x : 1, lab = f + 'F' + (o.type === 'array' && o.n.y > 1 ? '×' + o.n.y : ''), tw = g.measureText(lab).width + 10;
    g.fillStyle = 'rgba(19,20,22,.86)'; g.fillRect(padL + p.x - tw / 2, padT + p.y - 2, tw, 20); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(lab, padL + p.x, padT + p.y + 13); g.textAlign = 'left';
  }
  let y = padT + H + 50;
  g.fillStyle = '#131416'; g.font = F(600, 20); g.fillText(L('Share theo brand (cm ngang)', 'Share by brand (linear cm)'), padL, y); y += 30; g.font = F(400, 17);
  for (const e of met.brands.slice(0, 12)) { g.fillStyle = '#131416'; g.fillText(`${e.key}: ${fmt(e.linear)} cm · ${fmt(e.share * 100)}% · ${e.facings} F`, padL, y); y += 28; }
  y += 12; g.font = F(600, 20); g.fillText(L('SKU · facing · cm · sức chứa', 'SKU · facings · cm · capacity'), padL, y); y += 30; g.font = F(400, 16);
  for (const r of met.rows.slice(0, 30)) { g.fillText(`${r.k.name} (${r.k.code}) · ${r.facings} F · ${fmt(r.linear)} cm · ${r.count} ${formLabel(r.k.form).toLowerCase()}${r.conv ? ' = ' + fmt(r.conv, 0) + ' ' + L('đv', 'units') : ''}${r.dos != null ? ' · ' + fmt(r.dos) + ' ' + L('ngày', 'days') : ''}`, padL, y); y += 28; }
  return c.toDataURL('image/png');
}
