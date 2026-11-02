// Import dialogs: project JSON (with migration report), Spaceman .plnx (multi-planogram), POG PDF (options +
// drawing measurement), batch PDF → .plnx zip.
import { useEffect, useState } from 'react';
import { fmt, L } from '../../domain/i18n';
import type { Design } from '../../domain/types';
import { pogDefaults, type Pog, type PogOptions } from '../../infra/pdf/pogParser';
import { batchPdf, buildPog, download, importPlnxFile, measureAndApplyDrawing, readPdf, readProjectFile, zipPlnx } from '../../app/io';
import { openV6LibraryItem } from '../../infra/projectFile';
import { catalog } from '../../app/catalogStore';
import { prefs } from '../../app/prefs';
import { toast, workspace } from '../../app/workspace';
import { Button, Dialog, Field, NumberInput, Pill, Select } from '../ds';
import { go } from '../router';
import type { MigrationReport } from '../../domain/migration/normalize';

const own = () => [prefs().ownMaker, prefs().competitor] as const;
export async function createAndOpen(d: Design) { const id = await workspace.createProject(d, ...own()); go('/p/' + id); return id; }

type Job = { kind: 'json' | 'plnx' | 'pdf' | 'batch'; files: File[] };

/** Routes dropped / picked files to the right import dialog. */
export function ImportRouter({ job, onClose }: { job: Job | null; onClose: () => void }) {
  if (!job) return null;
  if (job.kind === 'batch') return <BatchDialog files={job.files} onClose={onClose} />;
  const f = job.files[0];
  if (/\.pdf$/i.test(f.name)) return <PdfDialog file={f} onClose={onClose} />;
  if (/\.(plnx|zip)$/i.test(f.name)) return <PlnxDialog file={f} onClose={onClose} />;
  return <JsonDialog file={f} onClose={onClose} />;
}
export const jobFor = (files: File[]): Job => (files.length > 1 && files.every((f) => /\.pdf$/i.test(f.name)) ? { kind: 'batch', files } : { kind: /\.pdf$/i.test(files[0].name) ? 'pdf' : /\.(plnx|zip)$/i.test(files[0].name) ? 'plnx' : 'json', files });

function MigrationNotes({ report }: { report: MigrationReport }) {
  if (!report.notes.length && !report.kept.length && !report.repaired) return <p className="muted">{L('Không cần chuyển đổi gì thêm.', 'Nothing needed converting.')}</p>;
  return <div className="well small">
    <p>{L('Bản gốc', 'Source')}: schema {String(report.from)} → 8 · {report.repaired} {L('SKU được sửa quy cách/kích thước', 'SKUs had pack form / size repaired')}</p>
    {report.kept.length > 0 && <p>{L('Trường cũ được giữ nguyên trong project', 'Legacy fields kept in the project')}: <span className="mono">{report.kept.join(', ')}</span></p>}
    {report.notes.map((n, i) => <p key={i}>• {n}</p>)}
  </div>;
}

function JsonDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [state, setState] = useState<{ err?: string; r?: Awaited<ReturnType<typeof readProjectFile>> }>({});
  useEffect(() => { readProjectFile(file).then((r) => setState({ r })).catch((e) => setState({ err: e.message })); }, [file]);
  const r = state.r;
  const open = async (d: Design) => { onClose(); await createAndOpen(d); toast(L('Đã mở ', 'Opened ') + file.name); };
  return <Dialog title={L('Mở project', 'Open project')} onClose={onClose} footer={<>
    <Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button>
    {r && r.kind !== 'v6library' && <Button variant="primary" onClick={() => open(r.design)}>{L('Mở thành dự án', 'Open as a project')}</Button>}
  </>}>
    <p><b>{file.name}</b></p>
    {state.err && <div className="notice" role="alert">{state.err}</div>}
    {!r && !state.err && <div className="loading-bar" />}
    {r && r.kind === 'design' && <><p className="muted">{r.design.meta.name} · {r.design.objects.length} {L('đối tượng', 'objects')} · {Object.keys(r.design.skus).length} SKU</p><MigrationNotes report={r.report} /></>}
    {r && r.kind === 'v6' && <><p className="muted">{L('Project V6 → bản mới. File gốc không bị thay đổi.', 'V6 project → new format. The original file is not modified.')}</p>
      <table className="t"><thead><tr><th></th><th className="num">V6</th></tr></thead><tbody>{Object.entries(r.v6.v6).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table><MigrationNotes report={r.report} /></>}
    {r && r.kind === 'v6library' && <div className="lib-list">{r.items.map((it, i) => <button key={i} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: 8 }} onClick={async () => { const m = await openV6LibraryItem(it as never, (s) => catalog.putAsset(s)); await open(m.design); }}>{it.thumb && <img src={it.thumb} alt="" width={40} />}<span>{it.name}<br /><small className="muted">{it.cartons || 0} {L('thùng', 'cartons')} · {it.height || '?'} cm</small></span></button>)}</div>}
  </Dialog>;
}

function PlnxDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [res, setRes] = useState<Awaited<ReturnType<typeof importPlnxFile>> | null>(null), [err, setErr] = useState('');
  useEffect(() => { importPlnxFile(file).then(setRes).catch((e) => setErr(e.message)); }, [file]);
  const openOne = async (d: Design) => { onClose(); await createAndOpen(structuredClone(d)); };
  const addAll = async () => { for (const b of res!.built) await workspace.addPog(b.design, file.name); toast(L(`Đã thêm ${res!.built.length} POG vào Space Share`, `${res!.built.length} POGs added to Space Share`)); onClose(); go('/share'); };
  const saveAll = async () => { for (const b of res!.built) await workspace.createProject(structuredClone(b.design), ...own()); toast(L(`Đã lưu ${res!.built.length} planogram`, `${res!.built.length} planograms saved`)); onClose(); };
  return <Dialog wide title={L('Planogram Spaceman (.plnx)', 'Spaceman planogram (.plnx)')} onClose={onClose} footer={res && <>
    <Button onClick={saveAll}>{L('Lưu tất cả thành dự án', 'Save all as projects')}</Button>
    <Button variant="primary" icon="share" onClick={addAll}>{L('Đưa vào Space Share', 'Add to Space Share')}</Button></>}>
    <p><b>{file.name}</b></p>
    {err && <div className="notice" role="alert">{err}</div>}
    {!res && !err && <div className="loading-bar" />}
    {res && <>
      {(res.merged.add > 0 || res.merged.fix > 0) && <div className="notice info">{L(`Danh mục: thêm ${res.merged.add} mã, cập nhật kích thước thật cho ${res.merged.fix} mã ước tính.`, `Catalog: ${res.merged.add} codes added, real sizes for ${res.merged.fix} estimated codes.`)}</div>}
      <div className="table-wrap"><table className="t"><thead><tr><th>Planogram</th><th className="num">{L('Kệ', 'Fixtures')}</th><th className="num">{L('Vị trí', 'Positions')}</th><th className="num">SKU</th><th></th></tr></thead>
        <tbody>{res.built.map((b, i) => <tr key={i}><td>{b.design.meta.name}</td><td className="num">{b.rep.fixtures}</td><td className="num">{b.rep.positions}</td><td className="num">{b.rep.skus}</td><td className="num"><Button size="sm" onClick={() => openOne(b.design)}>{L('Mở để chỉnh', 'Open to edit')}</Button></td></tr>)}</tbody></table></div>
    </>}
  </Dialog>;
}

function PdfDialog({ file, onClose }: { file: File; onClose: () => void }) {
  const [pogs, setPogs] = useState<(Pog[] & { pages?: unknown }) | null>(null), [err, setErr] = useState(''), [prog, setProg] = useState('');
  const [idx, setIdx] = useState(0), [o, setO] = useState<PogOptions | null>(null), [measure, setMeasure] = useState(true), [busy, setBusy] = useState(false);
  useEffect(() => { readPdf(file, (i, n) => setProg(L(`Đang đọc trang ${i}/${n}…`, `Reading page ${i}/${n}…`))).then((p) => { setPogs(p); setO(pogDefaults(p[0])); }).catch((e) => setErr(e.message)); }, [file]);
  const p = pogs?.[idx];
  const bays = p ? new Set(p.rows.map((r) => r.bay)).size : 0, codes = p ? new Set(p.rows.map((r) => r.code)) : new Set<string>(), known = [...codes].filter((c) => catalog.byCode(c)).length;
  const hasH = !!p && Object.keys(p.heights || {}).length > 0;
  const build = async (target: 'open' | 'share') => {
    if (!p || !o) return;
    setBusy(true);
    try {
      let drawing: { dims: number; pics: number } | null = null;
      if (measure) { const arr = [p] as Pog[] & { pages?: unknown }; arr.pages = pogs!.pages; drawing = await measureAndApplyDrawing(arr as never, setProg); }
      const r = buildPog(p, o);
      const msg = [`${r.rep.rows} ${L('vị trí', 'positions')} · ${r.rep.matched} ${L('khớp danh mục', 'matched the catalog')} · ${r.rep.newSkus.length} ${L('SKU mới (kích thước ước tính)', 'new SKUs (estimated size)')}`];
      if (drawing) msg.push(`${L('Từ bản vẽ', 'From the drawing')}: ${drawing.dims} ${L('mã đo được', 'codes measured')} · ${drawing.pics} ${L('hình', 'pictures')}`);
      if (r.rep.overflow.length) msg.push(r.rep.overflow.join(' · '));
      if (target === 'share') { await workspace.addPog(r.design, file.name); onClose(); go('/share'); }
      else { onClose(); await createAndOpen(r.design); }
      toast(msg.join(' — '), r.rep.overflow.length ? 'warn' : 'info');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const num = (k: keyof PogOptions, lab: string) => <Field label={lab}><NumberInput value={o![k] as number} unit="cm" onCommit={(v) => setO({ ...o!, [k]: Math.max(0.1, v) })} /></Field>;
  return <Dialog wide title={L('Nhập planogram từ PDF', 'Import planogram from PDF')} onClose={onClose} footer={p && o && <>
    <Button disabled={busy} onClick={() => build('share')}>{L('Chỉ đưa vào Space Share', 'Add to Space Share only')}</Button>
    <Button variant="primary" disabled={busy} onClick={() => build('open')}>{busy ? L('Đang dựng…', 'Building…') : L('Dựng planogram', 'Build planogram')}</Button></>}>
    <p><b>{file.name}</b> {prog && <span className="muted">· {prog}</span>}</p>
    {err && <div className="notice" role="alert">{err}</div>}
    {!pogs && !err && <div className="loading-bar" />}
    {p && o && <>
      <p>{p.fmt === 'go' ? 'GO! / mini go' : 'Lotte Mart'} · {bays} bay · {p.rows.length} {L('vị trí', 'positions')} · {p.rows.reduce((a, r) => a + r.facings, 0)} facing · {codes.size} SKU ({known} {L('có trong danh mục', 'in catalog')}, {codes.size - known} {L('mới', 'new')})</p>
      {pogs!.length > 1 && <Field label={L('Planogram trong file', 'Planogram in file')}><Select value={String(idx)} options={pogs!.map((q, i) => [String(i), `${q.title} (${q.rows.length})`] as [string, string])} onChange={(v) => { setIdx(+v); setO(pogDefaults(pogs![+v])); }} /></Field>}
      <p className="muted small">{hasH ? L('PDF có ghi cao độ tấm kệ ("chieu cao") → dùng luôn. Kích thước bay dưới đây là mặc định, sửa được sau.', 'The PDF prints shelf heights ("chieu cao") → used as is. Bay sizes below are defaults, editable later.') : L('PDF không ghi cao độ tấm kệ → mỗi tấm cao bằng sản phẩm cao nhất tầng dưới + 4 cm. Kích thước bay tuỳ store, sửa được sau.', 'No shelf heights in the PDF → each shelf = tallest product below + 4 cm. Bay sizes are store-specific and editable later.')}</p>
      <div className="grid3">{num('bayW', L('Rộng bay', 'Bay width'))}{num('h', L('Cao bay', 'Bay height'))}{num('d', L('Sâu kệ', 'Shelf depth'))}</div>
      <div className="grid3">{num('baseD', L('Sâu đế', 'Base depth'))}{num('kick', L('Cao chân đế', 'Kick'))}{num('pitch', L('Bước lỗ', 'Notch pitch'))}</div>
      <div className="grid3">
        <Field label={L('Tầng 1 là', 'Shelf 1 is')}><Select value={o.shelfFrom} options={[['bottom', L('dưới cùng', 'bottom')], ['top', L('trên cùng', 'top')]]} onChange={(v) => setO({ ...o, shelfFrom: v })} /></Field>
        <Field label={L('Vị trí 1 ở', 'Position 1 at')}><Select value={o.posFrom} options={[['left', L('bên trái', 'left')], ['right', L('bên phải', 'right')]]} onChange={(v) => setO({ ...o, posFrom: v })} /></Field>
        <Field label={L('Bay 1 ở', 'Bay 1 at')}><Select value={o.bayFrom} options={[['left', L('bên trái', 'left')], ['right', L('bên phải', 'right')]]} onChange={(v) => setO({ ...o, bayFrom: v })} /></Field>
      </div>
      {hasH && <label className="check"><input type="checkbox" checked={o.useH} onChange={(e) => setO({ ...o, useH: e.target.checked })} />{L('Dùng cao độ tấm kệ ghi trên POG', 'Use the shelf heights printed on the POG')}</label>}
      <label className="check"><input type="checkbox" checked={o.autoW} onChange={(e) => setO({ ...o, autoW: e.target.checked })} />{L('Nới rộng bay khi hàng không vừa', 'Widen a bay when products do not fit')}</label>
      <label className="check"><input type="checkbox" checked={measure} onChange={(e) => setMeasure(e.target.checked)} />{L('Đo kích thước & cắt hình sản phẩm từ bản vẽ PDF (cho mã ≈)', 'Measure sizes & cut product pictures from the PDF drawing (for ≈ codes)')}</label>
    </>}
  </Dialog>;
}

function BatchDialog({ files, onClose }: { files: File[]; onClose: () => void }) {
  const [measure, setMeasure] = useState(true), [toShare, setToShare] = useState(true), [busy, setBusy] = useState(false), [cur, setCur] = useState(''), [res, setRes] = useState<Awaited<ReturnType<typeof batchPdf>> | null>(null);
  const run = async () => {
    setBusy(true);
    const r = await batchPdf(files, { measure }, (i, n) => setCur(`${i + 1}/${files.length}: ${n}`));
    if (toShare) for (const x of r) if ('design' in x) await workspace.addPog(x.design, x.file);
    setRes(r); setBusy(false); setCur('');
  };
  const ok = (res || []).filter((x): x is Extract<typeof x, { design: Design }> => 'design' in x);
  return <Dialog wide title={L('Lô PDF → Spaceman (.plnx)', 'Batch PDFs → Spaceman (.plnx)')} onClose={onClose} footer={<>
    {res && ok.length > 0 && <Button icon="download" onClick={async () => download(`Spaceman_${new Date().toISOString().slice(0, 10)}_${ok.length}POG.zip`, await zipPlnx(ok.map((x) => x.plnx)), 'application/zip')}>{L('Tải .zip', 'Download .zip')}</Button>}
    {res && toShare && ok.length > 0 && <Button onClick={() => { onClose(); go('/share'); }}>Space Share</Button>}
    <Button variant="primary" disabled={busy} onClick={run}>{busy ? cur || '…' : L('Chạy', 'Run')}</Button></>}>
    <p className="muted">{L('Mỗi PDF được dựng thành planogram, đo kích thước + hình từ bản vẽ, xuất .plnx; tất cả gom vào 1 file .zip.', 'Each PDF is built, measured from its drawing and exported to .plnx; all go into one .zip.')}</p>
    <label className="check"><input type="checkbox" checked={measure} onChange={(e) => setMeasure(e.target.checked)} />{L('Đo kích thước & hình từ bản vẽ', 'Measure sizes & pictures from the drawing')}</label>
    <label className="check"><input type="checkbox" checked={toShare} onChange={(e) => setToShare(e.target.checked)} />{L('Thêm vào Space Share', 'Add to Space Share')}</label>
    <div className="table-wrap"><table className="t"><thead><tr><th>PDF</th><th>Planogram</th><th className="num">Bay</th><th className="num">{L('Vị trí', 'Pos.')}</th><th className="num">Facing</th><th className="num">SKU</th><th className="num">≈</th><th>{L('Kiểm tra', 'Check')}</th><th></th></tr></thead>
      <tbody>{files.map((f, i) => { const r = res?.[i]; return <tr key={i}><td className="small">{f.name}</td>{!r ? <td colSpan={8} className="muted">{busy ? '…' : '—'}</td> : 'err' in r ? <td colSpan={8} style={{ color: 'var(--negative)' }}>{r.err}</td> : <>
        <td>{r.name}</td><td className="num">{r.stats.bays}</td><td className="num">{r.stats.positions}</td><td className="num">{r.stats.facings}</td><td className="num">{r.stats.skus}</td><td className="num">{r.stats.est}</td>
        <td>{r.pf.filter((w) => w.level !== 'info').length ? <Pill tone="warning">{r.pf.filter((w) => w.level !== 'info').length} {L('lưu ý', 'notes')}</Pill> : <Pill tone="positive">OK</Pill>}</td>
        <td><Button size="sm" onClick={async () => { onClose(); await createAndOpen(structuredClone(r.design)); }}>{L('Mở', 'Open')}</Button></td></>}</tr>; })}</tbody></table></div>
    {res && <p className="muted">{L(`Xong ${ok.length}/${files.length} PDF · ${ok.reduce((a, r) => a + r.stats.positions, 0)} vị trí`, `Done ${ok.length}/${files.length} · ${ok.reduce((a, r) => a + r.stats.positions, 0)} positions`)} · {fmt(ok.reduce((a, r) => a + r.stats.est, 0), 0)} SKU ≈</p>}
  </Dialog>;
}
