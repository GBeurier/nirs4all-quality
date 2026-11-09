// Root-pool source gate, NOT EXECUTED by the author. Real staged owners and the
// named frozen Quali Ridge oracle. Transport/outer-selection verdicts are separate.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { methodsRoot, wasmRoot } from './methods-stage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dagFile = resolve(wasmRoot, 'dagml/dag_ml_wasm.js');
const dag = await import(pathToFileURL(dagFile));
dag.initSync({ module: await readFile(resolve(wasmRoot, 'dagml/dag_ml_wasm_bg.wasm')) });
const dmdFile = resolve(wasmRoot, 'dagml-data/dag_ml_data_wasm.js');
const dmd = await import(pathToFileURL(dmdFile));
dmd.initSync({ module: await readFile(resolve(wasmRoot, 'dagml-data/dag_ml_data_wasm_bg.wasm')) });
const datasetsFile = resolve(wasmRoot, 'datasets/nirs4all_datasets_wasm.js');
const datasets = await import(pathToFileURL(datasetsFile));
datasets.initSync({ module: await readFile(resolve(wasmRoot, 'datasets/nirs4all_datasets_wasm_bg.wasm')) });
const methods = await import(pathToFileURL(resolve(methodsRoot, 'index.js')));
await methods.loadModule();
const controllerModule = await import(pathToFileURL(resolve(wasmRoot, 'dagml/n4m_controller.mjs')));
const { N4mWasmRegressionController: Controller } = controllerModule;
const coreStorageFile = resolve(root, 'vendor/owners-current/core/src/n4a.js');
const storage = await import(pathToFileURL(coreStorageFile));

// Test-only references to actual initialized native namespaces. Explicit exports
// avoid SSR re-evaluation and preserve the real DAG default and prototype spies.
const NATIVE_OWNER_PREFIX = '\0quali-native-owner:';
const nativeOwnerFiles = new Map([
  [dagFile, 'dag'], [dmdFile, 'dmd'], [datasetsFile, 'datasets'], [resolve(methodsRoot, 'index.js'), 'methods'],
  [resolve(wasmRoot, 'dagml/n4m_controller.mjs'), 'controller'], [coreStorageFile, 'storage'],
]);
globalThis.__qualiRidgeNativeOwners = { dag, dmd, datasets, methods, controller: controllerModule, storage };
const nativeOwnerId = file => NATIVE_OWNER_PREFIX + nativeOwnerFiles.get(file);
function nativeOwnerSource(id) {
  if (!id.startsWith(NATIVE_OWNER_PREFIX)) return;
  const key = id.slice(NATIVE_OWNER_PREFIX.length);
  const owner = globalThis.__qualiRidgeNativeOwners[key];
  if (!owner) return;
  return `const owner = globalThis.__qualiRidgeNativeOwners[${JSON.stringify(key)}];\n`
    + Object.keys(owner).map(name => name === 'default'
      ? 'export default owner.default;'
      : `export const ${name} = owner[${JSON.stringify(name)}];`).join('\n');
}
const events = [];
globalThis.__qualiRidgeOwnerEvents = events;
const server = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'actual-ridge-owner-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id === 'nirs4all') return nativeOwnerId(coreStorageFile);
      if (id === 'dag-ml-data-wasm') return nativeOwnerId(dmdFile);
      if (id === '@nirs4all/datasets-wasm') return nativeOwnerId(datasetsFile);
      if (id === 'dag-ml-wasm') return '\0ridge-owner-dag';
      if (id === dagFile || id === '@nirs4all/methods') return nativeOwnerId(id === dagFile ? dagFile : resolve(methodsRoot, 'index.js'));
      if (id === 'dag-ml-wasm/n4m-controller') return nativeOwnerId(resolve(wasmRoot, 'dagml/n4m_controller.mjs'));
    },
    transform(source, id) {
      // Expose the existing frozen private oracle function for test access only.
      // No oracle bytes or implementation are changed on disk.
      if (id.endsWith('/engine/testing/oracle/jsEngine.ts')) {
        assert.ok(source.includes('function fitEval('), 'named oracle source must expose the expected private function');
        return source.replace('function fitEval(', 'export function fitEval(');
      }
    },
    load(id) {
      const nativeSource = nativeOwnerSource(id);
      if (nativeSource !== undefined) return nativeSource;
      if (id !== '\0ridge-owner-dag') return;
      const forwards = ['derive_controller_manifest_json', 'build_execution_plan_json', 'sample_relation_set_fingerprint_json',
        'initial_full_refit_predict_envelope_json'];
      const recorded = ['validate_initial_full_refit_package_json', 'execute_single_holdout_bank_json', 'execute_initial_full_refit_json',
        'replay_initial_full_refit_json', 'score_regression_prediction_block_with_profile_json'];
      return `import * as real from ${JSON.stringify(dagFile)}; export default real.default;\n`
        + forwards.map(name => `export const ${name}=real.${name};`).join('\n')
        + recorded.map(name => `export function ${name}(...args){const text=real.${name}(...args);globalThis.__qualiRidgeOwnerEvents.push({api:${JSON.stringify(name)},args:args.filter(value=>typeof value!=='function'),result:typeof text==='string'?JSON.parse(text):null});return text;}`).join('\n');
    },
  }],
});
after(async () => { delete globalThis.__qualiRidgeOwnerEvents; delete globalThis.__qualiRidgeNativeOwners; await server.close(); });
const load = path => server.ssrLoadModule(`/src/${path}`);
const { CALIB_VARIANTS, runVariant } = await load('engine/variants.ts');
const { dagEngine, runRidgeBank, predictDagModel } = await load('engine/dagEngine.ts');
const { lowerRidgeBank, ridgeTrainCount, ridgeSelectionSplit } = await load('engine/ownerRidgeBanks.ts');
const { importModelContainer, exportModelContainer, QUALI_HOST, qualiHostManifest } = await load('lib/modelIo.ts');
const { reportToMetrics } = await load('engine/ownerReports.ts');
const { fitEval: frozenFitEval, runJsVariant: frozenRunRidge } = await load('engine/testing/oracle/jsEngine.ts');
const { kennardStoneTest: frozenKs } = await load('engine/testing/oracle/jsNumerics.ts');
const { predictWithModel: frozenPredict } = await load('engine/testing/oracle/predict.ts');
const banks = JSON.parse(await readFile(new URL('./fixtures/ridge-owner-banks.json', import.meta.url)));
const api = name => events.filter(event => event.api === name);

test('Ridge exact lowered banks preserve 40/9/49 chain-major identities and explicit parameters', () => {
  for (const expected of banks) {
    const actual = CALIB_VARIANTS.find(variant => variant.id === expected.id).spec;
    assert.deepEqual(actual.chains, expected.chains.map(({ label, ops }) => ({ label, ops })));
    assert.deepEqual(actual.alphas, expected.alphas);
    const lowered = lowerRidgeBank(actual);
    assert.equal(lowered.chains.length * lowered.alphas.length, expected.candidate_count);
    assert.deepEqual(lowered.chains, expected.chains.map(({ label, steps }, chain) => ({ chain, label, steps })));
    assert.deepEqual(lowered.alphas, expected.alphas);
  }
});

async function d1() {
  const { makeDemoState } = await load('store/demo.ts');
  const { buildTrainingDataset } = await load('lib/trainingData.ts');
  const state = makeDemoState(), project = state.projects[0];
  const ds = buildTrainingDataset(state.spectraByProject[project.id], state.samplesByProject[project.id], project.method.target, 'mean');
  assert.deepEqual([ds.nSamples, ds.nFeatures], [26, 200], 'named D1 demo fixture');
  return ds;
}
function subset(ds, n) {
  return { ...ds, X: ds.X.slice(0, n * ds.nFeatures), y: ds.y.slice(0, n), nSamples: n,
    sampleIds: ds.sampleIds.slice(0, n), partitions: ds.partitions.slice(0, n),
    ...(ds.groupIds ? { groupIds: ds.groupIds.slice(0, n) } : {}) };
}
function gather(ds, ids) {
  const rows = new Map(ds.sampleIds.map((id, i) => [id, i]));
  return Float64Array.from(ids.flatMap(id => Array.from(ds.X.subarray(rows.get(id) * ds.nFeatures, (rows.get(id) + 1) * ds.nFeatures))));
}
function byId(block, ids) {
  assert.equal(new Set(block.sample_ids).size, ids.length);
  const rows = new Map(block.sample_ids.map((id, i) => [id, block.values[i][0]]));
  return ids.map(id => { assert.ok(rows.has(id)); return rows.get(id); });
}

test('Ridge count is half-up and KS train gather is by materialized row, with unchanged validation order', async () => {
  assert.deepEqual([25, 26, 30].map(ridgeTrainCount), [19, 20, 23]);
  const full = await d1();
  for (const ds of [full, subset(full, 25)]) {
    // Deliberately oppose lexical ID ordering to materialized row ordering.
    ds.sampleIds = ds.sampleIds.map((_, i) => `row-${String(ds.nSamples - i).padStart(3, '0')}`);
    const expectedValid = frozenKs(ds.X, ds.nSamples, ds.nFeatures, .25);
    const expectedTrain = Array.from({ length: ds.nSamples }, (_, i) => i).filter(i => !expectedValid.includes(i));
    const actual = ridgeSelectionSplit(ds, methods);
    assert.deepEqual(actual, { train: expectedTrain, valid: expectedValid });
    assert.equal(actual.train.length, ridgeTrainCount(ds.nSamples));
    assert.deepEqual(actual.train.map(i => ds.sampleIds[i]), expectedTrain.map(i => ds.sampleIds[i]));
  }
});

// Inherited B1 diagnostic only; strict native selection/ordinal checks below
// never permit a winner change within this tolerance. Raw differences are logged.
const TOL = 1e-9;
function diagnostic(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  const scale = Math.max(...expected.map(Math.abs)) || 1;
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) / scale <= TOL, `${label}: row ${i}`));
}

test('Ridge all three D1 banks use one owner batch, native ordinal selection and one all-labelled deployment refit', async () => {
  const ds = await d1();
  for (const expectedBank of banks) {
    const variant = CALIB_VARIANTS.find(v => v.id === expectedBank.id), spec = variant.spec;
    const { train, valid } = ridgeSelectionSplit(ds, methods);
    const trainIds = train.map(i => ds.sampleIds[i]), validIds = valid.map(i => ds.sampleIds[i]);
    const tasks = [], fits = [], splits = [];
    let callbackDepth = 0;
    const invoke = Controller.prototype.invoke, fit = methods.RolePipeline.prototype.fit, split = methods.KennardStone.prototype.split;
    Controller.prototype.invoke = function(id, text) {
      const task = JSON.parse(text);
      if (!task.operation) tasks.push(task);
      callbackDepth++;
      try { return invoke.call(this, id, text); } finally { callbackDepth--; }
    };
    methods.RolePipeline.prototype.fit = function(...args) {
      fits.push({ fromController: callbackDepth > 0, rows: args[0].rows });
      return fit.apply(this, args);
    };
    methods.KennardStone.prototype.split = function(...args) {
      splits.push({ ...this.params });
      return split.apply(this, args);
    };
    events.length = 0;
    let result;
    try { result = await runVariant(ds, variant, dagEngine); }
    finally {
      Controller.prototype.invoke = invoke;
      methods.RolePipeline.prototype.fit = fit;
      methods.KennardStone.prototype.split = split;
    }
    assert.deepEqual(splits, [{ n_train: 20 }], 'count-only generic role, no fractional call');
    assert.equal(api('execute_single_holdout_bank_json').length, 1);
    assert.equal(api('execute_initial_full_refit_json').length, 1);
    assert.equal(fits.length, expectedBank.candidate_count + 1);
    assert.ok(fits.every(call => call.fromController), 'no host fit');
    assert.deepEqual(fits.filter(call => call.rows === ds.nSamples).map(call => call.rows), [26]);
    const bank = api('execute_single_holdout_bank_json')[0].result;
    assert.equal(bank.variants.length, expectedBank.candidate_count);
    assert.deepEqual(result.candidateIssues, []);
    for (const task of tasks.filter(task => task.phase === 'FIT_CV')) {
      assert.deepEqual(Object.values(task.data_views).find(view => view.partition === 'fold_train').sample_ids, trainIds);
      assert.deepEqual(Object.values(task.data_views).find(view => view.partition === 'fold_validation').sample_ids, validIds);
    }
    assert.deepEqual(tasks.filter(task => task.phase === 'REFIT').map(task => Object.values(task.data_views).find(view => view.partition === 'full_train').sample_ids), [ds.sampleIds]);
    const paired = [], differences = [];
    for (const chain of spec.chains) for (const alpha of spec.alphas) {
      const evidence = bank.variants[paired.length], ordinal = `ord:${String(paired.length).padStart(5, '0')}`;
      assert.equal(evidence.identity.ordinal, ordinal);
      assert.equal(evidence.identity.chain_label, chain.label);
      assert.equal(evidence.identity.params.alpha, alpha);
      assert.equal(evidence.eligible, true);
      const oracle = frozenFitEval(chain.ops, alpha, ds, train, valid);
      diagnostic([evidence.report.metrics.rmse], [oracle.rmse], `${variant.id}/${ordinal}/RMSE`);
      const predicted = byId(evidence.validation_predictions, validIds);
      diagnostic(predicted, oracle.preds, `${variant.id}/${ordinal}/predictions`);
      differences.push({ ordinal, rmse_delta: evidence.report.metrics.rmse - oracle.rmse,
        prediction_deltas: predicted.map((value, i) => value - oracle.preds[i]) });
      const direct = methods.RolePipeline.fromSteps(evidence.identity.recipe);
      try {
        direct.fit({ data: gather(ds, trainIds), rows: train.length, cols: ds.nFeatures }, Float64Array.from(train.map(i => ds.y[i])));
        assert.deepEqual(predicted, Array.from(direct.predict({ data: gather(ds, validIds), rows: valid.length, cols: ds.nFeatures }).data));
      } finally { direct.dispose(); }
      paired.push({ evidence, oracle });
    }
    console.log(JSON.stringify({ fixture: 'D1', bank: variant.id, diagnostic_tolerance: TOL, differences }));
    const first = paired.reduce((best, candidate) => candidate.oracle.rmse < best.oracle.rmse ? candidate : best).evidence;
    assert.equal(bank.decision.selected_candidate_id, first.identity.ordinal, 'no tolerance in winner comparison');
    assert.equal(result.model.state.selectedOrdinal, first.identity.ordinal);
    assert.equal(result.model.state.selectedVariantId, first.identity.variant_id);
    assert.equal(result.model.state.chainLabel, first.identity.chain_label);
    assert.deepEqual(result.model.state.params, { alpha: first.identity.params.alpha });
    if (variant.id === 'ridge-cart') {
      assert.equal(result.model.state.chainLabel, 'SNV + detrend');
      assert.equal(result.model.state.params.alpha, 10);
      assert.equal(result.model.state.selectedOrdinal, 'ord:00038');
    }
    assert.equal(result.model.state.backendId, 'dag-ml-methods-ridge');
    assert.equal(result.model.state.deploymentScope, 'all_labelled');
    assert.deepEqual(result.model.state.trainingSampleIds, ds.sampleIds);
    assert.deepEqual(JSON.parse(result.model.state.packageJson).training_sample_ids, ds.sampleIds);
    const scopedPackage = JSON.parse(result.model.state.packageJson);
    const scopedSource = scopedPackage.training_envelope.relation_fingerprint;
    assert.notEqual(scopedSource, dag.sample_relation_set_fingerprint_json(JSON.stringify(scopedPackage.training_relations)), 'real DMD source S differs from canonical C');
    assert.deepEqual(scopedPackage.training_envelope.coordinator_relations, scopedPackage.training_relations);
    assert.equal(scopedPackage.data_identities.length, 1);
    assert.ok(scopedPackage.data_identities.every(identity => identity.relation_fingerprint === scopedSource));
    assert.equal(scopedSource, JSON.parse(api('execute_single_holdout_bank_json')[0].args[2]).relation_fingerprint, 'Ridge deploys the full labelled source authority');
    assert.deepEqual(result.refit.ownerReport, first.report);
    assert.deepEqual(result.refit.metrics, reportToMetrics(first.report));
    assert.deepEqual(result.refit.predictions.map(row => row.predicted), byId(first.validation_predictions, validIds));
    assert.deepEqual(result.evaluation, { scope: 'selection_validation', independent_test: false });
    const deploy = api('execute_initial_full_refit_json')[0].result;
    const fittedPredictions = deploy.node_results.flatMap(node => node.predictions);
    assert.equal(fittedPredictions.length, 1);
    const replay = await predictDagModel(result.model, ds.X, ds.nSamples, ds.nFeatures, { sampleIds: ds.sampleIds });
    assert.deepEqual(Array.from(replay.values), byId(fittedPredictions[0], ds.sampleIds), 'hydrated replay equals actual all-row REFIT predictions bitwise');
    const oracle = frozenRunRidge(ds, spec, `Frozen ${variant.id}`);
    const expected = await frozenPredict(oracle.model, ds.X, ds.nSamples, ds.nFeatures);
    diagnostic(Array.from(replay.values), Array.from(expected.values), `${variant.id}/all-labelled-deployment`);
    assert.ok(valid.some((row, i) => replay.values[row] !== result.refit.predictions[i].predicted), 'deployment differs from the holdout fit');
    assert.equal(result.variants.filter(value => value.selected).length, 1);
    const bundle = { schema: QUALI_HOST.schema, schema_version: 1, selectedProfileId: variant.id,
      model: result.model, engine: result.engine, pipeline: result.pipelineName, targetName: result.targetName,
      nFeatures: ds.nFeatures, yRange: [Math.min(...ds.y), Math.max(...ds.y)], createdAt: result.createdAt,
      metrics: result.refit.metrics, ownerReport: result.refit.ownerReport, population: result.population,
      evaluation: result.evaluation, candidateIssues: result.candidateIssues ?? [], failedPipelines: [],
      leaderboard: [{ profileId: variant.id, ownerReport: result.refit.ownerReport, population: result.population, evaluation: result.evaluation }] };
    const refitsBefore = api('execute_initial_full_refit_json').length;
    const bytes = await exportModelContainer(bundle);
    if (process.env.QUALI_MODEL_OUTPUT_DIR) await writeFile(resolve(process.env.QUALI_MODEL_OUTPUT_DIR, `${variant.id}-d1.n4a`), bytes, { flag: 'wx' });
    const opened = await storage.openN4aContainer(bytes);
    try { assert.deepEqual(opened.artifactMemberPaths(QUALI_HOST.path), [QUALI_HOST.path]); }
    finally { opened.close(); }
    const fresh = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [{ name: 'real-storage-and-owners', enforce: 'pre', resolveId(id) {
        if (id === 'nirs4all') return nativeOwnerId(coreStorageFile);
        if (id === 'dag-ml-data-wasm') return nativeOwnerId(dmdFile);
        if (id === '@nirs4all/datasets-wasm') return nativeOwnerId(datasetsFile);
        if (id === 'dag-ml-wasm') return nativeOwnerId(dagFile);
        if (id === '@nirs4all/methods') return nativeOwnerId(resolve(methodsRoot, 'index.js'));
        if (id === 'dag-ml-wasm/n4m-controller') return nativeOwnerId(resolve(wasmRoot, 'dagml/n4m_controller.mjs'));
      }, load: nativeOwnerSource }],
    });
    let imported;
    try { imported = await (await fresh.ssrLoadModule('/src/lib/modelIo.ts')).importModelContainer(new Blob([bytes])); }
    finally { await fresh.close(); }
    assert.ok('model' in imported);
    assert.equal(imported.model.model.state.packageJson, result.model.state.packageJson);
    assert.deepEqual(imported.model.sourceBundle, bundle);
    assert.deepEqual(imported.model.ownerReport, result.refit.ownerReport);
    const reversed = [...ds.sampleIds].reverse();
    const importedPrediction = await predictDagModel(imported.model.model, gather(ds, reversed), reversed.length, ds.nFeatures, { sampleIds: reversed });
    assert.deepEqual(Array.from(importedPrediction.values), [...replay.values].reverse());
    assert.equal(api('execute_initial_full_refit_json').length, refitsBefore, 'transport/replay creates no fresh fit');
    const unqualified = { ...bundle, selectedProfileId: 'unqualified-ridge' };
    const payload = new TextEncoder().encode(JSON.stringify(unqualified));
    const { createHash } = await import('node:crypto');
    const fingerprint = createHash('sha256').update(payload).digest('hex');
    const invalid = await storage.writeN4aContainer(qualiHostManifest(fingerprint), [{ path: QUALI_HOST.path, bytes: payload }]);
    events.length = 0;
    assert.ok('error' in await importModelContainer(invalid.archiveBytes));
    assert.equal(events.length, 0, 'unqualified Ridge profile refused before DAG');

  }
});

test('Ridge duplicate scores keep the first ordinal and failed chains are explicit owner issues', async () => {
  const full = await d1();
  const axis = { fr: 'chain', en: 'chain' };
  // Positive distinct penalties and distinct recipes are valid owner choices.
  // An exact zero target gives every Ridge candidate the same zero residual.
  const tieData = { ...full, y: new Float64Array(full.nSamples) };
  const tied = await runRidgeBank(tieData, { kind: 'js_ridge_screen',
    chains: [{ label: 'first', ops: [] }, { label: 'second', ops: ['snv'] }], alphas: [1, 2], axis }, 'ties', 'ridge-ties');
  const tieBank = api('execute_single_holdout_bank_json').at(-1).result;
  assert.deepEqual(tieBank.variants.map(candidate => candidate.report.metrics.rmse), [0, 0, 0, 0], 'actual native scores tie exactly');
  assert.equal(tieBank.decision.selected_candidate_id, 'ord:00000');
  assert.equal(tied.model.state.selectedOrdinal, 'ord:00000');
  assert.deepEqual(tied.variants.map(value => value.selected), [true, false]);
  const ds = { ...full, nFeatures: 2, axis: full.axis.slice(0, 2),
    X: Float64Array.from(Array.from({ length: full.nSamples }, (_, i) => Array.from(full.X.subarray(i * full.nFeatures, i * full.nFeatures + 2))).flat()) };
  const failed = { kind: 'js_ridge_screen', chains: [{ label: 'raw', ops: [] }, { label: 'd2', ops: ['diff2'] }], alphas: [1], axis };
  const partial = await runRidgeBank(ds, failed, 'chain failure', 'ridge-partial');
  assert.deepEqual(partial.candidateIssues.map(issue => [issue.label, issue.status]), [['d2', 'failed']]);
  assert.deepEqual(partial.variants.map(value => value.label), ['raw']);
  await assert.rejects(() => runRidgeBank(ds, { ...failed, chains: [failed.chains[1]] }, 'all fail', 'ridge-all-fail'),
    error => /No Ridge candidates/.test(error.message) && error.candidateIssues[0].status === 'failed');
  const variant = CALIB_VARIANTS.find(value => value.id === 'fast-aom-ridge');
  await assert.rejects(() => runVariant(full, variant, { name: 'unavailable' }), error => /No Ridge candidates/.test(error.message) && error.candidateIssues.length === 3);
});
