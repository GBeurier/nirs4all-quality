// Root runs after integration and new owner staging. No numerical substitutes.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { methodsRoot, qualifiedMethodsStage } from './methods-stage.mjs';

// Test-only pre-migration expectations, not a parity reference.
// Captured once by Root from the declared synthetic inputs below (exit 0, 1.204 s).
// Capture SHA256: 523bcffae905ff69c480cdf8c0b44137ef37e1c05668cc74814ef825fc7d5eb3
// Source SHA256: 7a73a905457fff9de89408b5b2fb334a283505d42c4c2f660f4e084d85190e52
// Exact capture bytes, including the final newline; no external input path needed.
const expected = JSON.parse(String.raw`{
  "kind": "test-only pre-migration expectations, not a parity reference",
  "source_sha256": "7a73a905457fff9de89408b5b2fb334a283505d42c4c2f660f4e084d85190e52",
  "msc": [
    -0.39062500000000006,
    -0.34375000000000006,
    -0.29687500000000006,
    -0.29687500000000006,
    -0.25000000000000006,
    -0.20312500000000003,
    -0.20312500000000003,
    -0.15625000000000003,
    -0.10937500000000001,
    -0.10937500000000001,
    -0.06250000000000001,
    -0.015625000000000003,
    -0.015625000000000003,
    0.03125000000000001,
    0.07812500000000001,
    0.07812500000000001,
    0.12500000000000003,
    0.17187500000000003,
    0.17187500000000003,
    0.21875000000000003,
    0.26562500000000006,
    0.26562500000000006,
    0.31250000000000006,
    0.35937500000000006,
    0.35937500000000006,
    -0.390625,
    -0.34375,
    -0.296875,
    -0.296875,
    -0.25,
    -0.203125,
    -0.203125,
    -0.15625,
    -0.109375,
    -0.109375,
    -0.0625,
    -0.015625,
    -0.015625,
    0.03125,
    0.078125,
    0.078125,
    0.125,
    0.171875,
    0.171875,
    0.21875,
    0.265625,
    0.265625,
    0.3125,
    0.359375,
    0.359375,
    -0.390625,
    -0.34375,
    -0.296875,
    -0.296875,
    -0.25,
    -0.203125,
    -0.203125,
    -0.15625,
    -0.109375,
    -0.109375,
    -0.0625,
    -0.015625,
    -0.015625,
    0.03125,
    0.078125,
    0.078125,
    0.125,
    0.171875,
    0.171875,
    0.21875,
    0.265625,
    0.265625,
    0.3125,
    0.359375,
    0.359375,
    -0.390625,
    -0.34375,
    -0.296875,
    -0.296875,
    -0.25,
    -0.203125,
    -0.203125,
    -0.15625,
    -0.109375,
    -0.109375,
    -0.0625,
    -0.015625,
    -0.015625,
    0.03125,
    0.078125,
    0.078125,
    0.125,
    0.171875,
    0.171875,
    0.21875,
    0.265625,
    0.265625,
    0.3125,
    0.359375,
    0.359375,
    -0.390625,
    -0.34375,
    -0.296875,
    -0.296875,
    -0.25,
    -0.203125,
    -0.203125,
    -0.15625,
    -0.109375,
    -0.109375,
    -0.0625,
    -0.015625,
    -0.015625,
    0.03125,
    0.078125,
    0.078125,
    0.125,
    0.171875,
    0.171875,
    0.21875,
    0.265625,
    0.265625,
    0.3125,
    0.359375,
    0.359375,
    -0.39062500000000006,
    -0.34375000000000006,
    -0.29687500000000006,
    -0.29687500000000006,
    -0.25000000000000006,
    -0.20312500000000003,
    -0.20312500000000003,
    -0.15625000000000003,
    -0.10937500000000001,
    -0.10937500000000001,
    -0.06250000000000001,
    -0.015625000000000003,
    -0.015625000000000003,
    0.03125000000000001,
    0.07812500000000001,
    0.07812500000000001,
    0.12500000000000003,
    0.17187500000000003,
    0.17187500000000003,
    0.21875000000000003,
    0.26562500000000006,
    0.26562500000000006,
    0.31250000000000006,
    0.35937500000000006,
    0.35937500000000006
  ],
  "d1": [
    0.078,
    0.099,
    0.12160714285714286,
    0.14535714285714285,
    0.1697142857142857,
    0.19407142857142856,
    0.21775,
    0.24,
    0.26,
    0.28,
    0.3,
    0.32,
    0.33999999999999997,
    0.36,
    0.37999999999999995,
    0.4,
    0.42,
    0.44,
    0.44525,
    0.4373571428571428,
    0.4179999999999999,
    0.38892857142857146,
    0.3519642857142857,
    0.309,
    0.2619999999999999
  ],
  "d1Short": [
    0.023535714285714285,
    0.024,
    0.023607142857142854
  ],
  "d2": [
    0.02114551083591331,
    0.02303405572755418,
    0.024207946336429313,
    0.02463364293085655,
    0.024349845201238396,
    0.023477812177502586,
    0.022231682146542843,
    0.02092879256965944,
    0.020000000000000007,
    0.02,
    0.01999999999999999,
    0.019999999999999976,
    0.020000000000000004,
    0.019999999999999983,
    0.020000000000000004,
    0.020000000000000025,
    0.020000000000000004,
    0.013911248710010371,
    0.003810629514963859,
    -0.00845201238390092,
    -0.021264189886480878,
    -0.03326109391124871,
    -0.043335913312693486,
    -0.050650154798761615,
    -0.0546439628482972
  ],
  "d2Short": [
    0.0015144478844169263,
    0.00006191950464396433,
    -0.0013957688338493285
  ]
}
`);
assert.equal(expected.kind, 'test-only pre-migration expectations, not a parity reference');
assert.equal(expected.source_sha256, '7a73a905457fff9de89408b5b2fb334a283505d42c4c2f660f4e084d85190e52', 'The captured expectations must identify the preserved current preimage.');
const stage = await qualifiedMethodsStage();
const root = fileURLToPath(new URL('..', import.meta.url));
const virtual = name => `\0preview-contract:${name}`;
const flatten = ds => ds.samples.flatMap(s => s.reps.flatMap(r => Array.from(r.values)));
function close(actual, wanted, abs, rel) {
  assert.equal(actual.length, wanted.length);
  actual.forEach((value, i) => assert.ok(Number.isFinite(value) && Number.isFinite(wanted[i]) && Math.abs(value - wanted[i]) <= abs + rel * Math.abs(wanted[i]), `index ${i}: ${value} != ${wanted[i]}`));
}
// 3 samples x 2 repetitions; mean slope 1 and mean offset 0, reference variance
// safely nonzero. Relative slopes 0.5..1.5; values and offsets are order one.
function fixture(tag = 'A', shift = 0) {
  const slopes = [0.75, 1, 1.25, 0.5, 1, 1.5], offsets = [-0.5, 0.25, 0.5, -0.25, 0.75, -0.75];
  return { tag, metadata: { source: 'preview-contract' }, axisUnit: 'nm', axis: Array.from({ length: 25 }, (_, j) => 1000 + 2.5 * j),
    samples: ['S-z', 'S-a', 'S-m'].map((sampleId, i) => ({ sampleId, metadata: { lot: i }, reps: ['rep-9', 'rep-2'].map((repId, k) => {
      const row = 2 * i + k;
      return { repId, suspect: k === 1, metadata: { instrument: 'physical-A' }, values: Float64Array.from({ length: 25 }, (_, j) => offsets[row] + slopes[row] * ((j - 12) / 32 + (j % 3 - 1) / 64) + shift) };
    }) })) };
}
function rowsDataset(rows) {
  return { axis: Array.from({ length: rows[0].length }, (_, j) => j), axisUnit: 'nm', samples: rows.map((values, i) => ({ sampleId: `physical-${i}`, reps: [{ repId: 'r', values: Float64Array.from(values) }] })) };
}
function config({ control = false, browser = false } = {}) {
  return { configFile: false, root, esbuild: { jsx: 'automatic' },
    resolve: { alias: [{ find: '@', replacement: resolve(root, 'src') }] }, optimizeDeps: browser ? { include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'recharts', 'lucide-react'] } : { noDiscovery: true, include: [] },
    server: browser ? { host: '127.0.0.1', port: 0, fs: { allow: [root, methodsRoot] } } : { middlewareMode: true, hmr: false },
    plugins: [{ name: 'bounded-preview-contract', enforce: 'pre',
      resolveId(id) {
        if (id === '@nirs4all/methods') return control ? virtual('owner') : { id: resolve(methodsRoot, 'index.js'), external: !browser };
        if (id.startsWith('preview-contract:')) return virtual(id.slice('preview-contract:'.length));
      },
      transform(source, id) {
        if (!browser) return;
        if (id.endsWith('/usePreviewSpectra.ts')) return source.replace("from './preview'", "from 'preview-contract:bridge'");
        if (id.endsWith('/screens/DatasetExplorer.tsx') || id.endsWith('/screens/Health.tsx')) {
          source = source.replace("from '@/store/store'", "from 'preview-contract:store'");
          for (const name of ['SpectraTab', 'PcaTab', 'HealthSpectraView']) {
            source = source.replace(new RegExp(`(function ${name}\\([^\\n]+\\) \\{)`), `$1\n  globalThis.__screenInputs.push({ view: '${name}', spectra });`);
          }
          return source;
        }
        if (id.endsWith('/lib/quality.ts')) return source.replace(/(export function computeQuality\([\s\S]*?\): QualityReport \{)/, '$1\n  globalThis.__qualityInputs.push(spectra);');
      },
      load(id) {
        if (id === virtual('owner')) return `
          const real = globalThis.__previewOwner.owner;
          export const { NativeEstimator, FlexiblePCA, HotellingT2, QResiduals } = real;
          export const loadModule = () => globalThis.__previewOwner.load();
          export const version = () => globalThis.__previewOwner.version ?? real.version();
          export const abiVersion = () => real.abiVersion();
          export const methodClass = methodId => globalThis.__previewOwner.methodClass(methodId);
        `;
        if (id === virtual('bridge')) return `
          import { applyPreviewPp as actual } from '/src/lib/preview.ts'; export { PREVIEW_PP } from '/src/lib/preview.ts';
          export function applyPreviewPp(ds, option) {
            if (!globalThis.__deferPreview) return actual(ds, option);
            return new Promise((resolve, reject) => globalThis.__pendingPreview.push({ ds, option,
              success: () => actual(ds, option).then(resolve, reject), error: () => reject(new Error('controlled stale error')) }));
          }
        `;
        if (id === virtual('store')) return `
          import { createContext, useContext, useMemo } from 'react'; import { cropSpectra } from '/src/domain/spectra.ts';
          export const Context = createContext(null);
          export function useLab() { return useContext(Context); }
          export function useProjectSpectra(projectId) {
            const { state } = useLab(), full = state.spectraByProject[projectId], crop = state.cropByProject[projectId];
            return useMemo(() => full && crop ? cropSpectra(full, crop.from, crop.to) : full, [full, crop]);
          }
        `;
        if (id === virtual('browser')) return browserEntry();
      },
      configureServer(server) {
        if (browser) server.middlewares.use('/__preview_contract', (_req, res) => {
          res.setHeader('Content-Type', 'text/html'); res.end('<div id="root" style="width:1100px;min-height:800px"></div><script type="module" src="/@id/__x00__preview-contract:browser"></script>');
        });
      },
    }],
  };
}
const server = await createServer(config());
let browserServer, browser;
try {
  const host = await server.ssrLoadModule('/src/lib/preview.ts');
  const { cropSpectra } = await server.ssrLoadModule('/src/domain/spectra.ts');
  const { buildTrainingDataset } = await server.ssrLoadModule('/src/lib/trainingData.ts');
  const { validateCalibrationDataset } = await server.ssrLoadModule('/src/engine/evaluation.ts');
  const { validateDataset } = await server.ssrLoadModule('/src/engine/port.ts');
  // One crop-input regression: an absent kept band must stay missing all the
  // way to the existing calibration finite guard. No bank or fit is invoked.
  {
    const sampleIds = ['label-z', 'label-a', 'label-m', 'label-b', 'label-y', 'label-c', 'label-x', 'label-d'];
    const finiteSource = {
      axis: [1000, 1002.5, 1005, 1007.5, 1010, 1012.5], axisUnit: 'nm',
      metadata: { source: 'cropped-missing-labelled-input', instrument: 'physical-A' },
      samples: sampleIds.map((sampleId, i) => ({
        sampleId, metadata: { lot: `lot-${i}` }, reps: [{
          repId: `physical-rep-${i}`, suspect: false, metadata: { acquiredBy: 'operator-A' },
          values: Float64Array.from({ length: 6 }, (_, j) => 1 + i / 8 + j / 16 + 2 ** -35),
        }],
      })),
    };
    // One repetition per labelled sample keeps groups unique in BOTH mean/raw
    // modes, so neither count nor repeated-group admission can mask the defect.
    const labelled = sampleIds.map((id, i) => ({
      id, projectId: 'crop-input-regression', lotId: `lot-${i}`, barcode: `barcode-${i}`, status: 'integrated',
      repetitions: [{ id: `physical-rep-${i}`, spectrumRef: `spectra/${id}`, acquiredAt: '2026-11-08T00:00:00Z' }],
      reference: { value: 3 + i / 4, status: 'validated' }, metadata: { instrument: 'physical-A' }, createdAt: '2026-11-08T00:00:00Z',
    })).reverse(); // References must join by physical ID, not by input position.
    const missingSource = structuredClone(finiteSource), missingRow = 3, missingBand = 4;
    missingSource.samples[missingRow].reps[0].values = missingSource.samples[missingRow].reps[0].values.slice(0, missingBand);
    assert.equal(missingSource.samples[missingRow].reps[0].values[missingBand], undefined);
    assert.ok(labelled.some(sample => sample.id === sampleIds[missingRow] && Number.isFinite(sample.reference.value)));
    const originals = structuredClone({ finiteSource, missingSource, labelled });
    const kept = [1, 2, 3, 4], finiteCrop = cropSpectra(finiteSource, 1002.5, 1010), missingCrop = cropSpectra(missingSource, 1002.5, 1010);
    for (const [source, cropped] of [[finiteSource, finiteCrop], [missingSource, missingCrop]]) {
      assert.deepEqual(cropped.axis, kept.map(j => source.axis[j])); assert.equal(cropped.axisUnit, source.axisUnit);
      assert.equal(cropped.metadata, source.metadata); assert.equal(cropped.samples.length, 8);
      cropped.samples.forEach((sample, i) => {
        assert.equal(sample.sampleId, source.samples[i].sampleId); assert.equal(sample.metadata, source.samples[i].metadata);
        assert.equal(sample.reps.length, 1);
        const rep = sample.reps[0], original = source.samples[i].reps[0];
        assert.equal(rep.repId, original.repId); assert.equal(rep.metadata, original.metadata);
        assert.equal(Object.hasOwn(rep, 'suspect'), true); assert.equal(rep.suspect, false);
        assert.ok(rep.values instanceof Float64Array); assert.equal(rep.values.length, kept.length);
        kept.forEach((j, k) => {
          if (source === missingSource && i === missingRow && j === missingBand) {
            assert.ok(Number.isNaN(rep.values[k]), 'An absent kept feature must become NaN, never a synthetic finite zero.');
          } else {
            assert.ok(Number.isFinite(rep.values[k])); assert.equal(rep.values[k], original.values[j]);
          }
        });
      });
    }
    for (const mode of ['mean', 'raw']) {
      const control = buildTrainingDataset(finiteCrop, labelled, 'concentration', mode);
      const missing = buildTrainingDataset(missingCrop, labelled, 'concentration', mode);
      for (const [cropped, training] of [[finiteCrop, control], [missingCrop, missing]]) {
        assert.doesNotThrow(() => validateDataset(training)); // Shape admission alone does not establish finite input.
        assert.equal(training.nSamples, 8); assert.equal(training.nFeatures, 4); assert.equal(training.taskType, 'regression');
        assert.equal(new Set(training.groupIds).size, 8); assert.deepEqual(training.groupIds, sampleIds);
        assert.deepEqual(training.sampleIds, mode === 'raw' ? sampleIds.map(id => `${id}#1`) : sampleIds);
        assert.equal(training.axis, cropped.axis); assert.equal(training.axisUnit, cropped.axisUnit);
        assert.deepEqual(Array.from(training.y), sampleIds.map((_, i) => 3 + i / 4)); assert.ok(training.y.every(Number.isFinite));
        assert.deepEqual(Array.from(training.X), flatten(cropped));
      }
      assert.ok(control.X.every(Number.isFinite)); assert.doesNotThrow(() => validateCalibrationDataset(control));
      assert.ok(Number.isNaN(missing.X[missingRow * 4 + 3]), `${mode} must retain the labelled sample's cropped missing band.`);
      assert.throws(() => validateCalibrationDataset(missing), { name: 'Error', message: 'Calibration requires finite spectra and targets.' });
    }
    assert.deepEqual({ finiteSource, missingSource, labelled }, originals);
  }
  const real = await import(pathToFileURL(resolve(methodsRoot, 'index.js')).href);
  const raw = fixture(), before = structuredClone(raw);
  const wantedSteps = {
    snv: { methodId: 'preprocessing.scatter.snv', params: { with_mean: true, with_std: true, ddof: 1 } },
    d1: { methodId: 'preprocessing.derivatives.savitzky_golay', params: { window_length: 15, polyorder: 2, deriv: 1, mode: 'nearest', delta: 1, cval: 0 } },
    d2: { methodId: 'preprocessing.derivatives.savitzky_golay', params: { window_length: 17, polyorder: 2, deriv: 2, mode: 'nearest', delta: 1, cval: 0 } },
    msc: { methodId: 'preprocessing.scatter.msc', params: {} },
    std: { methodId: 'preprocessing.scaling.standard_scale', params: { with_mean: true, with_std: true, ddof: 1 } },
  };
  // Vite SSR and fileURL imports can have different error-class identities.
  // Compare the exact nominal owner contract, including status AND message.
  async function assertOwnerRefusal(ds, option, ownerError) {
    if (ownerError === undefined) {
      const step = wantedSteps[option], estimator = new (real.methodClass(step.methodId))();
      try {
        estimator.params = { ...step.params };
        const X = { data: Float64Array.from(flatten(ds)), rows: ds.samples.reduce((n, sample) => n + sample.reps.length, 0), cols: ds.axis.length };
        estimator.fit(X); estimator.transform(X);
      } catch (error) { ownerError = error; } finally { estimator.dispose(); }
    }
    assert.equal(ownerError?.name, 'N4mError');
    assert.ok(Number.isInteger(ownerError.status) && ownerError.status > 0);
    assert.match(ownerError.message, new RegExp(`^n4m error ${ownerError.status}: .+`));
    await assert.rejects(host.applyPreviewPp(ds, option), { name: 'N4mError', status: ownerError.status, message: ownerError.message });
  }
  for (const [id, step] of Object.entries(wantedSteps)) assert.deepEqual(host.PREVIEW_PP.find(pp => pp.id === id).steps, [step]);
  assert.equal(await host.applyPreviewPp(raw, 'none'), raw);
  await assert.rejects(host.applyPreviewPp(raw, 'unknown'), /Unsupported preview option/);
  const numericResults = {};
  for (const option of Object.keys(wantedSteps)) {
    const out = await host.applyPreviewPp(raw, option); numericResults[option] = flatten(out);
    assert.equal(out.axis, raw.axis); assert.equal(out.axisUnit, raw.axisUnit); assert.equal(out.metadata, raw.metadata);
    out.samples.forEach((sample, i) => {
      assert.equal(sample.sampleId, raw.samples[i].sampleId); assert.equal(sample.metadata, raw.samples[i].metadata);
      sample.reps.forEach((rep, k) => {
        assert.equal(rep.repId, raw.samples[i].reps[k].repId); assert.equal(rep.suspect, raw.samples[i].reps[k].suspect);
        assert.equal(rep.metadata, raw.samples[i].reps[k].metadata); assert.ok(rep.values instanceof Float64Array);
        assert.equal(rep.values.length, 25); assert.notEqual(rep.values, raw.samples[i].reps[k].values);
      });
    });
  }
  close(numericResults.msc, expected.msc, 1e-12, 1e-12);
  const base = Array.from({ length: 25 }, (_, j) => (j - 12) / 32 + (j % 3 - 1) / 64);
  for (let row = 0; row < 6; row++) close(numericResults.msc.slice(row * 25, (row + 1) * 25), base, 1e-12, 1e-12);
  const quadratic = rowsDataset([Array.from({ length: 25 }, (_, j) => 0.25 + 0.1 * j + 0.01 * j * j)]);
  for (const [option, half, deriv] of [['d1', 7, 1], ['d2', 8, 2]]) {
    const values = flatten(await host.applyPreviewPp(quadratic, option));
    close(values, expected[option], 1e-9, 1e-10);
    for (let j = half; j < 25 - half; j++) close([values[j]], [deriv === 1 ? 0.1 + 0.02 * j : 0.02], 1e-9, 1e-10);
    const short = cropSpectra(quadratic, 0, 2), step = wantedSteps[option];
    const estimator = new (real.methodClass(step.methodId))();
    assert.ok(estimator instanceof real.NativeEstimator); assert.equal(typeof estimator.transform, 'function');
    let ownerOutput, ownerError;
    try {
      estimator.params = { ...step.params };
      const X = { data: short.samples[0].reps[0].values, rows: 1, cols: 3 };
      estimator.fit(X); ownerOutput = estimator.transform(X);
    } catch (error) { ownerError = error; } finally { estimator.dispose(); }
    if (ownerError) {
      await assertOwnerRefusal(short, option, ownerError);
      console.log(`${option} short crop: owner refusal ${ownerError.message}`);
    } else {
      const result = flatten(await host.applyPreviewPp(short, option));
      close(result, Array.from(ownerOutput.data), 1e-9, 1e-10); close(result, expected[`${option}Short`], 1e-9, 1e-10);
      console.log(`${option} short crop: owner nearest-padding success, unchanged window`);
    }
  }
  close(flatten(await host.applyPreviewPp(rowsDataset([[1, 2, 3, 4]]), 'snv')), [-1.5, -0.5, 0.5, 1.5].map(v => v / Math.sqrt(5 / 3)), 1e-12, 1e-13);
  assert.deepEqual(flatten(await host.applyPreviewPp(rowsDataset([[4, 4, 4, 4]]), 'snv')), [0, 0, 0, 0]);
  close(flatten(await host.applyPreviewPp(rowsDataset([[1, 1 + 2 ** -30, 1 + 2 ** -29]]), 'snv')), [-1, 0, 1], 1e-12, 1e-13);
  await assertOwnerRefusal(rowsDataset([[4]]), 'snv');
  // Row-constant spectra still undergo a column operation on every row.
  close(flatten(await host.applyPreviewPp(rowsDataset([[1, 1], [2, 2], [4, 4]]), 'std')), [1, 1, 2, 2, 4, 4].map(v => (v - 7 / 3) / Math.sqrt(7 / 3)), 1e-12, 1e-12);
  assert.deepEqual(flatten(await host.applyPreviewPp(rowsDataset([[5, 1], [5, 2], [5, 3]]), 'std')), [0, -1, 0, 0, 0, 1]);
  await assertOwnerRefusal(rowsDataset([[1, 2]]), 'std');
  for (const bad of [rowsDataset([[2, 2], [2, 2]]), rowsDataset([[1, 2], [2, 1]]), rowsDataset([[1, 1, 1], [0, 1, 2], [0, 2, 4]])]) {
    await assertOwnerRefusal(bad, 'msc');
  }
  const crop = cropSpectra(raw, 1010, 1040), croppedOut = await host.applyPreviewPp(crop, 'std');
  assert.deepEqual(crop.axis, raw.axis.slice(4, 17)); assert.equal(crop.metadata, raw.metadata);
  assert.equal(crop.samples[0].reps[0].metadata, raw.samples[0].reps[0].metadata); assert.equal(croppedOut.axis, crop.axis);
  close(flatten(croppedOut), numericResults.std.filter((_, i) => i % 25 >= 4 && i % 25 <= 16), 1e-12, 1e-12);
  for (const value of [null, undefined, '1', NaN, Infinity, -Infinity]) {
    const bad = fixture(); bad.samples[0].reps[0].values = Array.from(bad.samples[0].reps[0].values); bad.samples[0].reps[0].values[5] = value;
    const copy = structuredClone(bad);
    for (const option of Object.keys(wantedSteps)) await assert.rejects(host.applyPreviewPp(bad, option), /Missing|non-finite|non-numeric/);
    assert.equal(await host.applyPreviewPp(bad, 'none'), bad); assert.deepEqual(bad, copy);
    const badCrop = cropSpectra(bad, 1010, 1040);
    assert.ok(!Number.isFinite(badCrop.samples[0].reps[0].values[1])); await assert.rejects(host.applyPreviewPp(badCrop, 'snv'));
  }
  const ragged = fixture(); ragged.samples[0].reps[0].values = new Float64Array(24);
  for (const option of Object.keys(wantedSteps)) await assert.rejects(host.applyPreviewPp(ragged, option), /Ragged/);
  assert.deepEqual(raw, before);

  // Controlled initialization/errors only. Successful fit/transform delegate to WASM.
  const controlled = await createServer(config({ control: true }));
  try {
    const calls = { load: 0, lookup: [], create: 0, fit: [], transform: 0, dispose: 0, release: 0 };
    let release, initError = false, failAt;
    const gate = new Promise(resolve => { release = resolve; });
    globalThis.__previewOwner = {
      owner: real, // One initialized namespace for classes, getters and native state.
      async load() { calls.load++; await gate; if (initError) throw new Error('controlled init failure'); await real.loadModule(); },
      methodClass(methodId) {
        calls.lookup.push(methodId);
        const OwnerClass = real.methodClass(methodId);
        // Subclass the actual generated estimator: preserve NativeEstimator
        // identity, public params, fitted state, and the synchronous role API.
        return class extends OwnerClass {
          constructor() { super(); calls.create++; if (failAt === 'create') throw new Error('controlled create failure'); }
          fit(X) {
            calls.fit.push({ methodId: this.methodId, params: { ...this.params }, rows: X.rows, cols: X.cols, values: Array.from(X.data) });
            if (failAt === 'fit') throw new Error('controlled fit failure');
            return super.fit(X);
          }
          transform(X) { calls.transform++; if (failAt === 'transform') throw new Error('controlled transform failure'); return super.transform(X); }
          dispose() { calls.dispose++; if (this.fitted) calls.release++; super.dispose(); }
        };
      },
    };
    const adapter = await controlled.ssrLoadModule('/src/lib/preview.ts');
    assert.equal(await adapter.applyPreviewPp(raw, 'none'), raw); assert.equal(calls.load, 0);
    const { applySteps } = await controlled.ssrLoadModule('/src/engine/jsNumerics.ts');
    const X = { data: Float64Array.from(flatten(raw)), rows: 6, cols: 25 };
    assert.equal(await applySteps(X, []), X);
    await assert.rejects(applySteps(X, [wantedSteps.snv, wantedSteps.std]), { message: 'Preview processing supports exactly one transformer step.' });
    assert.equal(calls.load, 0); assert.equal(calls.lookup.length, 0); assert.equal(calls.create, 0);
    const pending = [adapter.applyPreviewPp(raw, 'msc'), adapter.applyPreviewPp(raw, 'std')];
    assert.equal(calls.load, 1); assert.equal(calls.create, 0); release(); await Promise.all(pending);
    // NativeEstimator.fit disposes the prior (initially empty) handle before
    // publishing the new fit; finally must then release each fitted handle.
    assert.equal(calls.dispose, 4); assert.equal(calls.release, 2);
    for (const X of calls.fit) { assert.equal(X.rows, 6); assert.equal(X.cols, 25); assert.deepEqual(X.values, flatten(raw)); }
    for (const option of ['msc', 'std']) await adapter.applyPreviewPp(crop, option);
    for (const X of calls.fit.slice(2)) { assert.equal(X.rows, 6); assert.equal(X.cols, 13); assert.deepEqual(X.values, flatten(crop)); }
    for (const phase of ['create', 'fit', 'transform']) {
      failAt = phase; const disposals = calls.dispose, releases = calls.release;
      await assert.rejects(adapter.applyPreviewPp(raw, 'snv'), new RegExp(`controlled ${phase} failure`));
      assert.equal(calls.dispose, disposals + (phase === 'create' ? 0 : phase === 'fit' ? 1 : 2));
      assert.equal(calls.release, releases + (phase === 'transform' ? 1 : 0));
    }
    const fresh = await createServer(config({ control: true }));
    try {
      initError = true; const next = await fresh.ssrLoadModule('/src/lib/preview.ts'); const creations = calls.create;
      await assert.rejects(next.applyPreviewPp(raw, 'snv'), /controlled init failure/); assert.equal(calls.create, creations);
      initError = false; failAt = undefined; globalThis.__previewOwner.version = '1.3.4';
      await assert.rejects(next.applyPreviewPp(raw, 'snv'), /Quality requires Methods/); assert.equal(calls.create, creations);
      delete globalThis.__previewOwner.version;
      await next.applyPreviewPp(raw, 'snv'); assert.equal(calls.create, creations + 1); assert.equal(calls.dispose, 13); assert.equal(calls.release, 6);
      for (const fitted of calls.fit) {
        const recipe = Object.values(wantedSteps).find(step => step.methodId === fitted.methodId);
        assert.deepEqual(fitted.params, recipe.params, 'Public params must reach the real generated estimator unchanged.');
      }
    } finally { await fresh.close(); }
  } finally { delete globalThis.__previewOwner; await controlled.close(); }

  browserServer = await createServer(config({ browser: true })); await browserServer.listen();
  browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${browserServer.httpServer.address().port}/__preview_contract`); await page.waitForFunction(() => !!globalThis.__contract);
  const settle = status => page.waitForFunction(wanted => document.querySelector('[data-testid=preview-status]')?.dataset.previewState === wanted && globalThis.__current?.status === wanted, status);
  const set = changes => page.evaluate(changes => globalThis.__contract.set(changes), changes);
  for (const screen of ['explorer', 'health']) {
    await set({ screen, option: 'none', project: 'P-A', dataset: 'A', crop: null, mounted: true }); await settle('raw');
    for (const option of Object.keys(wantedSteps)) {
      await page.getByTestId(`preview-option-${option}`).click(); await settle('ready');
      const view = screen === 'health' ? 'HealthSpectraView' : 'SpectraTab';
      const displayed = await page.evaluate(({ view }) => {
        const ds = globalThis.__screenInputs.filter(input => input.view === view).at(-1).spectra;
        return ds.samples.flatMap(s => s.reps.flatMap(r => Array.from(r.values)));
      }, { view });
      close(displayed, numericResults[option], option.startsWith('d') ? 1e-9 : 1e-12, option.startsWith('d') ? 1e-10 : option === 'snv' ? 1e-13 : 1e-12);
      if (['msc', 'std'].includes(option)) assert.match(await page.textContent('body'), /Descriptive preview fitted on all displayed repetitions; not a calibration model\./);
      if (option.startsWith('d')) assert.match(await page.textContent('body'), /Derivative per band index \(delta = 1\)/);
      if (screen === 'health') assert.equal(await page.evaluate(() => globalThis.__qualityInputs.at(-1) === globalThis.__current.raw), true, 'Health findings use RAW cropped identity');
    }
    if (screen === 'explorer') {
      await page.getByRole('button', { name: 'PCA', exact: true }).click();
      close(await page.evaluate(() => globalThis.__screenInputs.filter(input => input.view === 'PcaTab').at(-1).spectra.samples.flatMap(s => s.reps.flatMap(r => Array.from(r.values)))), numericResults.std, 1e-12, 1e-12);
      await page.getByRole('button', { name: 'Spectra', exact: true }).click();
    }
    for (const [dataset, option] of [['oneband', 'snv'], ['singleton', 'std'], ['constantMsc', 'msc'], ['zeroSlope', 'msc'], ['missing', 'snv'], ['ragged', 'snv'], ['A', 'unknown']]) {
      await set({ dataset, option }); await settle('unavailable'); assert.match(await page.getByTestId('preview-status').textContent(), /^Raw — preview processing unavailable/);
      assert.equal(await page.evaluate(() => globalThis.__current.spectra === globalThis.__current.raw), true);
      await set({ option: 'none' }); await settle('raw');
    }
  }
  // StrictMode is enabled. Delay actual success/error over each bounded key change.
  for (const outcome of ['success', 'error']) for (const change of ['option', 'project', 'dataset', 'crop', 'unmount']) {
    await page.evaluate(() => { globalThis.__deferPreview = true; globalThis.__pendingPreview = []; });
    await set({ screen: 'explorer', project: 'P-A', dataset: 'A', crop: null, option: 'snv', mounted: true }); await settle('processing');
    assert.equal(await page.getByTestId('preview-status').textContent(), 'Raw — preview processing');
    const changes = change === 'option' ? { option: 'std' } : change === 'project' ? { project: 'P-B' }
      : change === 'dataset' ? { dataset: 'B' } : change === 'crop' ? { crop: { from: 1010, to: 1040 } } : { mounted: false };
    assert.equal(await page.evaluate(changes => {
      globalThis.__oldPending = globalThis.__pendingPreview.splice(0); globalThis.__contract.set(changes);
      return changes.mounted === false ? document.querySelector('[data-testid=preview-status]') === null
        : globalThis.__current.status === 'processing' && globalThis.__current.spectra === globalThis.__current.raw;
    }, changes), true, 'new-key render must show raw immediately');
    if (change !== 'unmount') {
      await settle('processing');
      await page.evaluate(async () => { await Promise.all(globalThis.__pendingPreview.splice(0).map(item => item.success())); }); await settle('ready');
      await page.evaluate(() => { globalThis.__newerResult = globalThis.__current.spectra; globalThis.__newerDisplay = globalThis.__screenInputs.at(-1).spectra; });
    }
    await page.evaluate(async outcome => { await Promise.all(globalThis.__oldPending.map(item => item[outcome]())); await new Promise(resolve => setTimeout(resolve, 0)); }, outcome);
    if (change === 'unmount') assert.equal(await page.getByTestId('preview-status').count(), 0);
    else {
      await settle('ready'); assert.equal(await page.evaluate(() => globalThis.__current.spectra === globalThis.__newerResult && globalThis.__screenInputs.at(-1).spectra === globalThis.__newerDisplay), true);
    }
    assert.equal(await page.evaluate(() => { globalThis.__contract.set({ option: 'none', mounted: true }); return globalThis.__current.status === 'raw' && globalThis.__current.spectra === globalThis.__current.raw; }), true, 'Raw reset is immediate');
  }
  // Same-key StrictMode cleanup: late first-setup errors must not replace success.
  await set({ mounted: false });
  await page.evaluate(() => { globalThis.__pendingPreview = []; });
  await set({ mounted: true, screen: 'explorer', option: 'snv', dataset: 'A', project: 'P-A', crop: null }); await settle('processing');
  assert.equal(await page.evaluate(() => globalThis.__pendingPreview.length), 4, 'two real hook consumers, each with StrictMode setup/cleanup/setup');
  await page.evaluate(async () => {
    const all = globalThis.__pendingPreview.splice(0); globalThis.__strictOld = all.slice(0, 2);
    await Promise.all(all.slice(2).map(item => item.success()));
  }); await settle('ready');
  await page.evaluate(async () => { globalThis.__strictOld.forEach(item => item.error()); await new Promise(resolve => setTimeout(resolve, 0)); }); await settle('ready');
  // Reset Raw with work still pending, then deliver both kinds of late outcome.
  for (const outcome of ['success', 'error']) {
    await set({ option: 'std' }); await settle('processing');
    assert.equal(await page.evaluate(() => { globalThis.__contract.set({ option: 'none' }); return globalThis.__current.status === 'raw' && globalThis.__current.spectra === globalThis.__current.raw; }), true);
    await page.evaluate(async outcome => { await Promise.all(globalThis.__pendingPreview.splice(0).map(item => item[outcome]())); await new Promise(resolve => setTimeout(resolve, 0)); }, outcome);
    await settle('raw');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', stage, scope: 'five owner-WASM previews, both host screens, RAW Health findings, identity/crop/missingness, bounded lifecycle' }));
} finally {
  if (browser) await browser.close(); if (browserServer) await browserServer.close(); await server.close();
}

// One virtual browser entry; real screens/hook/adapters, controlled store transport.
function browserEntry() { return `
  import React, { StrictMode, useState } from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
  import { Context, useProjectSpectra } from 'preview-contract:store';
  import { usePreviewSpectra } from '/src/lib/usePreviewSpectra.ts'; import { DatasetExplorer } from '/src/screens/DatasetExplorer.tsx'; import { Health } from '/src/screens/Health.tsx';
  import { I18nProvider } from '/src/i18n/index.tsx'; import { initializeDiagnostics } from '/src/engine/nativeDiagnostics.ts';
  const fixture = ${fixture.toString()}; const rowsDataset = ${rowsDataset.toString()};
  globalThis.__screenInputs = []; globalThis.__qualityInputs = []; globalThis.__pendingPreview = [];
  localStorage.setItem('quali-nirs4all.lang', 'en'); await initializeDiagnostics();
  const A = fixture(), B = fixture('B', 3), missing = fixture('missing'), ragged = fixture('ragged');
  missing.samples[0].reps[0].values[5] = NaN; ragged.samples[0].reps[0].values = new Float64Array(24);
  const datasets = { A, B, missing, ragged, oneband: rowsDataset([[4], [5], [6]]), singleton: rowsDataset([[1, 2, 3]]), constantMsc: rowsDataset([[2, 2], [2, 2], [2, 2]]), zeroSlope: rowsDataset([[1, 1, 1], [0, 1, 2], [0, 2, 4]]) };
  function Probe({ project, option }) {
    const raw = useProjectSpectra(project), result = usePreviewSpectra(project, raw, option);
    globalThis.__current = { ...result, raw, project, option }; return null;
  }
  function Harness() {
    const [control, update] = useState({ screen: 'explorer', project: 'P-A', dataset: 'A', crop: null, option: 'none', mounted: true });
    globalThis.__contract = { set: changes => flushSync(() => update(current => ({ ...current, ...changes }))) };
    const raw = datasets[control.dataset];
    const state = { projects: [], spectraByProject: { [control.project]: raw }, cropByProject: { [control.project]: control.crop },
      samplesByProject: { [control.project]: raw.samples.map(s => ({ id: s.sampleId, metadata: { instrument: 'A' }, status: 'unlabelled' })) },
      previewPpByProject: { [control.project]: control.option }, repModeByProject: {} };
    const dispatch = action => {
      if (action.kind === 'set_preview_pp') update(current => ({ ...current, option: action.pp }));
      else if (action.kind === 'set_crop') update(current => ({ ...current, crop: { from: action.from, to: action.to } }));
      else throw new Error('Unexpected test-store action: ' + action.kind);
    };
    return React.createElement(Context.Provider, { value: { state, dispatch } }, control.mounted && React.createElement(React.Fragment, null,
      React.createElement(Probe, { project: control.project, option: control.option }),
      React.createElement(control.screen === 'health' ? Health : DatasetExplorer, { key: control.screen, projectId: control.project })));
  }
  createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null, React.createElement(I18nProvider, null, React.createElement(Harness))));
`; }
