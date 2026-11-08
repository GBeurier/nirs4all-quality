// Keyed reference (y) import contract: the real staged IO WASM (describeTables + validate +
// assembleDataset) driven through the actual src/lib/referenceImport.ts. No parser, owner or
// numeric mock. Same loading pattern as scripts/io-import-contract.mjs (read-only reuse).
//
//   NIRS4ALL_IO_WASM_ROOT=<staged io dir> node scripts/reference-import-contract.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ioImportRoot, qualifiedIOImportStage } from './io-stage.mjs';

const source = await readFile(new URL('../src/lib/referenceImport.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const ref = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
await qualifiedIOImportStage();
const io = await import(pathToFileURL(resolve(ioImportRoot(), 'nirs4all_io_wasm.js')).href);
io.initSync({ module: await readFile(resolve(ioImportRoot(), 'nirs4all_io_wasm_bg.wasm')) });

const file = (name, text) => {
  const bytes = new TextEncoder().encode(text);
  return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const sample = (id, value = null, status = 'nirs_measured') => ({
  id, projectId: 'p', lotId: null, barcode: null, status, repetitions: [], metadata: {}, createdAt: '2026-11-08T00:00:00.000Z',
  reference: value === null ? null : { value, status: 'validated' },
});
const CSV = { hasHeader: true, delimiter: ',' };
const preview = (f, options, idColumn, valueColumn, samples) => ref.previewReference(io, f, options, idColumn, valueColumn, samples);
const refusal = (result, pattern) => { assert.equal(result.ok, false, 'expected a refusal'); assert.match(result.reason, pattern); };
const plain = [sample('A'), sample('B'), sample('C')];

// 1. keyed reorder: rows in a different order than the project samples; exact owner doubles.
{
  const result = preview(file('y.csv', 'sample_id,protein\nC,8.9\nA,6.1\nB,7.3\n'), CSV, 'sample_id', 'protein', plain);
  assert.equal(result.ok, true, JSON.stringify(result));
  const byId = Object.fromEntries(result.delta.updates.map((u) => [u.id, u.value]));
  assert.deepEqual(Object.keys(byId).sort(), ['A', 'B', 'C']);
  assert.ok(Object.is(byId.A, 6.1) && Object.is(byId.B, 7.3) && Object.is(byId.C, 8.9));
  assert.deepEqual(result.delta.counts, { set: 3, changed: 0, unchanged: 0, invalidKept: 0, unknownIds: 0, absentFromFile: 0 });
  assert.equal(result.delta.file.sha256.length, 64);
  assert.deepEqual(result.delta.reader, { delimiter: ',', hasHeader: true });
}

// 2. a missing value keeps the existing reference; 3. an unknown id is reported and not applied.
{
  const samples = [sample('A', 5.5, 'integrated'), sample('B', 5.0, 'integrated'), sample('C')];
  const result = preview(file('y.csv', 'sample_id,protein\nA,6.1\nB,\nZ,9.9\n'), CSV, 'sample_id', 'protein', samples);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.delta.updates, [{ id: 'A', value: 6.1, previous: 5.5 }]);
  assert.equal(result.delta.counts.changed, 1);
  assert.equal(result.delta.counts.invalidKept, 1);
  assert.deepEqual(result.delta.unknownIds, ['Z']);
  assert.equal(result.delta.counts.absentFromFile, 1); // C is not mentioned
  const state = { samplesByProject: { p: samples }, modelByProject: {}, calibByProject: {}, audit: [] };
  const next = ref.applyReferenceDeltaToState(state, 'p', result.delta, (detail) => ({ id: 'a1', projectId: 'p', action: 'reference_imported', userId: 'u', role: 'admin', at: 'now', detail }));
  const refs = Object.fromEntries(next.samplesByProject.p.map((s) => [s.id, s.reference?.value ?? null]));
  assert.deepEqual(refs, { A: 6.1, B: 5.0, C: null });
  assert.equal(next.samplesByProject.p[1], samples[1]); // untouched sample object
}

// 4. duplicate ids refuse; 5. unkeyed (single column) refuses; wrong delimiter behaves as unkeyed.
refusal(preview(file('y.csv', 'sample_id,protein\nA,1\nA,2\n'), CSV, 'sample_id', 'protein', plain), /repeated|more than once/);
refusal(preview(file('y.csv', 'protein\n6.1\n7.3\n8.9\n'), CSV, 'protein', 'protein', plain), /sample-ID column/);
refusal(preview(file('y.csv', 'sample_id;protein\nA;6.1\nB;7.3\n'), { hasHeader: true, delimiter: ',' }, 'sample_id', 'protein', plain), /sample-ID column/);
{
  const semicolon = preview(file('y.csv', 'sample_id;protein\nA;6.1\nB;7.3\n'), { hasHeader: true, delimiter: ';' }, 'sample_id', 'protein', plain);
  assert.equal(semicolon.ok, true, JSON.stringify(semicolon));
  assert.equal(semicolon.delta.reader.delimiter, ';');
}

// Selected columns are explicit: extra columns are ignored, wrong choices refuse, ids are never converted.
{
  const text = 'lot,sample_id,protein,note\nL1,A,6.1,x\nL1,B,7.3,y\nL2,C,8.9,z\n';
  const ok = preview(file('y.csv', text), CSV, 'sample_id', 'protein', plain);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.delta.valueColumn, 'protein');
  refusal(preview(file('y.csv', text), CSV, 'sample_id', 'note', plain), /not numeric/);
  refusal(preview(file('y.csv', text), CSV, 'sample_id', 'sample_id', plain), /two different columns/);
  refusal(preview(file('y.csv', text), CSV, 'lot', 'protein', plain), /repeated/); // lot repeats: not a unique id column
  refusal(preview(file('y.csv', 'id,protein\n1,6.1\n2,7.3\n'), CSV, 'id', 'protein', [sample('1'), sample('2')]), /text ids/);
}

// Owner precision: the selected target double is kept exactly (no rounding, no local Number(text)).
{
  const result = preview(file('y.csv', 'sample_id,protein\nA,0.1\nB,123456789.123456789\n'), CSV, 'sample_id', 'protein', plain);
  assert.equal(result.ok, true, JSON.stringify(result));
  const byId = Object.fromEntries(result.delta.updates.map((u) => [u.id, u.value]));
  assert.ok(Object.is(byId.A, 0.1) && Object.is(byId.B, 123456789.123456789));
}

// Stale guards: the commit is refused when sample ids or reference values moved since the preview.
{
  const result = preview(file('y.csv', 'sample_id,protein\nA,6.1\n'), CSV, 'sample_id', 'protein', plain);
  assert.equal(result.ok, true);
  assert.equal(ref.guardMatches(plain, result.delta.expected), true);
  assert.equal(ref.guardMatches([sample('A', 1), sample('B'), sample('C')], result.delta.expected), false); // reference moved
  assert.equal(ref.guardMatches([sample('A'), sample('B')], result.delta.expected), false); // list shrank
  assert.equal(ref.guardMatches([sample('B'), sample('A'), sample('C')], result.delta.expected), false); // list reordered
  const state = { samplesByProject: { p: [sample('A', 1), sample('B'), sample('C')] }, modelByProject: { p: { m: 1 } }, calibByProject: { p: { c: 1 } }, audit: [] };
  assert.equal(ref.applyReferenceDeltaToState(state, 'p', result.delta, () => assert.fail('no audit on a stale delta')), state);
}

// Atomic store step: models/calibration dropped only for the project whose value really changed;
// the retained historical import is the same object; a project with no retained source works.
{
  const delta = preview(file('y.csv', 'sample_id,protein\nA,6.1\n'), CSV, 'sample_id', 'protein', plain).delta;
  const retained = { files: [{ name: 'X.csv' }], marker: 'historical' };
  const state = {
    samplesByProject: { p: plain, q: [sample('A', 9)] },
    modelByProject: { p: { m: 'p' }, q: { m: 'q' } }, calibByProject: { p: { c: 'p' }, q: { c: 'q' } },
    importsByProject: { p: retained }, audit: [],
  };
  const audit = (detail) => ({ id: 'a', projectId: 'p', action: 'reference_imported', userId: 'u', role: 'admin', at: 'now', detail });
  const next = ref.applyReferenceDeltaToState(state, 'p', delta, audit);
  assert.equal(next.samplesByProject.p[0].reference.value, 6.1);
  assert.equal(next.samplesByProject.p[0].reference.status, 'validated');
  assert.equal(next.samplesByProject.p[0].status, 'integrated');
  assert.equal('p' in next.modelByProject, false);
  assert.equal('p' in next.calibByProject, false);
  assert.deepEqual(next.modelByProject.q, { m: 'q' });
  assert.equal(next.samplesByProject.q, state.samplesByProject.q);
  assert.equal(next.importsByProject, state.importsByProject);
  assert.equal(next.importsByProject.p, retained);
  assert.equal(next.audit.length, 1);
  const detail = next.audit[0].detail;
  assert.deepEqual([detail.file.name, detail.file.sha256, detail.idColumn, detail.valueColumn, detail.counts.set, detail.alignment],
    ['y.csv', delta.file.sha256, 'sample_id', 'protein', 1, 'owner-keyed']);

  // no-op: same values as already stored -> same state object, models kept, no audit
  const same = preview(file('y.csv', 'sample_id,protein\nA,6.1\n'), CSV, 'sample_id', 'protein', next.samplesByProject.p);
  assert.equal(same.ok, true);
  assert.deepEqual(same.delta.updates, []);
  assert.equal(same.delta.counts.unchanged, 1);
  const keep = { ...next, modelByProject: { p: { m: 'again' } }, calibByProject: { p: { c: 'again' } } };
  const noop = ref.applyReferenceDeltaToState(keep, 'p', same.delta, audit);
  assert.equal(noop, keep);
  assert.deepEqual(noop.modelByProject.p, { m: 'again' });

  // source-less project: no importsByProject at all
  const sourceless = { samplesByProject: { p: plain }, modelByProject: {}, calibByProject: {}, audit: [] };
  const applied = ref.applyReferenceDeltaToState(sourceless, 'p', delta, audit);
  assert.equal(applied.samplesByProject.p[0].reference.value, 6.1);
  assert.equal('importsByProject' in applied, false);
}

console.log('reference-import contract passed');
