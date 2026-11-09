// Root-pool gate, NOT EXECUTED by the author. Actual staged DAG/Methods and
// named Core portable oracle; frozen historical JS regressions stay separate.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
const oracleRoot = process.env.QUALI_PLS_ORACLE_CORE_ROOT;
const oracleMethodsRoot = process.env.QUALI_PLS_ORACLE_METHODS_ROOT;
assert.ok(oracleRoot && oracleMethodsRoot, 'Root must supply the frozen pre-count Core package and complete e63 Methods module; no current-owner substitution');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshotBytes = await readFile(resolve(oracleRoot, '../SNAPSHOT.json'));
assert.equal(digest(snapshotBytes), '918d48835586ce15ba9d23cfb1706261819ced3847dcb957ad199db718e83f3c');
for (const file of JSON.parse(snapshotBytes).files) assert.equal(digest(await readFile(resolve(oracleRoot, file.path))), file.sha256);
assert.equal(digest(await readFile(resolve(oracleRoot, 'src/execution.js'))), 'dcc35fbe1a741764864c75786172362949e79815c862a014a08eafe535bee962');
assert.equal(digest(await readFile(resolve(oracleMethodsRoot, 'n4m.wasm'))), 'e63a5dffbe7837dd856177967a546fcbe4ef992778d8eaa6d9b6f83c9e958891');
const oracleMethods = await import(pathToFileURL(resolve(oracleMethodsRoot, 'index.js')));
await oracleMethods.loadModule();
const core = await import(pathToFileURL(resolve(oracleRoot, 'src/execution.js')));
const coreStorageFile = resolve(root, 'vendor/owners-current/core/src/n4a.js');
const storage = await import(pathToFileURL(coreStorageFile));

// Test-only references to actual initialized native namespaces. Explicit exports
// avoid SSR re-evaluation and preserve the real DAG default and prototype spies.
const NATIVE_OWNER_PREFIX = '\0quali-native-owner:';
const nativeOwnerFiles = new Map([
  [dagFile, 'dag'], [dmdFile, 'dmd'], [datasetsFile, 'datasets'], [resolve(methodsRoot, 'index.js'), 'methods'],
  [resolve(wasmRoot, 'dagml/n4m_controller.mjs'), 'controller'], [coreStorageFile, 'storage'],
]);
globalThis.__qualiPlsNativeOwners = { dag, dmd, datasets, methods, controller: controllerModule, storage };
const nativeOwnerId = file => NATIVE_OWNER_PREFIX + nativeOwnerFiles.get(file);
function nativeOwnerSource(id) {
  if (!id.startsWith(NATIVE_OWNER_PREFIX)) return;
  const key = id.slice(NATIVE_OWNER_PREFIX.length);
  const owner = globalThis.__qualiPlsNativeOwners[key];
  if (!owner) return;
  return `const owner = globalThis.__qualiPlsNativeOwners[${JSON.stringify(key)}];\n`
    + Object.keys(owner).map(name => name === 'default'
      ? 'export default owner.default;'
      : `export const ${name} = owner[${JSON.stringify(name)}];`).join('\n');
}
const produced = [];
const events = [];
globalThis.__qualiOwnerEvents = events;
// Named historical adapter boundary forwards the actual pinned Core implementation.
globalThis.__qualiPinnedCoreOracle = {
  runPortablePipeline: (source, data) => core.runPortablePipeline(source, data, { methods: oracleMethods }),
  predictPortablePipeline: (state, data) => core.predictPortablePipeline(state, data, { methods: oracleMethods }),
};
const server = await createServer({ configFile: false, root, server: { middlewareMode: true },
  resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'actual-owner-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id === 'virtual:pinned-core-test-oracle') return '\0pinned-core-test-oracle';
      if (id === 'dag-ml-wasm') return '\0owner-dag';
      if (id === 'nirs4all') return nativeOwnerId(coreStorageFile);
      if (id === 'dag-ml-data-wasm') return nativeOwnerId(dmdFile);
      if (id === '@nirs4all/datasets-wasm') return nativeOwnerId(datasetsFile);
      if (id === dagFile || id === '@nirs4all/methods') return nativeOwnerId(id === dagFile ? dagFile : resolve(methodsRoot, 'index.js'));
      if (id === 'dag-ml-wasm/n4m-controller') return nativeOwnerId(resolve(wasmRoot, 'dagml/n4m_controller.mjs'));
    },
    transform(source, id) {
      if (id.endsWith('/engine/testing/oracle/wasmEngine.ts')) return source.replace("from 'nirs4all'", "from 'virtual:pinned-core-test-oracle'");
    },
    load(id) {
      const nativeSource = nativeOwnerSource(id);
      if (nativeSource !== undefined) return nativeSource;
      if (id === '\0pinned-core-test-oracle') return `export const runPortablePipeline=(...args)=>globalThis.__qualiPinnedCoreOracle.runPortablePipeline(...args); export const predictPortablePipeline=(...args)=>globalThis.__qualiPinnedCoreOracle.predictPortablePipeline(...args);`;
      if (id !== '\0owner-dag') return;
      const forwards = ['derive_controller_manifest_json', 'build_execution_plan_json', 'sample_relation_set_fingerprint_json',
        'initial_full_refit_predict_envelope_json'];
      const recorded = ['validate_initial_full_refit_package_json', 'execute_single_holdout_bank_json', 'score_regression_prediction_block_with_profile_json',
        'execute_initial_full_refit_json', 'replay_initial_full_refit_json'];
      return `import * as real from ${JSON.stringify(dagFile)}; export default real.default;\n`
        + forwards.map(name => `export const ${name}=real.${name};`).join('\n')
        + recorded.map(name => `export function ${name}(...args){ const text=real.${name}(...args); globalThis.__qualiOwnerEvents.push({api:${JSON.stringify(name)},args:args.filter(value=>typeof value!=='function'),result:typeof text==='string'?JSON.parse(text):null});return text;}`).join('\n');
    },
  }],
});
after(async () => { delete globalThis.__qualiOwnerEvents; delete globalThis.__qualiPinnedCoreOracle; delete globalThis.__qualiPlsNativeOwners; await server.close(); });
const load = name => server.ssrLoadModule(`/src/${name}`);
const { CALIB_VARIANTS, runVariant } = await load('engine/variants.ts');
const { dagEngine, runPlsBank } = await load('engine/dagEngine.ts');
const { lowerPlsBank, lowerPlsSteps } = await load('engine/ownerRecipes.ts');
const { reportToMetrics, REPORT_PROFILE } = await load('engine/ownerReports.ts');
const { scoreKnownPredictions } = await load('engine/ownerScores.ts');
const { predictWithModel } = await load('engine/predict.ts');
const { exportModelContainer, importModelContainer, QUALI_HOST, qualiHostManifest } = await load('lib/modelIo.ts');
const { isOwnerReport } = await load('engine/ownerReports.ts');
const expected = JSON.parse(await readFile(new URL('./fixtures/pls-owner-banks.json', import.meta.url)));
const apiEvents = name => events.filter(e => e.api === name);
function ownerBundle(result, selectedProfileId, ds) {
  return { schema: QUALI_HOST.schema, schema_version: 1, selectedProfileId,
    model: result.model, engine: result.engine, pipeline: result.pipelineName, targetName: result.targetName,
    nFeatures: ds.nFeatures, yRange: [Math.min(...ds.y), Math.max(...ds.y)], createdAt: result.createdAt,
    metrics: result.refit.metrics, ownerReport: result.refit.ownerReport, population: result.population,
    evaluation: result.evaluation, candidateIssues: result.candidateIssues ?? [], failedPipelines: [],
    leaderboard: [{ profileId: selectedProfileId, ownerReport: result.refit.ownerReport, population: result.population, evaluation: result.evaluation }] };
}
async function existingBundle() {
  if (produced[0]) return structuredClone(produced[0].bundle);
  assert.ok(process.env.QUALI_MODEL_FIXTURE, 'Root supplies QUALI_MODEL_FIXTURE for isolated transport gates; no fresh fit');
  const opened = await storage.openN4aContainer(new Uint8Array(await readFile(process.env.QUALI_MODEL_FIXTURE)));
  try { return JSON.parse(new TextDecoder().decode(await opened.readMember(QUALI_HOST.path))); }
  finally { opened.close(); }
}
async function createFreshHost() {
  const fresh = await createServer({ configFile: false, root, server: { middlewareMode: true },
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
  return { async importModelContainer(source) {
    try { return await (await fresh.ssrLoadModule('/src/lib/modelIo.ts')).importModelContainer(source); }
    finally { await fresh.close(); }
  } };
}


test('all three lowered PLS banks retain every exact step, grid and refusal', () => {
  for (const bank of expected) {
    const variant = CALIB_VARIANTS.find(v => v.id === bank.id);
    assert.equal(variant.spec.maxComp, bank.maxComp);
    assert.deepEqual(variant.spec.screen.map(c => c.label), bank.labels);
    const actual = lowerPlsBank(variant.spec, 26, 200);
    assert.deepEqual(actual.candidateIssues.map(i => [i.label, i.status]), bank.refused.map(label => [label, 'refused']));
    // Test-only materialization of the two axes; production does not expand or run candidates.
    const flat = actual.chains.flatMap(c => actual.components.map(n => ({ id: `c${String(c.chain).padStart(2, '0')}:n${String(n).padStart(2, '0')}`,
      chain: c.chain, label: c.label, n, steps: lowerPlsSteps(variant.spec.screen[c.chain].steps, n) })));
    assert.deepEqual(flat, bank.candidates);
  }
});

test('artifact hashing matches SHA-256 across byte-view and block boundaries', async () => {
  const { artifactDigest } = await load('engine/artifactDigest.ts');
  for (const size of [0, 3, 55, 56, 63, 64, 65, 1000]) {
    const bytes = Uint8Array.from({ length: size + 11 }, (_, i) => i * 17).subarray(5, 5 + size);
    assert.equal(artifactDigest(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
});

function synthetic() {
  // Existing scientific-contract formula, explicitly widened to exercise all SG windows.
  const n = 12, p = 35;
  return { X: Float64Array.from({ length: n * p }, (_, k) => {
    const i = Math.floor(k / p), j = k % p;
    return 1 + i * 0.4 + (j + 1) ** 2 * (1 + i * 0.07) + Math.sin(i + j) * 0.5;
  }), y: Float64Array.from({ length: n }, (_, i) => 2 + i * 0.8 + Math.cos(i)), nSamples: n, nFeatures: p,
    axis: Array.from({ length: p }, (_, i) => i), axisUnit: 'nm', sampleIds: Array.from({ length: n }, (_, i) => `sample-${i}`),
    partitions: Array(n).fill('train'), targetName: 'concentration', taskType: 'regression' };
}
async function fixtures() {
  const { makeDemoState } = await load('store/demo.ts');
  const { buildTrainingDataset } = await load('lib/trainingData.ts');
  const demo = makeDemoState(), project = demo.projects[0];
  return [['Quali demo mean spectra', buildTrainingDataset(demo.spectraByProject[project.id], demo.samplesByProject[project.id], project.method.target, 'mean')],
    ['scientific-contract formula, 35 features', synthetic()]];
}
function gather(ds, ids) {
  return Float64Array.from(ids.flatMap(id => Array.from(ds.X.subarray(ds.sampleIds.indexOf(id) * ds.nFeatures, (ds.sampleIds.indexOf(id) + 1) * ds.nFeatures))));
}

// Prior B1 diagnostic tolerance is retained. Selection/report RMSE and train-only
// owner predictions below use exact equality and never accept a winner flip.
const TOL = 1e-9;
function close(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  const scale = Math.max(...expected.map(Math.abs)) || 1;
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) / scale <= TOL, `${label}: row ${i}`));
}

test('real DMD scopes retain declared IDs, masks and ordered source authority without a fit', async () => {
  const { loadDataOwners, nativeDataset } = await load('engine/ownerData.ts');
  const owners = await loadDataOwners(), original = synthetic();
  assert.equal(owners.dmd.build_coordinator_data_plan_envelope_json, dmd.build_coordinator_data_plan_envelope_json);
  assert.equal(owners.dmd.WasmInMemoryProvider, dmd.WasmInMemoryProvider);
  assert.equal(owners.hash, datasets.sha256);
  const ds = { ...original, groupIds: original.sampleIds.map(id => `group-${id}`) };
  const ids = [ds.sampleIds[7], ds.sampleIds[2], ds.sampleIds[10]];
  const request = { requestId: 'quali:pls:x', nodeId: 'model:quali.pls', phase: 'REFIT' };
  const scoped = nativeDataset(owners, ds, ids, request);
  assert.deepEqual(scoped.dataset.sampleIds, ids, 'original identities and requested order, no cohort renumbering');
  assert.deepEqual(scoped.dataset.X, gather(ds, ids));
  assert.deepEqual(Array.from(scoped.dataset.y), ids.map(id => ds.y[ds.sampleIds.indexOf(id)]));
  assert.deepEqual(scoped.dataset.axis, ds.axis);
  assert.equal(scoped.dataset.axisUnit, ds.axisUnit);
  assert.deepEqual(scoped.dataset.groupIds, ids.map(id => `group-${id}`));
  const records = scoped.envelope.coordinator_relations.records;
  assert.deepEqual(records.map(row => row.sample_id).sort(), [...ids].sort());
  for (const row of records) {
    assert.equal(row.observation_id, row.sample_id, 'declared positional 1:1 provenance');
    assert.equal(row.group_id, `group-${row.sample_id}`);
    assert.equal(row.origin_sample_id, null, 'no stronger origin claim');
    assert.equal(row.target_id, 'y');
    assert.equal(row.metadata.identity_basis, 'positional');
    assert.equal(row.metadata.observation_id_basis, 'synthetic_1_to_1_from_declared_sample_id');
  }
  assert.notEqual(scoped.envelope.relation_fingerprint,
    dag.sample_relation_set_fingerprint_json(JSON.stringify(scoped.envelope.coordinator_relations)));
  assert.doesNotThrow(() => dmd.validate_coordinator_data_plan_envelope_json(JSON.stringify(scoped.envelope)));
  const changedHeldout = { ...ds, y: Float64Array.from(ds.y, (value, row) => ids.includes(ds.sampleIds[row]) ? value : value + 1000) };
  assert.deepEqual(nativeDataset(owners, changedHeldout, ids, request).envelope, scoped.envelope, 'held-out targets never enter scoped authority');
  const ungrouped = nativeDataset(owners, original, ids, request);
  assert.ok(ungrouped.envelope.coordinator_relations.records.every(row => row.group_id === null), 'absent groups are never inferred from IDs');
  const masked = ds.X.slice(); masked[7 * ds.nFeatures] = NaN;
  assert.throws(() => nativeDataset(owners, { ...ds, X: masked }, ids, request), undefined, 'the dense owner refuses selected missing cells without imputation');
});


test('one owner call per bank: exact native RMSE, ordinal winner, greedy train-only REFIT and hydrated replay', async () => {
  for (const [fixture, ds] of await fixtures()) for (const variant of CALIB_VARIANTS.filter(v => v.spec.kind === 'wasm_pls_screen')) {
    events.length = 0;
    const context = `${fixture}: ${variant.id}`, calls = [], invoke = Controller.prototype.invoke;
    Controller.prototype.invoke = function(id, text) {
      const task = JSON.parse(text);
      if (!task.operation) calls.push(task);
      return invoke.call(this, id, text);
    };
    let result;
    try { result = await runVariant(ds, variant, dagEngine); }
    finally { Controller.prototype.invoke = invoke; }
    const bankCalls = apiEvents('execute_single_holdout_bank_json');
    assert.equal(bankCalls.length, 1, context);
    const bank = bankCalls[0].result, lowered = lowerPlsBank(variant.spec, ds.nSamples, ds.nFeatures);
    assert.equal(bank.variants.length, lowered.chains.length * lowered.components.length, context);
    assert.deepEqual(result.candidateIssues.map(i => [i.label, i.status]), lowered.candidateIssues.map(i => [i.label, i.status]), context);
    const split = methods.computeSplitIndices('KennardStone', { data: ds.X, rows: ds.nSamples, cols: ds.nFeatures }, null, { testSize: .25 });
    const trainIds = Array.from(split.trainIndices, i => ds.sampleIds[i]), validIds = Array.from(split.testIndices, i => ds.sampleIds[i]);
    for (const task of calls.filter(t => t.phase === 'FIT_CV')) {
      assert.deepEqual(Object.values(task.data_views).find(v => v.partition === 'fold_train').sample_ids, trainIds, context);
      assert.deepEqual(Object.values(task.data_views).find(v => v.partition === 'fold_validation').sample_ids, validIds, context);
    }
    const paired = [];
    for (const chain of lowered.chains) {
      const recipe = variant.spec.screen[chain.chain];
      const source = { name: context, pipeline: [
        { class: 'nirs4all.operators.splitters.KennardStoneSplitter', params: { test_size: .25 } },
        ...recipe.steps.map(s => ({ class: `nirs4all.operators.transforms.${s.type}`, params: s.params })),
        { model: { class: 'sklearn.cross_decomposition.PLSRegression', params: { n_components: lowered.components.at(-1) } }, param: 'n_components', _range_: [1, lowered.components.at(-1), 1] },
      ] };
      const oracle = await core.runPortablePipeline(source, { X: ds.X, y: ds.y, rows: ds.nSamples, cols: ds.nFeatures }, { methods: oracleMethods });
      assert.deepEqual(oracle.split.trainIndices, Array.from(split.trainIndices), context);
      assert.deepEqual(oracle.split.testIndices, Array.from(split.testIndices), context);
      for (const n of lowered.components) {
        const evidence = bank.variants[paired.length];
        assert.equal(evidence.identity.ordinal, `ord:${String(paired.length).padStart(5, '0')}`, context);
        assert.equal(evidence.identity.chain_label, chain.label, context);
        assert.equal(evidence.identity.params.n_components, n, context);
        assert.deepEqual(evidence.identity.recipe, lowerPlsSteps(recipe.steps, n), context);
        assert.equal(evidence.eligible, true, context);
        const expected = oracle.variants.find(v => v.n_components === n);
        assert.equal(evidence.report.metrics.rmse, expected.rmse, `${context}: exact candidate RMSE`);
        close(evidence.validation_predictions.values.flat(), expected.predictions, context);
        paired.push({ evidence, rmse: expected.rmse });
      }
    }
    const first = paired.reduce((a, b) => b.rmse < a.rmse ? b : a).evidence;
    assert.equal(result.model.state.selectedCandidateId, first.identity.ordinal, context);
    assert.equal(result.model.state.selectedVariantId, first.identity.variant_id, context);
    assert.deepEqual(result.refit.ownerReport, first.report, context);
    assert.deepEqual(result.refit.metrics, reportToMetrics(first.report), context);
    assert.deepEqual(result.model.state.trainingSampleIds, trainIds, context);
    const scopedPackage = JSON.parse(result.model.state.packageJson);
    const scopedSource = scopedPackage.training_envelope.relation_fingerprint;
    assert.notEqual(scopedSource, dag.sample_relation_set_fingerprint_json(JSON.stringify(scopedPackage.training_relations)), 'real DMD source S differs from canonical C');
    assert.deepEqual(scopedPackage.training_envelope.coordinator_relations, scopedPackage.training_relations, 'exact typed owner records survive the package');
    assert.equal(scopedPackage.data_identities.length, 1);
    assert.ok(scopedPackage.data_identities.every(identity => identity.relation_fingerprint === scopedSource), 'training identities retain source S');
    assert.deepEqual(scopedPackage.training_sample_ids, trainIds, 'DMD canonical serialization never sorts the greedy fit cohort');
    assert.notEqual(scopedSource, JSON.parse(bankCalls[0].args[2]).relation_fingerprint, 'PLS source authority is scoped to KS train');
    assert.deepEqual(calls.filter(t => t.phase === 'REFIT').map(t => Object.values(t.data_views).find(v => v.partition === 'full_train').sample_ids), [trainIds], context);
    const owner = methods.RolePipeline.fromSteps(first.identity.recipe);
    try {
      owner.fit({ data: gather(ds, trainIds), rows: trainIds.length, cols: ds.nFeatures }, Float64Array.from(trainIds.map(id => ds.y[ds.sampleIds.indexOf(id)])));
      assert.deepEqual(result.refit.predictions.map(r => r.predicted), Array.from(owner.predict({ data: gather(ds, validIds), rows: validIds.length, cols: ds.nFeatures }).data), context);
    } finally { owner.dispose(); }
    const bundle = ownerBundle(result, variant.id, ds);
    produced.push({ bundle, result, ds });
    const packageBefore = result.model.state.packageJson;
    const refitCallsBefore = apiEvents('execute_initial_full_refit_json').length;
    const bytes = await exportModelContainer(bundle);
    if (process.env.QUALI_MODEL_OUTPUT_DIR) await writeFile(resolve(process.env.QUALI_MODEL_OUTPUT_DIR, `${variant.id}-${fixture.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.n4a`), bytes, { flag: 'wx' });
    const inventory = await storage.openN4aContainer(bytes);
    try { assert.deepEqual(inventory.artifactMemberPaths(QUALI_HOST.path), [QUALI_HOST.path]); }
    finally { inventory.close(); }
    // Fresh host context, same real Core API and owner, no fresh fit.
    const fresh = await createFreshHost();
    const imported = await fresh.importModelContainer(new Blob([bytes]));
    assert.ok('model' in imported, imported.error ?? context);
    assert.equal(imported.model.model.state.packageJson, packageBefore);
    assert.deepEqual(imported.model.model.state.trainingSampleIds, result.model.state.trainingSampleIds);
    assert.equal(apiEvents('execute_initial_full_refit_json').length, refitCallsBefore);
    assert.ok('model' in imported, context);
    assert.deepEqual(imported.model.ownerReport, result.refit.ownerReport, context);
    const refs = validIds.map(sampleId => ({ sampleId, actual: ds.y[ds.sampleIds.indexOf(sampleId)] })).reverse();
    const prediction = await predictWithModel(imported.model.model, gather(ds, validIds), validIds.length, ds.nFeatures, { sampleIds: validIds, references: refs });
    assert.deepEqual(Array.from(prediction.values), result.refit.predictions.map(r => r.predicted), context);
    assert.deepEqual(prediction.report.metrics, result.refit.ownerReport.metrics, context);
    assert.deepEqual(prediction.report.undefined_metrics ?? {}, result.refit.ownerReport.undefined_metrics ?? {}, context);
    const reversed = [...validIds].reverse();
    const permuted = await predictWithModel(imported.model.model, gather(ds, reversed), reversed.length, ds.nFeatures, { sampleIds: reversed });
    assert.deepEqual(Array.from(permuted.values), [...prediction.values].reverse(), 'same imported state replays permuted IDs exactly');
    assert.equal(result.variants.filter(v => v.selected).length, 1, context);
    assert.deepEqual(result.evaluation, { scope: 'selection_validation', independent_test: false });
  }
});

test('known-reference permutations join by ID; missing and unrelated references remain unscored', async () => {
  const result = { values: Float64Array.of(3, 1, 9), sampleIds: ['b', 'a', 'c'], predictionBlock: {
    producer_node: 'model:fixture', partition: 'final', fold_id: null, target_names: ['y'],
    sample_ids: ['c', 'a', 'b'], values: [[9], [1], [3]],
  } };
  const references = [{ sampleId: 'b', actual: 2 }, { sampleId: 'unrelated', actual: 99 }, { sampleId: 'a', actual: 0 }, { sampleId: 'c', actual: null }];
  events.length = 0;
  const scored = await scoreKnownPredictions(result, { sampleIds: ['b', 'a', 'c'], references });
  const call = apiEvents('score_regression_prediction_block_with_profile_json')[0];
  assert.deepEqual(JSON.parse(call.args[0]).sample_ids, ['a', 'b'], 'native prediction order retained');
  assert.deepEqual(JSON.parse(call.args[1]).unit_ids.map(u => u.id), ['b', 'a'], 'reference order is independent');
  assert.equal(JSON.parse(call.args[2]), REPORT_PROFILE, 'profile is JSON string text');
  assert.deepEqual(scored.unscoredSampleIds, ['c']);
  assert.deepEqual(scored.report.metrics, { bias: 1, r2: 0, rmse: 1, rpd: 1, rpiq: 1 }, 'literal owner fixture; no local formula');
  const reordered = await scoreKnownPredictions(result, { sampleIds: ['b', 'a', 'c'], references: [...references].reverse() });
  assert.deepEqual(reordered.report, scored.report, 'target permutation cannot change a score');
  const permutedRows = { values: Float64Array.of(9, 3, 1), sampleIds: ['c', 'b', 'a'], predictionBlock: result.predictionBlock };
  const permuted = await scoreKnownPredictions(permutedRows, { sampleIds: ['c', 'b', 'a'], references });
  assert.deepEqual(permuted.report, scored.report, 'caller row order cannot re-pair known targets');
  events.length = 0;
  const missing = await scoreKnownPredictions(scored, { sampleIds: result.sampleIds, references: [{ sampleId: 'unrelated', actual: 3 }] });
  assert.equal(missing.report, undefined);
  assert.deepEqual(missing.unscoredSampleIds, ['b', 'a', 'c']);
  assert.equal(apiEvents('score_regression_prediction_block_with_profile_json').length, 0);
  await assert.rejects(() => scoreKnownPredictions(result, { sampleIds: result.sampleIds, targetName: 'another-target', references }), /target name differs/);
  await assert.rejects(() => scoreKnownPredictions(result, { sampleIds: ['b', 'b', 'c'], references }), /unique sample ID/);
  await assert.rejects(() => scoreKnownPredictions(result, { sampleIds: result.sampleIds, references: [{ sampleId: 'a', actual: 0 }, { sampleId: 'a', actual: 1 }] }), /unique nonempty/);
});

function portableCoreModel() {
  return { taskType: 'regression', nFeatures: 3, state: { backendId: 'nirs4all-core-wasm', result: { preprocessing: [],
    model: { type: 'PLSRegression', n_components: 1, params: [], n_features: 3, n_targets: 1,
      coefficients: [1, 0, 0], xMean: [0, 0, 0], yMean: [0], intercept: null } } } };
}

test('undefined owner reasons survive display, JSON model export/import and valid zero RMSE', async () => {
  for (const fixture of [
    { actual: [0, 2], predicted: [0, 2], metrics: { rmse: 0, bias: 0, r2: 1 }, reasons: { rpd: 'zero_rmse', rpiq: 'zero_rmse' } },
    { actual: [2, 2], predicted: [1, 3], metrics: { rmse: 1, bias: 0, rpd: 0, rpiq: 0 }, reasons: { r2: 'constant_target' } },
  ]) {
    const scored = await scoreKnownPredictions({ values: Float64Array.from(fixture.predicted) }, {
      sampleIds: ['left', 'right'], references: ['right', 'left'].map((sampleId, i) => ({ sampleId, actual: fixture.actual[1 - i] })),
    });
    assert.deepEqual(scored.report.metrics, fixture.metrics, 'literal C1 fixture, including defined zero ratios');
    assert.deepEqual(scored.report.undefined_metrics, fixture.reasons);
  }
  const result = await scoreKnownPredictions({ values: Float64Array.of(2, 2) }, {
    sampleIds: ['right', 'left'], references: [{ sampleId: 'left', actual: 2 }, { sampleId: 'right', actual: 2 }],
  });
  assert.deepEqual(result.report.metrics, { rmse: 0, bias: 0 });
  assert.deepEqual(result.report.undefined_metrics, { r2: 'constant_target', rpd: 'zero_rmse', rpiq: 'zero_rmse' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.report)), result.report);
  const metrics = reportToMetrics(result.report);
  assert.deepEqual(metrics, { n: 2, rmse: 0, bias: 0 });
  const bundle = await existingBundle();
  bundle.diagnosticFixtures = [result.report];
  const imported = await importModelContainer(await exportModelContainer(bundle));
  assert.ok('model' in imported);
  assert.deepEqual(imported.model.sourceBundle.diagnosticFixtures[0], result.report, 'literal diagnostic metadata survives real Core without relabelling model performance');
  assert.deepEqual(reportToMetrics(imported.model.sourceBundle.diagnosticFixtures[0]), metrics, 'undefined literal metrics survive actual storage without obsolete zero stand-ins');
  assert.deepEqual(imported.model.metrics, reportToMetrics(bundle.ownerReport));
  assert.deepEqual(imported.model.ownerReport, bundle.ownerReport);
  const invalid = structuredClone(result.report);
  invalid.metrics.rpd = 0;
  assert.equal(isOwnerReport(invalid), false, 'a diagnostic cannot be numeric and undefined');
  const contradictory = { ...bundle, ownerReport: invalid };
  const payload = new TextEncoder().encode(JSON.stringify(contradictory));
  const physical = await storage.writeN4aContainer(qualiHostManifest(digest(payload)), [{ path: QUALI_HOST.path, bytes: payload }]);
  events.length = 0;
  assert.ok('error' in await importModelContainer(physical.archiveBytes), 'a diagnostic cannot be numeric and undefined at the file boundary');
  assert.equal(events.length, 0);

  const { TrainingResults } = await load('screens/TrainingResults.tsx');
  const { I18nProvider } = await load('i18n/index.tsx');
  const run = { engine: 'dag-ml-methods-pls', pipelineName: 'literal', evaluation: { scope: 'selection_validation', independent_test: false },
    refit: { metrics, ownerReport: result.report, predictions: [{ sampleId: 'left', actual: 2, predicted: 2, residual: 0 }, { sampleId: 'right', actual: 2, predicted: 2, residual: 0 }] } };
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TrainingResults, {
    dsl: { name: 'literal', steps: [], model: { id: 'm', type: 'PLS', params: {} } }, result: run,
  })));
  assert.match(html, /constant_target/);
  assert.match(html, /zero_rmse/);
  assert.match(html, /undefined \(constant_target\)/);
  assert.match(html, /undefined \(zero_rmse\)/);
});

test('legacy Core execution remains a frozen TEST oracle; product rejects its state unchanged', async () => {
  const model = portableCoreModel(), X = Float64Array.of(1, 0, 0, 3, 0, 0);
  const expected = await core.predictPortablePipeline(model.state.result, { X, rows: 2, cols: 3 }, { methods: oracleMethods });
  assert.deepEqual(Array.from(expected.data), [1, 3], 'frozen Core portable prediction oracle');
  const { wasmEngine: frozenQualiCoreAdapter } = await load('engine/testing/oracle/wasmEngine.ts');
  const inference = await frozenQualiCoreAdapter.predict(model, X, 2, 3);
  assert.deepEqual(Array.from(inference.values), Array.from(expected.data));
  events.length = 0;
  const scored = await scoreKnownPredictions(inference, { sampleIds: ['b', 'a'], references: [{ sampleId: 'a', actual: 2 }, { sampleId: 'b', actual: 0 }] });
  assert.deepEqual(Array.from(scored.values), Array.from(expected.data));
  assert.equal(apiEvents('score_regression_prediction_block_with_profile_json').length, 1);

  const before = JSON.stringify(model);
  events.length = 0;
  await assert.rejects(() => predictWithModel(model, X, 2, 3), /Legacy Core-JS.*Recalibrate/);
  assert.equal(JSON.stringify(model), before);
  assert.equal(events.length, 0, 'retired execution is refused before any DAG callback');
});

test('duplicate scores select the first ordinal; failed/refused banks never fall back to JS', async () => {
  const ds = synthetic();
  const ties = await runPlsBank(ds, { screen: [{ label: 'first', steps: [] }, { label: 'second', steps: [] }], maxComp: 1 }, 'ties', 'ties');
  assert.equal(ties.model.state.selectedCandidateId, 'ord:00000');
  assert.deepEqual(ties.variants.map(v => v.selected), [true, false]);
  const variant = CALIB_VARIANTS.find(v => v.id === 'fast-aom-pls');
  await assert.rejects(() => runVariant(ds, variant, { name: 'unavailable' }), e => /No PLS candidates/.test(e.message) && e.candidateIssues.length === 4);
  await assert.rejects(() => runPlsBank(ds, { screen: [{ label: 'MSC', steps: [{ id: 'msc', type: 'MultiplicativeScatterCorrection', params: {} }] }], maxComp: 1 }, 'refusal', 'refusal'), e => e.candidateIssues[0].status === 'refused');
  const invoke = Controller.prototype.invoke;
  Controller.prototype.invoke = function(id, text) {
    if (JSON.parse(text).phase === 'FIT_CV') throw new Error('Deliberate owner candidate failure');
    return invoke.call(this, id, text);
  };
  try {
    await assert.rejects(() => runPlsBank(ds, { screen: [{ label: 'raw', steps: [] }], maxComp: 1 }, 'all failed', 'all-failed'),
      e => /No PLS candidates/.test(e.message) && e.candidateIssues[0].status === 'failed' && /Deliberate owner/.test(e.candidateIssues[0].reason));
  } finally { Controller.prototype.invoke = invoke; }
});

test('all legacy JS states refuse before callbacks and preserve the supplied state', async () => {
  // Declared-kind negative fixtures, never represented as executable fitted models.
  for (const backendId of ['js-pls', 'js-ridge']) {
    const model = { taskType: 'regression', nFeatures: 3, state: { backendId, legacyPayload: [1, 2, 3] } };
    const before = JSON.stringify(model);
    events.length = 0;
    await assert.rejects(() => predictWithModel(model, Float64Array.of(1, 0, 0, 3, 0, 0), 2, 3), /Recalibrate/);
    assert.equal(JSON.stringify(model), before);
    assert.equal(events.length, 0);
  }
});

test('real Core transport refuses corruption, wrong declarations and unqualified families before DAG', async () => {
  const bundle = await existingBundle();
  async function physical(payload, changeManifest = manifest => manifest) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return (await storage.writeN4aContainer(changeManifest(qualiHostManifest(digest(bytes))), [{ path: QUALI_HOST.path, bytes }])).archiveBytes;
  }
  const bytes = await exportModelContainer(bundle), corrupt = bytes.slice();
  corrupt[0] ^= 255;
  const sources = [corrupt, new TextEncoder().encode(JSON.stringify(bundle)),
    await physical(bundle, manifest => ({ ...manifest, required_features: ['other-host@1'], entrypoints: manifest.entrypoints.map(entry => ({ ...entry, required_features: ['other-host@1'] })) })),
    await physical(bundle, manifest => ({ ...manifest, entrypoints: manifest.entrypoints.map(entry => ({ ...entry, operation: 'other.predict' })) })),
    await physical({ ...bundle, schema_version: 2 }),
    await physical({ ...bundle, selectedProfileId: 'unqualified-family' })];
  for (const source of sources) {
    const before = digest(source);
    events.length = 0;
    const imported = await importModelContainer(new Blob([source]));
    assert.ok('error' in imported);
    assert.equal(events.length, 0, 'Core inventory and host admission precede any DAG call');
    assert.equal(digest(source), before, 'the original file is unchanged');
  }
});


test('production imports contain no retired execution or historical-oracle route', async () => {
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'testing') continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        assert.doesNotMatch(source, /(?:runPortablePipeline|predictPortablePipeline)/, path);
        assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"][^'"]*testing\/oracle/, path);
      }
    }
  }
  await visit(resolve(root, 'src'));
});
