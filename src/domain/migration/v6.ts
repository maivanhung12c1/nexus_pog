// V6 → V7 migration adapter (legacy migrateV6), unchanged. V6 axes: x = width, y = depth (0 = back), z = up;
// V7/8 axes: X = x, Z = y, Y = z (same origin) — a pure axis rename.
import { colorFor } from '../colors';
import { arrayCount, toWorld } from '../geometry';
import { L } from '../i18n';
import { newDesign } from '../design';
import { PALLET_PRESETS } from '../presets';
import type { ArrayObj, Design, Face } from '../types';
import { clamp, R2, uid } from '../util';
import { unitsFrom } from '../catalog/sku';

const V6_UNIT: Record<string, { w: number; d: number; h: number }> = { can320s: { w: 5.9, d: 5.9, h: 14.6 }, can330: { w: 6.6, d: 6.6, h: 12.2 }, pet390: { w: 6.5, d: 6.5, h: 22 }, pet15: { w: 9, d: 9, h: 31 } };
const V6_CLUSTERS: Record<string, { n: number; cols: number }> = { '1': { n: 1, cols: 1 }, '2': { n: 2, cols: 2 }, '3': { n: 3, cols: 3 }, line4: { n: 4, cols: 1 }, '4': { n: 4, cols: 2 }, '6': { n: 6, cols: 3 }, '8': { n: 8, cols: 4 }, '9': { n: 9, cols: 3 } };
const FACES: Face[] = ['front', 'back', 'left', 'right', 'top'];

export interface V6Report { notes: string[]; v6: { cartons: number; loose: number; props: number; boards: number; skirt: number; text: number } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** putAsset stores a data URL and returns its asset id. */
export async function migrateV6(P: Any, images: Record<string, Record<string, string>>, putAsset: (src: string) => Promise<string>): Promise<{ design: Design; rep: V6Report }> {
  const rep: V6Report = { notes: [], v6: { cartons: 0, loose: 0, props: 0, boards: 0, skirt: 0, text: 0 } };
  const d = newDesign('go');
  d.objects = [];
  d.meta.name = (P.meta && P.meta.name) || 'Display V6';
  d.settings = { kind: 'pallet', maxH: +P.pallet.maxH || 150, overhang: +(P.tol && P.tol.overhang) || 0, preset: PALLET_PRESETS[P.preset] ? P.preset : 'custom' };
  const map: Record<string, string> = {}, used = new Set<string>();
  for (const s of P.skus || []) {
    let id = s.code ? 'c:' + String(s.code).trim() : 'v6:' + s.id;
    while (used.has(id)) id += '~';
    used.add(id); map[s.id] = id;
    const faces: Partial<Record<Face, string>> = {};
    for (const [f, src] of Object.entries(images[s.id] || {})) if (src && FACES.includes(f as Face)) faces[f as Face] = await putAsset(src);
    d.skus[id] = { id, code: String(s.code || s.id), name: s.name || s.code || 'SKU', brand: '', maker: '', form: 'carton', w: +s.w, d: +s.d, h: +s.h, units: +s.units || 0, kg: +s.kg || 0, color: s.color || colorFor(s.name), family: s.code || s.name || '', faces, ml: '', pkg: '', cat: '', sub: '' };
  }
  const skuV6 = (id: string) => (P.skus || []).find((k: Any) => k.id === id);
  const C = V6_CLUSTERS[P.cluster] || V6_CLUSTERS['1'], pl = P.pallet, gap = P.combine && C.n > 1 ? 0 : Math.max(0, +pl.gap || 0), rows = Math.ceil(C.n / C.cols);
  const G = { w: C.cols * pl.w + (C.cols - 1) * gap, d: rows * pl.d + (rows - 1) * gap };
  const origin = (i: number) => ({ x: (i % C.cols) * (pl.w + gap), y: Math.floor(i / C.cols) * (pl.d + gap) });
  for (let i = 0; i < C.n; i++) { const O = origin(i); d.objects.push({ id: uid('p'), type: 'pallet', name: 'Pallet ' + (i + 1), size: { w: +pl.w, d: +pl.d, h: +pl.h }, pos: { x: R2(O.x + pl.w / 2), y: 0, z: R2(O.y + pl.d / 2) }, ry: 0, lock: true }); }
  if (C.n > 1) rep.notes.push(L(`Cụm ${C.n} pallet chuyển thành ${C.n} pallet riêng theo vị trí thực.`, `A ${C.n}-pallet cluster became ${C.n} separate pallets at their real positions.`));
  for (const st of P.stacks || []) {
    const r = st.pallets.length > 1 ? { x: 0, y: 0 } : origin(st.pallets[0]);
    let z = +pl.h;
    for (const l of st.layers || []) {
      let lh = 0;
      const ids = new Set<string>((l.boxes || []).map((b: Any) => b.sku || l.sku));
      if (!ids.size) ids.add(l.sku);
      for (const id of ids) lh = Math.max(lh, +(skuV6(id) || {}).h || 0);
      for (const b of l.boxes || []) { const sid = map[b.sku || l.sku]; if (!sid) continue; rep.v6.cartons++; d.objects.push({ id: uid(), type: 'sku', sku: sid, pos: { x: R2(r.x + b.x + b.w / 2), y: R2(z), z: R2(r.y + b.y + b.d / 2) }, ry: b.rot ? 270 : 0 }); }
      z += lh;
    }
  }
  const hid = P.hid || {}, unitSku: Record<string, string> = {};
  const looseSku = (e: Any) => {
    const baseId = map[e.sku];
    if (!baseId) return null;
    const u = V6_UNIT[e.preset] || { w: +e.uw || 6, d: +e.ud || 6, h: +e.uh || 12 }, key = baseId + '|' + u.w + 'x' + u.d + 'x' + u.h;
    if (unitSku[key]) return unitSku[key];
    const k0 = d.skus[baseId], isUnit = !!V6_UNIT[e.preset] || u.w * u.d < 60, id = 'l:' + key;
    d.skus[id] = { id, code: k0.code + (isUnit ? '-LE' : '-LOC'), name: (isUnit ? L('Lẻ – ', 'Single – ') : L('Lốc – ', 'Pack – ')) + k0.name, brand: '', maker: '', form: isUnit ? 'unit' : 'pack', w: u.w, d: u.d, h: u.h, units: isUnit ? 1 : unitsFrom('', k0.name) || 0, kg: 0, color: k0.color, family: isUnit ? k0.family : '', faces: {}, ml: '', pkg: '', cat: '', sub: '' };
    if (!isUnit) rep.notes.push(L(`"${k0.name}": khối lẻ có kích thước lốc → tạo SKU lốc riêng, không cộng dồn vào quy đổi thùng.`, `"${k0.name}": loose module uses pack size → separate pack SKU.`));
    return (unitSku[key] = id);
  };
  for (const e of hid.elements || []) {
    const rot = !!e.rot, ex = +e.x || 0, ey = +e.y || 0, ez = +e.z || 0;
    if (e.kind === 'block' || e.kind === 'steps' || e.kind === 'pyramid') {
      const sid = looseSku(e);
      if (!sid) { rep.notes.push('HID: ' + e.name + ' – SKU?'); continue; }
      const k = d.skus[sid];
      const a: ArrayObj = { id: uid(), type: 'array', name: e.name || '', sku: sid, n: { x: Math.max(1, e.nx | 0), y: Math.max(1, e.nz | 0), z: Math.max(1, e.ny | 0) }, gap: { x: 0, y: 0, z: 0 }, shape: e.kind === 'block' ? 'block' : e.kind, step: 1, cellRy: 0, ry: rot ? 90 : 0, anchor: { x: -1, z: -1 }, pos: { x: 0, y: R2(ez), z: 0 } };
      const S = { w: a.n.x * k.w, d: a.n.z * k.d }, X = rot ? S.d : S.w, Y = rot ? S.w : S.d;
      a.pos.x = R2(ex + X / 2); a.pos.z = R2(ey + Y / 2);
      d.objects.push(a);
      rep.v6.loose += arrayCount(a);
    } else if (e.kind === 'prop') {
      const w = +e.uw || 20, dd = +e.ud || 20, h = +e.uh || 25, nx = Math.max(1, e.nx | 0), ny = Math.max(1, e.ny | 0), nz = Math.max(1, e.nz | 0), X0 = nx * w, Y0 = ny * dd, X = rot ? Y0 : X0, Y = rot ? X0 : Y0;
      const asset = e.img ? await putAsset(e.img) : null, frame = { pos: { x: ex + X / 2, y: ez, z: ey + Y / 2 }, ry: rot ? 90 : 0 };
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = toWorld(frame, -X0 / 2 + i * w + w / 2, k * h, -Y0 / 2 + j * dd + dd / 2);
        d.objects.push({ id: uid(), type: 'prop', name: e.name || 'Prop', size: { w, d: dd, h }, asset, color: e.color || '#f4a3c0', pos: { x: R2(p.x), y: R2(p.y), z: R2(p.z) }, ry: frame.ry });
        rep.v6.props++;
      }
    } else if (e.kind === 'board') {
      const th = clamp(+e.th || 1.2, 0.5, 30), w = +e.uw || 80, h = +e.uh || 40, X = rot ? th : w, Y = rot ? w : th, asset = e.img ? await putAsset(e.img) : null;
      d.objects.push({ id: uid(), type: 'posm', name: e.name || 'Topboard', size: { w, d: th, h }, asset, cutout: !!(e.img && /^data:image\/png/.test(e.img)), color: e.color || '#ffffff', pos: { x: R2(ex + X / 2), y: R2(ez), z: R2(ey + Y / 2) }, ry: rot ? 90 : 0 });
      rep.v6.boards++;
    } else if (e.kind === 'text') rep.v6.text++;
  }
  if (rep.v6.text) rep.notes.push(L(`${rep.v6.text} module chữ bằng lon chưa chuyển.`, `${rep.v6.text} can-lettering modules were not converted.`));
  const sk = hid.skirt;
  if (sk && sk.on && +sk.h > 0) {
    const h = +sk.h, t0 = 0.8, f = sk.faces || {}, col = sk.color || '#f3f6f9', nm = L('Áo POSM quây chân', 'POSM skirt');
    const lab: Record<string, [string, string]> = { front: ['trước', 'front'], back: ['sau', 'back'], left: ['trái', 'left'], right: ['phải', 'right'] };
    const add = async (face: string, w: number, x: number, z: number, ry: number) => {
      d.objects.push({ id: uid(), type: 'posm', subtype: 'skirt', name: nm + ' – ' + L(lab[face][0], lab[face][1]), size: { w, d: t0, h }, asset: f[face] ? await putAsset(f[face]) : null, cutout: false, color: col, pos: { x: R2(x), y: 0, z: R2(z) }, ry });
      rep.v6.skirt++;
    };
    await add('front', G.w, G.w / 2, G.d + t0 / 2, 0); await add('back', G.w, G.w / 2, -t0 / 2, 180); await add('left', G.d, -t0 / 2, G.d / 2, 270); await add('right', G.d, G.w + t0 / 2, G.d / 2, 90);
  }
  return { design: d, rep };
}
