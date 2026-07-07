// Render smoke (works for served http OR a file:// single-file bundle): loads
// the app, opens the demo project, visits the data explorer, and asserts the
// shell + a recharts chart render with no fatal console errors. Does NOT require
// the WASM engine (so it validates the offline single-file too).
import { chromium } from 'playwright-core';

const URL = process.env.SMOKE_URL || 'http://localhost:4399/';
const EXE = process.env.CHROME || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|wasm|n4m|WebAssembly/i.test(m.text())) errors.push(m.text()); });

let code = 0;
const fail = (m) => { console.error('✗ ' + m); code = 1; };

try {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('header img[alt="nirs4all"]', { timeout: 15000 });
  console.log('✓ app shell rendered (brand icon)');

  // the drag-and-drop quick-start dropzone is on the projects window
  if (/Déposez X|Drop X/i.test((await page.textContent('body')) || '')) console.log('✓ drag-and-drop dropzone present');
  else fail('project dropzone not rendered');

  await page.locator('button', { hasText: 'Protéines' }).first().click();
  await page.waitForSelector('[data-step-id="explore"]', { timeout: 10000 });
  console.log('✓ project opened on the data explorer');

  // a recharts chart (spectra) should render
  await page.waitForSelector('svg.recharts-surface', { timeout: 15000 });
  const charts = await page.locator('svg.recharts-surface').count();
  if (charts < 1) fail('no recharts chart rendered'); else console.log(`✓ ${charts} chart(s) rendered`);

  // the replicate explorer tab — and assert the chart is MEANINGFUL (the demo
  // now has ≥3 replicates with real spread + clearly-divergent reps above P95)
  await page.locator('button', { hasText: 'Répétitions' }).first().click();
  await page.waitForTimeout(500);
  const body = (await page.textContent('body')) || '';
  if (/répétitions|P95|Distance/i.test(body)) console.log('✓ replicate explorer rendered');
  else fail('replicate explorer did not render');
  const suspects = Number((body.match(/(\d+)\s+répétitions suspectes/) || [])[1] || '0');
  if (suspects > 0) console.log(`✓ replicate chart is meaningful (${suspects} suspect replicates > P95)`);
  else fail('replicate chart shows no suspect replicates — demo data still degenerate');

  // a "?" explanation opens
  await page.locator('[aria-label^="Expliquer"]').first().click();
  await page.waitForTimeout(200);
  if (/Ce qui a été fait/i.test((await page.textContent('body')) || '')) console.log('✓ "?" explanation opens');
  else fail('explanation panel did not open');

  if (errors.length) fail('console errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  fail('exception: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  console.log(code === 0 ? '\n✅ RENDER smoke PASSED' : '\n❌ RENDER smoke FAILED');
  process.exit(code);
}
