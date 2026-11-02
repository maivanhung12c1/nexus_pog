// End-to-end smoke test in the installed Chrome: boots the app, creates a gondola planogram, drags a SKU onto a shelf,
// sets facings / stack with the keyboard, undo / redo, autosave + reload, Space Share, build sheet, catalog, phone width.
// Usage: npm run dev (port 5173) in another terminal, then: npm run e2e   (BASE=http://... to override)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:5173/';
const here = dirname(fileURLToPath(import.meta.url)), shots = join(here, 'out');
mkdirSync(shots, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const results = [];
const step = async (name, fn) => { const t0 = Date.now(); try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log('  ✓', name); } catch (e) { results.push(['FAIL', name, e.message]); console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: join(shots, 'fail-' + name.replace(/\W+/g, '_') + '.png') }); } };
const statusText = () => page.locator('.status').innerText();

await step('boot: catalog loads and Planograms home renders', async () => {
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Planograms' }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(shots, '01-home.png') });
});

await step('create a 3-bay gondola planogram', async () => {
  await page.getByRole('button', { name: /Tạo planogram|Create planogram/ }).first().click();
  await page.locator('.editor .canvas-well canvas').first().waitFor();
  await page.waitForTimeout(600);
  const s = await statusText();
  if (!/Kệ|Shelf/.test(s)) throw Error('status bar has no shelf metrics: ' + s);
  await page.screenshot({ path: join(shots, '02-editor-empty.png') });
});

let before = '';
await step('drag a SKU from the library onto a shelf (front view)', async () => {
  await page.getByRole('searchbox').fill('pepsi chai 300ml');
  await page.waitForTimeout(200);
  const card = page.locator('.lib-card').first();
  const cb = await card.boundingBox(), well = await page.locator('.canvas-well').boundingBox();
  before = await statusText();
  await page.mouse.move(cb.x + 30, cb.y + 20);
  await page.mouse.down();
  // drop in the front view (left half), at shelf height (lower-middle of the view)
  const tx = well.x + well.width * 0.18, ty = well.y + well.height * 0.44; // ≈ 130 cm: above a mid shelf
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cb.x + 30 + ((tx - cb.x - 30) * i) / 12, cb.y + 20 + ((ty - cb.y - 20) * i) / 12); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await statusText();
  if (!/SKU\s*1\b/.test(after)) throw Error('no SKU on shelf after drop: ' + after);
});

await step('keyboard: type 4 → 4 facings, Shift+↑ → stack 2, facing limit respected', async () => {
  await page.locator('.canvas-well').hover();
  await page.keyboard.press('4');
  await page.waitForTimeout(300);
  let s = await statusText();
  if (!/Facing\s*4\b/.test(s)) throw Error('facings not 4: ' + s);
  await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(300);
  await page.keyboard.press('9'); await page.keyboard.press('9');
  await page.waitForTimeout(400);
  s = await statusText();
  const f = +(/Facing\s*(\d+)/.exec(s) || [])[1];
  if (!(f > 4 && f < 99)) throw Error('facing limit not applied (got ' + f + ')');
  await page.screenshot({ path: join(shots, '03-editor-facings.png') });
});

await step('undo / redo', async () => {
  const a = await statusText();
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  const b = await statusText();
  if (a === b) throw Error('undo changed nothing');
  await page.keyboard.press('Control+y'); await page.waitForTimeout(300);
  const c = await statusText();
  if (c !== a) throw Error('redo did not restore: ' + c + ' vs ' + a);
});

await step('switch views (Top+3D, 3D, Front) and frame', async () => {
  for (const name of ['Top + 3D', '3D', 'Trước', 'Trước + 3D']) { await page.getByRole('radio', { name, exact: true }).click(); await page.waitForTimeout(250); }
  await page.keyboard.press('f');
  await page.screenshot({ path: join(shots, '04-editor-front.png') });
});

let projectUrl = '';
await step('autosave + reload keeps the planogram', async () => {
  await page.waitForTimeout(1200);
  projectUrl = page.url();
  const s1 = await statusText();
  await page.reload();
  await page.locator('.editor .status').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const s2 = await statusText();
  const pick = (s) => (/Facing\s*\d+/.exec(s) || [''])[0] + (/SKU\s*\d+/.exec(s) || [''])[0];
  if (pick(s1) !== pick(s2)) throw Error(`after reload ${pick(s2)} ≠ ${pick(s1)}`);
});

await step('export menu offers .plnx and BOM', async () => {
  await page.getByRole('button', { name: /^(Xuất|Export)$/ }).click();
  await page.getByRole('menuitem', { name: /Spaceman/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
});

await step('inspector: select a shelf, pack right, then quantities tab', async () => {
  await page.getByRole('tab', { name: /Đối tượng|Layers/ }).click();
  await page.locator('.layer-row', { hasText: /Kệ 2|Shelf 2/ }).first().click();
  await page.getByRole('tab', { name: /Thuộc tính|Properties/ }).click();
  await page.getByRole('button', { name: /Dồn phải|Pack right/ }).click();
  await page.getByRole('tab', { name: /Số lượng|Quantities/ }).click();
  await page.getByRole('heading', { name: /Số lượng \(BOM\)|Bill of materials/ }).waitFor();
  await page.screenshot({ path: join(shots, '05-editor-quantities.png') });
});

await step('build sheet: document with KPIs, prices, picking list', async () => {
  await page.getByRole('button', { name: /Phiếu dựng|Build sheet/ }).first().click();
  await page.locator('article.doc').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const t = await page.locator('article.doc').innerText();
  if (!/Facing|facing/.test(t) || !/Picking|hàng lấy/i.test(t)) throw Error('sheet sections missing');
  await page.screenshot({ path: join(shots, '06-build-sheet.png'), fullPage: false });
});

await step('Space Share: add the project and see the focus share', async () => {
  await page.goto(BASE + '#/');
  await page.locator('table.t tbody tr').first().waitFor();
  await page.locator('table.t tbody tr').first().getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Space Share/ }).click();
  await page.goto(BASE + '#/share');
  await page.locator('.kpi.lead').waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shots, '07-space-share.png') });
});

await step('catalog: 3,300+ SKUs, search works', async () => {
  await page.goto(BASE + '#/catalog');
  await page.getByRole('heading', { name: /Danh mục SKU|SKU catalog/ }).waitFor();
  const lead = await page.locator('.page-head .lead').innerText();
  if (!/3[.,]?3\d\d/.test(lead)) throw Error('catalog size: ' + lead);
  await page.getByRole('searchbox').fill('aquafina');
  await page.waitForTimeout(300);
  const n = await page.locator('table.t tbody tr.clickable').count();
  if (n < 1) throw Error('search returned nothing');
  await page.screenshot({ path: join(shots, '08-catalog.png') });
});

await step('phone width: home + field view render without horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '#/');
  await page.getByRole('heading', { name: 'Planograms' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: join(shots, '09-phone-home.png') });
  const id = projectUrl.split('#/p/')[1];
  await page.goto(BASE + '#/field/' + id);
  await page.getByRole('tab').first().waitFor();
  await page.screenshot({ path: join(shots, '10-phone-field.png') });
  if (overflow > 2) throw Error('horizontal overflow ' + overflow + 'px');
});


// ---------------- file workflows ----------------
const dl = join(shots, 'files'); mkdirSync(dl, { recursive: true });
await page.setViewportSize({ width: 1440, height: 900 });
let plnxPath = '', jsonPath = '';
await step('export .plnx and project .json from the editor (real downloads)', async () => {
  await page.goto(projectUrl);
  await page.locator('.editor .status').waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^(Xuất|Export)$/ }).click();
  const dlP = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Spaceman/ }).click();
  const pf = page.getByRole('button', { name: /Vẫn xuất|Export anyway/ });
  if (await pf.isVisible({ timeout: 1500 }).catch(() => false)) await pf.click();
  const d1 = await dlP; plnxPath = join(dl, d1.suggestedFilename()); await d1.saveAs(plnxPath);
  if (!/\.plnx$/.test(plnxPath)) throw Error('not a .plnx: ' + plnxPath);
  await page.getByRole('button', { name: /^(Xuất|Export)$/ }).click();
  const dlJ = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Project/ }).click();
  const d2 = await dlJ; jsonPath = join(dl, d2.suggestedFilename()); await d2.saveAs(jsonPath);
});

const importVia = async (menu, file) => {
  await page.goto(BASE + '#/');
  await page.getByRole('heading', { name: 'Planograms' }).waitFor();
  await page.getByRole('button', { name: /^Nhập|^Import/ }).click();
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: menu }).click();
  await (await fc).setFiles(file);
};

await step('re-import the exported .plnx (Spaceman round trip in the browser)', async () => {
  await importVia(/Spaceman/, plnxPath);
  const row = page.locator('.dialog table.t tbody tr').first();
  await row.waitFor({ timeout: 20000 });
  const t = await row.innerText();
  if (!/\b1\b/.test(t)) throw Error('unexpected positions: ' + t);
  await page.screenshot({ path: join(shots, '11-plnx-import.png') });
  await row.getByRole('button').click();
  await page.locator('.editor .status').waitFor();
  await page.waitForTimeout(600);
  const s = await statusText();
  if (!/Facing\s*\d+/.test(s) || /Facing\s*0\b/.test(s)) throw Error('imported design has no facings: ' + s);
});

await step('open the saved project .json (new file, schema 8)', async () => {
  await importVia(/Project Nexus|Nexus project/, jsonPath);
  await page.getByRole('button', { name: /Mở thành dự án|Open as a project/ }).click();
  await page.locator('.editor .status').waitFor();
});

await step('POG PDF import (GO! format, generated PDF) builds a planogram', async () => {
  const gen = await ctx.newPage();
  const rows = [['1/1', '1', 'P1', '8934588013157', 'PEPSI CHAI 300ML', '4', '24'], ['1/1', '2', 'P2', '8934588063053', 'NTK AQUAFINA 500ML', '3', '18'], ['1/2', '1', 'P3', '8934588063145', 'NTK AQUAFINA 355ML', '5', '30'], ['2/1', '1', 'P4', '8934588012228', 'PEPSI LON 320ML', '6', '36']];
  const line = (y, cells) => cells.map(([x, t]) => `<div style="position:absolute;left:${x}px;top:${y}px;white-space:nowrap">${t}</div>`).join('');
  const xs = [40, 110, 200, 290, 420, 640, 720];
  let html = '<html><body style="font:12px Arial;margin:0">' + line(30, [[40, 'POG E2E STORE - PW.plnx']]) + line(55, [[40, 'Product List']]) + line(80, ['Fixel_ID', 'Location_ID', 'Product_ID', 'UPC', 'Name', 'Total_Facings', 'Capacity'].map((t, i) => [xs[i], t]));
  rows.forEach((r, j) => { html += line(105 + j * 20, r.map((t, i) => [xs[i], t])); });
  html += '</body></html>';
  await gen.setContent(html);
  const pdfPath = join(dl, 'go-e2e.pdf');
  await gen.pdf({ path: pdfPath, format: 'A4' });
  await gen.close();
  await importVia(/POG PDF/, pdfPath);
  const info = page.locator('.dialog .dialog-body p').nth(1);
  await info.waitFor({ timeout: 30000 });
  const t = await page.locator('.dialog').innerText();
  if (!/2 bay/.test(t) || !/4 vị trí|4 positions/.test(t)) throw Error('PDF parse summary: ' + t.slice(0, 200));
  await page.screenshot({ path: join(shots, '12-pdf-import.png') });
  await page.getByRole('button', { name: /Dựng planogram|Build planogram/ }).click();
  await page.locator('.editor .status').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const s = await statusText();
  if (!/SKU\s*4\b/.test(s)) throw Error('built planogram: ' + s);
  await page.screenshot({ path: join(shots, '13-pdf-built.png') });
});

await step('Space Share PDF report renders', async () => {
  await page.goto(BASE + '#/share');
  await page.getByRole('button', { name: /Báo cáo PDF|PDF report/ }).click();
  await page.locator('article.doc').waitFor();
  await page.screenshot({ path: join(shots, '14-share-report.png') });
});


await step('master price set in the catalog flows into the build sheet', async () => {
  await page.goto(BASE + '#/catalog');
  await page.getByRole('searchbox').fill('8934588013157');
  await page.waitForTimeout(300);
  await page.locator('table.t tbody tr.clickable').first().click();
  const normal = page.locator('.drawer .field', { hasText: /Giá niêm yết|Normal price/ }).locator('input');
  await normal.fill('12500');
  await page.getByRole('button', { name: /Lưu vào danh mục|Save to catalog/ }).click();
  await page.goto(BASE + '#/sheets');
  await page.locator('table.t tbody tr.clickable', { hasText: /Gondola 120/ }).first().click();
  await page.locator('article.doc').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const t = await page.locator('article.doc').innerText();
  if (!/12\.500/.test(t)) throw Error('price 12.500 not on the sheet');
});

await step('Auto POG: build scenarios A and C from the PDF-built planogram', async () => {
  await page.goto(BASE + '#/auto');
  await page.locator('.field', { hasText: /Planogram kệ nguồn|Source shelf planogram/ }).locator('select').selectOption({ label: 'POG E2E STORE - PW' });
  await page.getByRole('button', { name: /Tạo POG đề xuất|Build proposals/ }).click();
  await page.getByRole('heading', { name: /Kết quả|Results/ }).waitFor({ timeout: 20000 });
  const n = await page.locator('section.section table.t tbody tr').count();
  if (n < 2) throw Error('no scenario rows');
  await page.screenshot({ path: join(shots, '15-auto-pog.png') });
});

await step('pallet display: create, drop a carton, hollow shell (H)', async () => {
  await page.goto(BASE + '#/');
  await page.getByRole('button', { name: /Tạo display|Create display/ }).click();
  await page.locator('.editor .status').waitFor();
  await page.getByRole('searchbox').fill('TH.24 NTL PET PEPSI');
  await page.waitForTimeout(200);
  await page.locator('.lib-card').first().dblclick();
  await page.waitForTimeout(400);
  let s = await statusText();
  if (!/Thùng\s*1\b|Cartons\s*1\b/.test(s)) throw Error('carton not added: ' + s);
  await page.locator('.canvas-well').hover();
  await page.keyboard.press('h');
  await page.getByRole('dialog', { name: /Xếp viền rỗng ruột|Hollow shell/ }).waitFor();
  await page.locator('.dialog .field', { hasText: /Số tầng|Levels/ }).locator('input').fill('4');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, '16-shell-dialog.png') });
  await page.getByRole('button', { name: /^(Áp dụng|Apply)$/ }).click();
  await page.waitForTimeout(500);
  s = await statusText();
  const n = +(/(?:Thùng|Cartons)\s*(\d+)/.exec(s) || [])[1];
  if (!(n > 20)) throw Error('shell not built: ' + s);
  await page.screenshot({ path: join(shots, '17-pallet-shell.png') });
});

await browser.close();
const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed` + (errors.length ? `\n${errors.length} console/page errors:\n  ` + [...new Set(errors)].slice(0, 12).join('\n  ') : '\nno console errors'));
process.exit(fails.length ? 1 : 0);
