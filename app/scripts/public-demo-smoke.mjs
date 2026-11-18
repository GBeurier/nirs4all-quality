// Exercise the public demo's explicit calibration and prediction journey with real owners.
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [], failedRequests = [], serverRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => {
  if (!request.url().includes('fonts.')) failedRequests.push(request.url());
});
page.on('request', request => {
  if (new URL(request.url()).pathname.startsWith('/api/')) serverRequests.push(request.url());
});

try {
  await page.goto(process.env.SMOKE_URL || 'http://localhost:4399/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: /Protéines — farine/ }).click();
  await page.getByRole('heading', { name: 'Explore data', exact: true }).waitFor();
  assert.match(await page.locator('main').innerText(), /42 samples/);
  for (const [step, heading] of [['health', 'Data health'], ['select', 'Choose what to send to HPLC']]) {
    await page.locator(`[data-step-id="${step}"]`).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.ok(await page.locator('main svg.recharts-surface').count() > 0, `${step} charts render`);
  }

  await page.locator('[data-step-id="predict"]').click();
  await page.getByRole('button', { name: 'Calibrate a model', exact: true }).click();
  const launch = page.getByRole('button', { name: /Run calibration/ });
  await launch.click();
  await page.getByText('Profile results', { exact: false }).waitFor({ timeout: 120000 });
  assert.equal(await page.locator('table tbody tr').count(), 4);
  assert.equal(await page.locator('button[aria-pressed="true"]').count(), 0, 'calibration never activates a model implicitly');
  assert.match(await page.locator('main').innerText(), /dag-ml-methods-pls/);
  assert.match(await page.locator('main').innerText(), /dag-ml-methods-ridge/);

  await page.locator('[data-step-id="predict"]').click();
  await page.getByRole('button', { name: 'Choose a calibration profile', exact: true }).click();
  await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).getAttribute('aria-pressed'), 'true');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export model (.n4a)', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.n4a$/);
  assert.ok((await stat(await download.path())).size > 0, 'active owner model exports');
  if (process.env.SMOKE_EXPORT) await writeFile(process.env.SMOKE_EXPORT, await readFile(await download.path()), { flag: 'wx' });

  await page.getByRole('button', { name: 'Activate Ridge + cartesian', exact: true }).click();
  const otherDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export model (.n4a)', exact: true }).click();
  const otherModel = await otherDownloadPromise;
  await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).click();
  await page.getByRole('button', { name: 'Predict with this model', exact: true }).click();
  await page.getByText('16 routine spectra predicted.', { exact: false }).waitFor({ timeout: 30000 });
  assert.match(await page.locator('main').innerText(), /These predictions are unqualified for routine use until independently validated/);
  assert.ok(await page.locator('main svg.recharts-surface').count() >= 2);
  await page.getByRole('button', { name: 'See details', exact: true }).first().click();
  await page.getByText('Distance to domain', { exact: true }).waitFor();

  await page.locator('input[type="file"][accept=".n4a"]').setInputFiles(await otherModel.path());
  await page.getByText('Imported evaluation is declared by the file and has not been independently verified.').waitFor();
  assert.match(await page.locator('main').innerText(), /dag-ml-methods-ridge/);
  await page.locator('[data-step-id="calibrate"]').click();
  assert.equal(await page.locator('button[aria-pressed="true"]').count(), 0, 'an imported model does not activate an older calibration result');
  assert.equal(await page.getByRole('button', { name: 'Predict with this model', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Export model (.n4a)', exact: true }).isEnabled(), true, 'the selected results remain exportable');
  await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Predict with this model', exact: true }).click();
  await page.getByText('16 routine spectra predicted.', { exact: false }).waitFor({ timeout: 30000 });
  assert.match(await page.locator('main').innerText(), /dag-ml-methods-pls/);

  await page.locator('[data-step-id="maintain"]').click();
  await page.getByRole('button', { name: 'Simulate a batch', exact: true }).click();
  await page.getByText('Drift map', { exact: false }).waitFor();
  await page.locator('[data-step-id="calibrate"]').click();
  assert.equal(await page.getByRole('button', { name: 'Activate PLS + cartesian', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(serverRequests, [], 'the local demo makes no server API calls');
  console.log('Public demo passed: exploration, health, HPLC, four owner profiles, explicit activation, model export, prediction and maintenance; no server requests.');
} finally {
  await browser.close();
}
