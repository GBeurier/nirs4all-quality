// Regression tests load production TypeScript through Vite. Only the external
// Core runtime is replaced: local preprocessing, models and consumers are real.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { methodsRoot, qualifiedMethodsStage } from './methods-stage.mjs';

await qualifiedMethodsStage();

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  configFile: false, root, server: { middlewareMode: true },
  resolve: { alias: { '@': `${root}/src` } },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: ['@nirs4all/methods'] },
  plugins: [{
    name: 'core-test-boundary',
    enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/engine/wasmEngine.ts')) return source.replace("from 'nirs4all'", "from 'virtual:quali-test-core'");
    },
    resolveId(id) {
      if (id === 'virtual:quali-test-core') return '\0core-test-boundary';
      if (id === '@nirs4all/methods') return { id: resolve(methodsRoot, 'index.js'), external: true };
    },
    load(id) {
      if (id === '\0core-test-boundary') return `
        export const runPortablePipeline = (...args) => globalThis.__qualiCore.run(...args);
        export const predictPortablePipeline = () => { throw new Error('Unexpected Core predict'); };
      `;
    },
  }],
});
after(async () => { delete globalThis.__qualiCore; await server.close(); });
const load = (path) => server.ssrLoadModule(`/src/${path}`);
const { initializeDiagnostics } = await load('engine/nativeDiagnostics.ts');
await initializeDiagnostics();
const { wasmEngine } = await load('engine/wasmEngine.ts');
const { runPlsScreenSteps, runJsVariant } = await load('engine/jsEngine.ts');
const { applySteps, kennardStoneTest, plsFit, plsPredictRow } = await load('engine/jsNumerics.ts');
const { CALIB_VARIANTS, runVariant } = await load('engine/variants.ts');
const { parseModelBundle } = await load('lib/modelIo.ts');
const { evaluationLabel, validateCalibrationDataset } = await load('engine/evaluation.ts');

function dataset(n = 12, p = 6) {
  return {
    X: Float64Array.from({ length: n * p }, (_, k) => {
      const i = Math.floor(k / p), j = k % p;
      return 1 + i * 0.4 + (j + 1) ** 2 * (1 + i * 0.07) + Math.sin(i + j) * 0.5;
    }),
    y: Float64Array.from({ length: n }, (_, i) => 2 + i * 0.8 + Math.cos(i)),
    nSamples: n, nFeatures: p, axis: Array.from({ length: p }, (_, j) => j), axisUnit: 'nm',
    sampleIds: Array.from({ length: n }, (_, i) => `sample-${i}`),
    partitions: Array(n).fill('train'), targetName: 'concentration', taskType: 'regression',
  };
}
const dsl = (steps = []) => ({ name: 'regression fixture', steps, model: { id: 'pls', type: 'PLS', params: { n_components: 1 } } });
const ridge = { kind: 'js_ridge_screen', chains: [{ label: 'raw', ops: [] }], alphas: [1], axis: { fr: 'alpha', en: 'alpha' } };
const step = (type, params = {}) => ({ id: type, type, params });

function coreResult(ds, evaluation) {
  const testIndices = [2, 5, 8];
  return {
    split: { kind: 'KennardStone', trainIndices: Array.from({ length: ds.nSamples }, (_, i) => i).filter((i) => !testIndices.includes(i)), testIndices },
    selected: { n_components: 1, rmse: 0.2, predictions: testIndices.map((i) => ds.y[i] + 0.2) },
    variants: [{ n_components: 1, rmse: 0.2 }], preprocessing: [],
    model: { type: 'PLSRegression', n_components: 1, params: [], n_features: ds.nFeatures, n_targets: 1, coefficients: Array(ds.nFeatures).fill(1), xMean: Array(ds.nFeatures).fill(0), yMean: [0], intercept: null },
    ...(evaluation ? { evaluation } : {}),
  };
}

test('WASM refuses unsupported steps and SNV parameters before invoking Core', async () => {
  let calls = 0;
  globalThis.__qualiCore = { run() { calls++; throw new Error('Should not call Core'); } };
  for (const s of [step('MultiplicativeScatterCorrection'), step('Detrend'), step('UnknownFilter'), step('StandardNormalVariate', { with_std: false })]) {
    await assert.rejects(() => wasmEngine.run(dataset(), dsl([s])), /Unsupported/);
  }
  assert.equal(calls, 0);
});

test('supported WASM preprocessing retains its ordered types and parameters', async () => {
  const ds = dataset();
  let source;
  globalThis.__qualiCore = { run(recipe) { source = recipe; return coreResult(ds); } };
  const params = { window_length: 5, polyorder: 2, deriv: 1, mode: 'interp' };
  await wasmEngine.run(ds, dsl([step('StandardNormalVariate'), step('SavitzkyGolay', params)]));
  assert.deepEqual(source.pipeline.slice(1, -1), [
    { class: 'nirs4all.operators.transforms.StandardNormalVariate', params: {} },
    { class: 'nirs4all.operators.transforms.SavitzkyGolay', params },
  ]);
});

test('Core evaluation survives the adapter, preprocessing selection and JSON model import', async () => {
  const ds = dataset();
  const evaluation = { scope: 'selection_validation', independent_test: false, provenance: 'Core regression fixture' };
  globalThis.__qualiCore = { run: () => coreResult(ds, evaluation) };
  const spec = { id: 'fixture', group: 'aom', label: { fr: 'fixture', en: 'fixture' }, spec: { kind: 'wasm_pls_screen', screen: [{ label: 'raw', steps: [] }], maxComp: 1 } };
  const result = await runVariant(ds, spec, wasmEngine);
  assert.deepEqual(result.evaluation, evaluation);
  assert.equal(result.refit.name, 'Selection validation');
  const imported = parseModelBundle(JSON.stringify({ format: 'quali-nirs4all/n4a', version: 1, model: result.model, nFeatures: ds.nFeatures, metrics: result.refit.metrics, evaluation: result.evaluation }));
  assert.deepEqual(imported.model.evaluation, evaluation);
  assert.deepEqual(imported.model.metrics, result.refit.metrics);
});

test('older runtime results receive conservative selection context; saved legacy scores remain unknown', async () => {
  const ds = dataset();
  globalThis.__qualiCore = { run: () => coreResult(ds) };
  const result = await wasmEngine.run(ds, dsl());
  assert.deepEqual(result.evaluation, { scope: 'selection_validation', independent_test: false });
  assert.equal(evaluationLabel(undefined), 'Evaluation scope unavailable');
});

test('every shipped PLS step is executable by JS or explicitly refused by WASM', async () => {
  const { validatePreprocessingStep, PreprocessingRefusal } = await load('engine/preprocessing.ts');
  for (const variant of CALIB_VARIANTS) {
    if (variant.spec.kind !== 'wasm_pls_screen') continue;
    for (const candidate of variant.spec.screen) for (const s of candidate.steps) {
      assert.doesNotThrow(() => validatePreprocessingStep(s, 'js'), `${variant.id}: ${candidate.label}`);
      if (s.type === 'SavitzkyGolay') assert.equal(s.params.mode, 'nearest');
      if (s.type === 'Detrend' || s.type === 'MultiplicativeScatterCorrection') {
        assert.throws(() => validatePreprocessingStep(s, 'wasm'), PreprocessingRefusal);
      } else assert.doesNotThrow(() => validatePreprocessingStep(s, 'wasm'));
    }
  }
});

test('a refused JS candidate does not discard valid candidates or disappear from provenance', () => {
  const result = runPlsScreenSteps(dataset(), [{ label: 'unsupported', steps: [step('Detrend', { degree: 2 })] }, { label: 'raw', steps: [] }], 1, 'partial bank');
  assert.equal(result.variants, undefined); // A single successful candidate has no sweep chart.
  assert.equal(result.candidateIssues[0].label, 'unsupported');
  assert.equal(result.candidateIssues[0].backend, 'js');
  assert.equal(result.candidateIssues[0].status, 'refused');
  assert.ok(Number.isFinite(result.refit.metrics.rmse));
});

test('all shipped variants produce real fallback results, including the extended PLS bank', async () => {
  const ds = dataset(12, 35);
  const unavailable = { name: 'unavailable', run() { throw new Error('WASM unavailable fixture'); } };
  for (const v of CALIB_VARIANTS) {
    const result = await runVariant(ds, v, unavailable);
    assert.ok(Number.isFinite(result.refit.metrics.rmse), v.id);
    assert.equal(result.evaluation.independent_test, false, v.id);
    if (v.spec.kind === 'wasm_pls_screen') {
      assert.equal(result.variants.length, v.spec.screen.length, v.id);
      assert.ok(result.candidateIssues.every((issue) => issue.backend === 'wasm' && issue.status === 'failed'));
    }
  }
});

test('completely invalid variants raise their reasons for display instead of returning null', async () => {
  const v = { id: 'invalid', group: 'aom', label: { fr: 'invalid', en: 'invalid' }, spec: { kind: 'wasm_pls_screen', screen: [{ label: 'unknown', steps: [step('UnknownFilter')] }], maxComp: 1 } };
  await assert.rejects(() => runVariant(dataset(), v, wasmEngine), /No PLS candidates could be scored.*UnknownFilter/);
});

test('demonstration engines cannot return calibration scores', async () => {
  const { StubEngine } = await load('engine/stubEngine.ts');
  await assert.rejects(() => new StubEngine().run(dataset(), dsl()), /demonstration engine cannot calibrate/);
});

test('routine decisions never qualify selection, training or unknown scores as reliable', async () => {
  const { buildQualifiedDecisionView, buildRoutinePredictions } = await load('lib/reliability.ts');
  const input = { applicabilityScore: 0.3, localDensity: 0.6, intervalWidth: 0.1 };
  for (const evaluation of [undefined, { scope: 'training', independent_test: false }, { scope: 'selection_validation', independent_test: false }]) {
    const view = buildQualifiedDecisionView(input, evaluation, 'en');
    assert.notEqual(view.color, 'reliable');
    assert.match(view.label, /Unqualified/);
    assert.match(view.action, /Independent validation is required/);
  }
  assert.notEqual(buildQualifiedDecisionView(input, { scope: 'independent_test', independent_test: true }, 'en').color, 'reliable', 'an independent score alone cannot calibrate heuristic coverage');
  const spectra = (i) => ({ sampleId: `s${i}`, reps: [{ values: Float64Array.of(i, i * i, i + 1) }] });
  const output = buildRoutinePredictions({ cal: [spectra(1), spectra(2), spectra(3)], routine: [spectra(2.1)], predicted: [2], axisLen: 3, yMin: 1, yMax: 3, scoreRmse: 0.1 });
  assert.match(output.preds[0].interval, /^Heuristic ±/);
});

test('imported independent-test claims remain intact but cannot grant routine qualification', async () => {
  const { buildQualifiedDecisionView } = await load('lib/reliability.ts');
  const ds = dataset();
  globalThis.__qualiCore = { run: () => coreResult(ds) };
  const result = await wasmEngine.run(ds, dsl());
  const declared = { scope: 'independent_test', independent_test: true };
  const imported = parseModelBundle(JSON.stringify({ format: 'quali-nirs4all/n4a', version: 1, model: result.model, nFeatures: ds.nFeatures, evaluation: declared, evaluationDeclaredOnly: false }));
  assert.deepEqual(imported.model.evaluation, declared, 'retain declared provenance');
  assert.equal(imported.model.evaluationDeclaredOnly, true, 'the bundle cannot verify its own claim');
  const view = buildQualifiedDecisionView({ applicabilityScore: 0.3, localDensity: 0.6, intervalWidth: 0.1 }, imported.model.evaluation, 'en', imported.model.evaluationDeclaredOnly);
  assert.equal(view.color, 'caution');
  assert.equal(view.label, 'Unqualified prediction');
});

test('JS rejects unknown operations and unsupported parameter semantics', () => {
  for (const s of [step('UnknownFilter'), step('Detrend', { degree: 2 }), step('StandardNormalVariate', { with_std: false }), step('SavitzkyGolay', { window_length: 4 }), step('SavitzkyGolay', { mode: 'interp' })]) {
    assert.throws(() => applySteps(dataset().X, 12, 6, [s]), /Unsupported|supports|Invalid/);
  }
  assert.throws(() => runPlsScreenSteps(dataset(), [{ label: 'scaled', steps: [step('StandardScaler')] }], 1, 'refused'), /display previews/);
});

test('fallback MSC prediction replays deployment state and refuses a missing reference', async () => {
  const { predictWithModel } = await load('engine/predict.ts');
  const ds = dataset();
  const steps = [step('MultiplicativeScatterCorrection')];
  const result = runPlsScreenSteps(ds, [{ label: 'MSC', steps }], 1, 'prediction fixture');
  const transformed = applySteps(ds.X, ds.nSamples, ds.nFeatures, steps, { state: result.model.state.stepState });
  const predictions = await predictWithModel(result.model, ds.X, ds.nSamples, ds.nFeatures);
  close(predictions.values, Array.from({ length: ds.nSamples }, (_, i) => plsPredictRow(result.model.state.pls, transformed.data, i * ds.nFeatures)), 'deployment reference replay');
  const broken = structuredClone(result.model);
  delete broken.state.stepState;
  await assert.rejects(() => predictWithModel(broken, ds.X, ds.nSamples, ds.nFeatures), /fitted training reference/);
});

function gather(X, p, indices) {
  return Float64Array.from(indices.flatMap((i) => Array.from(X.slice(i * p, (i + 1) * p))));
}
function close(actual, expected, message) {
  assert.equal(actual.length, expected.length);
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-9, `${message}: ${x} != ${expected[i]}`));
}

test('fallback PLS scores MSC with a training-only reference and refits deployment on all rows', () => {
  const ds = dataset();
  const steps = [step('MultiplicativeScatterCorrection')];
  const te = kennardStoneTest(ds.X, ds.nSamples, ds.nFeatures);
  const tr = Array.from({ length: ds.nSamples }, (_, i) => i).filter((i) => !te.includes(i));
  const capture = {};
  const training = applySteps(gather(ds.X, ds.nFeatures, tr), tr.length, ds.nFeatures, steps, { capture });
  const refBefore = capture.mscRef.slice();
  const model = plsFit(training.data, tr.length, ds.nFeatures, Float64Array.from(tr.map((i) => ds.y[i])), 1);
  const validation = applySteps(gather(ds.X, ds.nFeatures, te), te.length, ds.nFeatures, steps, { state: capture });
  const expected = te.map((_, i) => plsPredictRow(model, validation.data, i * ds.nFeatures));
  const result = runPlsScreenSteps(ds, [{ label: 'MSC', steps }], 1, 'MSC fixture');
  close(result.refit.predictions.map((r) => r.predicted), expected, 'training-only MSC score');
  assert.deepEqual(result.refit.predictions.map((r) => r.sampleId), te.map((i) => ds.sampleIds[i]));
  // Reproduce the old transform-all-rows path and prove this fixture detects it.
  const leaked = applySteps(ds.X, ds.nSamples, ds.nFeatures, steps);
  const leakedModel = plsFit(gather(leaked.data, ds.nFeatures, tr), tr.length, ds.nFeatures, Float64Array.from(tr.map((i) => ds.y[i])), 1);
  const leakedPredictions = te.map((i) => plsPredictRow(leakedModel, leaked.data, i * ds.nFeatures));
  assert.ok(expected.some((x, i) => Math.abs(x - leakedPredictions[i]) > 1e-6), 'fixture distinguishes the leaked reference');
  // Evaluation values cannot mutate an already fitted MSC reference or training transform.
  const perturbed = gather(ds.X, ds.nFeatures, te).map((x, i) => x + (i % ds.nFeatures) ** 3 * 100);
  applySteps(perturbed, te.length, ds.nFeatures, steps, { state: capture });
  close(capture.mscRef, refBefore, 'reference unchanged by evaluation rows');
  close(applySteps(gather(ds.X, ds.nFeatures, tr), tr.length, ds.nFeatures, steps, { state: capture }).data, training.data, 'training transform invariant');
  const deployRef = Array.from({ length: ds.nFeatures }, (_, j) => Array.from({ length: ds.nSamples }, (_, i) => ds.X[i * ds.nFeatures + j]).reduce((a, b) => a + b, 0) / ds.nSamples);
  close(result.model.state.stepState.mscRef, deployRef, 'deployment refit uses all rows');
  assert.deepEqual(result.evaluation, { scope: 'selection_validation', independent_test: false });
});

test('all entry points refuse tiny datasets and upstream resubstitution', async () => {
  for (let n = 0; n < 8; n++) {
    const ds = dataset(n);
    assert.throws(() => runPlsScreenSteps(ds, [{ label: 'raw', steps: [] }], 1, 'tiny'), /Insufficient samples/);
    assert.throws(() => runJsVariant(ds, ridge, 'tiny'), /Insufficient samples/);
    await assert.rejects(() => wasmEngine.run(ds, dsl()), /Insufficient samples/);
  }
  const ds = dataset();
  globalThis.__qualiCore = { run() {
    const result = coreResult(ds, { scope: 'training', independent_test: false });
    result.split = { kind: 'all', trainIndices: [0, 1, 2], testIndices: [0, 1, 2] };
    return result;
  } };
  await assert.rejects(() => wasmEngine.run(ds, dsl()), /resubstitution is refused/);
});

test('replicate identities survive dataset assembly and cannot cross a row-based split', async () => {
  const { buildTrainingDataset } = await load('lib/trainingData.ts');
  const samples = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, reference: { value: i } }));
  const spectra = { axis: [1, 2, 3], axisUnit: 'nm', samples: samples.map((s, i) => ({ sampleId: s.id, reps: [{ values: Float64Array.of(i, i + 1, i + 2) }, { values: Float64Array.of(i + 0.1, i + 1, i + 2) }] })) };
  const raw = buildTrainingDataset(spectra, samples, 'y', 'raw');
  assert.equal(raw.nSamples, 16);
  assert.equal(new Set(raw.groupIds).size, 8);
  assert.throws(() => validateCalibrationDataset(raw), /group-aware split/);
  assert.doesNotThrow(() => validateCalibrationDataset(buildTrainingDataset(spectra, samples, 'y', 'mean')));
});

test('JS ridge scores carry selection context and training charts show it in plain text', async () => {
  const result = runJsVariant(dataset(), ridge, 'ridge fixture');
  assert.equal(result.evaluation.scope, 'selection_validation');
  assert.equal(result.evaluation.independent_test, false);
  const { TrainingResults } = await load('screens/TrainingResults.tsx');
  const { I18nProvider } = await load('i18n/index.tsx');
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TrainingResults, { dsl: dsl(), result })));
  assert.match(html, /Selection validation/);
  assert.match(html, /independent prediction error has not been measured/);
  assert.match(html, /View scored samples/);
  assert.doesNotMatch(html, /RMSEP|frozen.test|test gelé/);
});
