import { R2 } from '../util';
import type { Scene } from '../scene';
import type { SceneObject } from '../types';
import { toWorld } from '../geometry';

export function localCorner(s: Scene, o: SceneObject, ax: number, az: number) {
  const S = s.localSize(o);
  return toWorld(o, (ax * S.w) / 2, 0, (az * S.d) / 2);
}

/** Keep a local corner (ax, az ∈ {-1,0,1}) of an object fixed in the world while fn() changes its size. */
export function keepCorner(s: Scene, o: SceneObject, ax: number, az: number, fn: () => void) {
  const w0 = localCorner(s, o, ax, az);
  fn();
  const S = s.localSize(o), a = ((o.ry || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), lx = (ax * S.w) / 2, lz = (az * S.d) / 2;
  o.pos.x = R2(w0.x - (lx * c + lz * sn));
  o.pos.z = R2(w0.z - (-lx * sn + lz * c));
}
