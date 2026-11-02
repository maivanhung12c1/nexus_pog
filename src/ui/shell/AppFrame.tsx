// Tinted L-frame (sidebar + 48 px top bar on the ground, no rule between) with the page on a white sheet.
import { useState, type ReactNode } from 'react';
import { L } from '../../domain/i18n';
import { setPref, usePrefs } from '../../app/prefs';
import { useCatalog } from '../../app/catalogStore';
import { Button, Icon, Pill } from '../ds';
import type { IconName } from '../ds/icons';
import { go } from '../router';

interface NavItem { path: string; icon: IconName; label: () => string; planned?: boolean; match?: (p: string) => boolean }
const NAV: { group: () => string; items: NavItem[] }[] = [
  { group: () => L('Làm việc', 'Work'), items: [
    { path: '/', icon: 'planograms', label: () => 'Planograms', match: (p) => p === '/' || p.startsWith('/p/') },
    { path: '/share', icon: 'share', label: () => 'Space Share' },
    { path: '/sheets', icon: 'sheet', label: () => L('Phiếu dựng', 'Build sheets'), match: (p) => p.startsWith('/sheets') },
  ] },
  { group: () => L('Dữ liệu', 'Data'), items: [
    { path: '/catalog', icon: 'catalog', label: () => L('Danh mục SKU', 'SKU catalog') },
    { path: '/competitors', icon: 'competitor', label: () => L('Đối thủ', 'Competitors') },
    { path: '/presets', icon: 'presets', label: () => L('Mẫu kệ & display', 'Fixtures & displays') },
  ] },
  { group: () => L('Tự động hoá', 'Automation'), items: [
    { path: '/auto', icon: 'auto', label: () => 'Auto POG', match: (p) => p.startsWith('/auto') },
    { path: '/tet2027', icon: 'tet', label: () => 'Tết 2027', planned: true },
    { path: '/compliance', icon: 'compliance', label: () => L('Tuân thủ POG', 'Compliance') },
    { path: '/warehouse', icon: 'warehouse', label: () => L('Xếp kho', 'Warehouse stacking'), planned: true },
    { path: '/pricetags', icon: 'tag', label: () => L('Bảng giá', 'Price tags'), planned: true },
  ] },
];

export function BrandMark() {
  // monogram: a shelf with three facings — the product's object
  return <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="6" style={{ fill: 'var(--brand-bg)' }} /><rect x="5" y="16.5" width="16" height="1.6" fill="#fff" /><rect x="5" y="9" width="4.2" height="7.5" rx="0.8" fill="#4d8be0" /><rect x="10.1" y="11" width="4.2" height="5.5" rx="0.8" fill="#fff" /><rect x="15.2" y="10" width="4.2" height="6.5" rx="0.8" fill="#4d8be0" /></svg>;
}

export function AppFrame({ path, title, crumbs, children }: { path: string; title?: string; crumbs?: ReactNode; children: ReactNode }) {
  const theme = usePrefs((s) => s.theme), lang = usePrefs((s) => s.lang), own = usePrefs((s) => s.ownMaker), cat = useCatalog((s) => s.catalog.length);
  const [open, setOpen] = useState(false);
  return <div className="frame">
    <nav className={'sidebar' + (open ? ' open' : '')} aria-label={L('Điều hướng', 'Navigation')}>
      <div className="brand"><BrandMark /><div><div className="brand-name">Nexus POG</div><div className="brand-sub">by VBH · {own}</div></div>
        {open && <Button variant="ghost" icon="close" aria-label="Close menu" onClick={() => setOpen(false)} />}</div>
      {NAV.map((g) => <div className="nav-group" key={g.group()}><div className="nav-label">{g.group()}</div>
        {g.items.map((it) => { const I = Icon[it.icon], active = it.match ? it.match(path) : path === it.path || path.startsWith(it.path + '/'); return <button key={it.path} className={'nav-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined} onClick={() => { setOpen(false); go(it.path); }}><I />{it.label()}{it.planned && <Pill>{L('Kế hoạch', 'Planned')}</Pill>}</button>; })}
      </div>)}
      <div className="sidebar-foot">
        <div className="small muted" style={{ padding: '0 8px' }}>{cat.toLocaleString('vi-VN')} SKU · {L('chạy trên máy này', 'local-first')}</div>
        <div className="theme-switch" role="radiogroup" aria-label={L('Giao diện', 'Theme')}>{([['system', L('Hệ thống', 'System')], ['light', L('Sáng', 'Light')], ['dark', L('Tối', 'Dark')]] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={theme === k} className={theme === k ? 'on' : ''} onClick={() => setPref('theme', k)}>{l}</button>)}</div>
        <button className="nav-item" onClick={() => setPref('lang', lang === 'vi' ? 'en' : 'vi')}><Icon.settings />{lang === 'vi' ? 'English' : 'Tiếng Việt'}</button>
      </div>
    </nav>
    <header className="topbar">
      <Button className="mobile-bar" variant="ghost" icon="menu" aria-label="Menu" onClick={() => setOpen(true)} />
      <div className="crumbs">{crumbs || <span>{title}</span>}</div>
      <div className="spacer" />
    </header>
    <main className="sheet">{children}</main>
  </div>;
}
