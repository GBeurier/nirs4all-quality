import { chromium } from 'playwright-core';
const URL = process.env.SMOKE_URL || 'http://localhost:4730/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const ctx = await b.newContext();
const p = await ctx.newPage();
let code = 0; const fail = (m) => { console.error('✗ ' + m); code = 1; };
const csv = ['1000,1100,1200,1300', ...Array.from({ length: 10 }, (_, i) => `0.3,0.4,${(0.5 + i * 0.02).toFixed(3)},0.4`)].join('\n');
try {
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForSelector('header img[alt="nirs4all"]');
  await p.getByRole('button', { name: /Nouveau projet|New project/ }).click();
  await p.waitForSelector('input.input');
  await p.locator('input.input').first().fill('PERSIST-TEST-XYZ');
  await p.waitForSelector('input[type=file]', { state: 'attached' });
  await p.locator('input[type=file]').first().setInputFiles({ name: 'spectra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Créer le projet|Create project/ }).click();
  await p.waitForSelector('[data-step-id="explore"]');
  await p.waitForTimeout(1500); // let the debounced save flush
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('header img[alt="nirs4all"]');
  await p.locator('header button').first().click(); // back to projects
  await p.waitForTimeout(400);
  const body = (await p.textContent('body')) || '';
  if (/PERSIST-TEST-XYZ/.test(body)) console.log('✓ created project persists over reload');
  else fail('created project LOST after reload');
} catch (e) { fail('exception: ' + (e instanceof Error ? e.message : String(e))); }
finally { await b.close(); console.log(code === 0 ? '\n✅ PERSIST smoke PASSED' : '\n❌ PERSIST smoke FAILED'); process.exit(code); }
