import { useEffect, useState } from 'react';

export function useRoute() {
  const [h, setH] = useState(() => location.hash.replace(/^#/, '') || '/');
  useEffect(() => { const f = () => setH(location.hash.replace(/^#/, '') || '/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const parts = h.split('?')[0].split('/').filter(Boolean);
  return { path: '/' + parts.join('/'), parts };
}
export const go = (path: string) => { location.hash = path; };
