// Phiếu Dựng as one PNG (1240 px wide) for Zalo / clipboard — the same content and order as the printable document.
import { formatVnd } from '../domain/catalog/pricing';
import { fmt, formLabel, L } from '../domain/i18n';
import type { SheetSummary } from '../domain/operations/sheet';
import { totLine } from '../domain/operations/sheet';
import type { Design, SheetData } from '../domain/types';

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

export async function sheetPNG(d: Design, sh: SheetData, sum: SheetSummary, preview: string): Promise<Blob> {
  const W = 1240, pad = 48, rowH = 34, F = (w: number, sz: number) => `${w} ${sz}px "IBM Plex Sans", system-ui, Arial`;
  const img = await loadImg(preview);
  const imgH = img ? Math.min(420, Math.round(((W - pad * 2) * img.height) / img.width)) : 0;
  const posm = sh.posm.filter((p) => p.type), tot = sum.tot;
  const blocks = [130, 96, imgH + 24, 50 + sum.lines.length * rowH, 50 + Math.max(1, posm.length) * rowH, 50 + Math.max(1, tot.length) * rowH, 50 + sum.lines.length * rowH, 150, 40];
  const H = blocks.reduce((a, b) => a + b, 0) + 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  let y = 0;
  // header
  g.fillStyle = '#131416'; g.font = F(500, 14); g.fillText(L('PHIẾU HƯỚNG DẪN DỰNG DISPLAY', 'DISPLAY BUILD SHEET'), pad, 46);
  g.font = F(600, 32); g.fillText(d.meta.name || 'Display', pad, 88);
  g.font = F(400, 15); g.fillStyle = '#5b6068'; g.fillText([sum.displayLabel, sum.preset, sh.store, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · '), pad, 114);
  g.fillStyle = '#131416'; g.fillRect(pad, 126, W - pad * 2, 2);
  y = 130;
  // KPIs
  const k = [[L('Tổng facing', 'Total facings'), String(sum.totalFac)], [L('Linear (cm)', 'Linear (cm)'), fmt(sum.totalLin)], [L('Số SKU', 'SKUs'), String(sum.skuCount)], [L('Kệ / pallet', 'Fixture'), sum.preset]];
  const kw = (W - pad * 2) / 4;
  k.forEach(([lab, val], i) => { const x = pad + i * kw; g.strokeStyle = '#d7dbe0'; g.strokeRect(x + 0.5, y + 16.5, kw - 1, 66); g.fillStyle = '#5b6068'; g.font = F(400, 13); g.fillText(lab, x + 14, y + 38); g.fillStyle = '#131416'; g.font = F(500, i === 3 ? 16 : 26); g.fillText(val.length > 26 ? val.slice(0, 25) + '…' : val, x + 14, y + 70); });
  y += 96;
  if (img) { const iw = ((W - pad * 2) * imgH) / Math.min(420, Math.round(((W - pad * 2) * img.height) / img.width)); g.drawImage(img, pad + (W - pad * 2 - Math.min(W - pad * 2, (img.width * imgH) / img.height)) / 2, y, Math.min(W - pad * 2, (img.width * imgH) / img.height), imgH); void iw; y += imgH + 24; }
  const table = (title: string, cols: { t: string; w: number; r?: boolean }[], rows: { cells: string[]; red?: number }[], empty: string) => {
    g.fillStyle = '#131416'; g.font = F(600, 18); g.fillText(title, pad, y + 26);
    y += 40;
    let x = pad;
    g.font = F(400, 12); g.fillStyle = '#5b6068';
    cols.forEach((col) => { g.textAlign = col.r ? 'right' : 'left'; g.fillText(col.t, col.r ? x + col.w - 6 : x + 6, y); x += col.w; });
    g.textAlign = 'left'; g.fillStyle = '#131416'; g.fillRect(pad, y + 6, W - pad * 2, 1);
    y += 10;
    if (!rows.length) { g.fillStyle = '#5b6068'; g.font = F(400, 14); g.fillText(empty, pad + 6, y + 22); y += rowH; }
    for (const r of rows) {
      x = pad; g.font = F(400, 14);
      r.cells.forEach((t, i) => { const col = cols[i]; g.fillStyle = r.red === i ? '#c4242a' : '#131416'; g.textAlign = col.r ? 'right' : 'left'; let s = t; while (g.measureText(s).width > col.w - 12 && s.length > 3) s = s.slice(0, -2); if (s !== t) s += '…'; g.fillText(s, col.r ? x + col.w - 6 : x + 6, y + 22); x += col.w; });
      g.textAlign = 'left'; g.fillStyle = '#e3e6ea'; g.fillRect(pad, y + rowH - 4, W - pad * 2, 1);
      y += rowH;
    }
  };
  const CW = W - pad * 2;
  table(L('Bảng giá', 'Price scorecard'), [{ t: L('Mã', 'Code'), w: 160 }, { t: L('Tên SKU', 'SKU'), w: CW - 160 - 120 - 170 - 170 }, { t: L('Quy cách', 'Pack'), w: 120 }, { t: L('Giá niêm yết', 'Normal'), w: 170, r: true }, { t: L('Giá KM', 'Promo'), w: 170, r: true }], sum.lines.map((l) => ({ cells: [l.k.code, l.k.name, formLabel(l.k.form), formatVnd(l.priceNormal), formatVnd(l.pricePromo)], red: l.pricePromo != null ? 4 : undefined })), '—');
  table(L('POSM triển khai', 'POSM to install'), [{ t: L('Loại POSM', 'POSM'), w: 260 }, { t: L('Vị trí gắn', 'Where'), w: CW - 260 - 90 }, { t: L('SL', 'Qty'), w: 90, r: true }], posm.map((p) => ({ cells: [p.type, p.loc, String(p.qty || 0)] })), L('Chưa có POSM', 'No POSM'));
  table(L('TOT – hàng tặng kèm', 'TOT – gift with purchase'), [{ t: 'Brand / SKU', w: 360 }, { t: L('Chương trình', 'Offer'), w: CW - 360 }], tot.map((t) => ({ cells: [`${t.k.brand} · ${t.k.code}`, totLine(t)], red: 1 })), L('Chưa có TOT', 'No TOT'));
  table(L('Danh sách hàng lấy', 'Picking list'), [{ t: L('Mã', 'Code'), w: 160 }, { t: L('Tên SKU', 'SKU'), w: CW - 160 - 120 - 100 - 120 - 120 }, { t: L('Quy cách', 'Pack'), w: 120 }, { t: 'Facing', w: 100, r: true }, { t: 'Linear cm', w: 120, r: true }, { t: L('Số lượng', 'Qty'), w: 120, r: true }], sum.lines.map((l) => ({ cells: [l.k.code, l.k.name, formLabel(l.k.form), String(l.fac), fmt(l.lin), fmt(l.stk, 0)] })), '—');
  // signatures
  y += 24;
  const sw = (CW - 32) / 3;
  [[L('Người lập', 'Prepared by'), sh.preparedBy], [L('Người dựng', 'Installer'), sh.installer || ''], [L('Kiểm tra / Account', 'Checker / Account'), sh.checker || '']].forEach(([lab, name], i) => { const x = pad + i * (sw + 16); g.strokeStyle = '#c9ced5'; g.strokeRect(x + 0.5, y + 0.5, sw, 110); g.fillStyle = '#5b6068'; g.font = F(400, 12); g.fillText(lab!, x + 10, y + 20); g.fillStyle = '#131416'; g.font = F(500, 15); g.fillText(name || '', x + 10, y + 98); });
  y += 130;
  g.fillStyle = '#5b6068'; g.font = F(400, 12);
  g.fillText(`Nexus POG by VBH · ${new Date().toISOString().slice(0, 10)} · ${L('Số liệu từ thiết kế; không thay thế kiểm tra an toàn tại chỗ.', 'Figures come from the design; on-site safety checks still apply.')}`, pad, y + 14);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
