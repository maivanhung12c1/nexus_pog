// XLSX reader: first worksheet (or the sheet the workbook lists first), shared strings and inline strings
// (legacy readXLSX). Writer: a minimal single-sheet XLSX for exports and tests.
import { unzipEntries, zipFiles } from './zip';

const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

export async function readXLSX(src: Blob | ArrayBuffer | Uint8Array): Promise<string[][]> {
  const ents = await unzipEntries(src);
  const get = async (n: string) => { const e = ents.find((x) => x.name === n); if (!e) return null; const b = await e.get(); return b ? new TextDecoder().decode(b) : null; };
  const ss: string[] = [];
  const sx = await get('xl/sharedStrings.xml');
  if (sx) { const doc = parseXml(sx); for (const si of Array.from(doc.getElementsByTagName('si'))) ss.push(Array.from(si.getElementsByTagName('t')).map((x) => x.textContent).join('')); }
  const wbr = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  let target = 'xl/worksheets/sheet1.xml';
  try {
    const wb = parseXml(wbr!), sh = wb.getElementsByTagName('sheet')[0];
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rd = parseXml(rels!);
    for (const r of Array.from(rd.getElementsByTagName('Relationship'))) if (r.getAttribute('Id') === rid) { const tg = r.getAttribute('Target')!; target = tg.startsWith('/') ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, ''); }
  } catch { /* default sheet1 */ }
  const xml = await get(target);
  if (!xml) throw Error('sheet');
  const doc = parseXml(xml), rows: string[][] = [];
  const colIdx = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  for (const r of Array.from(doc.getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const tp = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], ref = c.getAttribute('r');
      let val = '';
      if (tp === 's') val = ss[+(v && v.textContent || 0)] ?? '';
      else if (tp === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
      else val = v ? v.textContent || '' : '';
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

const xe = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Minimal XLSX with inline strings and numbers. */
export async function writeXLSX(rows: unknown[][], sheetName = 'Sheet1'): Promise<Blob> {
  const enc = new TextEncoder();
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];
  const z = await zipFiles(files);
  return new Blob([z], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
