// JS-numerics engine for the calibration variants libn4m's portable path can't
// run (Ridge + the compact/extended AOM operator screens). Real closed-form ridge
// (see jsNumerics), a deterministic 25% hold-out, and honest RMSE-on-test. It
// screens a list of preprocessing chains × an α grid and keeps the best, then
// returns the SAME RunResult shape as the WASM engine so the leaderboard and the
// TrainingResults charts treat every variant uniformly.
import { regressionMetrics } from './metrics.js';
import {
  applyChain, applySteps, kennardStoneTest, plsFit, plsPredictRow, ridgeFit, ridgePredictRow,
  type Operator, type PreprocStep, type RidgeModel, type StepState,
} from './jsNumerics.js';
import type { MaterializedDataset, PredRow, RunResult } from './port.js';

// A Kennard-Stone hold-out on raw X (test_size ≈ 0.25) — the same spread-based
// split the WASM portable path uses, so PLS and Ridge/AOM metrics are comparable.
function splitIdx(ds: MaterializedDataset): { train: number[]; test: number[] } {
  const testSet = new Set(kennardStoneTest(ds.X, ds.nSamples, ds.nFeatures, 0.25));
  const train: number[] = [];
  const test: number[] = [];
  for (let i = 0; i < ds.nSamples; i++) (testSet.has(i) ? test : train).push(i);
  return test.length >= 2 && train.length >= 2 ? { train, test } : { train: [...train, ...test], test: [...train, ...test] };
}

function gather(data: Float64Array, p: number, idx: number[]): Float64Array {
  const out = new Float64Array(idx.length * p);
  idx.forEach((row, i) => { for (let j = 0; j < p; j++) out[i * p + j] = data[row * p + j]!; });
  return out;
}

interface Fit { model: RidgeModel; rmse: number; preds: number[]; p: number; }

function fitEval(ops: readonly Operator[], alpha: number, ds: MaterializedDataset, tr: number[], te: number[]): Fit {
  const { data, p } = applyChain(ds.X, ds.nSamples, ds.nFeatures, ops);
  const Xtr = gather(data, p, tr);
  const ytr = Float64Array.from(tr.map((r) => ds.y[r] ?? 0));
  const model = ridgeFit(Xtr, tr.length, p, ytr, alpha);
  const Xte = gather(data, p, te);
  const preds = te.map((_, i) => ridgePredictRow(model, Xte, i * p));
  let sse = 0;
  te.forEach((r, i) => { const d = preds[i]! - (ds.y[r] ?? 0); sse += d * d; });
  return { model, rmse: Math.sqrt(sse / Math.max(1, te.length)), preds, p };
}

/** One preprocessing chain to screen (a composition of strict-linear operators). */
export interface RidgeChain { label: string; ops: Operator[]; }
export interface JsRidgeScreenSpec {
  kind: 'js_ridge_screen';
  chains: RidgeChain[];
  alphas: number[];
  axis: { fr: string; en: string };
}

/** One preprocessing chain to screen, expressed as real DSL steps (window-aware
 *  Savitzky-Golay / MSC / SNV / detrend) — the AOM-PLS banks use this. */
export interface StepChain { label: string; steps: PreprocStep[]; }

/** Screen real preprocessing-step chains × PLS components (KS hold-out), keeping the
 *  best. Unlike runPlsScreen (coarse operator union), each Savitzky-Golay window/deriv
 *  produces a genuinely distinct column set, so an enlarged bank is meaningful even
 *  when the libn4m WASM PLS path is unavailable. */
export function runPlsScreenSteps(ds: MaterializedDataset, screen: StepChain[], maxComp: number, name: string): RunResult {
  const { train, test } = splitIdx(ds);
  const yTrain = Float64Array.from(train.map((r) => ds.y[r] ?? 0));

  interface PFit { rmse: number; preds: number[]; nComp: number; }
  let best: PFit | null = null;
  let bestChain = screen[0]!;
  let bestNComp = 1;

  const variants = screen.map((chain, k) => {
    const { data, p } = applySteps(ds.X, ds.nSamples, ds.nFeatures, chain.steps);
    const Xtr = gather(data, p, train);
    const Xte = gather(data, p, test);
    const maxC = Math.max(1, Math.min(maxComp, train.length - 1, p));
    let cBest: PFit | null = null;
    for (let nc = 1; nc <= maxC; nc++) {
      const model = plsFit(Xtr, train.length, p, yTrain, nc);
      const preds = test.map((_, i) => plsPredictRow(model, Xte, i * p));
      let sse = 0;
      test.forEach((r, i) => { const d = preds[i]! - (ds.y[r] ?? 0); sse += d * d; });
      const rmse = Math.sqrt(sse / Math.max(1, test.length));
      if (!cBest || rmse < cBest.rmse) cBest = { rmse, preds, nComp: nc };
    }
    if (cBest && (!best || cBest.rmse < best.rmse)) { best = cBest; bestChain = chain; bestNComp = cBest.nComp; }
    return { x: k, rmse: cBest?.rmse ?? Number.POSITIVE_INFINITY, selected: false, label: chain.label };
  });
  variants.forEach((v, k) => { v.selected = screen[k] === bestChain; });

  const rows: PredRow[] = test.map((r, i) => {
    const actual = ds.y[r] ?? Number.NaN;
    const predicted = best?.preds[i] ?? Number.NaN;
    return { sampleId: ds.sampleIds[r] ?? `s${r}`, actual, predicted, residual: predicted - actual };
  });

  // deploy model = refit best chain+nComp on ALL samples, capturing stateful preproc
  const capture: StepState = {};
  const all = applySteps(ds.X, ds.nSamples, ds.nFeatures, bestChain.steps, { capture });
  const deployModel = plsFit(all.data, ds.nSamples, all.p, ds.y, bestNComp);

  return {
    id: `js-pls-${ds.nSamples}-${name}`,
    pipelineName: name,
    taskType: 'regression',
    targetName: ds.targetName,
    refit: { id: 'refit', name: 'Refit · test', kind: 'refit', metrics: regressionMetrics(rows), predictions: rows, status: 'completed' },
    folds: [],
    seed: 0,
    engine: 'js-pls',
    scoreMetric: 'rmse',
    model: { taskType: 'regression', nFeatures: ds.nFeatures, state: { backendId: 'js-pls', steps: bestChain.steps, stepState: capture, pls: deployModel } },
    createdAt: new Date().toISOString(),
    ...(variants.length > 1 ? { variants, variantAxis: { fr: 'combo de préprocessing screené', en: 'screened preprocessing combo', categorical: true } } : {}),
  };
}

export function runJsVariant(ds: MaterializedDataset, spec: JsRidgeScreenSpec, name: string): RunResult {
  const { train, test } = splitIdx(ds);
  let best: Fit | null = null;
  let bestChain = spec.chains[0]!;
  let bestAlpha = spec.alphas[0]!;

  const variants = spec.chains.map((chain, k) => {
    let cBest: Fit | null = null;
    let cAlpha = spec.alphas[0]!;
    for (const alpha of spec.alphas) {
      const f = fitEval(chain.ops, alpha, ds, train, test);
      if (!cBest || f.rmse < cBest.rmse) { cBest = f; cAlpha = alpha; }
    }
    if (!best || cBest!.rmse < best.rmse) { best = cBest; bestChain = chain; bestAlpha = cAlpha; }
    return { x: k, rmse: cBest!.rmse, selected: false, label: chain.label };
  });
  variants.forEach((v, k) => { v.selected = spec.chains[k] === bestChain; });

  const rows: PredRow[] = test.map((r, i) => {
    const actual = ds.y[r] ?? Number.NaN;
    const predicted = best!.preds[i] ?? Number.NaN;
    return { sampleId: ds.sampleIds[r] ?? `s${r}`, actual, predicted, residual: predicted - actual };
  });

  // the SERIALIZED model is refit on ALL labelled samples (not just the KS-train
  // subset) so an exported .n4a is deployment-ready; test metrics stay from the
  // held-out estimate above.
  const allIdx = Array.from({ length: ds.nSamples }, (_, i) => i);
  const deployModel = fitEval(bestChain.ops, bestAlpha, ds, allIdx, [allIdx[0] ?? 0]).model;

  return {
    id: `js-ridge-${ds.nSamples}-${name}`,
    pipelineName: name,
    taskType: 'regression',
    targetName: ds.targetName,
    refit: { id: 'refit', name: 'Refit · test', kind: 'refit', metrics: regressionMetrics(rows), predictions: rows, status: 'completed' },
    folds: [],
    seed: 0,
    engine: 'js-ridge',
    scoreMetric: 'rmse',
    model: { taskType: 'regression', nFeatures: ds.nFeatures, state: { backendId: 'js-ridge', chain: bestChain.label, ops: bestChain.ops, alpha: bestAlpha, ridge: deployModel } },
    createdAt: new Date().toISOString(),
    ...(variants.length > 1 ? { variants, variantAxis: { fr: spec.axis.fr, en: spec.axis.en, categorical: true } } : {}),
  };
}
