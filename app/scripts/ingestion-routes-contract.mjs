// Root's deferred route gate. Real IO/Methods/DAG; fixed predictions, no fitting.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { ioImportRoot, qualifiedIOImportStage } from './io-stage.mjs';
import { methodsRoot, wasmRoot, qualifiedMethodsStage } from './methods-stage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const stage = await qualifiedIOImportStage();
await qualifiedMethodsStage();
const ioRoot = ioImportRoot();
const io = await import(pathToFileURL(resolve(ioRoot, 'nirs4all_io_wasm.js')).href);
io.initSync({ module: await readFile(resolve(ioRoot, 'nirs4all_io_wasm_bg.wasm')) });
const dagFile = resolve(wasmRoot, 'dagml/dag_ml_wasm.js');
const dag = await import(pathToFileURL(dagFile).href);
dag.initSync({ module: await readFile(resolve(wasmRoot, 'dagml/dag_ml_wasm_bg.wasm')) });
const methods = await import(pathToFileURL(resolve(methodsRoot, 'index.js')).href);
// Forward initialized native namespaces so browser-default init does not fetch in Node.
globalThis.__qualiIngestionOwners = { dag, methods };
const virtual = '\0quali-ingestion-owner:';
const server = await createServer({
  configFile: false, root, server: { middlewareMode: true },
  esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: {
    '@': resolve(root, 'src'),
    '@quali/io-import-numeric': resolve(ioRoot, 'numeric-wire.mjs'),
    'dag-ml-data-wasm': resolve(wasmRoot, 'dagml-data/dag_ml_data_wasm.js'),
    '@nirs4all/datasets-wasm': resolve(wasmRoot, 'datasets/nirs4all_datasets_wasm.js'),
    'dag-ml-wasm/n4m-controller': resolve(wasmRoot, 'dagml/n4m_controller.mjs'),
  } },
  plugins: [{ name: 'initialized-route-owners', enforce: 'pre',
    resolveId(id) {
      if (id === 'dag-ml-wasm') return virtual + 'dag';
      if (id === '@nirs4all/methods') return virtual + 'methods';
    },
    load(id) {
      if (!id.startsWith(virtual)) return;
      const key = id.slice(virtual.length), owner = globalThis.__qualiIngestionOwners[key];
      return `const owner=globalThis.__qualiIngestionOwners[${JSON.stringify(key)}];\n` + Object.keys(owner).map(name => name === 'default'
        ? 'export default async function init(){return owner;}'
        : `export const ${name}=owner[${JSON.stringify(name)}];`).join('\n');
    },
  }],
});
try {
  const host = await server.ssrLoadModule('/src/lib/ioImport.ts');
  const { predictionInput } = await server.ssrLoadModule('/src/screens/Predict.tsx');
  const { quickStartDraft } = await server.ssrLoadModule('/src/screens/Projects.tsx');
  const maintenance = await server.ssrLoadModule('/src/screens/Maintenance.tsx');
  const { scoreKnownPredictions } = await server.ssrLoadModule('/src/engine/ownerScores.ts');
  const { toCsv } = await server.ssrLoadModule('/src/lib/export.ts');
  const file = (name, text) => new File([text], name, { type: 'text/csv' });
  const specFor = (name, target = 'protein') => ({
    schema_version: 1, task_type: target === null ? 'auto' : 'regression',
    sample_index: { by: 'id', key: 'sample_id' }, repetition: 'sample_id',
    params: { delimiter: ',', has_header: true, na: { policy: 'ignore' } },
    sources: [{ id: 'observations', input: name, role: 'mixed', params: { header_unit: 'nm' },
      columns: [{ role: 'features', select: ['1000', '1100', '1200'] },
        ...(target === null ? [] : [{ role: 'targets', select: [target] }]),
        { role: 'metadata', select: ['sample_id'] }] }],
  });
  async function materialize(name, text, target = 'protein') {
    const spec = specFor(name, target);
    const record = host.runOwnerCycle(io, { ...host.emptyImport(),
      files: await host.readImportFiles([file(name, text)]), reviewSpecJson: JSON.stringify(spec), specEdited: true, status: 'pending',
    }, stage);
    const projection = host.projectForLab(record, 'routine:contract');
    assert.equal(projection.ok, true, JSON.stringify(projection));
    return { record, projection };
  }

  const external = await materialize('external.csv', 'sample_id,protein,1000,1100,1200\nmissing,,4,5,6\nshared,20,1,2,3\nshared,20,3,4,5');
  const projectSamples = external.projection.samples.map(sample => ({ ...sample,
    reference: { value: sample.id === 'shared' ? 2 : 77, status: 'validated' },
  }));
  const input = predictionInput(external.projection.spectra.samples, 3, projectSamples, 'project-display-name', external.projection);
  assert.deepEqual(input.context, { sampleIds: ['missing', 'shared'], targetName: 'protein', references: [{ sampleId: 'shared', actual: 20 }] });
  assert.deepEqual([...input.X], [4, 5, 6, 2, 3, 4], 'declared repetitions retain their sample mean');
  assert.equal(external.projection.samples[1].repetitions.length, 2);
  const result = { values: Float64Array.of(11, 19), sampleIds: input.context.sampleIds,
    predictionBlock: { producer_node: 'model:fixed-contract', partition: 'final', fold_id: null,
      target_names: ['protein'], sample_ids: ['shared', 'missing'], values: [[19], [11]] } };
  const scored = await scoreKnownPredictions(result, input.context);
  assert.equal(scored.report.metrics.bias, -1, 'loaded y=20 is authoritative; project y=2 is unrelated');
  assert.deepEqual(scored.unscoredSampleIds, ['missing'], 'a masked external target never falls back to project y');
  assert.ok(Object.keys(scored.report.undefined_metrics).length > 0, 'one scored sample retains undefined metric reasons');
  const csvReport = toCsv([{ prediction_report: JSON.stringify(scored.report) }], ['prediction_report']);
  for (const reason of Object.values(scored.report.undefined_metrics)) assert.ok(csvReport.includes(reason), 'owner reason retained in export');
  const reordered = predictionInput([...external.projection.spectra.samples].reverse(), 3, [...projectSamples].reverse(), 'wrong-project-name', external.projection);
  const permuted = await scoreKnownPredictions({ ...result, values: Float64Array.of(19, 11), sampleIds: reordered.context.sampleIds }, reordered.context);
  assert.deepEqual(permuted.report, scored.report);

  const mismatch = await materialize('mismatch.csv', 'sample_id,moisture,1000,1100,1200\nshared,20,1,2,3', 'moisture');
  const mismatchInput = predictionInput(mismatch.projection.spectra.samples, 3, projectSamples, 'protein', mismatch.projection);
  await assert.rejects(() => scoreKnownPredictions({ values: Float64Array.of(19), sampleIds: ['shared'],
    predictionBlock: { ...result.predictionBlock, sample_ids: ['shared'], values: [[19]] } }, mismatchInput.context), /target name differs/);
  const noTarget = await materialize('no-target.csv', 'sample_id,1000,1100,1200\nshared,1,2,3', null);
  const noTargetInput = predictionInput(noTarget.projection.spectra.samples, 3, projectSamples, 'protein', noTarget.projection);
  const unscored = await scoreKnownPredictions({ values: Float64Array.of(19) }, noTargetInput.context);
  assert.equal(unscored.report, undefined);
  assert.deepEqual(unscored.unscoredSampleIds, ['shared']);
  const masked = await materialize('masked.csv', 'sample_id,protein,1000,1100,1200\nshared,20,1,,3');
  assert.ok(Number.isNaN(masked.projection.spectra.samples[0].reps[0].values[1]));
  assert.throws(() => predictionInput(masked.projection.spectra.samples, 3, projectSamples, 'protein', masked.projection), /complete finite spectra/);
  assert.throws(() => predictionInput([{ sampleId: 'short', reps: [{ repId: 'rep', values: Float64Array.of(1, 2) }] }], 3, projectSamples, 'protein'), /complete finite spectra/);

  const loaded = await materialize('monitor.csv', 'sample_id,protein,1000,1100,1200\nS02,2,1,2,3\nS7,7,4,5,6\nS02,2,3,4,5\nS10,10,7,8,9');
  const batch = maintenance.maintenanceBatch(loaded.record, loaded.projection, loaded.projection.spectra);
  assert.equal(batch.record, loaded.record, 'complete owner record retained beside the matrix');
  assert.deepEqual(batch.sampleIds, ['S02', 'S7', 'S10']);
  assert.deepEqual([...batch.X], [2, 3, 4, 4, 5, 6, 7, 8, 9]);
  const analysis = { newPts: [{ idx: 2, x: 0, y: 0, novelty: 5, out: true },
    { idx: 0, x: 0, y: 0, novelty: 4, out: true }, { idx: 1, x: 0, y: 0, novelty: 1, out: false }], threshold: 2.5 };
  const points = maintenance.identifiedDriftPoints(analysis, batch);
  const worklist = maintenance.maintenanceWorklist(points, analysis.threshold);
  const resend = maintenance.maintenanceResend(points, batch.sampleIds, { values: Float64Array.of(20, 5, 10), sampleIds: batch.sampleIds }, [0, 15]);
  assert.deepEqual(worklist.map(item => item.sampleId), ['S10', 'S02']);
  assert.deepEqual(resend.map(item => [item.sampleId, item.predicted]), [['S02', 20], ['S10', 10]]);
  assert.throws(() => maintenance.maintenanceResend(points, batch.sampleIds, { values: Float64Array.of(20, 5, 10), sampleIds: ['S10', 'S7', 'S02'] }, [0, 15]), /identities differ/);
  const controlRows = maintenance.controlExportRows(worklist), resendRows = maintenance.resendExportRows(resend);
  assert.deepEqual(controlRows.map(row => row.sample_id), ['S10', 'S02']);
  assert.deepEqual(resendRows.map(row => [row.sample_id, row.predicted]), [['S02', '20.000'], ['S10', '10.000']]);
  const markup = renderToStaticMarkup(React.createElement('table', null, React.createElement(maintenance.MaintenanceResendBody,
    { resend, tr: (_fr, en) => en })));
  for (const text of [markup, toCsv(controlRows), toCsv(resendRows)]) {
    assert.ok(text.includes('S02') && text.includes('S10'));
    assert.ok(!/N-100\d|predict:/.test(text));
  }
  const replacement = await materialize('replacement.csv', 'sample_id,protein,1000,1100,1200\nnew-owner-id,4,1,2,3');
  assert.deepEqual(maintenance.maintenanceBatch(replacement.record, replacement.projection, replacement.projection.spectra).sampleIds, ['new-owner-id']);
  assert.equal(host.projectForLab(host.invalidateImport(loaded.record), 'pending').ok, false);

  const draft = await quickStartDraft([file('quick-start.csv', 'sample_id,1000,1100,1200\nquick,1,2,3')], null);
  assert.equal(draft.name, 'quick-start');
  assert.equal(draft.record.assembled, null, 'quick drop hands off a draft, not a created project');
  const saved = { ...draft, name: 'Operator name', record: { ...draft.record,
    reviewSpecJson: JSON.stringify({ sources: [], operator_extension: { retain: true } }), specEdited: true } };
  const merged = await quickStartDraft([file('second.csv', 'a\n1')], saved);
  assert.equal(merged.projectId, saved.projectId);
  assert.equal(merged.name, 'Operator name');
  assert.equal(merged.record.reviewSpecJson, saved.record.reviewSpecJson);
  assert.deepEqual(merged.record.files.map(binding => binding.name), ['quick-start.csv', 'second.csv']);
  console.log('Focused ingestion route contracts passed: loaded reference authority, identity, masks and quick-start handoff. No model was fitted.');
} finally {
  await server.close();
  delete globalThis.__qualiIngestionOwners;
}
