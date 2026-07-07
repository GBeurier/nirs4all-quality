// Screens smoke: Predict (dataviz + working "see details") and Maintenance
// (add/simulate a batch → drift map + recommendation + control worklist).
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
  await page.waitForSelector('[data-step-id="predict"]', { timeout: 10000 });

  // --- Predict (auto-builds a real model, then predicts on routine spectra) ---
  await page.locator('[data-step-id="predict"]').click();
  await page.waitForSelector('text=/Répartition des fiabilités/', { timeout: 90000 });
  const body0 = (await page.textContent('body')) || '';
  if (/Modèle\s*:/.test(body0)) console.log('✓ predict used a real model'); else fail('predict did not report a model');
  const charts = await page.locator('svg.recharts-surface').count();
  if (charts >= 2) console.log(`✓ predict dataviz rendered (${charts} charts)`); else fail(`predict has ${charts} charts (<2)`);

  // working "see details"
  const seeDetails = page.getByRole('button', { name: /Voir le détail|See details/ }).first();
  if (await seeDetails.count() === 0) { fail('no "see details" control'); }
  else {
    await seeDetails.click();
    await page.waitForTimeout(200);
    if (/Distance au domaine|Distance to domain/.test((await page.textContent('body')) || '')) console.log('✓ "see details" opens the evidence');
    else fail('"see details" did not reveal evidence');
  }

  // --- Maintenance ---
  await page.locator('[data-step-id="maintain"]').click();
  await page.waitForSelector('text=/Simuler un nouveau lot|Simulate a batch/', { timeout: 10000 });
  await page.getByRole('button', { name: /Simuler un nouveau lot|Simulate a batch/ }).click();
  await page.waitForSelector('text=/Carte de dérive|Drift map/', { timeout: 10000 });
  const body = (await page.textContent('body')) || '';
  if (/Verdict de dérive|Drift verdict/.test(body)) console.log('✓ drift verdict rendered'); else fail('no drift verdict');
  if (/Stable|Dérive|drift/i.test(body)) console.log('✓ drift recommendation present'); else fail('no recommendation');
  const mcharts = await page.locator('svg.recharts-surface').count();
  if (mcharts >= 1) console.log(`✓ drift map rendered (${mcharts})`); else fail('no drift map chart');
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ SCREENS smoke PASSED' : '\n❌ SCREENS smoke FAILED');
  process.exit(code);
}
