// Phiếu Dựng (build sheet): edit on the left, the document as it will print on the right. Prices default from master
// data; overrides, POSM, TOT and people are undoable project edits and autosave.
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatVnd, parsePrice } from '../../domain/catalog/pricing';
import { fmt, formLabel, L } from '../../domain/i18n';
import { DISPLAY_TYPES, displayType, TOT_ITEMS } from '../../domain/presets';
import { normaliseSheet, sheetSummary, totLine } from '../../domain/operations/sheet';
import type { SheetData } from '../../domain/types';
import { slug } from '../../domain/util';
import { catalog } from '../../app/catalogStore';
import { copyImageToClipboard, download } from '../../app/io';
import { setPref, usePrefs } from '../../app/prefs';
import { session, useSession } from '../../app/session';
import { toast, useWorkspace } from '../../app/workspace';
import { Viewport } from '../../render/viewport';
import { sheetPNG } from '../../render/sheetCanvas';
import { AppFrame } from '../shell/AppFrame';
import { BrandMark } from '../shell/AppFrame';
import { Button, Empty, Field, Pill, Select } from '../ds';
import { ShelfStrip } from '../widgets/ShelfStrip';
import { go } from '../router';

export function BuildSheets({ path, id }: { path: string; id?: string }) {
  const projects = useWorkspace((s) => s.projects);
  usePrefs((s) => s.lang);
  if (!id) return <AppFrame path={path} title={L('Phiếu dựng', 'Build sheets')}><div className="page">
    <div className="page-head"><div><h1>{L('Phiếu dựng', 'Build sheets')}</h1><p className="lead">{L('Hướng dẫn dựng cho đội lắp đặt: sơ đồ, giá, POSM, TOT, danh sách hàng lấy, chữ ký.', 'Instructions for installers: layout, prices, POSM, TOT, picking list, sign-off.')}</p></div></div>
    {!projects.length ? <Empty action={<Button onClick={() => go('/')}>{L('Tạo planogram', 'Create a planogram')}</Button>}>{L('Chưa có dự án nào để lập phiếu.', 'No project to build a sheet from yet.')}</Empty> :
      <div className="table-wrap"><table className="t responsive"><thead><tr><th style={{ width: 140 }}></th><th>{L('Dự án', 'Project')}</th><th className="num">SKU</th><th className="num">Facing</th><th></th></tr></thead>
        <tbody>{projects.map((p) => <tr key={p.id} className="clickable" onClick={() => go('/sheets/' + p.id)}><td><ShelfStrip rects={p.strip} width={128} height={40} /></td><td>{p.name}<span className="sub">{p.kind === 'shelf' ? L('Planogram kệ', 'Shelf planogram') : L('Display pallet', 'Pallet display')}</span></td><td className="num">{p.skus}</td><td className="num">{p.facings}</td><td className="num"><Button size="sm" onClick={(e) => { e.stopPropagation(); go('/field/' + p.id); }}>{L('Xem hiện trường', 'Field view')}</Button></td></tr>)}</tbody></table></div>}
  </div></AppFrame>;
  return <SheetEditor path={path} id={id} />;
}

/** Off-screen 3D render of the design for the sheet / field view. */
export function useDesignSnapshot(version: number) {
  const host = useRef<HTMLDivElement>(null), [img, setImg] = useState('');
  useEffect(() => {
    const s = session.scene;
    if (!s || !host.current) return;
    const gl = document.createElement('canvas'), ov = document.createElement('canvas');
    host.current.append(gl, ov);
    const vp = new Viewport(host.current, gl, ov, (a) => catalog.asset(a));
    vp.setMode('3d'); vp.rebuild(s, new Set());
    const t = setTimeout(() => { setImg(vp.snapshot('persp', 1400, 760, { keepAngle: true })); vp.dispose(); gl.remove(); ov.remove(); }, 250);
    return () => { clearTimeout(t); };
  }, [version]);
  return { host: <div ref={host} aria-hidden="true" style={{ position: 'fixed', left: -4000, top: 0, width: 700, height: 380 }} />, img };
}

function SheetEditor({ path, id }: { path: string; id: string }) {
  const [err, setErr] = useState(''), scene = useSession((s) => s.scene), sid = useSession((s) => s.id), version = useSession((s) => s.version);
  useEffect(() => { const me = Symbol('sheet'); session.open(id, me).catch((e) => setErr(e.message)); return () => session.close(me); }, [id]);
  const ready = scene && sid === id;
  const snap = useDesignSnapshot(ready ? Math.floor(version / 1) : -1);
  if (err) return <AppFrame path={path}><div className="page"><p>{err}</p></div></AppFrame>;
  if (!ready) return <AppFrame path={path}><div className="page"><div className="loading-bar" /></div></AppFrame>;
  return <AppFrame path={path} crumbs={<><a href="#/sheets">{L('Phiếu dựng', 'Build sheets')}</a><span>/</span><span style={{ color: 'var(--text)' }}>{session.d!.meta.name}</span></>}>
    {snap.host}
    <SheetBody preview={snap.img} />
  </AppFrame>;
}

function SheetBody({ preview }: { preview: string }) {
  useSession((s) => s.version);
  const d = session.d!, id = useSession((s) => s.id)!, sh = normaliseSheet(d.sheet, d), sum = useMemo(() => sheetSummary(d, (id) => catalog.byId(id)), [d, useSession.getState().version]);
  const by = usePrefs((s) => s.preparedBy);
  const edit = (label: string, fn: (s: SheetData) => void) => session.edit(label, (sc) => { const cur = normaliseSheet(sc.d.sheet, sc.d); fn(cur); sc.d.sheet = cur; });
  useEffect(() => { if (!d.sheet) edit(L('Tạo phiếu dựng', 'Create build sheet'), (s) => { s.preparedBy = s.preparedBy || by; }); }, []);
  const dt = displayType(sh.displayType);
  const png = async () => { const b = await sheetPNG(d, sh, sum, preview); download(`${slug(d.meta.name)}-phieu-dung.png`, b, 'image/png'); };
  const copy = async () => { try { await copyImageToClipboard(await sheetPNG(d, sh, sum, preview)); toast(L('Đã chép phiếu – dán (Ctrl+V) vào Zalo', 'Sheet copied – paste (Ctrl+V) into Zalo')); } catch (e) { toast((e as Error).message, 'warn'); } };
  return <div className="page" style={{ maxWidth: 1500 }}>
    <div className="page-head no-print">
      <div><h1>{L('Phiếu dựng', 'Build sheet')}</h1><p className="lead">{sum.skuCount} SKU · {sum.totalFac} facing · {fmt(sum.totalLin)} cm · {sum.lines.filter((l) => l.priceNormal == null).length ? L(`${sum.lines.filter((l) => l.priceNormal == null).length} SKU chưa có giá`, `${sum.lines.filter((l) => l.priceNormal == null).length} SKUs without a price`) : L('đủ giá', 'all priced')}</p></div>
      <div className="actions"><Button onClick={() => go('/p/' + id)}>{L('Mở planogram', 'Open planogram')}</Button><Button icon="clipboard" onClick={copy}>{L('Chép ảnh (Zalo)', 'Copy image (Zalo)')}</Button><Button icon="image" onClick={png}>PNG</Button><Button variant="primary" icon="print" onClick={() => window.print()}>{L('In / PDF A4', 'Print / PDF A4')}</Button></div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 520px) minmax(0, 1fr)', gap: 24, alignItems: 'start' }} className="sheet-grid">
      <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section className="panel-section"><h2>{L('Thông tin chung', 'General')}</h2>
          <div className="grid2"><Field label={L('Loại trưng bày', 'Display type')}><Select value={dt.id} options={DISPLAY_TYPES.map((t) => [t.id, L(t.label, t.en)] as [string, string])} onChange={(v) => edit(L('Loại trưng bày', 'Display type'), (s) => { s.displayType = v; if (!s.posm.length || confirm(L('Đặt lại danh sách POSM theo loại trưng bày này?', 'Reset the POSM list to this display type?'))) s.posm = displayType(v).posm.map((p) => ({ ...p })); })} /></Field>
            <Field label={L('Cửa hàng', 'Store')}><input className="input" defaultValue={sh.store || ''} onBlur={(e) => e.target.value !== (sh.store || '') && edit(L('Cửa hàng', 'Store'), (s) => { s.store = e.target.value; })} /></Field></div>
          {!dt.templateConfirmed && <p className="small muted">{L('Loại này chưa có mẫu POSM được xác nhận – nhập POSM thủ công.', 'No confirmed POSM template for this type yet – enter POSM manually.')}</p>}
          <div className="grid3">{([['preparedBy', L('Người lập', 'Prepared by')], ['installer', L('Người dựng', 'Installer')], ['checker', L('Kiểm tra / Account', 'Checker / Account')]] as const).map(([f, lab]) => <Field key={f} label={lab}><input className="input" defaultValue={sh[f] || ''} onBlur={(e) => { if (e.target.value !== (sh[f] || '')) { edit(lab, (s) => { s[f] = e.target.value; }); if (f === 'preparedBy') setPref('preparedBy', e.target.value); } }} /></Field>)}</div>
        </section>
        <section className="panel-section"><h2>{L('Bảng giá', 'Price scorecard')}</h2><p className="small muted">{L('Mặc định lấy từ danh mục SKU. Nhập để ghi đè riêng phiếu này; xoá trống để quay về giá danh mục.', 'Defaults come from the SKU catalog. Type to override for this sheet; clear to fall back to the catalog price.')}</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>SKU</th><th className="num">{L('Niêm yết', 'Normal')}</th><th className="num">{L('Khuyến mãi', 'Promo')}</th></tr></thead><tbody>{sum.lines.map((l) => { const o = sh.prices[l.k.id] || {}; const cell = (f: 'normal' | 'promo') => <input className="input num" style={{ width: 110, height: 28 }} placeholder={formatVnd(f === 'normal' ? catalog.byId(l.k.id)?.priceNormal ?? l.k.priceNormal : catalog.byId(l.k.id)?.pricePromo ?? l.k.pricePromo)} defaultValue={o[f] || ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (o[f] || '')) edit(L('Giá', 'Price'), (s) => { s.prices[l.k.id] = { ...(s.prices[l.k.id] || {}), [f]: v && parsePrice(v) != null ? String(parsePrice(v)) : '' }; }); }} />;
            return <tr key={l.k.id}><td>{l.k.name}<span className="sub mono">{l.k.code}</span></td><td className="num">{cell('normal')}</td><td className="num">{cell('promo')}</td></tr>; })}</tbody></table></div></section>
        <section className="panel-section"><h2>POSM</h2>
          {sh.posm.map((p, i) => <div key={i} className="grid3" style={{ gridTemplateColumns: '1fr 1.4fr 70px 32px' }}>
            <input className="input" aria-label={L('Loại POSM', 'POSM type')} defaultValue={p.type} onBlur={(e) => e.target.value !== p.type && edit('POSM', (s) => { s.posm[i].type = e.target.value; })} />
            <input className="input" aria-label={L('Vị trí gắn', 'Location')} defaultValue={p.loc} onBlur={(e) => e.target.value !== p.loc && edit('POSM', (s) => { s.posm[i].loc = e.target.value; })} />
            <input className="input num" aria-label={L('Số lượng', 'Qty')} defaultValue={p.qty} onBlur={(e) => +e.target.value !== p.qty && edit('POSM', (s) => { s.posm[i].qty = Math.max(0, parseInt(e.target.value) || 0); })} />
            <Button variant="ghost" icon="trash" aria-label={L('Xoá', 'Remove')} onClick={() => edit('POSM', (s) => { s.posm.splice(i, 1); })} /></div>)}
          <div className="btn-row"><Button size="sm" icon="plus" onClick={() => edit('POSM', (s) => { s.posm.push({ type: '', qty: 1, loc: '' }); })}>{L('Thêm POSM', 'Add POSM')}</Button><Button size="sm" variant="ghost" onClick={() => edit('POSM', (s) => { s.posm = displayType(s.displayType).posm.map((p) => ({ ...p })); })}>{L('Đặt lại theo loại trưng bày', 'Reset to display type')}</Button></div></section>
        <section className="panel-section"><h2>TOT</h2><p className="small muted">Mua X thùng [Brand] tặng Y [quà]</p>
          <div className="table-wrap"><table className="t"><thead><tr><th>SKU</th><th className="num">{L('Mua', 'Buy')}</th><th>{L('Quà', 'Gift')}</th><th className="num">{L('SL quà', 'Gifts')}</th></tr></thead><tbody>{sum.lines.map((l) => { const t = sh.tot[l.k.id] || {}; return <tr key={l.k.id}><td>{l.k.brand}<span className="sub mono">{l.k.code}</span></td>
            <td className="num"><input className="input num" style={{ width: 64, height: 28 }} defaultValue={t.buyQty || ''} onBlur={(e) => edit('TOT', (s) => { s.tot[l.k.id] = { ...(s.tot[l.k.id] || {}), buyQty: parseInt(e.target.value) || 0 }; })} /></td>
            <td><select className="select" style={{ height: 28 }} value={t.item || ''} onChange={(e) => edit('TOT', (s) => { s.tot[l.k.id] = { ...(s.tot[l.k.id] || {}), item: e.target.value }; })}><option value="">— {L('không', 'none')} —</option>{TOT_ITEMS.map((x) => <option key={x}>{x}</option>)}</select></td>
            <td className="num"><input className="input num" style={{ width: 64, height: 28 }} defaultValue={t.giftQty || ''} onBlur={(e) => edit('TOT', (s) => { s.tot[l.k.id] = { ...(s.tot[l.k.id] || {}), giftQty: parseInt(e.target.value) || 0 }; })} /></td></tr>; })}</tbody></table></div></section>
      </div>
      <SheetDocument preview={preview} />
    </div>
  </div>;
}

export function SheetDocument({ preview }: { preview: string }) {
  const d = session.d!, sh = normaliseSheet(d.sheet, d), sum = sheetSummary(d, (id) => catalog.byId(id)), today = new Date().toISOString().slice(0, 10);
  return <article className="doc" aria-label={L('Phiếu dựng (bản in)', 'Build sheet (print)')}>
    <div className="doc-head"><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><BrandMark /><div><div className="small" style={{ color: '#5b6068' }}>{L('Phiếu hướng dẫn dựng display', 'Display build sheet')}</div><h1>{d.meta.name}</h1></div></div>
      <div className="meta">{sum.displayLabel}{sh.store ? <><br />{sh.store}</> : null}<br />{today}</div></div>
    <div className="doc-kpis"><div><span>{L('Tổng facing', 'Total facings')}</span><b>{sum.totalFac}</b></div><div><span>Linear (cm)</span><b>{fmt(sum.totalLin)}</b></div><div><span>{L('Số SKU', 'SKUs')}</span><b>{sum.skuCount}</b></div><div><span>{L('Kệ / pallet', 'Fixture')}</span><b style={{ fontSize: 13 }}>{sum.preset}</b></div></div>
    {preview ? <img className="preview" src={preview} alt={L('Sơ đồ 3D', '3D layout')} /> : <div className="loading-bar" style={{ height: 180 }} />}
    <h2>{L('Bảng giá', 'Price scorecard')}</h2>
    <table><thead><tr><th>{L('Mã', 'Code')}</th><th>{L('Tên SKU', 'SKU')}</th><th>{L('Quy cách', 'Pack')}</th><th className="num">{L('Giá niêm yết', 'Normal')}</th><th className="num">{L('Giá KM', 'Promo')}</th></tr></thead>
      <tbody>{sum.lines.map((l) => <tr key={l.k.id}><td className="mono" style={{ fontSize: 11 }}>{l.k.code}</td><td>{l.k.name}</td><td>{formLabel(l.k.form)}</td><td className="num">{formatVnd(l.priceNormal)}</td><td className={'num' + (l.pricePromo != null ? ' promo' : '')}>{formatVnd(l.pricePromo)}</td></tr>)}</tbody></table>
    <h2>{L('POSM triển khai', 'POSM to install')}</h2>
    {sh.posm.filter((p) => p.type).length ? <table><thead><tr><th>{L('Loại POSM', 'POSM')}</th><th>{L('Vị trí gắn', 'Where')}</th><th className="num">{L('SL', 'Qty')}</th></tr></thead><tbody>{sh.posm.filter((p) => p.type).map((p, i) => <tr key={i}><td>{p.type}</td><td>{p.loc}</td><td className="num">{p.qty || 0}</td></tr>)}</tbody></table> : <p style={{ color: '#5b6068' }}>{L('Chưa có POSM.', 'No POSM.')}</p>}
    <h2>{L('TOT – hàng tặng kèm', 'TOT – gift with purchase')}</h2>
    {sum.tot.length ? <table><tbody>{sum.tot.map((t) => <tr key={t.k.id}><td style={{ width: '35%' }}>{t.k.brand} <span className="mono" style={{ fontSize: 11, color: '#5b6068' }}>{t.k.code}</span></td><td className="promo">{totLine(t)}</td></tr>)}</tbody></table> : <p style={{ color: '#5b6068' }}>{L('Chưa có TOT.', 'No TOT.')}</p>}
    <h2>{L('Danh sách hàng lấy', 'Picking list')}</h2>
    <table><thead><tr><th>{L('Mã', 'Code')}</th><th>{L('Tên SKU', 'SKU')}</th><th>{L('Quy cách', 'Pack')}</th><th className="num">Facing</th><th className="num">Linear cm</th><th className="num">{L('Số lượng', 'Qty')}</th><th className="num">{L('Quy đổi', 'Units')}</th></tr></thead>
      <tbody>{sum.lines.map((l) => <tr key={l.k.id}><td className="mono" style={{ fontSize: 11 }}>{l.k.code}</td><td>{l.k.name}</td><td>{formLabel(l.k.form)}</td><td className="num">{l.fac}</td><td className="num">{fmt(l.lin)}</td><td className="num">{fmt(l.stk, 0)}</td><td className="num">{l.units != null ? fmt(l.units, 0) : '—'}</td></tr>)}</tbody></table>
    <h2>{L('Xác nhận', 'Sign-off')}</h2>
    <div className="sig"><div><span>{L('Người lập', 'Prepared by')}</span><b>{sh.preparedBy}</b></div><div><span>{L('Người dựng', 'Installer')}</span><b>{sh.installer}</b></div><div><span>{L('Kiểm tra / Account', 'Checker / Account')}</span><b>{sh.checker}</b></div></div>
    <div className="foot"><span>Nexus POG by VBH · {today}</span><span>{L('Số liệu từ thiết kế; không thay thế kiểm tra an toàn tại chỗ.', 'Figures come from the design; on-site safety checks still apply.')}</span></div>
  </article>;
}

export const _pill = Pill;
