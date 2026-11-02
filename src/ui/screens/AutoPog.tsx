// Auto POG proposal (existing engine, ported unchanged): CDT zones → vertical blocks → products; scenarios A/B/C.
import { useEffect, useMemo, useState } from 'react';
import { apBuild, apCurrent, apSales, apShares, AUTO_POG_DEFAULTS, SCENARIO_LABEL, type AutoPogConfig, type ScenarioMode, type ScenarioResult } from '../../domain/analysis/autoPog';
import { aggregate, DIMS, dimLabel, positions, rpNorm, share } from '../../domain/analysis/spaceShare';
import { fmt, L } from '../../domain/i18n';
import type { Design } from '../../domain/types';
import { norm, poolKey, toNum } from '../../domain/util';
import { download, readTable } from '../../app/io';
import { prefs, usePrefs } from '../../app/prefs';
import { toast, useWorkspace, workspace } from '../../app/workspace';
import { toCSV } from '../../infra/csv';
import { AppFrame } from '../shell/AppFrame';
import { Button, Empty, Field, FileButton, NumberInput, Pill, Select } from '../ds';
import { ShelfStrip } from '../widgets/ShelfStrip';
import { go } from '../router';
import { stripOf } from '../../app/workspace';

const KEY = 'nexus:autopog';
const loadCfg = (): AutoPogConfig => { try { return { ...AUTO_POG_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...AUTO_POG_DEFAULTS }; } };

export function AutoPog({ path, id }: { path: string; id?: string }) {
  const projects = useWorkspace((s) => s.projects).filter((p) => p.kind === 'shelf');
  usePrefs((s) => s.lang);
  const [d, setD] = useState<Design | null>(null);
  useEffect(() => { if (id) workspace.loadDesign(id).then(setD); else setD(null); }, [id]);
  return <AppFrame path={path} title="Auto POG">
    <div className="page">
      <div className="page-head"><div><h1>{L('POG đề xuất tự động', 'Automatic POG proposal')}</h1><p className="lead">{L('Xếp lại toàn bộ kệ theo cây quyết định (vùng → khối dọc → sản phẩm) và space share mục tiêu. Kết quả là dự án mới, không sửa bản gốc.', 'Re-lays the whole shelf from a decision tree (zone → vertical block → products) and target space shares. Results are new projects; the original is untouched.')}</p></div></div>
      <Field label={L('Planogram kệ nguồn', 'Source shelf planogram')}><Select value={id || ''} options={[['', L('— chọn —', '— choose —')], ...projects.map((p) => [p.id, p.name] as [string, string])]} onChange={(v) => go(v ? '/auto/' + v : '/auto')} /></Field>
      {!projects.length && <div style={{ marginTop: 16 }}><Empty>{L('Cần một planogram kệ có sản phẩm (tạo mới, hoặc nhập .plnx / PDF).', 'Needs a shelf planogram with products (create one, or import a .plnx / PDF).')}</Empty></div>}
      {d && id && <AutoPogForm d={d} sourceId={id} />}
    </div>
  </AppFrame>;
}

function AutoPogForm({ d, sourceId }: { d: Design; sourceId: string }) {
  const [cfg, setCfg] = useState<AutoPogConfig>(() => ({ ...loadCfg(), flow: d.settings.flow === 'rtl' || d.settings.flow === 'ltr' ? d.settings.flow : loadCfg().flow, focus: prefs().ownMaker }));
  const [res, setRes] = useState<(ScenarioResult & { pid?: string })[] | null>(null), [err, setErr] = useState('');
  const set = (p: Partial<AutoPogConfig>) => { const n = { ...cfg, ...p }; setCfg(n); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* */ } };
  const items = useMemo(() => apCurrent(d), [d]), hasSales = items.some((r) => apSales(d, r.k) > 0);
  const cur = useMemo(() => apShares(d, cfg, items, 'cur'), [d, cfg.block, items]), sal = useMemo(() => (hasSales ? apShares(d, cfg, items, 'sales') : {}), [d, cfg.block, items]);
  const keys = Object.keys(cur).sort((a, b) => cur[b] - cur[a]);
  const F: [string, string][] = [['none', L('(không chia)', '(none)')], ...DIMS.map(([k, f]) => [k, f()] as [string, string])];
  const tsum = Object.values(cfg.target).reduce((a, b) => a + b, 0);
  const run = async () => {
    setErr('');
    const sc: ScenarioMode[] = []; if (cfg.scen.cur) sc.push('cur'); if (cfg.scen.sales && hasSales) sc.push('sales'); if (cfg.scen.target) sc.push('target');
    if (!sc.length) { toast(L('Chọn ít nhất 1 phương án', 'Pick at least one scenario'), 'warn'); return; }
    try {
      const out: (ScenarioResult & { pid?: string })[] = sc.map((m) => apBuild(d, cfg, m, SCENARIO_LABEL[m]));
      const p = prefs();
      for (const r of out) r.pid = await workspace.createProject(r.design, p.ownMaker, p.competitor);
      // Space Share: current + proposals, current as the baseline
      const keep = useWorkspace.getState().pogSet.filter((x) => !/ĐỀ XUẤT [ABC]|– HIỆN TRẠNG/.test(x.name));
      const curEntry = { id: 'cur-' + sourceId, name: d.meta.name + ' – HIỆN TRẠNG', src: L('hiện trạng', 'current'), design: d, include: true };
      await workspace.setPogs([curEntry, ...out.map((r) => ({ id: 'ap-' + r.pid, name: r.design.meta.name, src: L('đề xuất tự động', 'auto proposal'), design: r.design, include: true })), ...keep.map((x) => ({ ...x, include: false }))]);
      setRes(out);
    } catch (e) { setErr((e as Error).message); }
  };
  const tpl = () => download('form_share_doanh_so.csv', toCSV([[L('Khối (theo cấp 2) hoặc Mã SKU', 'Block (level 2) or SKU code'), L('Share mục tiêu %', 'Target share %'), L('Doanh số (đv/tuần, nếu là mã SKU)', 'Sales (units/week, for SKU codes)')], ...keys.map((k) => [k, cfg.target[k] || '', '']), ...items.map((r) => [r.k.code, '', apSales(d, r.k) || ''])]), 'text/csv');
  const upload = async (f: File) => {
    try {
      const rs = await readTable(f); let nt = 0, ns = 0; const sales: Record<string, number> = {}, target = { ...cfg.target }, ks = new Set(keys);
      for (const r of rs) { const a = String(r[0] ?? '').trim(), b = toNum(r[1]), c = toNum(r[2]); if (!a) continue; const ku = rpNorm(a); if (ks.has(ku) && b > 0) { target[ku] = b; nt++; } else if (/^\d{6,14}$/.test(a.replace(/\s/g, ''))) { const v = c > 0 ? c : b > 0 && !(b <= 100 && String(r[1]).includes('%')) ? b : 0; if (v > 0) { sales[poolKey(a)] = v; ns++; } } }
      set({ target });
      if (ns) { d.settings.sales = { ...(d.settings.sales || {}), ...sales }; d.settings.salesSrc = f.name; const p = prefs(); await workspace.saveDesign(sourceId, d, p.ownMaker, p.competitor); }
      toast(L(`Đã nhận ${nt} mục tiêu khối · ${ns} doanh số SKU`, `${nt} block targets · ${ns} SKU sales`));
    } catch (e) { toast((e as Error).message, 'warn'); }
  };
  const focusShare = (x: Design) => share(aggregate(positions(x), 'maker', null), rpNorm(cfg.focus), 'lin');
  const s0 = focusShare(d);
  return <div style={{ marginTop: 24 }}>
    <div className="two-col">
      <section className="panel-section"><h2>{L('1 · Cây quyết định', '1 · Decision tree')}</h2>
        <div className="grid2"><Field label={L('Vùng (cấp 1)', 'Zone (level 1)')}><Select value={cfg.zone} options={F} onChange={(v) => set({ zone: v })} /></Field><Field label={L('Khối dọc (cấp 2)', 'Vertical block (level 2)')}><Select value={cfg.block} options={F.slice(1)} onChange={(v) => set({ block: v })} /></Field></div>
        <div className="grid2"><Field label={L('Thứ tự vùng/khối', 'Zone / block order')}><Select value={cfg.order} options={[['cdt', L('CDT: nhóm tập trung đầu, rồi theo share', 'CDT: focus first, then by share')], ['cur', L('Giữ thứ tự hiện tại', 'Keep the current order')]]} onChange={(v) => set({ order: v })} /></Field><Field label={L('Dòng chảy khách', 'Traffic flow')}><Select value={cfg.flow} options={[['ltr', L('Trái → phải', 'Left → right')], ['rtl', L('Phải → trái', 'Right → left')]]} onChange={(v) => set({ flow: v })} /></Field></div>
        <div className="grid2"><Field label={L('Nhóm tập trung', 'Focus group')}><input className="input" value={cfg.focus} onChange={(e) => set({ focus: e.target.value.trim() || 'SPVB' })} /></Field><Field label={L('Vị trí nhóm tập trung', 'Focus position')}><Select value={cfg.focusAt} options={[['first', L('Đầu dòng chảy', 'First in the flow')], ['share', L('Theo share', 'By share')]]} onChange={(v) => set({ focusAt: v })} /></Field></div>
        <label className="check"><input type="checkbox" checked={cfg.snap} onChange={(e) => set({ snap: e.target.checked })} />{L('Bám mép bay khi ranh giới khối gần mép (≤12 cm)', 'Snap block edges to bay edges (≤12 cm)')}</label>
      </section>
      <section className="panel-section"><h2>{L('2 · Luật trong khối', '2 · Rules inside a block')}</h2>
        <div className="grid3"><Field label={L('Golden zone từ', 'Golden zone from')}><NumberInput value={cfg.gz0} unit="cm" onCommit={(v) => set({ gz0: v })} /></Field><Field label={L('đến', 'to')}><NumberInput value={cfg.gz1} unit="cm" onCommit={(v) => set({ gz1: v })} /></Field><Field label={L('Hàng lớn xuống đáy khi cao ≥', 'Big packs to bottom if ≥')}><NumberInput value={cfg.big} unit="cm" onCommit={(v) => set({ big: v })} /></Field></div>
        <div className="grid3"><Field label={L('Chia facing theo', 'Facings by')}><Select value={cfg.weight} options={[['sales', L('Doanh số SKU', 'SKU sales') + (hasSales ? '' : L(' (chưa có → đều)', ' (none → equal)'))], ['cur', L('Facing hiện tại', 'Current facings')], ['eq', L('Chia đều', 'Equal')]]} onChange={(v) => set({ weight: v })} /></Field><Field label="Facing min"><NumberInput value={cfg.fmin} step={1} min={1} onCommit={(v) => set({ fmin: Math.max(1, Math.round(v)) })} /></Field><Field label="Facing max"><NumberInput value={cfg.fmax} step={1} min={1} onCommit={(v) => set({ fmax: Math.max(1, Math.round(v)) })} /></Field></div>
        <label className="check"><input type="checkbox" checked={cfg.stack} onChange={(e) => set({ stack: e.target.checked })} />{L('Chồng tầng nếu khoảng trống đủ cao', 'Stack units when the gap allows')}</label>
      </section>
    </div>
    <section className="section"><div className="section-head"><h2>{L('3 · Space share mục tiêu theo khối', '3 · Target space share by block')}</h2><span className="lead">{L('để trống = chia phần còn lại theo share hiện tại', 'blank = the rest is split by current share')}</span>
      <div className="actions"><FileButton accept=".csv,.xlsx,.txt" size="sm" icon="upload" onFiles={(f) => upload(f[0])}>{L('Tải form share/doanh số', 'Upload share / sales form')}</FileButton><Button size="sm" variant="ghost" onClick={tpl}>{L('Form mẫu', 'Template')}</Button><Button size="sm" variant="ghost" onClick={() => set({ target: {} })}>{L('Xoá mục tiêu', 'Clear targets')}</Button></div></div>
      <div className="table-wrap" style={{ maxWidth: 760, maxHeight: 320 }}><table className="t"><thead><tr><th>{dimLabel(cfg.block)}</th><th className="num">{L('Hiện tại', 'Current')}</th><th className="num">{L('Doanh số', 'Sales')}</th><th className="num">{L('Mục tiêu', 'Target')}</th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k} className={norm(k).includes(norm(cfg.focus)) ? 'selected' : ''}><td>{k}</td><td className="num">{fmt(cur[k] * 100, 1)}%</td><td className="num">{hasSales ? fmt((sal[k] || 0) * 100, 1) + '%' : <span className="dash">—</span>}</td><td className="num"><div style={{ width: 110, marginLeft: 'auto' }}><NumberInput value={cfg.target[k] || null} unit="%" onCommit={(v) => { const t = { ...cfg.target }; if (v > 0) t[k] = v; else delete t[k]; set({ target: t }); }} /></div></td></tr>)}</tbody></table></div>
      <p className="small muted" style={{ marginTop: 6 }}>{L(`Mục tiêu đã nhập: ${Object.keys(cfg.target).length} khối · tổng ${fmt(tsum, 1)}%`, `Targets: ${Object.keys(cfg.target).length} blocks · total ${fmt(tsum, 1)}%`)}{tsum > 100 ? L(' – vượt 100%, sẽ được chia lại tỉ lệ', ' – over 100%, will be rescaled') : ''}{!hasSales && ' · ' + L('Chưa có doanh số SKU – nhập trong planogram (Số bán) hoặc tải form', 'No SKU sales yet – import in the planogram or upload the form')}</p>
    </section>
    <section className="section"><div className="section-head"><h2>{L('4 · Phương án', '4 · Scenarios')}</h2></div>
      <label className="check"><input type="checkbox" checked={cfg.scen.cur} onChange={(e) => set({ scen: { ...cfg.scen, cur: e.target.checked } })} />A · {L('Giữ share hiện tại – chỉ xếp lại theo CDT, khối dọc, golden zone', 'Keep current share – re-lay by CDT, vertical blocks, golden zone')}</label>
      <label className="check"><input type="checkbox" disabled={!hasSales} checked={cfg.scen.sales && hasSales} onChange={(e) => set({ scen: { ...cfg.scen, sales: e.target.checked } })} />B · {L('Share theo doanh số (fair share)', 'Share = sales share (fair share)')} {!hasSales && <Pill>{L('cần doanh số', 'needs sales')}</Pill>}</label>
      <label className="check"><input type="checkbox" checked={cfg.scen.target} onChange={(e) => set({ scen: { ...cfg.scen, target: e.target.checked } })} />C · {L('Share mục tiêu (bảng trên)', 'Target share (table above)')}</label>
      <div style={{ marginTop: 12 }}><Button variant="primary" icon="auto" onClick={run}>{L('Tạo POG đề xuất', 'Build proposals')}</Button></div>
      {err && <div className="notice" role="alert" style={{ marginTop: 12 }}>{err}</div>}
    </section>
    {res && <section className="section"><div className="section-head"><h2>{L('Kết quả', 'Results')}</h2><span className="lead">{L('đã lưu thành dự án và đưa vào Space Share (hiện trạng làm mốc)', 'saved as projects and added to Space Share (current as baseline)')}</span><div className="actions"><Button icon="share" onClick={() => go('/share')}>{L('So sánh Space Share', 'Compare space share')}</Button></div></div>
      <div className="table-wrap"><table className="t"><thead><tr><th></th><th>{L('Phương án', 'Scenario')}</th><th className="num">{cfg.focus} share</th><th className="num">Δ</th><th className="num">SKU</th><th>{L('Lưu ý', 'Notes')}</th><th></th></tr></thead>
        <tbody><tr><td><ShelfStrip rects={stripOf(d, prefs().ownMaker, prefs().competitor).rects} width={120} height={36} /></td><td>{L('Hiện trạng', 'Current')}</td><td className="num">{fmt(s0 * 100, 1)}%</td><td></td><td className="num">{items.length}</td><td></td><td></td></tr>
          {res.map((r) => { const s1 = focusShare(r.design), dd = s1 - s0; return <tr key={r.mode}><td><ShelfStrip rects={stripOf(r.design, prefs().ownMaker, prefs().competitor).rects} width={120} height={36} /></td><td>{r.label}<span className="sub">{L('Khối', 'Blocks')}: {r.seq.slice(0, 6).map((b) => b.b).join(' · ')}{r.seq.length > 6 ? '…' : ''}</span></td><td className="num"><b style={{ fontWeight: 500 }}>{fmt(s1 * 100, 1)}%</b></td><td className="num"><span className={'delta ' + (Math.abs(dd) < 0.0005 ? 'zero' : dd > 0 ? 'up' : 'down')}>{(dd >= 0 ? '+' : '−') + fmt(Math.abs(dd) * 100, 1)} pp</span></td><td className="num">{new Set(r.design.objects.filter((o) => o.type === 'array').map((o) => (o as { sku: string }).sku)).size}</td>
            <td className="small">{r.dropped.length > 0 && <Pill tone="warning">{L(`${r.dropped.length} mã không còn chỗ`, `${r.dropped.length} SKUs dropped`)}</Pill>} {r.warn.length > 0 && <span className="muted">{r.warn.length} {L('cảnh báo', 'warnings')}</span>}{r.dropped.length > 0 && <span className="sub">{r.dropped.slice(0, 4).map((x) => x.k.name).join(', ')}{r.dropped.length > 4 ? '…' : ''}</span>}</td>
            <td className="num"><Button size="sm" onClick={() => go('/p/' + r.pid)}>{L('Mở', 'Open')}</Button></td></tr>; })}</tbody></table></div></section>}
  </div>;
}
