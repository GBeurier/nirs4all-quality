// Add-y browser smoke on the built app: the source-less demo project, its REAL sample ids, a keyed
// reference file through the actual Add y panel and the real IO WASM. Fresh isolated browser context
// (nothing from a user profile), synthetic public fixture only, no upload, no fit, no calibration run.
//
//   SMOKE_URL=http://127.0.0.1:<port>/ node scripts/addy-smoke.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const URL_IN = process.env.SMOKE_URL;
if (!URL_IN) throw new Error('SMOKE_URL (the served built app) is required.');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let exitCode = 0;
const ok = (message) => console.log(`✓ ${message}`);

/** Real project state through the existing "Export LIMS (CSV)" button: sample ids and reference values. */
async function limsRows() {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export LIMS (CSV)' }).click()]);
  const text = await readFile(await download.path(), 'utf8');
  assert.ok(!text.includes('"'), 'unexpected quoted CSV cells in the LIMS export');
  const [header, ...lines] = text.trim().split('\n').map((line) => line.split(','));
  const idAt = header.indexOf('sample_id'), refAt = header.indexOf('reference_value');
  assert.ok(idAt >= 0 && refAt >= 0, 'LIMS export columns');
  return lines.map((cells) => ({ id: cells[idAt], reference: cells[refAt] }));
}
const withReference = async () => Number((await page.getByText(/\d+ with a reference/).first().innerText()).match(/(\d+) with a reference/)[1]);

/** Answer only what IO cannot decide (header / delimiter), until the explicit column choices are offered. */
async function settleReader(panel) {
  const idColumn = panel.getByLabel('Sample-ID column');
  const headerYes = panel.getByRole('radio', { name: 'Yes' });
  const comma = panel.getByRole('radio', { name: '","' });
  for (;;) {
    await idColumn.or(headerYes).or(comma).first().waitFor();
    if (await idColumn.isVisible()) return;
    if (await headerYes.isVisible()) await headerYes.check();
    else await comma.check();
  }
}

async function previewFile(text) {
  await page.getByRole('button', { name: /Add y/ }).click();
  const panel = page.getByRole('region', { name: 'Add reference values y' });
  await panel.getByLabel('Reference file').setInputFiles({ name: 'y_refs.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await settleReader(panel);
  await panel.getByLabel('Sample-ID column').selectOption('sample_id');
  await panel.getByLabel('Reference value column').selectOption('reference');
  await panel.getByRole('button', { name: 'Preview', exact: true }).click();
  const status = panel.getByTestId('reference-preview').getByRole('status');
  await status.waitFor();
  return { panel, status };
}

try {
  await page.goto(URL_IN, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: /manioc|cassava/i }).first().click();
  const total = Number((await page.getByText(/\d+ samples/).first().innerText()).match(/(\d+) samples/)[1]);
  const before = await limsRows();
  assert.equal(before.length, total);
  const labelled = before.filter((row) => row.reference !== '');
  const unlabelled = before.filter((row) => row.reference === '');
  assert.ok(labelled.length >= 3 && unlabelled.length >= 1, 'the demo project needs labelled and unlabelled samples');
  const [changed, unchanged, missing] = labelled;
  const fresh = unlabelled[0];
  const newValue = String(Math.round((Number(changed.reference) + 1) * 10) / 10);
  assert.notEqual(Number(newValue), Number(changed.reference));
  const startRefs = await withReference();
  assert.equal(startRefs, labelled.length);
  ok(`source-less demo project: ${total} real sample ids, ${startRefs} with a reference`);

  // keyed file in an order unrelated to the project: change one, add one, keep one equal, leave one empty, one unknown id
  const file = ['sample_id,reference', `${fresh.id},12.5`, `${missing.id},`, `${changed.id},${newValue}`, `${unchanged.id},${unchanged.reference}`, 'UNKNOWN-ID-1,9.9', ''].join('\n');
  const first = await previewFile(file);
  const text = await first.status.innerText();
  const absent = total - 4;
  assert.match(text, new RegExp(`1 set · 1 changed · 1 unchanged · 1 invalid — existing kept · 1 unknown id\\(s\\) · ${absent} sample\\(s\\) not in the file`));
  const table = await first.panel.getByRole('region', { name: /Changed values/ }).innerText();
  for (const expected of [changed.id, changed.reference, newValue, fresh.id, '12.5']) assert.ok(table.includes(expected), `changed-values table lists ${expected}`);
  assert.ok(!table.includes(missing.id) && !table.includes(unchanged.id), 'missing and unchanged rows are not listed as changes');
  assert.ok((await first.panel.innerText()).includes('UNKNOWN-ID-1'), 'the unknown id is reported');
  assert.equal(await withReference(), startRefs, 'nothing is applied before confirmation');
  ok('preview: counts, changed values, unknown id, missing value kept — nothing applied yet');

  await first.panel.getByRole('button', { name: 'Confirm and apply' }).click();
  await page.getByText(/1 reference\(s\) added, 1 changed/).waitFor();
  await page.getByText(new RegExp(`${startRefs + 1} with a reference`)).first().waitFor();
  const after = await limsRows();
  const expectedRef = (row) => row.id === changed.id ? newValue : row.id === fresh.id ? '12.5' : row.reference;
  assert.deepEqual(after.map((row) => [row.id, Number(row.reference === '' ? NaN : row.reference)]),
    before.map((row) => [row.id, Number(expectedRef(row) === '' ? NaN : expectedRef(row))]));
  ok(`applied by id: ${startRefs + 1} with a reference; the empty row kept ${missing.id}'s existing value`);

  // the same file again is a no-op: nothing to confirm
  const again = await previewFile(file);
  assert.match(await again.status.innerText(), new RegExp(`0 set · 0 changed · 3 unchanged · 1 invalid — existing kept · 1 unknown id\\(s\\) · ${absent} sample\\(s\\) not in the file`));
  assert.ok(await again.panel.getByRole('button', { name: 'Confirm and apply' }).isDisabled(), 'no-op preview cannot be confirmed');
  await again.panel.getByText('No reference change.').waitFor();
  await again.panel.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('region', { name: 'Add reference values y' }).waitFor({ state: 'detached' });
  assert.equal(await withReference(), startRefs + 1);
  ok('no-op preview: counts shown, confirmation disabled, cancel leaves the project unchanged');
  assert.deepEqual(pageErrors, [], 'no page errors');
} catch (error) {
  exitCode = 1;
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await context.close();
  await browser.close();
  console.log(exitCode === 0 ? '\nADD-Y smoke PASSED' : '\nADD-Y smoke FAILED');
  process.exit(exitCode);
}
