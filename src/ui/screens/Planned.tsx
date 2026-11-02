// Future modules shown honestly: what exists, what inputs they will take, which business decisions are still open.
// Compliance has a working part (proposed vs actual design comparison); the others compute nothing yet.
import { useState } from 'react';
import { compareDesigns } from '../../domain/analysis/compare';
import { aggregate, positions, share } from '../../domain/analysis/spaceShare';
import { COMPLIANCE_STATUS, PRICE_TAG_STATUS, TET2027_STATUS, TET2027_STEPS, WAREHOUSE_STATUS } from '../../domain/future';
import { formatVnd } from '../../domain/catalog/pricing';
import { fmt, L } from '../../domain/i18n';
import type { Design } from '../../domain/types';
import { useCatalog } from '../../app/catalogStore';
import { usePrefs } from '../../app/prefs';
import { useWorkspace, workspace } from '../../app/workspace';
import { readProjectFile } from '../../app/io';
import { AppFrame } from '../shell/AppFrame';
import { Empty, Field, FileButton, Pill, Select } from '../ds';

function Status({ s }: { s: { implemented: boolean | string; reason: string } }) {
  return <div className="notice" style={{ marginBottom: 20, maxWidth: 900 }}><b>{s.implemented === 'partial' ? L('Có một phần', 'Partly available') : L('Kế hoạch – chưa chạy', 'Planned – not running yet')}.</b> {s.reason}</div>;
}

export function Tet2027({ path }: { path: string }) {
  usePrefs((s) => s.lang);
  return <AppFrame path={path} title="Tết 2027">
    <div className="page">
      <div className="page-head"><div><h1>Tết 2027 Auto Build POG</h1><p className="lead">{L('Trình hướng dẫn 7 bước tạo POG Tết. Module đã có ranh giới dữ liệu; luật nghiệp vụ chờ VBH xác nhận.', 'A 7-step wizard to build Tết POGs. The module boundary exists; business rules await VBH confirmation.')}</p></div></div>
      <Status s={TET2027_STATUS} />
      <div className="steps">{TET2027_STEPS.map((s, i) => <div className="step" key={s.id}><span className="n">{L('Bước', 'Step')} {i + 1}</span><b style={{ fontWeight: 500 }}>{L(s.vi, s.en)}</b><Pill tone="warning">{L('luật chưa xác nhận', 'rule not confirmed')}</Pill></div>)}</div>
      <section className="section"><div className="section-head"><h2>{L('Cần VBH trả lời trước khi xây', 'Needed from VBH before building')}</h2></div>
        <ol style={{ margin: 0, paddingLeft: 20, maxWidth: 820, lineHeight: '24px' }}>
          <li>{L('Bản kế hoạch Tết 2027 và 4 câu hỏi làm rõ còn mở – không có trong kho mã nguồn.', 'The Tết 2027 plan and its four open clarification questions – not in the repository.')}</li>
          <li>{L('Quy tắc khối thương hiệu (thứ tự, share tối thiểu) cho mùa Tết.', 'Brand-block rules (order, minimum share) for the Tết season.')}</li>
          <li>{L('Giới hạn golden zone và phân khúc áp dụng cho Tết (có khác Auto POG hiện tại?).', 'Golden-zone limits and segmentation for Tết (different from the current Auto POG?).')}</li>
          <li>{L('Ràng buộc bắt buộc theo chuỗi / theo store.', 'Mandatory constraints per retailer / store.')}</li>
        </ol>
        <p className="muted" style={{ marginTop: 12, maxWidth: 820 }}>{L('Trong lúc chờ: dùng Auto POG (đã chạy) với vùng/khối/golden zone/space share mục tiêu – đây là động cơ mà wizard Tết sẽ dùng lại.', 'Meanwhile: use Auto POG (working) with zones, blocks, golden zone and target shares – the engine the Tết wizard will reuse.')} <a href="#/auto">Auto POG →</a></p>
      </section>
    </div>
  </AppFrame>;
}

export function Warehouse({ path }: { path: string }) {
  usePrefs((s) => s.lang);
  return <AppFrame path={path} title={L('Xếp kho', 'Warehouse stacking')}>
    <div className="page"><div className="page-head"><div><h1>{L('Xếp hàng kho tự động (Mode A)', 'Warehouse auto stacking (Mode A)')}</h1><p className="lead">{L('Mẫu xếp SPVB PF-1 / PF-4, xếp pallet, đặt thùng, kiểm tra ràng buộc.', 'SPVB stacking patterns PF-1 / PF-4, pallet stacking, carton placement, constraint checks.')}</p></div></div>
      <Status s={WAREHOUSE_STATUS} />
      <p className="muted" style={{ maxWidth: 820 }}>{L('Đã có: mô hình pallet + thùng, khối lặp (block/steps/pyramid), kiểm tra va chạm, chiều cao tối đa, mặt đỡ – dùng được trong trình chỉnh display pallet. Chưa có: định nghĩa mẫu PF-1/PF-4, tải trọng tối đa, quy tắc xoay thùng xen kẽ. Không tạo luật giả.', 'Available now: pallet + carton model, repeat blocks (block/steps/pyramid), collision, max height and support checks – usable in the pallet display editor. Missing: PF-1/PF-4 definitions, maximum load, interlocking rules. No rules are invented.')}</p>
    </div></AppFrame>;
}

export function PriceTags({ path }: { path: string }) {
  const cat = useCatalog((s) => s.catalog);
  usePrefs((s) => s.lang);
  const priced = cat.filter((k) => k.priceNormal != null).slice(0, 6);
  return <AppFrame path={path} title={L('Bảng giá', 'Price tags')}>
    <div className="page"><div className="page-head"><div><h1>{L('In bảng giá', 'Price tag generator')}</h1><p className="lead">{L('Master data → bảng giá in được (giá niêm yết, giá KM, mã, quy cách).', 'Master data → printable tags (normal price, promo price, code, pack).')}</p></div></div>
      <Status s={PRICE_TAG_STATUS} />
      <p className="muted" style={{ maxWidth: 820, marginBottom: 16 }}>{L(`Dữ liệu giá đã sẵn trong danh mục: ${cat.filter((k) => k.priceNormal != null).length} SKU có giá niêm yết. Còn thiếu: mẫu thiết kế bảng giá và khổ in.`, `Price data is ready in the catalog: ${cat.filter((k) => k.priceNormal != null).length} SKUs have a normal price. Missing: the tag design and print size.`)}</p>
      {priced.length ? <div className="table-wrap" style={{ maxWidth: 760 }}><table className="t"><thead><tr><th>SKU</th><th className="num">{L('Niêm yết', 'Normal')}</th><th className="num">{L('KM', 'Promo')}</th></tr></thead><tbody>{priced.map((k) => <tr key={k.id}><td>{k.name}<span className="sub mono">{k.code}</span></td><td className="num">{formatVnd(k.priceNormal)}</td><td className="num">{formatVnd(k.pricePromo)}</td></tr>)}</tbody></table></div> : <Empty>{L('Chưa có SKU nào có giá – nhập giá trong Danh mục SKU.', 'No SKU has a price yet – add prices in the SKU catalog.')}</Empty>}
    </div></AppFrame>;
}

export function Compliance({ path }: { path: string }) {
  const projects = useWorkspace((s) => s.projects), own = usePrefs((s) => s.ownMaker), comp = usePrefs((s) => s.competitor);
  usePrefs((s) => s.lang);
  const [a, setA] = useState<{ d: Design; n: string } | null>(null), [b, setB] = useState<{ d: Design; n: string } | null>(null);
  const pickProject = async (id: string, set: (x: { d: Design; n: string } | null) => void) => { const d = id ? await workspace.loadDesign(id) : null; set(d ? { d, n: projects.find((p) => p.id === id)!.name } : null); };
  const pickFile = async (f: File, set: (x: { d: Design; n: string } | null) => void) => { const r = await readProjectFile(f); if (r.kind !== 'v6library') set({ d: r.design, n: f.name }); };
  const res = a && b ? compareDesigns(a.d, b.d, own) : null;
  const sA = a ? share(aggregate(positions(a.d), 'maker', null), own.toUpperCase(), 'lin') : 0, sB = b ? share(aggregate(positions(b.d), 'maker', null), own.toUpperCase(), 'lin') : 0;
  const compA = b ? share(aggregate(positions(b.d), 'maker', null), comp.toUpperCase(), 'lin') - (a ? share(aggregate(positions(a.d), 'maker', null), comp.toUpperCase(), 'lin') : 0) : 0;
  const pick = (label: string, v: { n: string } | null, set: (x: { d: Design; n: string } | null) => void) => <Field label={label}><div style={{ display: 'flex', gap: 6 }}><Select value="" options={[['', v ? v.n : L('— chọn dự án —', '— choose a project —')], ...projects.map((p) => [p.id, p.name] as [string, string])]} onChange={(id) => pickProject(id, set)} /><FileButton accept=".json" onFiles={(f) => pickFile(f[0], set)}>.json</FileButton></div></Field>;
  return <AppFrame path={path} title={L('Tuân thủ POG', 'Compliance')}>
    <div className="page"><div className="page-head"><div><h1>{L('Tuân thủ POG: đề xuất ↔ thực tế', 'POG compliance: proposed ↔ actual')}</h1><p className="lead">{L('So POG đề xuất với kệ thực tế (dựng tay hoặc nhập POG thực tế): thiếu SKU, thừa SKU, sai facing, lệch share.', 'Compare the proposed POG with the actual shelf (built by hand or imported): missing, extra, wrong facings, share deviation.')}</p></div></div>
      <Status s={COMPLIANCE_STATUS} />
      <div className="grid2" style={{ maxWidth: 900 }}>{pick(L('POG đề xuất', 'Proposed POG'), a, setA)}{pick(L('Kệ thực tế', 'Actual shelf'), b, setB)}</div>
      {res && <section className="section">
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi lead"><div className="label">{own} share {L('thực tế', 'actual')}</div><div className="value">{fmt(sB * 100, 1)}<span className="unit">%</span></div><div className="sub">{L('đề xuất', 'proposed')} {fmt(sA * 100, 1)}% · {(sB - sA >= 0 ? '+' : '−') + fmt(Math.abs(sB - sA) * 100, 1)} pp</div></div>
          <div className="kpi"><div className="label">{L('SKU thiếu', 'Missing SKUs')}</div><div className="value">{res.rows.filter((r) => r.st === 'del').length}</div></div>
          <div className="kpi"><div className="label">{L('SKU thừa', 'Extra SKUs')}</div><div className="value">{res.rows.filter((r) => r.st === 'add').length}</div></div>
          <div className="kpi"><div className="label">{L('Sai facing', 'Wrong facings')}</div><div className="value">{res.rows.filter((r) => r.st === 'up' || r.st === 'down').length}</div></div>
          <div className="kpi"><div className="label">{comp} {L('lấn', 'intrusion')}</div><div className="value">{(compA >= 0 ? '+' : '−') + fmt(Math.abs(compA) * 100, 1)}<span className="unit">pp</span></div></div>
        </div>
        <div className="table-wrap"><table className="t"><thead><tr><th></th><th>SKU</th><th className="num">{L('Đề xuất', 'Proposed')}</th><th className="num">{L('Thực tế', 'Actual')}</th></tr></thead><tbody>{res.rows.filter((r) => r.st !== 'same').map((r) => <tr key={r.k.code}><td><Pill tone={r.st === 'del' ? 'negative' : r.st === 'add' ? 'warning' : 'info'}>{({ del: L('Thiếu', 'Missing'), add: L('Thừa', 'Extra'), up: L('Dư facing', 'Too many F'), down: L('Thiếu facing', 'Too few F'), move: L('Lệch cm', 'Width differs'), same: '' })[r.st]}</Pill></td><td>{r.k.name}<span className="sub mono">{r.k.code} · {r.k.maker}</span></td><td className="num">{r.fc ? `${r.fc} F` : <span className="dash">—</span>}</td><td className="num">{r.fp ? `${r.fp} F` : <span className="dash">—</span>}</td></tr>)}</tbody></table></div>
        <p className="small muted" style={{ marginTop: 8 }}>{L('Chưa có: nhận diện ảnh kệ thực tế, lệch vị trí/tầng. Khung dữ liệu (ComplianceFinding) đã sẵn cho bước đó.', 'Not yet: photo recognition of the actual shelf, position/shelf deviations. The data contract (ComplianceFinding) is ready for it.')}</p>
      </section>}
    </div></AppFrame>;
}
