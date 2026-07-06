// A deterministic STUB engine — a "null model" (predicts the training mean) that
// lets the whole app (screens, worklists, reliability cards) be built and driven
// with honest, reproducible numbers before the WASM engine is wired. It is NOT a
// real calibration: `name`/`engine` say 'stub' so nothing mistakes it for one.

import { regressionMetrics } from './metrics.js';
import { validateDataset } from './port.js';
import type {
  FittedModel,
  LabEngine,
  MaterializedDataset,
  PipelineDSL,
  PredictResult,
  PredRow,
  RunOptions,
  RunResult,
  ScoreNode,
} from './port.js';

interface StubState {
  mean: number;
}

function trainMean(ds: MaterializedDataset): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < ds.nSamples; i++) {
    if (ds.partitions[i] === 'train') {
      const v = ds.y[i];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; count += 1; }
    }
  }
  // fall back to all rows if there is no explicit train partition
  if (count === 0) {
    for (let i = 0; i < ds.nSamples; i++) {
      const v = ds.y[i];
      if (typeof v === 'number' && Number.isFinite(v)) { sum += v; count += 1; }
    }
  }
  return count > 0 ? sum / count : 0;
}

function scoreRows(ds: MaterializedDataset, mean: number, which: 'train' | 'test'): PredRow[] {
  const rows: PredRow[] = [];
  for (let i = 0; i < ds.nSamples; i++) {
    if (ds.partitions[i] !== which) continue;
    const actual = ds.y[i] ?? Number.NaN;
    rows.push({ sampleId: ds.sampleIds[i] ?? `s${i}`, actual, predicted: mean, residual: actual - mean });
  }
  return rows;
}

export class StubEngine implements LabEngine {
  readonly name = 'stub';

  async run(ds: MaterializedDataset, dsl: PipelineDSL, opts?: RunOptions): Promise<RunResult> {
    validateDataset(ds);
    opts?.onProgress?.({ phase: 'preprocess', pct: 10 });
    const mean = trainMean(ds);
    opts?.onProgress?.({ phase: 'refit', pct: 70 });

    const hasTest = ds.partitions.includes('test');
    const refitRows = scoreRows(ds, mean, hasTest ? 'test' : 'train');
    const refit: ScoreNode = {
      id: 'refit', name: 'Refit (null model)', kind: 'refit',
      metrics: regressionMetrics(refitRows), predictions: refitRows, status: 'completed',
    };

    // NOTE: the stub is a null model — it does NOT do cross-validation, so it
    // never emits a `cv` node (that would misrepresent a real CV). Only the WASM
    // engine produces honest CV / OOF scores.
    opts?.onProgress?.({ phase: 'done', pct: 100 });
    const state: StubState = { mean };
    return {
      id: `stub-${ds.sampleIds.length}-${dsl.name}`,
      pipelineName: dsl.name,
      taskType: ds.taskType,
      targetName: ds.targetName,
      refit,
      folds: [],
      seed: dsl.cv?.seed ?? 42,
      engine: 'stub',
      scoreMetric: 'rmse',
      model: { taskType: ds.taskType, nFeatures: ds.nFeatures, state },
      createdAt: new Date().toISOString(),
    };
  }

  async predict(model: FittedModel, _Xnew: Float64Array, nSamples: number, _nFeatures: number): Promise<PredictResult> {
    const state = model.state as StubState;
    const mean = state?.mean ?? 0;
    const values = new Float64Array(nSamples);
    values.fill(mean);
    return { values };
  }
}
