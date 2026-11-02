// CSV parsing (legacy parseCSV: delimiter sniffed from the first line among , ; tab; quoted cells) and writing.

export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.slice(0, 5000).split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((c) => c.trim())) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
/** CSV with a UTF-8 BOM and CRLF (opens correctly in Excel with Vietnamese text). */
export const toCSV = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
