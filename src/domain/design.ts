// Design factories (legacy newDesign / newShelfDesign).
import { L } from './i18n';
import { PALLET_PRESETS } from './presets';
import { SCHEMA, type Design } from './types';
import { uid } from './util';

export function newDesign(presetKey = 'go'): Design {
  const p = PALLET_PRESETS[presetKey] || PALLET_PRESETS.go;
  return {
    schema: SCHEMA,
    meta: { name: L('Display mới', 'New display'), by: '', created: Date.now(), updated: Date.now() },
    settings: { kind: 'pallet', maxH: p.maxH, overhang: 0, preset: presetKey },
    skus: {},
    objects: [{ id: uid('p'), type: 'pallet', name: 'Pallet ' + p.name, size: { w: p.w, d: p.d, h: p.h }, pos: { x: p.w / 2, y: 0, z: p.d / 2 }, ry: 0, lock: true }],
  };
}

export function emptyShelfDesign(name?: string): Design {
  const d = newDesign('go');
  d.objects = [];
  d.settings = { maxH: 200, overhang: 0, preset: 'custom', kind: 'shelf', sales: {} };
  d.meta.name = name || L('Planogram kệ mới', 'New planogram');
  return d;
}
