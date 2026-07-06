// Smoke for the 4-points features: EN/FR toggle, CSV ingestion, and CSV export.
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:4399/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('text=quali-nirs4all', { timeout: 15000 });

  // (1) EN toggle
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(300);
  if (/Your projects/.test((await page.textContent('body')) || '')) console.log('✓ EN toggle → "Your projects"');
  else fail('EN toggle did not switch to English');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.waitForTimeout(200);

  // (2) CSV ingestion via a new project
  await page.getByRole('button', { name: /Nouveau projet|New project/ }).click();
  await page.waitForSelector('input[type=file]', { timeout: 8000 });
  const csv = ['1000,1100,1200,1300,1400', ...Array.from({ length: 8 }, (_, i) => `0.3,0.4,${(0.5 + i * 0.02).toFixed(3)},0.4,0.3`)].join('\n');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'spectra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForTimeout(400);
  if (/8 spectres|8 spectra/.test((await page.textContent('body')) || '')) console.log('✓ CSV ingestion preview (8 spectra)');
  else fail('ingestion preview not shown');
  await page.getByRole('button', { name: /Créer le projet|Create project/ }).click();
  await page.waitForSelector('[data-step-id="explore"]', { timeout: 10000 });
  await page.waitForSelector('svg.recharts-surface', { timeout: 10000 });
  console.log('✓ ingested project opens with a chart');

  // (3) Export a CSV (LIMS) — capture the download
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.getByRole('button', { name: /Export LIMS/ }).click(),
  ]);
  const fn = dl.suggestedFilename();
  if (/\.csv$/.test(fn)) console.log(`✓ CSV export downloaded (${fn})`);
  else fail(`unexpected export filename: ${fn}`);
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ FEATURES smoke PASSED' : '\n❌ FEATURES smoke FAILED');
  process.exit(code);
}
