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
  if (/quali[·-]nirs4all|wasm|n4m|portable|Kennard|libn4m|import/i.test(m.text())) console.log('  ⤷', line);
  if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => { errors.push('PAGEERR: ' + e.message); console.log('  ⤷ PAGEERR:', e.message); });

let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

try {
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
  await page.getByText(/quali[·-]nirs4all/i).first().waitFor({ timeout: 10000 });
  console.log('✓ app loaded');

  await page.locator('button', { hasText: 'Protéines' }).first().click();
  await page.waitForSelector('[data-step-id="calibrate"]', { timeout: 10000 });
  console.log('✓ project workflow opened');

  await page.locator('[data-step-id="calibrate"]').click();
  const variants = page.locator('input[type="checkbox"]');
  const variantCount = await variants.count();
  for (let i = 1; i < variantCount; i += 1) {
    if (await variants.nth(i).isChecked()) await variants.nth(i).click();
  }
  await page.getByRole('button', { name: /Construire le modèle|Lancer la calibration|Run calibration/i }).click();
  console.log('… building (loading libn4m WASM)…');

  await page.waitForFunction(() => document.body.innerText.includes('nirs4all-core-wasm'), null, { timeout: 90000 });
  const body = (await page.textContent('body')) || '';
  const m = body.match(/Moteur\s*:?\s*([a-z0-9-]+)/i);
  console.log('engine label:', m ? m[1] : 'nirs4all-core-wasm');

  if (/nirs4all-core-wasm/.test(body)) console.log('✓ REAL libn4m WASM executed (nirs4all-core-wasm)');
  else if (/\bstub\b/.test(body)) fail('fell back to STUB — WASM did not execute');
  else fail('no engine label found in the model report');

  if (/RMSE/.test(body) && /Selection validation/.test(body) && /independent prediction error has not been measured/i.test(body)) {
    console.log('✓ selection RMSE and evaluation context rendered');
  } else fail('selection score context missing from the model report');
  if (/frozen.test|test gelé|RMSEP/i.test(body)) fail('misleading independent-test label in calibration results');

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Exporter le modèle|Export model/ }).click();
  const exported = await pendingDownload;
  if (process.env.SMOKE_EXPORT) await exported.saveAs(process.env.SMOKE_EXPORT);
  const stream = await exported.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (bundle.evaluation?.scope !== 'selection_validation' || bundle.evaluation?.independent_test !== false
      || !bundle.leaderboard?.every((row) => row.evaluation?.scope === 'selection_validation' && row.evaluation?.independent_test === false)) {
    fail('export lost selection evaluation metadata');
  } else console.log('✓ model export retains evaluation context');

  await page.locator('[data-step-id="predict"]').click();
  await page.getByText('These predictions are unqualified for routine use until independently validated.', { exact: false }).waitFor({ timeout: 30000 });
  const routineText = await page.locator('main').innerText();
  if (!/Heuristic ±/.test(routineText) || /\bReliable\b|All predictions are reliable|Toutes les prédictions sont fiables|\bsafe\b/i.test(routineText)) {
    fail('routine predictions still imply independent reliability');
  } else console.log('✓ selection-only routine predictions are unqualified and bands are heuristic');

  const declaredBundle = { ...bundle, evaluation: { scope: 'independent_test', independent_test: true }, evaluationDeclaredOnly: false };
  await page.locator('input[type="file"][accept=".json,.n4a"]').setInputFiles({
    name: 'declared-independent.n4a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(declaredBundle)),
  });
  await page.getByText('Imported evaluation is declared by the file and has not been independently verified.').waitFor();
  const importedText = await page.locator('main').innerText();
  if (/\bReliable\b|All predictions are reliable|Toutes les prédictions sont fiables|\bsafe\b/i.test(importedText)) {
    fail('unverified imported evaluation granted routine qualification');
  } else console.log('✓ imported independent-test claims remain unqualified');

  const refusalContext = await browser.newContext();
  const refusalPage = await refusalContext.newPage();
  await refusalPage.route('**/assets/wasmEngine-*.js', (route) => route.abort());
  await refusalPage.goto(APP_URL, { waitUntil: 'load' });
  await refusalPage.locator('button', { hasText: 'Protéines' }).first().click();
  await refusalPage.locator('[data-step-id="calibrate"]').click();
  await refusalPage.getByRole('button', { name: /Lancer la calibration|Run calibration/i }).click();
  await refusalPage.getByRole('alert').filter({ hasText: 'WASM engine unavailable' }).waitFor({ timeout: 30000 });
  console.log('✓ unavailable engines produce a visible pipeline failure');
  await refusalContext.close();

  if (errors.length) fail('console errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  const body = (await page.textContent('body').catch(() => '')) || '';
  if (body) console.error('page text:\n' + body.slice(0, 2500) + '\n…\n' + body.slice(-2000));
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ WASM smoke PASSED' : '\n❌ WASM smoke FAILED');
  process.exit(code);
}
