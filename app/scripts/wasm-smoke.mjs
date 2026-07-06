// Runtime smoke: load the built app in a real browser, open the demo project,
// go to Calibrate, click "Construire le modèle", and assert the REAL libn4m WASM
// engine executed (engine label = nirs4all-core-wasm), not the stub fallback.
// Run: serve `npm run preview`, then `node scripts/wasm-smoke.mjs`.
import { chromium } from 'playwright-core';

const APP_URL = process.env.SMOKE_URL || 'http://localhost:4399/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (m) => {
  const line = `[${m.type()}] ${m.text()}`;
  logs.push(line);
  if (/quali-nirs4all|wasm|n4m|portable|Kennard|libn4m|import/i.test(m.text())) console.log('  ⤷', line);
  if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => { errors.push('PAGEERR: ' + e.message); console.log('  ⤷ PAGEERR:', e.message); });

let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

try {
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('text=quali-nirs4all', { timeout: 10000 });
  console.log('✓ app loaded');

  await page.locator('button', { hasText: 'Protéines' }).first().click();
  await page.waitForSelector('[data-step-id="calibrate"]', { timeout: 10000 });
  console.log('✓ project workflow opened');

  await page.locator('[data-step-id="calibrate"]').click();
  await page.getByRole('button', { name: /Construire le modèle/i }).click();
  console.log('… building (loading libn4m WASM)…');

  await page.waitForSelector('text=/Moteur/', { timeout: 60000 });
  const body = (await page.textContent('body')) || '';
  const m = body.match(/Moteur\s*:?\s*([a-z0-9-]+)/i);
  console.log('engine label:', m ? m[1] : '(unknown)');

  if (/nirs4all-core-wasm/.test(body)) console.log('✓ REAL libn4m WASM executed (nirs4all-core-wasm)');
  else if (/\bstub\b/.test(body)) fail('fell back to STUB — WASM did not execute');
  else fail('no engine label found in the model report');

  if (/RMSEP/i.test(body)) console.log('✓ model report with RMSEP rendered');
  else fail('no RMSEP in the model report');

  if (errors.length) fail('console errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ WASM smoke PASSED' : '\n❌ WASM smoke FAILED');
  process.exit(code);
}
