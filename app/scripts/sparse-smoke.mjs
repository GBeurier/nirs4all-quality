// Sparse-dataset smoke (the OSSL failure mode): an X file with a wavelength
// header where most rows are empty `;;;` (samples without a spectrum), a per-ROW
// y aligned to the original rows, and a metadata file. The empty rows must be
// skipped, only real spectra kept, y aligned by original index, and the explorer
// PCA must render real points (not the "1 point / 0%" bug).
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:4721/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

// 24 rows: every 4th row is a real spectrum (6 total), the rest are empty `;;;`
const N = 24;
const real = (i) => `${(0.2 + i * 0.03).toFixed(3)};${(0.5 - i * 0.02).toFixed(3)};${(0.3 + (i % 3) * 0.05).toFixed(3)};${(0.4 + i * 0.01).toFixed(3)}`;
const X = ['600;602;604;606', ...Array.from({ length: N }, (_, i) => (i % 4 === 0 ? real(i) : ';;;'))].join('\n');
const Y = ['caco3', ...Array.from({ length: N }, (_, i) => (2 + i * 0.4).toFixed(2))].join('\n'); // per-ROW
const M = ['id;site', ...Array.from({ length: N }, (_, i) => `H${1000 + i};s${(i % 2) + 1}`)].join('\n');

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('header img[alt="nirs4all"]', { timeout: 15000 });
  await page.getByRole('button', { name: /Nouveau projet|New project/ }).click();
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 8000 });
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'X.csv', mimeType: 'text/csv', buffer: Buffer.from(X) },
    { name: 'Y.csv', mimeType: 'text/csv', buffer: Buffer.from(Y) },
    { name: 'M.csv', mimeType: 'text/csv', buffer: Buffer.from(M) },
  ]);
  await page.waitForSelector('text=/avec cible|with target/', { timeout: 8000 });
  const body = (await page.textContent('body')) || '';
  if (/6\s+spectres|6\s+spectra/.test(body)) console.log('✓ empty rows skipped → 6 real spectra (of 24)'); else fail('empty rows not skipped');
  if (/6\s+avec cible|6\s+with target/.test(body)) console.log('✓ per-row y aligned to kept rows (6 with target)'); else fail('per-row y not aligned to skipped rows');

  await page.getByRole('button', { name: /Créer le projet|Create project/ }).click();
  await page.waitForSelector('[data-step-id="explore"]', { timeout: 10000 });
  await page.locator('button', { hasText: 'PCA' }).first().click();
  await page.waitForTimeout(600);
  const pts = await page.locator('svg.recharts-surface .recharts-scatter-symbol').count();
  if (pts >= 3) console.log(`✓ explorer PCA renders real points (${pts}, not 1)`); else fail(`PCA shows ${pts} points (the empty-row bug)`);
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ SPARSE smoke PASSED' : '\n❌ SPARSE smoke FAILED');
  process.exit(code);
}
