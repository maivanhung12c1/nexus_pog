// App root: boot the stores, route by hash, error boundary, toasts.
import { Component, useEffect, useState, type ReactNode } from 'react';
import { L } from '../domain/i18n';
import { catalog } from '../app/catalogStore';
import { usePrefs } from '../app/prefs';
import { useWorkspace, workspace } from '../app/workspace';
import { useRoute } from './router';
import { Home } from './screens/Home';
import { Editor } from './screens/editor/Editor';
import { SpaceShare } from './screens/SpaceShare';
import { BuildSheets } from './screens/BuildSheets';
import { Catalog } from './screens/Catalog';
import { Competitors, Presets } from './screens/DataScreens';
import { AutoPog } from './screens/AutoPog';
import { Compliance, PriceTags, Tet2027, Warehouse } from './screens/Planned';
import { FieldView } from './screens/FieldView';
import { BrandMark } from './shell/AppFrame';

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = String(this.state.err.stack || this.state.err);
    return <div className="page"><h1>{L('Có lỗi trong ứng dụng', 'Something went wrong')}</h1><p className="muted" style={{ margin: '8px 0 12px' }}>{L('Dữ liệu đã lưu không bị ảnh hưởng. Chép lỗi dưới đây gửi cho đội phát triển.', 'Saved data is not affected. Copy the error below for the developers.')}</p>
      <pre className="well mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{msg}</pre>
      <div className="btn-row" style={{ marginTop: 12 }}><button className="btn" onClick={() => navigator.clipboard?.writeText(msg)}>{L('Chép lỗi', 'Copy error')}</button><button className="btn primary" onClick={() => { location.hash = '/'; location.reload(); }}>{L('Tải lại', 'Reload')}</button></div></div>;
  }
}

function Toasts() {
  const t = useWorkspace((s) => s.toasts);
  return <div className="toasts" role="status" aria-live="polite">{t.map((x) => <div key={x.id} className={'toast ' + x.kind}>{x.msg}</div>)}</div>;
}

export function App() {
  const [ready, setReady] = useState(false), [err, setErr] = useState('');
  usePrefs((s) => s.lang);
  useEffect(() => { Promise.all([catalog.init(), workspace.load()]).then(() => setReady(true)).catch((e) => setErr(String(e))); }, []);
  const { path, parts } = useRoute();
  if (err) return <div className="page"><h1>{L('Không khởi động được', 'Could not start')}</h1><p>{err}</p></div>;
  if (!ready) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: 'var(--muted)' }}><BrandMark /> {L('Đang mở danh mục…', 'Opening the catalog…')}</div>;
  let screen: ReactNode;
  const [a, b] = parts;
  if (a === 'p' && b) screen = <Editor id={b} key={b} />;
  else if (a === 'field' && b) screen = <FieldView id={b} key={b} />;
  else if (a === 'share') screen = <SpaceShare path={path} />;
  else if (a === 'sheets') screen = <BuildSheets path={path} id={b} key={b || 'list'} />;
  else if (a === 'catalog') screen = <Catalog path={path} />;
  else if (a === 'competitors') screen = <Competitors path={path} />;
  else if (a === 'presets') screen = <Presets path={path} />;
  else if (a === 'auto') screen = <AutoPog path={path} id={b} />;
  else if (a === 'tet2027') screen = <Tet2027 path={path} />;
  else if (a === 'warehouse') screen = <Warehouse path={path} />;
  else if (a === 'pricetags') screen = <PriceTags path={path} />;
  else if (a === 'compliance') screen = <Compliance path={path} />;
  else screen = <Home path={path} />;
  return <Boundary><title>{'Nexus POG'}</title>{screen}<Toasts /></Boundary>;
}
