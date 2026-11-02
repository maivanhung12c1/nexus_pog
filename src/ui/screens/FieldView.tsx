// Field mode (phone-first, read-only): the front elevation, the picking list as a checklist, and the build sheet.
import { useEffect, useState } from 'react';
import { fmt, formLabel, L } from '../../domain/i18n';
import { sheetSummary } from '../../domain/operations/sheet';
import { session, useSession } from '../../app/session';
import { catalog } from '../../app/catalogStore';
import { usePrefs } from '../../app/prefs';
import { Button, Tabs } from '../ds';
import { BrandMark } from '../shell/AppFrame';
import { go } from '../router';
import { SheetDocument, useDesignSnapshot } from './BuildSheets';
import { ShareMap } from './SpaceShare';
import { groupColors, positions } from '../../domain/analysis/spaceShare';

export function FieldView({ id }: { id: string }) {
  const scene = useSession((s) => s.scene), sid = useSession((s) => s.id), version = useSession((s) => s.version);
  usePrefs((s) => s.lang);
  const [tab, setTab] = useState<'pick' | 'view' | 'sheet'>('pick'), [done, setDone] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('nexus:pick:' + id) || '[]')); } catch { return new Set(); } });
  useEffect(() => { const me = Symbol('field'); session.open(id, me).catch(() => {}); return () => session.close(me); }, [id]);
  const ready = scene && sid === id, snap = useDesignSnapshot(ready ? version : -1);
  useEffect(() => { try { localStorage.setItem('nexus:pick:' + id, JSON.stringify([...done])); } catch { /* */ } }, [done]);
  if (!ready) return <div className="page"><div className="loading-bar" /></div>;
  const d = session.d!, sum = sheetSummary(d, (id) => catalog.byId(id)), P = positions(d);
  const keys = [...new Set(P.pos.map((p) => String(p.k.maker || '').toUpperCase()))];
  return <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
    {snap.host}
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 12px', background: 'var(--ground)' }}>
      <Button variant="ghost" icon="back" aria-label={L('Về', 'Back')} onClick={() => go('/')} /><BrandMark /><b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.meta.name}</b>
    </header>
    <div style={{ padding: '12px 16px' }}>
      <Tabs value={tab} onChange={setTab} options={[['pick', L(`Lấy hàng ${done.size}/${sum.lines.length}`, `Picking ${done.size}/${sum.lines.length}`)], ['view', L('Sơ đồ', 'Layout')], ['sheet', L('Phiếu dựng', 'Build sheet')]]} />
      {tab === 'pick' && <div style={{ marginTop: 12 }}>
        <p className="muted small" style={{ marginBottom: 8 }}>{sum.totalFac} facing · {fmt(sum.totalLin)} cm · {L('đánh dấu khi đã lấy / đã dựng', 'tick when picked / installed')}</p>
        {sum.lines.map((l) => <label key={l.k.id} className="check" style={{ padding: '12px 4px', borderTop: '1px solid var(--rule)', minHeight: 48 }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={done.has(l.k.id)} onChange={(e) => { const n = new Set(done); if (e.target.checked) n.add(l.k.id); else n.delete(l.k.id); setDone(n); }} />
          <span style={{ flex: 1, textDecoration: done.has(l.k.id) ? 'line-through' : undefined, color: done.has(l.k.id) ? 'var(--muted)' : undefined }}>{l.k.name}<span className="sub mono" style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{l.k.code} · {formLabel(l.k.form)}</span></span>
          <span className="num" style={{ textAlign: 'right' }}><b style={{ fontWeight: 500 }}>{fmt(l.stk, 0)}</b><span className="sub" style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{l.fac} F</span></span></label>)}
      </div>}
      {tab === 'view' && <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>{snap.img ? <img src={snap.img} alt="" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} /> : <div className="loading-bar" style={{ height: 200 }} />}<ShareMap P={P} dim="maker" scope={null} colors={groupColors(keys, usePrefs.getState().ownMaker.toUpperCase(), usePrefs.getState().competitor.toUpperCase())} /></div>}
      {tab === 'sheet' && <div style={{ marginTop: 12 }}><SheetDocument preview={snap.img} /></div>}
    </div>
  </div>;
}
