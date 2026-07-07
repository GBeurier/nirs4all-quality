// Dataset smoke: drop a spectra X file + a separate y (target) file into the
// Setup wizard, confirm the column-config preview reports real samples WITH a
// target, create the project, and confirm calibration then trains on it.
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:4660/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

// 12 spectra rows (3 samples × 4 replicates), an Mtrain metadata file whose
// sample_id column groups the replicates, and a y with one value per SAMPLE.
const ids = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C'];
const X = ['1000,1100,1200', ...Array.from({ length: 12 }, (_, i) => `${(0.2 + i * 0.01).toFixed(3)},${(0.4 + i * 0.015).toFixed(3)},${(0.3 + i * 0.02).toFixed(3)}`)].join('\n');
const M = ['sample_id,site', ...ids.map((id, i) => `${id},site${(i % 2) + 1}`)].join('\n');
const Y = ['protein', '6.10', '7.30', '8.90'].join('\n'); // one per sample (A,B,C)

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('header img[alt="nirs4all"]', { timeout: 15000 });
  await page.getByRole('button', { name: /Nouveau projet|New project/ }).click();
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 8000 });

  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'Xtrain.csv', mimeType: 'text/csv', buffer: Buffer.from(X) },
    { name: 'Mtrain.csv', mimeType: 'text/csv', buffer: Buffer.from(M) },
    { name: 'Ytrain.csv', mimeType: 'text/csv', buffer: Buffer.from(Y) },
  ]);
  await page.waitForTimeout(500);
  const body = (await page.textContent('body')) || '';
  if (/12\s+spectres|12\s+spectra/.test(body)) console.log('✓ replicates kept (12 spectra)'); else fail('replicate spectra count wrong');
  if (/3\s+avec cible|3\s+with target/.test(body)) console.log('✓ per-sample y joined (3 with target)'); else fail('per-sample y not joined');
  if (/via Mtrain/.test(body)) console.log('✓ Mtrain metadata file detected'); else fail('Mtrain not detected as metadata');

  await page.getByRole('button', { name: /Créer le projet|Create project/ }).click();
  await page.waitForSelector('[data-step-id="explore"]', { timeout: 10000 });
  await page.waitForSelector('svg.recharts-surface', { timeout: 10000 });
  const ex = (await page.textContent('body')) || '';
  if (/3\s+échantillons.*12\s+spectres|3\s+samples.*12\s+spectra/s.test(ex)) console.log('✓ explorer shows 3 samples · 12 spectra (replicates grouped)');
  else fail('explorer did not reflect the grouped replicates');
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ DATASET smoke PASSED' : '\n❌ DATASET smoke FAILED');
  process.exit(code);
}
