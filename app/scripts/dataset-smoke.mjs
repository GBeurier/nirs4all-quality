// Root's deferred browser import/preview gate; uses Root's existing server.
// Supported records enable Create; delivery qualification stays outside the product.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const fixture = JSON.parse(await readFile(new URL('../../../_implementation/2026-11-03-ecosystem-consolidation/phase5-joint-ui-preparation-20261107/QUALI_OWNER_CASE.json', import.meta.url), 'utf8'));
const originalSpec = structuredClone(fixture.spec);
originalSpec.sources[2] = fixture.original_three_file_refusal.target_source_replacement;
const url = process.env.SMOKE_URL || 'http://localhost:4660/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();

async function openSetup() {
  await page.waitForSelector('header img[alt="nirs4all"]');
  await page.getByRole('button', { name: /Nouveau projet|New project/ }).click();
  await page.getByTestId('quali-setup-import').waitFor();
}
async function settled() {
  await page.locator('[data-testid="io-import-review"][aria-busy="false"]').waitFor({ timeout: 30000 });
}
async function persistedState() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('quali-nirs4all', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('state', 'readonly').objectStore('state').get('current');
      get.onsuccess = () => {
        // Test transport only: Playwright receives plain arrays, retaining NaN.
        // The IndexedDB record itself keeps its original typed arrays.
        const view = (value) => {
          if (ArrayBuffer.isView(value)) return Array.from(value);
          if (Array.isArray(value)) return value.map(view);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, cell]) => [key, view(cell)]));
          return value;
        };
        resolve(view(get.result)); db.close();
      };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  }));
}
async function draft() { return (await persistedState())?.setupImportDraft ?? null; }
async function waitForPersist(predicate) {
  // Existing store persistence debounces for 400ms. Poll the observable state.
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await draft();
    if (predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error('Expected Setup draft was not persisted.');
}
async function waitForState(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await persistedState();
    if (value && predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error('Expected lab state was not persisted.');
}

// Only the keyed amendment needed by these retention/NA cases is repeated here.
// The broader Add y interaction campaign stays in the SDK-owned addy-smoke.mjs.
async function applyKeyedReferences(text, expectedCounts) {
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Add y', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Add reference values y', exact: true });
  await panel.getByLabel('Reference file').setInputFiles({ name: 'later-reference.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  const idColumn = panel.getByLabel('Sample-ID column');
  const headerYes = panel.getByRole('radio', { name: 'Yes', exact: true });
  const comma = panel.getByRole('radio', { name: '","', exact: true });
  for (;;) {
    await idColumn.or(headerYes).or(comma).first().waitFor();
    if (await idColumn.isVisible()) break;
    if (await headerYes.isVisible()) await headerYes.check();
    else await comma.check();
  }
  await idColumn.selectOption('sample_id');
  await panel.getByLabel('Reference value column').selectOption('protein');
  await panel.getByRole('button', { name: 'Preview', exact: true }).click();
  const status = panel.getByTestId('reference-preview').getByRole('status');
  await status.waitFor();
  assert.match(await status.innerText(), expectedCounts);
  await panel.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
}

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('header img[alt="nirs4all"]');
  await page.locator('input[type=file]').first().waitFor({ state: 'attached' });
  // The quick-start route hands off to the actual Setup draft and IO worker.
  const quickText = 'sample_id,protein,1000,1100,1200\nquick-a,2,1,2,3\nquick-b,3,2,3,4\nquick-c,4,3,5,6\nquick-d,5,4,6,9\nquick-e,6,5,10,12\nquick-f,7,6,9,8';
  const quickFile = { name: 'Quick-start.csv', mimeType: 'text/csv', buffer: Buffer.from(quickText) };
  const quickSpec = {
    schema_version: 1, task_type: 'regression', sample_index: { by: 'id', key: 'sample_id' },
    params: { delimiter: ',', has_header: true, na: { policy: 'ignore' } },
    sources: [{ id: 'observations', input: quickFile.name, role: 'mixed', params: { header_unit: 'nm' },
      columns: [{ role: 'features', select: ['1000', '1100', '1200'] }, { role: 'targets', select: ['protein'] },
        { role: 'metadata', select: ['sample_id'] }] }],
  };
  const initialState = await waitForState((state) => Array.isArray(state.projects));
  await page.locator('input[type=file]').first().setInputFiles(quickFile);
  await page.getByTestId('quali-setup-import').waitFor();
  await settled();
  const quickDraft = await waitForPersist((saved) => saved?.record.files[0]?.name === quickFile.name);
  assert.equal((await persistedState()).projects.length, initialState.projects.length, 'quick drop does not create a project');
  assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), 'Quick-start');
  assert.deepEqual(quickDraft.record.files[0].bytes, [...quickFile.buffer]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await waitForPersist((saved) => saved === null);
  assert.equal((await persistedState()).projects.length, initialState.projects.length);
  await page.locator('input[type=file]').first().setInputFiles(quickFile);
  await page.getByTestId('quali-setup-import').waitFor();
  await settled();
  await page.getByText('Review IO specification and column roles', { exact: true }).click();
  await page.getByTestId('io-spec-json').fill(JSON.stringify(quickSpec));
  await settled();
  await page.getByLabel('Project name', { exact: true }).fill('Quick-start reviewed');
  const configured = await waitForPersist((saved) => saved?.name === 'Quick-start reviewed' && saved.record.status === 'ready');
  await page.getByTestId('io-create-project').click();
  await page.waitForSelector('[data-step-id="explore"]');
  const quickCreated = await waitForState((state) => Object.hasOwn(state.importsByProject, configured.projectId));
  assert.equal(quickCreated.projects.find((project) => project.id === configured.projectId).name, 'Quick-start reviewed');
  assert.equal(quickCreated.samplesByProject[configured.projectId].length, 6);

  // Predict and Maintenance expose the same real IO review; no model fit.
  await page.locator('[data-step-id="predict"]').click();
  const predictZone = page.getByTestId('quali-predict-import');
  const routineFile = { name: 'external-browser.csv', mimeType: 'text/csv',
    buffer: Buffer.from('sample_id,protein,1000,1100,1200\nquick-a,20,1,2,3\nquick-a,20,3,4,5\nexternal-missing,,4,5,6') };
  await predictZone.locator('input[type=file]').setInputFiles(routineFile);
  await settled();
  await page.getByText('Review IO specification and column roles', { exact: true }).click();
  const routineSpec = structuredClone(quickSpec);
  routineSpec.repetition = 'sample_id'; routineSpec.sources[0].input = routineFile.name;
  await page.getByTestId('io-spec-json').fill(JSON.stringify(routineSpec));
  await settled();
  await page.getByText('2 samples · 3 spectra · target protein. No observation identity is invented.', { exact: true }).waitFor();
  assert.ok((await page.getByTestId('io-preview-values').textContent()).includes('20'));
  await page.getByRole('button', { name: /back to project samples|revenir aux échantillons du projet/ }).click();
  assert.equal(await page.getByTestId('io-import-review').count(), 0);

  await page.locator('[data-step-id="maintain"]').click();
  const maintenanceZone = page.getByTestId('quali-maintenance-import');
  const monitorFile = { name: 'monitor-browser.csv', mimeType: 'text/csv',
    buffer: Buffer.from('sample_id,protein,1000,1100,1200\nS02,2,1000,2000,3000\nS7,7,2,3,4\nS02,2,1002,2002,3002\nS10,10,1500,2500,3500') };
  await maintenanceZone.locator('input[type=file]').setInputFiles(monitorFile);
  await settled();
  await page.getByText('Review IO specification and column roles', { exact: true }).click();
  const monitorSpec = structuredClone(routineSpec); monitorSpec.sources[0].input = monitorFile.name;
  await page.getByTestId('io-spec-json').fill(JSON.stringify(monitorSpec));
  await settled();
  const control = page.getByTestId('maintenance-control-worklist');
  await control.waitFor();
  const controlText = await control.locator('table').textContent();
  assert.ok(controlText.includes('S02') && controlText.includes('S10'));
  assert.ok(!controlText.includes('N-1000'));
  const downloadPromise = page.waitForEvent('download');
  await control.getByRole('button', { name: /Exporter CSV|Export CSV/ }).click();
  const controlCsv = await readFile(await (await downloadPromise).path(), 'utf8');
  assert.ok(controlCsv.includes('S02') && controlCsv.includes('S10'));
  await maintenanceZone.locator('input[type=file]').setInputFiles({ ...monitorFile, buffer: Buffer.from('unreadable replacement') });
  await control.waitFor({ state: 'detached' });
  await settled();
  assert.equal(await page.getByTestId('maintenance-control-worklist').count(), 0, 'replacement/refusal clears the previous worklist');
  await page.locator('header button').first().click();
  await openSetup();
  assert.equal(await page.getByTestId('io-create-project').isEnabled(), true, 'no-input project needs no IO approval');
  assert.equal(await page.getByTestId('io-import-review').count(), 0, 'no IO worker review for an empty project');
  await page.getByLabel('Project name', { exact: true }).fill('Empty amendment project');
  await page.getByTestId('io-analyte').fill('Free-text analyte');
  await page.getByTestId('io-create-project').click();
  await page.waitForSelector('[data-step-id="explore"]');
  const emptyState = await waitForState((s) => s.projects.some((p) => p.name === 'Empty amendment project'));
  const emptyProject = emptyState.projects.find((p) => p.name === 'Empty amendment project');
  assert.equal(emptyProject.method.target, 'Free-text analyte');
  assert.equal(emptyProject.method.taskType, 'regression');
  assert.deepEqual(emptyState.samplesByProject[emptyProject.id], []);
  assert.deepEqual(emptyState.spectraByProject[emptyProject.id].samples, []);
  assert.equal(Object.hasOwn(emptyState.importsByProject, emptyProject.id), false);
  assert.equal(emptyState.setupImportDraft, null);
  await page.reload({ waitUntil: 'load' });
  await openSetup();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'unreadable.csv', mimeType: 'text/csv', buffer: Buffer.from('not a numerical dataset') });
  await settled();
  assert.equal(await page.getByTestId('io-create-project').isDisabled(), true, 'refused input never becomes an empty project');
  await page.getByRole('button', { name: 'Remove unreadable.csv', exact: true }).click();
  assert.equal(await page.getByTestId('io-create-project').isEnabled(), true, 'explicitly removing every input restores the empty path');
  await page.locator('input[type=file]').first().setInputFiles(fixture.files.map((f) => ({ name: f.name, mimeType: 'text/csv', buffer: Buffer.from(f.text) })));
  await settled();
  await page.getByText('Review IO specification and column roles', { exact: true }).click();
  await page.getByTestId('io-spec-json').fill(JSON.stringify(originalSpec));
  await settled();
  assert.ok((await page.getByTestId('io-import-review').textContent()).includes(fixture.original_three_file_refusal.message));
  assert.equal(await page.getByTestId('io-create-project').isDisabled(), true);
  assert.equal(await page.locator('section.n4ui-proposals').count(), 1, 'real shared proposal component');
  assert.equal(await page.locator('.dsb-validation').count(), 1, 'real shared validation component');
  for (let row = 0; row < 3; row++) assert.equal(await page.getByTestId(`io-target-row-${row}`).inputValue(), '', 'no preselected identity');

  const refused = await waitForPersist((d) => d?.record.status === 'refused' && d.record.mapping?.rowCount === 3);
  const reservedId = refused.projectId;
  assert.equal(refused.record.assembled, null);
  await page.reload({ waitUntil: 'load' });
  await openSetup();
  await settled();
  for (let row = 0; row < 3; row++) await page.getByTestId(`io-target-row-${row}`).selectOption(['A', 'B', 'C'][row]);
  await page.getByTestId('io-confirm-target-rows').click();
  await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
  await settled();
  const preview = await page.getByTestId('io-dataset-preview').textContent();
  assert.match(preview, /12 observation rows/);
  assert.match(preview, /3 distinct samples/);
  assert.equal(await page.getByTestId('io-preview-values').locator('tbody tr').count(), 12);
  assert.equal(await page.getByTestId('io-create-project').isEnabled(), true, 'supported import enables Create naturally');

  const ready = await waitForPersist((d) => d?.record.status === 'ready' && d.record.targetConfirmation?.rows.length === 3);
  assert.equal(ready.projectId, reservedId);
  assert.deepEqual(ready.record.targetConfirmation.rows, [{ row: 0, sampleId: 'A' }, { row: 1, sampleId: 'B' }, { row: 2, sampleId: 'C' }]);
  assert.equal(ready.record.assembled.identity.provenance.observation_id, null);
  assert.equal(ready.record.assembled.blocks.train.n_samples, 12);
  for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(ready.record.files[i].bytes), [...Buffer.from(fixture.files[i].text)]);

  await page.reload({ waitUntil: 'load' });
  await openSetup();
  await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
  await settled();
  assert.equal(await page.getByTestId('io-target-row-0').inputValue(), 'A', 'confirmed mapping resumes');

  // Same name replaces its binding and clears target-byte-bound evidence.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Ytrain.csv', mimeType: 'text/csv', buffer: Buffer.from('protein\n6.11\n7.30\n8.90') });
  assert.equal(await page.getByTestId('io-create-project').isDisabled(), true);
  await settled();
  assert.match(await page.getByTestId('io-binding-notice').textContent(), /Replaced same-name bindings/);
  const replaced = await waitForPersist((d) => d?.record.targetConfirmation === null && d.record.files.some((f) => f.name === 'Ytrain.csv' && f.bytesSha256 !== ready.record.targetConfirmation.targetBytesSha256));
  assert.equal(replaced.record.files.length, 3);
  assert.equal(replaced.record.witness, null);

  // Rapid changed specs must not let an older worker response restore a witness.
  await page.getByText('Review IO specification and column roles', { exact: true }).click();
  await page.getByTestId('io-spec-json').fill(JSON.stringify({ ...originalSpec, sample_index: { by: 'row' } }));
  await page.getByTestId('io-spec-json').fill(JSON.stringify(originalSpec));
  await settled();
  await waitForPersist((d) => d?.record.reviewSpecJson === JSON.stringify(originalSpec) && d.record.status === 'refused');
  assert.equal(await page.getByTestId('io-create-project').isDisabled(), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await waitForPersist((d) => d === null);
  {
    await openSetup();
    await page.locator('input[type=file]').first().setInputFiles(fixture.files.map((f) => ({ name: f.name, mimeType: 'text/csv', buffer: Buffer.from(f.text) })));
    await settled();
    await page.getByText('Review IO specification and column roles', { exact: true }).click();
    await page.getByTestId('io-spec-json').fill(JSON.stringify(originalSpec));
    await settled();
    // An attached file omitted by an otherwise valid spec cannot be discarded.
    await page.locator('input[type=file]').first().setInputFiles({ name: 'extra.csv', mimeType: 'text/csv', buffer: Buffer.from('extra\n1') });
    await settled();
    await page.getByTestId('io-spec-json').fill(JSON.stringify(originalSpec));
    await settled();
    for (let row = 0; row < 3; row++) await page.getByTestId(`io-target-row-${row}`).selectOption(['A', 'B', 'C'][row]);
    await page.getByTestId('io-confirm-target-rows').click();
    await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
    await settled();
    assert.equal(await page.getByTestId('io-create-project').isDisabled(), true);
    assert.match(await page.getByTestId('io-create-refusal').textContent(), /Unreferenced files: extra.csv/);
    await page.getByRole('button', { name: 'Remove extra.csv', exact: true }).click();
    await settled();
    await page.getByTestId('io-spec-json').fill(JSON.stringify(originalSpec));
    await settled();
    for (let row = 0; row < 3; row++) await page.getByTestId(`io-target-row-${row}`).selectOption(['A', 'B', 'C'][row]);
    await page.getByTestId('io-confirm-target-rows').click();
    await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
    await settled();
    const beforeCreate = await waitForPersist((d) => d?.record.status === 'ready');
    await page.getByTestId('io-create-project').click();
    await page.waitForSelector('[data-step-id="explore"]');
    await waitForPersist((d) => d === null);
    const committed = await persistedState();
    const projectId = beforeCreate.projectId;
    assert.deepEqual(committed.samplesByProject[projectId].map((s) => s.reference.value), [6.1, 7.3, 8.9]);
    assert.deepEqual(committed.spectraByProject[projectId].samples.map((s) => s.reps.length), [4, 4, 4]);
    assert.equal(committed.projects.find((p) => p.id === projectId).method.target, 'protein');
    assert.equal(committed.importsByProject[projectId].assembled.blocks.train.n_samples, 12);
    assert.deepEqual([...committed.importsByProject[projectId].assembled.blocks.train.y.data], fixture.expected.y_row_major);
    // Keyed reference amendments change current lab values, not the retained IO history.
    await applyKeyedReferences('sample_id,protein\nC,18.9\nA,16.1\nB,17.3', /0 set · 3 changed · 0 unchanged · 0 invalid/);
    const edited = await waitForState((state) => state.samplesByProject[projectId]?.[0]?.reference?.value === 16.1);
    assert.deepEqual(edited.samplesByProject[projectId].map((sample) => [sample.id, sample.reference.value]),
      [['A', 16.1], ['B', 17.3], ['C', 18.9]]);
    assert.equal(edited.samplesByProject[projectId][0].reference.value, 16.1);
    assert.deepEqual([...edited.importsByProject[projectId].assembled.blocks.train.y.data], fixture.expected.y_row_major);
    assert.deepEqual(edited.importsByProject[projectId].targetConfirmation.rows, beforeCreate.record.targetConfirmation.rows);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('header img[alt="nirs4all"]');
    const reloaded = await persistedState();
    assert.equal(reloaded.importsByProject[projectId].assembled.blocks.train.n_samples, 12);
    for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(reloaded.importsByProject[projectId].files[i].bytes), [...Buffer.from(fixture.files[i].text)]);
  }
  // Spectra may arrive before wet chemistry; preserve an actual y:null import.
  {
    await openSetup();
    await page.getByTestId('io-analyte').fill('Unlabelled protein method');
    await page.locator('input[type=file]').first().setInputFiles(fixture.files.slice(0, 2).map((f) => ({ name: f.name, mimeType: 'text/csv', buffer: Buffer.from(f.text) })));
    await settled();
    await page.getByText('Review IO specification and column roles', { exact: true }).click();
    const noTargetSpec = { ...originalSpec, task_type: 'auto', sources: originalSpec.sources.slice(0, 2) };
    await page.getByTestId('io-spec-json').fill(JSON.stringify(noTargetSpec));
    await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
    await settled();
    assert.equal(await page.getByTestId('io-create-project').isEnabled(), true);
    const unlabelledDraft = await waitForPersist((d) => d?.record.status === 'ready' && d.record.files.length === 2);
    assert.equal(unlabelledDraft.record.assembled.blocks.train.y, null);
    await page.getByTestId('io-create-project').click();
    await page.waitForSelector('[data-step-id="explore"]');
    const projectId = unlabelledDraft.projectId;
    const unlabelled = await waitForState((s) => Object.hasOwn(s.importsByProject, projectId));
    assert.equal(unlabelled.projects.find((p) => p.id === projectId).method.target, 'Unlabelled protein method');
    assert.equal(unlabelled.projects.find((p) => p.id === projectId).method.taskType, 'regression');
    assert.ok(unlabelled.samplesByProject[projectId].every((s) => s.reference === null && s.status === 'nirs_measured'));
    assert.deepEqual(unlabelled.spectraByProject[projectId].samples.map((s) => s.reps.length), [4, 4, 4]);
    await applyKeyedReferences('sample_id,protein\nB,7.3\nC,8.9\nA,6.1', /3 set · 0 changed · 0 unchanged · 0 invalid/);
    const labelled = await waitForState((state) => state.samplesByProject[projectId]?.[0]?.reference?.value === 6.1);
    assert.deepEqual(labelled.samplesByProject[projectId].map((sample) => [sample.id, sample.reference.value]),
      [['A', 6.1], ['B', 7.3], ['C', 8.9]]);
    assert.equal(labelled.projects.find((project) => project.id === projectId).method.target, 'Unlabelled protein method');
    assert.equal(labelled.importsByProject[projectId].assembled.blocks.train.y, null);
    assert.deepEqual(labelled.importsByProject[projectId].files.map((f) => f.name), ['Xtrain.csv', 'Mtrain.csv']);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('header img[alt="nirs4all"]');
    const reloaded = await persistedState();
    assert.equal(reloaded.importsByProject[projectId].assembled.blocks.train.y, null);
    assert.equal(reloaded.importsByProject[projectId].assembled.blocks.train.n_samples, 12);
    for (let i = 0; i < 2; i++) assert.deepEqual(Array.from(reloaded.importsByProject[projectId].files[i].bytes), [...Buffer.from(fixture.files[i].text)]);
  }
  // Missing X survives Create/reload and reaches existing analysis refusals.
  {
    await openSetup();
    await page.getByLabel('Project name', { exact: true }).fill('Incomplete spectra amendment');
    const text = ['sample_id,protein,1000,1100,1200', ...Array.from({ length: 10 }, (_, row) =>
      `sample-${row},${row < 8 ? row + 10 : ''},${row + 1},${row === 9 ? '' : (row + 2) ** 2},${row % 3 + 3}`)].join('\n');
    const spec = {
      schema_version: 1, task_type: 'regression', sample_index: { by: 'id', key: 'sample_id' },
      params: { delimiter: ',', has_header: true, na: { policy: 'ignore' } },
      sources: [{ id: 'observations', input: 'incomplete.csv', role: 'mixed', params: { header_unit: 'nm' },
        columns: [{ role: 'features', select: ['1000', '1100', '1200'] }, { role: 'targets', select: ['protein'] },
          { role: 'metadata', select: ['sample_id'] }] }],
    };
    await page.locator('input[type=file]').first().setInputFiles({ name: 'incomplete.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
    await settled();
    await page.getByText('Review IO specification and column roles', { exact: true }).click();
    await page.getByTestId('io-spec-json').fill(JSON.stringify(spec));
    await page.getByTestId('io-dataset-preview').waitFor({ timeout: 30000 });
    await settled();
    assert.equal(await page.getByTestId('io-create-project').isEnabled(), true);
    const missingDraft = await waitForPersist((d) => d?.record.status === 'ready' && d.record.files[0]?.name === 'incomplete.csv');
    const projectId = missingDraft.projectId;
    await page.getByTestId('io-create-project').click();
    await page.waitForSelector('[data-step-id="explore"]');
    const saved = await waitForState((s) => Object.hasOwn(s.importsByProject, projectId));
    assert.ok(Number.isNaN(saved.spectraByProject[projectId].samples[9].reps[0].values[1]));
    assert.equal(saved.importsByProject[projectId].assembled.blocks.train.x[0].validity[28], false);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('header img[alt="nirs4all"]');
    const reloaded = await persistedState();
    assert.ok(Number.isNaN(reloaded.spectraByProject[projectId].samples[9].reps[0].values[1]));
    await page.getByRole('button', { name: /Incomplete spectra amendment/ }).click();
    await page.locator('[data-step-id="select"]').click();
    await page.getByTestId('hplc-selection-refusal').waitFor();
    assert.equal(await page.getByTestId('hplc-selection-refusal').textContent(), 'Missing or non-finite spectra must be resolved before analysis.');
    await page.locator('[data-step-id="explore"]').click();
    // Keyed lab references cannot repair or conceal the missing spectral value.
    await applyKeyedReferences(['sample_id,protein', ...Array.from({ length: 10 }, (_, index) => {
      const row = 9 - index;
      return `sample-${row},${row + 10}`;
    })].join('\n'), /2 set · 0 changed · 8 unchanged · 0 invalid/);
    await waitForState((s) => s.samplesByProject[projectId]?.[9]?.reference?.value === 19);
    await page.locator('[data-step-id="calibrate"]').click();
    await page.getByText('Calibration requires finite spectra and targets.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Run calibration|Lancer la calibration/ }).isDisabled(), true);
    assert.equal(await page.getByText(/Selected model|Modèle retenu/).count(), 0);
    const refused = await persistedState();
    assert.equal(refused.projects.find((p) => p.id === projectId).activeModelVersionId, null);
    assert.ok(Number.isNaN(refused.spectraByProject[projectId].samples[9].reps[0].values[1]));
  }
  console.log('Setup empty/import/Create/retention smoke passed.');
} finally { await browser.close(); }
