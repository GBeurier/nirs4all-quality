// Calibration smoke: opens the demo project, goes to Calibrate, launches the
// checked pipeline matrix, and asserts a real leaderboard renders with several
// variants (PLS on WASM + Ridge/AOM on JS numerics) and a training chart.
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:4399/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('header img[alt="nirs4all"]', { timeout: 15000 });
  await page.locator('button', { hasText: 'Protéines' }).first().click();
  await page.waitForSelector('[data-step-id="calibrate"]', { timeout: 10000 });
  await page.locator('[data-step-id="calibrate"]').click();
  await page.waitForSelector('text=/Lancer la calibration/', { timeout: 10000 });
  console.log('✓ calibrate screen + variant chooser rendered');

  // count ticked variants in the button label, then launch
  await page.getByRole('button', { name: /Lancer la calibration/ }).click();
  // leaderboard appears once runs complete (WASM PLS can take a few seconds)
  await page.waitForSelector('text=/Classement des pipelines/', { timeout: 90000 });
  console.log('✓ leaderboard rendered');

  const rows = await page.locator('table tbody tr').count();
  if (rows >= 4) console.log(`✓ ${rows} pipelines ranked`);
  else fail(`only ${rows} pipelines ranked (expected ≥4)`);

  const body = (await page.textContent('body')) || '';
  // PLS ran (libn4m WASM when the staged methods are compatible, else JS fallback)
  if (/nirs4all-core-wasm|js-pls/.test(body)) console.log('✓ PLS ran (libn4m WASM or JS fallback)'); else fail('no PLS engine ran');
  if (/js-ridge/.test(body)) console.log('✓ Ridge/AOM-Ridge ran'); else fail('no ridge engine label');
  if (/🏆/.test(body)) console.log('✓ best pipeline marked'); else fail('no best marker');

  // a training chart for the selected (best) model
  const charts = await page.locator('svg.recharts-surface').count();
  if (charts >= 1) console.log(`✓ training chart rendered (${charts})`); else fail('no training chart');

  // navigate away (Predict) and back → the leaderboard must be restored
  await page.locator('[data-step-id="predict"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-step-id="calibrate"]').click();
  await page.waitForTimeout(500);
  if (/Classement des pipelines/.test((await page.textContent('body')) || '')) console.log('✓ calibration restored after navigating away and back');
  else fail('calibration was forgotten after navigation');
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ CALIB smoke PASSED' : '\n❌ CALIB smoke FAILED');
  process.exit(code);
}
