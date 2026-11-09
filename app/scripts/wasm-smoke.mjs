// Browser replay smoke over an already-produced Quali owner container. No fit.
// Root first supplies SMOKE_MODEL from the pooled owner gate; real Core storage
// inventories and repackages it here. No container or execution stub is used.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const { openN4aContainer, writeN4aContainer } = await import(pathToFileURL(resolve(root, 'vendor/owners-current/core/src/n4a.js')));
assert.ok(process.env.SMOKE_MODEL, 'SMOKE_MODEL must be an already-produced qualified owner container; this smoke never trains');
const original = new Uint8Array(await readFile(process.env.SMOKE_MODEL));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(original);
const opened = await openN4aContainer(original);
let bundle, manifest;
try {
  manifest = opened.view().readability.manifest;
  assert.equal(manifest.artifacts[0].owner, 'nirs4all.quali-host');
  bundle = JSON.parse(new TextDecoder().decode(await opened.readMember('host/bundle.json')));
} finally { opened.close(); }
assert.ok(['dag-ml-methods-pls', 'dag-ml-methods-ridge'].includes(bundle.model.state.backendId));
const exactPackage = bundle.model.state.packageJson;
assert.equal(typeof exactPackage, 'string');
assert.equal(bundle.evaluation.scope, 'selection_validation');
assert.equal(bundle.evaluation.independent_test, false);
assert.ok(bundle.leaderboard.every(row => row.population && row.evaluation.scope === 'selection_validation' && !row.evaluation.independent_test));

async function repack(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)), fingerprint = hash(bytes);
  const nextManifest = structuredClone(manifest);
  nextManifest.artifacts[0].identity.fingerprint = fingerprint;
  const written = await writeN4aContainer(nextManifest, [{ path: 'host/bundle.json', bytes }]);
  assert.equal(written.receipt.members[0].sha256, fingerprint);
  return written.archiveBytes;
}
const copy = await repack(bundle);
const verify = await openN4aContainer(copy);
try { assert.equal(JSON.parse(new TextDecoder().decode(await verify.readMember('host/bundle.json'))).model.state.packageJson, exactPackage); }
finally { verify.close(); }
if (process.env.SMOKE_EXPORT) {
  assert.notEqual(resolve(process.env.SMOKE_EXPORT), resolve(process.env.SMOKE_MODEL), 'export never overwrites the original');
  await writeFile(process.env.SMOKE_EXPORT, copy, { flag: 'wx' });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const APP_URL = process.env.SMOKE_URL || 'http://localhost:4399/';
async function openPredict(target) {
  await target.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
  await target.locator('button', { hasText: /Protéines|Proteins/ }).first().click();
  await target.locator('[data-step-id="predict"]').click();
}
async function importBytes(target, bytes, name = 'qualified-model.n4a') {
  await target.locator('input[type="file"][accept=".n4a"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}
try {
  await openPredict(page);
  await page.getByText('Choose a completed calibration profile explicitly, or import a qualified Quali host model.').waitFor();
  await importBytes(page, copy);
  await page.getByText('These predictions are unqualified for routine use until independently validated.', { exact: false }).waitFor({ timeout: 90000 });
  const body = await page.locator('main').innerText();
  assert.ok(body.includes(bundle.model.state.backendId), 'actual owner engine label');
  assert.match(body, /Selection validation/);
  assert.match(body, /Heuristic ±/);
  assert.doesNotMatch(body, /\bReliable\b|All predictions are reliable|Toutes les prédictions sont fiables|\bsafe\b/);
  console.log('Actual owner replay renders selection context and unqualified heuristic intervals.');
  const declared = { ...bundle, evaluation: { scope: 'independent_test', independent_test: true }, evaluationDeclaredOnly: false };
  await importBytes(page, await repack(declared), 'declared-independent.n4a');
  await page.getByText('Imported evaluation is declared by the file and has not been independently verified.').waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /\bReliable\b|All predictions are reliable|Toutes les prédictions sont fiables|\bsafe\b/);
  // File names grant no admission. Bare JSON is refused without rewriting it.
  await importBytes(page, new TextEncoder().encode(JSON.stringify(bundle)), 'renamed-legacy.n4a');
  await page.getByText(/Legacy raw JSON.*originals are unchanged/).waitFor();
  const refusalContext = await browser.newContext();
  try {
    const refusalPage = await refusalContext.newPage();
    await refusalPage.route('**/*dag_ml_wasm*', route => route.abort());
    await openPredict(refusalPage);
    await importBytes(refusalPage, copy);
    await refusalPage.getByText(/Quali imports only its qualified Core V1 host container/).waitFor({ timeout: 30000 });
  } finally { await refusalContext.close(); }
  assert.equal(hash(original), originalHash, 'the source container is unchanged');
  assert.deepEqual(errors, []);
  console.log('WASM replay/container smoke passed; no training was requested.');
} finally { await browser.close(); }
