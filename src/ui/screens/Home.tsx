// Planograms: what you can do first — open recent work, start from a preset, or bring in a retailer POG.
import { useState } from 'react';
import { fmt, L } from '../../domain/i18n';
import { newDesign } from '../../domain/design';
import { newShelfDesign } from '../../domain/shelf/gondola';
import { GONDOLA_PRESETS, PALLET_PRESETS } from '../../domain/presets';
import { clamp } from '../../domain/util';
import { usePrefs, prefs } from '../../app/prefs';
import { toast, useWorkspace, workspace } from '../../app/workspace';
import { saveProjectFile } from '../../app/io';
import { AppFrame } from '../shell/AppFrame';
import { Button, DropZone, Empty, Field, FileButton, Icon, Menu, NumberInput, Pill, Select } from '../ds';
import { ShelfStrip } from '../widgets/ShelfStrip';
import { ImportRouter, createAndOpen, jobFor } from './imports';
import { go } from '../router';

const ago = (t: number) => { const d = (Date.now() - t) / 1000; if (d < 60) return L('vừa xong', 'just now'); if (d < 3600) return L(`${Math.round(d / 60)} phút trước`, `${Math.round(d / 60)} min ago`); if (d < 86400) return L(`${Math.round(d / 3600)} giờ trước`, `${Math.round(d / 3600)} h ago`); return new Date(t).toISOString().slice(0, 10); };

export function Home({ path }: { path: string }) {
  const projects = useWorkspace((s) => s.projects), loaded = useWorkspace((s) => s.loaded), own = usePrefs((s) => s.ownMaker);
  usePrefs((s) => s.lang);
  const [g, setG] = useState('g120'), [bays, setBays] = useState(3), [pp, setPp] = useState('go');
  const [job, setJob] = useState<ReturnType<typeof jobFor> | null>(null);
  const newGondola = () => { const d = newShelfDesign(GONDOLA_PRESETS[g], clamp(bays | 0, 1, 20)); d.meta.name = `${GONDOLA_PRESETS[g].name} · ${bays} bay`; createAndOpen(d); };
  const newPallet = () => { const d = newDesign(pp); d.meta.name = 'Display ' + PALLET_PRESETS[pp].name; createAndOpen(d); };
  const onFiles = (fs: File[]) => setJob(jobFor(fs));
  const total = projects.length;
  return <AppFrame path={path} title="Planograms">
    <div className="page">
      <div className="page-head">
        <div><h1>Planograms</h1><p className="lead">{total ? L(`${total} planogram trên máy này · sửa gần nhất ${ago(projects[0].updated)}`, `${total} planograms on this computer · last edited ${ago(projects[0].updated)}`) : L('Tạo planogram kệ, display pallet, hoặc nhập POG của chuỗi.', 'Create a shelf planogram or pallet display, or import a retailer POG.')}</p></div>
        <div className="actions">
          <Menu label={L('Nhập', 'Import')} icon="upload" items={[
            { header: L('Mở file', 'Open a file') },
            { label: L('Project Nexus (.json, cả bản cũ V6/V7)', 'Nexus project (.json, incl. V6/V7)'), icon: 'planograms', onClick: () => pick('.json', false) },
            { label: 'Spaceman (.plnx)', icon: 'gondola', onClick: () => pick('.plnx,.zip', false) },
            { label: L('POG PDF (GO!, mini go, Lotte)', 'POG PDF (GO!, mini go, Lotte)'), icon: 'sheet', onClick: () => pick('.pdf', false) },
            { label: L('Lô nhiều PDF → .plnx', 'Batch PDFs → .plnx'), icon: 'copy', onClick: () => pick('.pdf', true) },
          ]} />
          <Button variant="primary" icon="plus" onClick={newGondola}>{L('Planogram kệ mới', 'New shelf planogram')}</Button>
        </div>
      </div>

      <div className="create-row">
        <div className="create-card" role="group" aria-label={L('Planogram kệ chính', 'Main-shelf planogram')}>
          <h3><Icon.gondola width={16} height={16} style={{ verticalAlign: -2, marginRight: 6 }} />{L('Planogram kệ chính (gondola)', 'Main-shelf planogram (gondola)')}</h3>
          <p>{L('Bay + tấm kệ theo lỗ cài. Kích thước mẫu là giả định, sửa theo chuỗi sau.', 'Bays and notched shelves. Preset sizes are assumptions; adjust per retailer.')}</p>
          <div className="grid2"><Field label={L('Mẫu', 'Preset')}><Select value={g} options={Object.values(GONDOLA_PRESETS).map((x) => [x.id, x.name] as [string, string])} onChange={setG} /></Field><Field label={L('Số bay', 'Bays')}><NumberInput value={bays} step={1} min={1} max={20} onCommit={(v) => setBays(Math.round(v))} /></Field></div>
          <div className="go"><Button variant="primary" onClick={newGondola}>{L('Tạo planogram', 'Create planogram')}</Button></div>
        </div>
        <div className="create-card" role="group" aria-label={L('Display pallet', 'Pallet display')}>
          <h3><Icon.pallet width={16} height={16} style={{ verticalAlign: -2, marginRight: 6 }} />{L('Display pallet / ụ đảo', 'Pallet display / island')}</h3>
          <p>{L('Xếp thùng, khối lặp, viền rỗng ruột, POSM. Chiều cao tối đa theo mẫu chuỗi.', 'Cartons, repeat blocks, hollow shells, POSM. Max height per retailer preset.')}</p>
          <Field label={L('Mẫu pallet', 'Pallet preset')}><Select value={pp} options={Object.values(PALLET_PRESETS).map((x) => [x.id, `${x.name} – ${x.w}×${x.d}×${x.h}`] as [string, string])} onChange={setPp} /></Field>
          <div className="go"><Button onClick={newPallet}>{L('Tạo display', 'Create display')}</Button></div>
        </div>
        <DropZone onFiles={onFiles} accept={/\.(json|plnx|zip|pdf)$/i}>
          <Icon.upload width={20} height={20} />
          <div style={{ flex: 1 }}><b style={{ color: 'var(--text)' }}>{L('Nhập POG của chuỗi', 'Import a retailer POG')}</b><br /><span className="small">{L('Kéo thả .plnx, PDF (GO!, mini go, Lotte) hoặc .json vào đây. Nhiều PDF = chạy lô.', 'Drop .plnx, PDF (GO!, mini go, Lotte) or .json here. Several PDFs = batch.')}</span></div>
          <FileButton accept=".json,.plnx,.zip,.pdf" multiple onFiles={onFiles}>{L('Chọn file', 'Choose files')}</FileButton>
        </DropZone>
      </div>

      <section className="section">
        <div className="section-head"><h2>{L('Dự án', 'Projects')}</h2><span className="lead">{L(`Share của ${own} tính theo cm ngang trên kệ`, `${own} share is measured in linear cm on shelf`)}</span></div>
        {!loaded ? <div className="loading-bar" /> : !projects.length ? <Empty action={<Button variant="primary" onClick={newGondola}>{L('Tạo planogram đầu tiên', 'Create the first planogram')}</Button>}>{L('Chưa có planogram nào trên máy này. Bắt đầu từ một mẫu gondola hoặc nhập POG của chuỗi.', 'No planograms on this computer yet. Start from a gondola preset or import a retailer POG.')}</Empty> :
          <div className="table-wrap"><table className="t responsive">
            <thead><tr><th style={{ width: 140 }}>{L('Mặt trước', 'Front')}</th><th>{L('Tên', 'Name')}</th><th className="num">SKU</th><th className="num">Facing</th><th className="num">{own} share</th><th className="num">{L('Đơn vị', 'Units')}</th><th className="num">{L('Sửa', 'Edited')}</th><th></th></tr></thead>
            <tbody>{projects.map((p) => <tr key={p.id} className="clickable" onClick={() => go('/p/' + p.id)}>
              <td><ShelfStrip rects={p.strip} width={128} height={40} label={p.name} /></td>
              <td><b style={{ fontWeight: 500 }}>{p.name}</b><span className="sub">{p.kind === 'shelf' ? L('Planogram kệ', 'Shelf planogram') : L('Display pallet', 'Pallet display')} · {fmt(p.widthCm, 0)} cm</span></td>
              <td className="num">{p.skus}</td><td className="num">{p.facings}</td>
              <td className="num">{p.focusShare == null ? <span className="dash">—</span> : fmt(p.focusShare * 100, 1) + '%'}</td>
              <td className="num">{p.units ? fmt(p.units, 0) : <span className="dash">—</span>}</td>
              <td className="num muted">{ago(p.updated)}</td>
              <td className="num" onClick={(e) => e.stopPropagation()}><Menu icon="more" variant="ghost" size="sm" items={[
                { label: L('Mở trình chỉnh', 'Open editor'), icon: 'planograms', onClick: () => go('/p/' + p.id) },
                { label: L('Phiếu dựng', 'Build sheet'), icon: 'sheet', onClick: () => go('/sheets/' + p.id) },
                { label: L('Xem tại hiện trường', 'Field view'), icon: 'field', onClick: () => go('/field/' + p.id) },
                { label: L('Đưa vào Space Share', 'Add to Space Share'), icon: 'share', onClick: async () => { const d = await workspace.loadDesign(p.id); if (d) { await workspace.addPog(d, L('dự án', 'project')); toast(L('Đã thêm vào Space Share', 'Added to Space Share')); } } },
                'sep',
                { label: L('Tải project (.json)', 'Download project (.json)'), icon: 'download', onClick: async () => { const d = await workspace.loadDesign(p.id); if (d) saveProjectFile(d); } },
                { label: L('Nhân bản', 'Duplicate'), icon: 'copy', onClick: () => workspace.duplicate(p.id, prefs().ownMaker, prefs().competitor) },
                { label: L('Xoá', 'Delete'), icon: 'trash', onClick: () => { if (confirm(L(`Xoá "${p.name}" khỏi máy này? Không hoàn tác được.`, `Delete "${p.name}" from this computer? This cannot be undone.`))) workspace.remove(p.id); } },
              ]} /></td>
            </tr>)}</tbody></table></div>}
      </section>

      <section className="section">
        <div className="section-head"><h2>{L('Chuyển từ bản cũ', 'Bringing work from the old app')}</h2></div>
        <p className="muted" style={{ maxWidth: 760 }}>{L('Bản HTML cũ lưu dữ liệu trong trình duyệt của file đó; bản mới không đọc được trực tiếp. Mở bản cũ → Lưu (.json, có kèm ảnh) → nhập file vào đây. SKU trong file được thêm vào danh mục; trường không chuyển được sẽ được báo và giữ lại.', 'The old HTML kept its data inside that file’s browser storage, which the new app cannot read. Open the old app → Save (.json, with images) → import that file here. Its SKUs join the catalog; anything that cannot be converted is reported and kept.')} <Pill>{L('Mở được: schema 7, V6, thư viện V6', 'Opens: schema 7, V6, V6 library')}</Pill></p>
      </section>
    </div>
    <ImportRouter job={job} onClose={() => setJob(null)} />
  </AppFrame>;

  function pick(accept: string, multiple: boolean) {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => { const fs = [...(i.files || [])]; if (fs.length) setJob(multiple && fs.length > 1 ? { kind: 'batch', files: fs } : jobFor(fs)); };
    i.click();
  }
}
