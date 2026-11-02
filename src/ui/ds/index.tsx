// Design-system components (see docs/rebuild/DESIGN_SYSTEM.md).
import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';
import type { Sku } from '../../domain/types';
import { catalog } from '../../app/catalogStore';

export function Button({ variant, size, icon, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm'; icon?: IconName }) {
  const I = icon ? Icon[icon] : null;
  return <button type="button" className={['btn', variant, size, !children && icon ? 'icon' : '', className].filter(Boolean).join(' ')} {...p}>{I && <I />}{children}</button>;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={'field ' + (className || '')}><span>{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

/** Number input that commits on blur / Enter (avoids one undo step per keystroke). */
export function NumberInput({ value, onCommit, unit, step = 0.1, min, max, ...p }: { value: number | null | undefined; onCommit: (v: number) => void; unit?: string; step?: number; min?: number; max?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value == null ? '' : String(Math.round(+value * 100) / 100));
  useEffect(() => setV(value == null ? '' : String(Math.round(+value * 100) / 100)), [value]);
  const commit = () => { const n = parseFloat(v.replace(',', '.')); if (Number.isFinite(n) && n !== value) onCommit(min != null ? Math.max(min, max != null ? Math.min(max, n) : n) : n); else setV(value == null ? '' : String(Math.round(+value * 100) / 100)); };
  return <div className="input-wrap"><input className="input num" inputMode="decimal" type="text" value={v} step={step} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} {...p} />{unit && <span className="unit">{unit}</span>}</div>;
}

export function TextInput({ value, onCommit, ...p }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} {...p} />;
}

export function Select<T extends string>({ value, options, onChange, ...p }: { value: T; options: [T, string][]; onChange: (v: T) => void } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)} {...p}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  return <div className="seg" role="radiogroup" aria-label={label}>{options.map(([k, l]) => <button key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="tabs" role="tablist">{options.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function Pill({ tone, children }: { tone?: 'positive' | 'negative' | 'warning' | 'info'; children: ReactNode }) { return <span className={'pill ' + (tone || '')}>{children}</span>; }

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);
  return <div className="scrim" data-modal-open onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="dialog-head"><h2>{title}</h2><Button variant="ghost" icon="close" aria-label="Close" onClick={onClose} /></div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </div>
  </div>;
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <><div className="drawer-scrim" data-modal-open onPointerDown={onClose} /><aside className="drawer" role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
    <div className="dialog-head"><h2>{title}</h2><Button variant="ghost" icon="close" aria-label="Close" onClick={onClose} /></div>
    <div className="dialog-body">{children}</div>
    {footer && <div className="dialog-foot">{footer}</div>}
  </aside></>;
}

export function Menu({ label, icon, items, align = 'right', variant, size }: { label?: ReactNode; icon?: IconName; items: ({ label: ReactNode; icon?: IconName; onClick: () => void; disabled?: boolean } | 'sep' | { header: string })[]; align?: 'left' | 'right'; variant?: 'primary' | 'ghost'; size?: 'sm' }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  return <div className="menu" ref={ref}>
    <Button variant={variant} size={size} icon={icon} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label}{label != null && <Icon.chevron />}</Button>
    {open && <div className={'menu-pop ' + (align === 'left' ? 'left' : '')} role="menu">{items.map((it, i) => it === 'sep' ? <div key={i} className="sep" /> : 'header' in it ? <div key={i} className="label">{it.header}</div> : (() => { const I = it.icon ? Icon[it.icon] : null; return <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>{I && <I />}{it.label}</button>; })())}</div>}
  </div>;
}

export function FileButton({ accept, multiple, onFiles, children, variant, icon, size, directory }: { accept?: string; multiple?: boolean; onFiles: (f: File[]) => void; children?: ReactNode; variant?: 'primary' | 'ghost'; icon?: IconName; size?: 'sm'; directory?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const dirProps = directory ? ({ webkitdirectory: '' } as Record<string, string>) : {};
  return <><Button variant={variant} icon={icon} size={size} onClick={() => ref.current?.click()}>{children}</Button><input ref={ref} type="file" hidden accept={accept} multiple={multiple} {...dirProps} onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} /></>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) { return <div className="empty"><span>{children}</span>{action}</div>; }

export function SkuThumb({ k, size }: { k: Sku; size?: 'lg' }) {
  const src = catalog.asset(k.faces?.front);
  return <div className={'thumb ' + (size || '')}>{src ? <img src={src} alt="" loading="lazy" /> : <div className="chip" style={{ background: k.color }}>{String(k.brand || k.code).slice(0, 8)}</div>}</div>;
}

export function DropZone({ onFiles, accept, children }: { onFiles: (f: File[]) => void; accept?: RegExp; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return <div className={'dropzone' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...e.dataTransfer.files].filter((f) => !accept || accept.test(f.name)); if (fs.length) onFiles(fs); }}>{children}</div>;
}

export { Icon };
