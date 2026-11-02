// Image pool helpers (legacy parseImageName / sniffMime / shrinkImage / pngHasAlpha / readAsDataURL).
// Spaceman names: CODE.1 front, .2 left, .3 top, .7 back, .8 right, .9 bottom; also CODE_1.jpg / CODE-1.png / CODE.jpg.
import type { Face } from '../domain/types';

export const SPACEMAN_FACE: Record<string, Face> = { '1': 'front', '2': 'left', '3': 'top', '7': 'back', '8': 'right', '9': 'bottom' };

export function parseImageName(name: string): { key: string; face: Face } | null {
  const base = String(name).split(/[\\/]/).pop()!;
  let m = base.match(/^(.+?)\.([123789])$/);
  if (m) return { key: m[1], face: SPACEMAN_FACE[m[2]] };
  m = base.match(/^(.+?)[._-]([123789])\.(?:jpe?g|png|gif|bmp|webp)$/i);
  if (m) return { key: m[1], face: SPACEMAN_FACE[m[2]] };
  m = base.match(/^(.+?)\.(?:jpe?g|png|gif|bmp|webp)$/i);
  if (m) return { key: m[1], face: 'front' };
  return null;
}

export function sniffMime(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  return null;
}
export function mimeName(b: Uint8Array | null) {
  if (!b || b.length < 4) return '?';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return 'TIFF';
  if (b[0] === 0x25 && b[1] === 0x50) return 'PDF';
  return 'unknown';
}

export const readAsDataURL = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });
export const loadImg = (src: string) => new Promise<HTMLImageElement>((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(im); im.src = src; });

export async function pngHasAlpha(src: string) {
  const im = await loadImg(src);
  const c = document.createElement('canvas'), s = Math.min(1, 200 / Math.max(1, im.naturalWidth, im.naturalHeight));
  c.width = Math.max(1, (im.naturalWidth * s) | 0); c.height = Math.max(1, (im.naturalHeight * s) | 0);
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) return true;
  return false;
}

export function shrinkImage(src: string, max = 640, keepAlpha = false) {
  return new Promise<string>((res) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      if (s === 1 && src.length < 500000) return res(src);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
      const g = c.getContext('2d')!;
      if (!keepAlpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(im, 0, 0, c.width, c.height);
      res(keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
    };
    im.onerror = () => res(src);
    im.src = src;
  });
}
