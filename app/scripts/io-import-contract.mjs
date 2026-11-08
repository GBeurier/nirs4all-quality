// Root's deferred contract: real browser IO glue + the actual host adapter.
// No fitting, duplicated projection, source parser or test-only axis decoder.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';
import { ioImportRoot, qualifiedIOImportStage } from './io-stage.mjs';

const source = await readFile(new URL('../src/lib/ioImport.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const executable = outputText.replace(/(['"])@quali\/io-import-numeric\1/g,
  JSON.stringify(pathToFileURL(resolve(ioImportRoot(), 'numeric-wire.mjs')).href));
const host = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const stage = await qualifiedIOImportStage();
const io = await import(pathToFileURL(resolve(ioImportRoot(), 'nirs4all_io_wasm.js')).href);
io.initSync({ module: await readFile(resolve(ioImportRoot(), 'nirs4all_io_wasm_bg.wasm')) });
const fixture = JSON.parse(await readFile(new URL('../../../_implementation/2026-11-03-ecosystem-consolidation/phase5-joint-ui-preparation-20261107/QUALI_OWNER_CASE.json', import.meta.url), 'utf8'));

async function inputFor(spec, files = fixture.files) {
  const bindings = await Promise.all(files.map(async (file, index) => {
    const bytes = new TextEncoder().encode(file.text);
    return { bindingId: `host-file-${index}`, name: file.name, bytes, bytesSha256: await host.sha256(bytes) };
  }));
  return { ...host.emptyImport(), files: bindings, reviewSpecJson: JSON.stringify(spec), status: 'pending' };
}
const originalSpec = structuredClone(fixture.spec);
originalSpec.sources[2] = fixture.original_three_file_refusal.target_source_replacement;
const original = host.runOwnerCycle(io, await inputFor(originalSpec), stage);
assert.equal(original.status, 'refused');
assert.ok(original.diagnostics.some((d) => d.phase === 'assembly' && d.message === fixture.original_three_file_refusal.message));
assert.equal(original.mapping.rowCount, 3);
assert.deepEqual(original.mapping.sampleIds, ['A', 'B', 'C']);
assert.equal(original.targetConfirmation, null);
assert.equal(original.witness, null);

const keyed = structuredClone(originalSpec);
keyed.sources[2].join = fixture.spec.sources[2].join;
const missingKey = host.runOwnerCycle(io, await inputFor(keyed), stage);
assert.equal(missingKey.status, 'refused');
assert.ok(missingKey.diagnostics.some((d) => d.phase === 'assembly' && d.message.includes('join keys not found')));

async function confirmed(record, sampleIds) {
  const mapped = await host.confirmTargetRows(record, sampleIds.map((sampleId, row) => ({ row, sampleId })));
  return host.runOwnerCycle(io, mapped, stage);
}
const ready = await confirmed(original, ['A', 'B', 'C']);
assert.equal(ready.status, 'ready', JSON.stringify(ready.diagnostics));
assert.deepEqual([...ready.witness.bytes], [...new TextEncoder().encode(fixture.in_memory_witness.text)]);
assert.equal(ready.witness.name, fixture.in_memory_witness.name);
const expected = fixture.expected, assembly = ready.assembled, train = assembly.blocks.train;
assert.deepEqual(assembly.partition_order, expected.partition_names);
assert.deepEqual(assembly.folds, expected.folds);
assert.equal(assembly.repetition, expected.repetition);
assert.equal(assembly.identity.provenance.sample_id, expected.identity_sample_id);
assert.equal(assembly.identity.provenance.observation_id, null);
assert.deepEqual(train.feature_headers, expected.feature_headers);
assert.deepEqual(train.header_units, expected.header_units);
assert.deepEqual(train.y_headers, expected.y_headers);
assert.equal(train.n_samples, 12);
assert.deepEqual([train.x[0].n_rows, train.x[0].n_cols], expected.x_shape);
assert.deepEqual([...train.x[0].data], expected.x_row_major);
assert.deepEqual(train.x[0].validity, expected.x_validity);
assert.deepEqual([...train.y.data], expected.y_row_major);
assert.deepEqual(train.y.columns[0].block.validity, expected.y_validity);
assert.deepEqual(train.metadata.columns.find((c) => c.name === 'sample_id').values, expected.sample_ids_in_physical_row_order);
assert.deepEqual(train.metadata.columns.find((c) => c.name === 'site').values, expected.site_in_physical_row_order);
for (const file of ready.files) {
  assert.deepEqual([...file.bytes], [...new TextEncoder().encode(fixture.files.find((f) => f.name === file.name).text)]);
  assert.notEqual(file.bytes.at(-1), 10, 'original has no terminal newline');
}
assert.deepEqual([...structuredClone(ready).assembled.blocks.train.x[0].data], expected.x_row_major);
assert.equal(host.previewView(ready).sampleCount, 3);
assert.equal(host.previewRows(ready.assembled).length, 12);
const projected = host.projectForLab(ready, 'fixture-project');
assert.equal(projected.ok, true, JSON.stringify(projected));
assert.deepEqual(projected.samples.map((s) => s.id), ['A', 'B', 'C']);
assert.deepEqual(projected.samples.map((s) => s.reference.value), [6.1, 7.3, 8.9]);
assert.deepEqual(projected.samples.map((s) => s.repetitions.length), [4, 4, 4]);
assert.deepEqual(projected.spectra.axis, [1000, 1100, 1200]);
assert.equal(projected.spectra.axisUnit, 'nm');
assert.equal(projected.targetName, 'protein');
assert.deepEqual(projected.spectra.samples.flatMap((s) => s.reps.flatMap((r) => [...r.values])), expected.x_row_major);
assert.ok(projected.samples.every((s) => !Object.hasOwn(s.metadata, 'site')), 'varying sites stay only in the full owner record');
assert.equal(ready.assembled.identity.provenance.observation_id, null);

function refusal(change, message, base = ready) {
  const record = structuredClone(base);
  change(record);
  const result = host.projectForLab(record, 'fixture-project');
  assert.equal(result.ok, false, message);
  assert.ok(result.reasons.length, message);
}
refusal((r) => { r.status = 'pending'; }, 'stale assembly cannot create');
refusal((r) => { r.assembled.partition_order.push('test'); r.assembled.blocks.test = r.assembled.blocks.train; }, 'held-out');
refusal((r) => { r.assembled.folds.push([[0], [1]]); }, 'folds');
refusal((r) => { r.assembled.blocks.train.x = []; }, 'missing X');
refusal((r) => { r.assembled.blocks.train.x.push(r.assembled.blocks.train.x[0]); }, 'multiple X');
const masked = structuredClone(ready);
masked.assembled.blocks.train.x[0].validity[0] = false;
masked.assembled.blocks.train.x[0].data[0] = 123; // The mask governs missingness, not a storage placeholder.
const maskedProjection = host.projectForLab(masked, 'masked');
assert.equal(maskedProjection.ok, true, JSON.stringify(maskedProjection));
assert.ok(Number.isNaN(maskedProjection.spectra.samples[0].reps[0].values[0]));
assert.equal(masked.assembled.blocks.train.x[0].validity[0], false);
assert.equal(masked.assembled.blocks.train.x[0].data[0], 123, 'retained owner object was not rewritten');
refusal((r) => { r.assembled.blocks.train.x[0].data[0] = Infinity; }, 'nonfinite X');
refusal((r) => { r.assembled.identity.provenance.sample_id = null; }, 'anonymous');
refusal((r) => { r.assembled.blocks.train.metadata.columns.find((c) => c.name === 'sample_id').values = Array(12).fill(101); }, 'numeric IDs');
refusal((r) => { r.assembled.blocks.train.weights = new Float64Array(12).fill(1); }, 'weights');
refusal((r) => { r.assembled.blocks.train.y.columns.push(r.assembled.blocks.train.y.columns[0]); }, 'multiple targets');
refusal((r) => { r.assembled.blocks.train.y.columns[0].kind = 'classification_integer'; }, 'classification');
refusal((r) => { r.assembled.blocks.train.y.columns[0].kind = 'classification_string'; }, 'string classification');
refusal((r) => { r.assembled.task_type = 'auto'; }, 'numeric target needs confirmed regression');
refusal((r) => { r.assembled.task_type = 'binary'; }, 'numeric target with binary task');
refusal((r) => { r.assembled.task_type = 'multiclass'; }, 'numeric target with multiclass task');
refusal((r) => { r.assembled.blocks.train.y.data[1] = 9; }, 'inconsistent targets');
refusal((r) => { r.assembled.blocks.train.y.columns[0].block.validity[1] = false; }, 'inconsistent target validity');
refusal((r) => { r.assembled.blocks.train.feature_axes[0][0].coordinates = { kind: 'string', values: ['a', 'b', 'c'] }; }, 'nonnumeric axis');
refusal((r) => { r.assembled.blocks.train.feature_axes[0][0].coordinates.count = 4; }, 'axis count mismatch');
const missingReference = structuredClone(ready);
for (let row = 0; row < 4; row++) {
  missingReference.assembled.blocks.train.y.columns[0].block.validity[row] = false;
  missingReference.assembled.blocks.train.y.data[row] = NaN;
}
const missingProjection = host.projectForLab(missingReference, 'fixture-project');
assert.equal(missingProjection.ok, true);
assert.equal(missingProjection.samples[0].reference, null);
assert.ok(Number.isNaN(missingReference.assembled.blocks.train.y.data[0]), 'retained logical missing target stays NaN');
const unknownUnit = structuredClone(ready);
unknownUnit.assembled.blocks.train.feature_axes[0][0].unit = 'owner-custom-unit';
assert.equal(host.projectForLab(unknownUnit, 'fixture-project').spectra.axisUnit, 'owner-custom-unit');

// Accepted optional-y amendment: only target gates are skipped, no task inferred.
const noTargetSpec = structuredClone(originalSpec);
noTargetSpec.sources = noTargetSpec.sources.slice(0, 2);
noTargetSpec.task_type = 'auto';
const noTarget = host.runOwnerCycle(io, await inputFor(noTargetSpec, fixture.files.slice(0, 2)), stage);
assert.equal(noTarget.status, 'ready', JSON.stringify(noTarget.diagnostics));
assert.equal(noTarget.assembled.blocks.train.y, null);
const noTargetProjection = host.projectForLab(noTarget, 'unlabelled');
assert.equal(noTargetProjection.ok, true, JSON.stringify(noTargetProjection));
assert.equal(noTargetProjection.targetName, null);
assert.deepEqual(noTargetProjection.samples.map((s) => s.id), ['A', 'B', 'C']);
assert.ok(noTargetProjection.samples.every((s) => s.reference === null && s.status === 'nirs_measured'));
assert.deepEqual(noTargetProjection.spectra.samples.map((s) => s.reps.length), [4, 4, 4]);
assert.deepEqual(noTargetProjection.spectra.samples.flatMap((s) => s.reps.flatMap((r) => [...r.values])), expected.x_row_major);
assert.deepEqual(noTargetProjection.spectra.axis, [1000, 1100, 1200]);
assert.ok(noTargetProjection.samples.every((s) => !Object.hasOwn(s.metadata, 'site')));
const noTaskRead = structuredClone(noTarget);
Object.defineProperty(noTaskRead.assembled, 'task_type', { get() { throw new Error('No-target projection must not read assembled task_type.'); } });
assert.equal(host.projectForLab(noTaskRead, 'unlabelled').ok, true);
refusal((r) => { r.assembled.partition_order.push('test'); }, 'no-target heldout', noTarget);
refusal((r) => { r.assembled.folds.push([[0], [1]]); }, 'no-target folds', noTarget);
refusal((r) => { r.assembled.blocks.train.x[0].data[0] = Infinity; }, 'no-target valid but nonfinite X', noTarget);
refusal((r) => { r.assembled.identity.provenance.sample_id = null; }, 'no-target anonymous IDs', noTarget);
refusal((r) => { r.assembled.blocks.train.metadata.columns.find((c) => c.name === 'sample_id').values = Array(12).fill(101); }, 'no-target numeric IDs', noTarget);
refusal((r) => { r.assembled.blocks.train.weights = new Float64Array(12).fill(1); }, 'no-target weights', noTarget);
for (const task of ['binary', 'multiclass']) refusal((r) => {
  r.specJson = JSON.stringify({ ...JSON.parse(r.specJson), task_type: task });
}, `no-target explicit ${task} declaration`, noTarget);
refusal((r) => { r.files.push({ ...r.files[0], bindingId: 'extra', name: 'unreferenced.csv' }); }, 'attached unreferenced file');

// Statistical NA fills are refused by the owner at spec admission (actual validate, no stub): Quali keeps
// the original bytes and spec text, creates no assembly, witness or lab projection, and fits nothing.
for (const method of ['mean', 'median']) {
  const statisticalSpec = structuredClone(noTargetSpec);
  statisticalSpec.params = { ...statisticalSpec.params, na: { policy: 'replace', fill: { method } } };
  const statisticalInput = await inputFor(statisticalSpec, fixture.files.slice(0, 2));
  const statistical = host.runOwnerCycle(io, statisticalInput, stage);
  assert.equal(statistical.status, 'refused', `${method} fill`);
  assert.equal(statistical.validationSucceeded, false);
  assert.equal(statistical.assembled, null);
  assert.equal(statistical.witness, null);
  const diagnostic = statistical.diagnostics.find((d) => d.phase === 'validation');
  assert.ok(diagnostic?.message.includes(`na.fill.method: '${method}' is refused`) && diagnostic.message.includes('IO does not compute fill statistics across samples'),
    `${method}: explicit owner refusal expected, got ${JSON.stringify(statistical.diagnostics)}`);
  assert.equal(statistical.reviewSpecJson, statisticalInput.reviewSpecJson, 'original spec text retained exactly');
  assert.equal(statistical.specJson, statisticalInput.reviewSpecJson);
  for (const file of statistical.files) {
    assert.deepEqual([...file.bytes], [...new TextEncoder().encode(fixture.files.find((f) => f.name === file.name).text)], 'original bytes retained');
  }
  const statisticalProjection = host.projectForLab(statistical, `na-${method}`);
  assert.equal(statisticalProjection.ok, false, `${method}: no valid lab result`);
  assert.ok(statisticalProjection.reasons.length);
}

// Accepted owner corpus: missing X and nonlexical IDs are retained, not repaired.
const case1 = JSON.parse(await readFile(new URL('../../../nirs4all-io/bindings/wasm/tests/fixtures/case1.json', import.meta.url), 'utf8'));
const case1Record = host.runOwnerCycle(io, await inputFor(case1.spec, case1.files), stage);
assert.equal(case1Record.status, 'ready', JSON.stringify(case1Record.diagnostics));
assert.equal(host.projectForLab(case1Record, 'case1').ok, false, 'accepted held-out owner data is not an alltrain lab project');
assert.deepEqual(case1Record.assembled.blocks.train.metadata.columns.find((c) => c.name === 'Sample_ID').values, ['S10', 'S7']);
assert.ok(case1Record.assembled.blocks.val.x[0].data.some(Number.isNaN));
const nonlexicalSpec = structuredClone(case1.spec);
delete nonlexicalSpec.partitions;
nonlexicalSpec.task_type = 'regression';
// IO requires every non-key column to have a role. Keep the second original
// target as metadata in this explicitly single-target lab-profile variant.
nonlexicalSpec.sources[1].role = 'mixed';
nonlexicalSpec.sources[1].columns = [
  { role: 'targets', select: ['protein'] },
  { role: 'metadata', select: ['moisture'] },
];
const alltrainMissing = host.runOwnerCycle(io, await inputFor(nonlexicalSpec, case1.files), stage);
assert.equal(alltrainMissing.status, 'ready', JSON.stringify(alltrainMissing.diagnostics));
assert.deepEqual(alltrainMissing.assembled.blocks.train.y_headers, ['protein']);
assert.deepEqual(alltrainMissing.assembled.blocks.train.metadata.columns.find((column) => column.name === 'moisture').values,
  [null, 7.5, 8.25, 9], 'all original moisture values remain aligned and retained as metadata');
const alltrainMissingProjection = host.projectForLab(alltrainMissing, 'case1');
assert.equal(alltrainMissingProjection.ok, true, JSON.stringify(alltrainMissingProjection));
assert.ok(Number.isNaN(alltrainMissingProjection.spectra.samples[1].reps[0].values[1]));
const finiteFiles = structuredClone(case1.files);
finiteFiles[0].text = finiteFiles[0].text.replace('S02;val;0.5;;0.75', 'S02;val;0.5;0.6;0.75');
const nonlexical = host.runOwnerCycle(io, await inputFor(nonlexicalSpec, finiteFiles), stage);
const nonlexicalProjection = host.projectForLab(nonlexical, 'case1');
assert.equal(nonlexicalProjection.ok, true, JSON.stringify(nonlexicalProjection));
assert.deepEqual(nonlexicalProjection.samples.map((s) => s.id), ['S10', 'S02', 'S7', 'S33']);

const permuted = await confirmed(original, ['C', 'A', 'B']);
assert.deepEqual([...permuted.assembled.blocks.train.y.data], [7.3, 7.3, 7.3, 7.3, 8.9, 8.9, 8.9, 8.9, 6.1, 6.1, 6.1, 6.1]);

// Serialization uses the declared target delimiter and CSV quoting for IDs.
const quotedFiles = [
  { name: 'Xtrain.csv', text: '1000;1100;1200\n1;2;3\n4;5;6\n7;8;9' },
  { name: 'Mtrain.csv', text: 'sample_id;site\n"A;west";one\n"B""quoted";two\nC;three' },
  fixture.files[2],
];
const quotedSpec = structuredClone(originalSpec);
quotedSpec.params.delimiter = ';';
quotedSpec.sources[2].params = { delimiter: ';', has_header: true };
const quotedOriginal = host.runOwnerCycle(io, await inputFor(quotedSpec, quotedFiles), stage);
assert.deepEqual(quotedOriginal.mapping.sampleIds, ['A;west', 'B"quoted', 'C']);
const quoted = await confirmed(quotedOriginal, ['A;west', 'B"quoted', 'C']);
assert.equal(quoted.status, 'ready', JSON.stringify(quoted.diagnostics));
assert.equal(new TextDecoder().decode(quoted.witness.bytes), 'sample_id\n"A;west"\n"B""quoted"\nC');
assert.deepEqual(quoted.assembled.blocks.train.metadata.columns.find((c) => c.name === 'sample_id').values, ['A;west', 'B"quoted', 'C']);

// Replacement invalidates all dependent evidence even when the bytes are equal.
const target = ready.files.find((f) => f.name === 'Ytrain.csv');
const replaced = host.replaceBindings(ready, [{ ...target, bindingId: 'replacement-handle' }]);
assert.equal(replaced.files.filter((f) => f.name === target.name).length, 1);
assert.equal(replaced.assembled, null);
assert.equal(replaced.targetConfirmation, null);
assert.equal(replaced.witness, null);
assert.deepEqual(replaced.confirmed, []);

// Unknown owner/user fields survive round trips and targeted proposal deltas.
const unknownSpec = structuredClone(originalSpec);
unknownSpec.future_owner_extension = { opaque: [1, { keep: true }] };
const unknownInput = await inputFor(unknownSpec);
const unknown = host.runOwnerCycle(io, unknownInput, stage);
assert.equal(unknown.reviewSpecJson, unknownInput.reviewSpecJson, 'unchanged JSON text retained exactly');
assert.deepEqual(JSON.parse(unknown.specJson).future_owner_extension, unknownSpec.future_owner_extension);

// One actual production boundary each: runVariant/createEngine and Methods PCA.
// Ten declared sample IDs, eight references, two pool samples; only pool row 9
// has a missing feature. No source parser or diagnostic guard is reimplemented.
const incompleteText = ['sample_id,protein,1000,1100,1200', ...Array.from({ length: 10 }, (_, row) =>
  `sample-${row},${row < 8 ? row + 10 : ''},${row + 1},${row === 9 ? '' : (row + 2) ** 2},${row % 3 + 3}`)].join('\n');
const incompleteSpec = {
  schema_version: 1, task_type: 'regression', sample_index: { by: 'id', key: 'sample_id' },
  params: { delimiter: ',', has_header: true, na: { policy: 'ignore' } },
  sources: [{ id: 'observations', input: 'incomplete.csv', role: 'mixed', params: { header_unit: 'nm' },
    columns: [{ role: 'features', select: ['1000', '1100', '1200'] }, { role: 'targets', select: ['protein'] },
      { role: 'metadata', select: ['sample_id'] }] }],
};
const incompleteRecord = host.runOwnerCycle(io, await inputFor(incompleteSpec, [{ name: 'incomplete.csv', text: incompleteText }]), stage);
const incompleteProjection = host.projectForLab(incompleteRecord, 'incomplete');
assert.equal(incompleteProjection.ok, true, JSON.stringify(incompleteProjection));
assert.ok(Number.isNaN(incompleteProjection.spectra.samples[9].reps[0].values[1]));
assert.equal(incompleteRecord.assembled.blocks.train.x[0].validity[28], false);

const appRoot = fileURLToPath(new URL('..', import.meta.url));
// Use the actual app config/staged runtime, with no Core/Methods substitution.
const server = await createServer({ root: appRoot, configFile: resolve(appRoot, 'vite.config.ts'),
  server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { buildTrainingDataset } = await server.ssrLoadModule('/src/lib/trainingData.ts');
  const unlabelled = buildTrainingDataset(incompleteProjection.spectra, incompleteProjection.samples, 'protein');
  assert.equal(unlabelled.nSamples, 8);
  assert.ok(unlabelled.X.every(Number.isFinite));
  assert.ok(!unlabelled.sampleIds.includes('sample-9'));
  const labelledSamples = incompleteProjection.samples.map((sample) => ({ ...sample,
    reference: sample.reference ?? { value: 20, status: 'validated' } }));
  const labelled = buildTrainingDataset(incompleteProjection.spectra, labelledSamples, 'protein');
  assert.ok(Number.isNaN(labelled.X[28]));
  assert.ok(!Object.is(labelled.X[28], 0), 'missing labelled X is never silently zero-filled');
  const raw = buildTrainingDataset(incompleteProjection.spectra, labelledSamples, 'protein', 'raw');
  assert.ok(Number.isNaN(raw.X[28]));
  assert.ok(!Object.is(raw.X[28], 0));
  const { createEngine } = await server.ssrLoadModule('/src/engine/index.ts');
  const { runVariant, CALIB_VARIANTS } = await server.ssrLoadModule('/src/engine/variants.ts');
  const engine = await createEngine();
  assert.equal(engine.name, 'nirs4all-core-wasm', 'actual WASM engine, not a stub or mocked Core');
  await assert.rejects(() => runVariant(labelled, CALIB_VARIANTS.find((variant) => variant.spec.kind === 'wasm_pls_screen'), engine),
    { message: 'Calibration requires finite spectra and targets.' });
  const { initializeDiagnostics, fitPcaReference } = await server.ssrLoadModule('/src/engine/nativeDiagnostics.ts');
  await initializeDiagnostics();
  assert.throws(() => fitPcaReference({ data: labelled.X, rows: labelled.nSamples, cols: labelled.nFeatures }),
    { message: 'Missing or non-finite spectra must be resolved before analysis.' });
} finally { await server.close(); }

console.log('IO import/axis/lab projection contract cases passed. Root still owns browser Create qualification and publication authority.');
