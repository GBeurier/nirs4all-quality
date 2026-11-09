// Named pre-migration Quali reference; test-only, never a production fallback.
// WASM target — a REAL working engine that reuses the `nirs4all` package's
// portable pipeline (libn4m WASM via the aliased `@nirs4all/methods`). This
// deliberately does NOT pull studio-lite's `@/`-aliased engine (which collides
// with this app's `@/` when bundled by source); it consumes the clean, package-
// exported `runPortablePipeline` / `predictPortablePipeline` surface instead.
//
// Scope: the portable path covers regression + PLS with SNV / Savitzky-Golay and
// a Kennard-Stone split — the design's MVP calibration. Broader coverage (CV/OOF,
// D-optimal, conformal) arrives with the dag-ml scheduler behind this same port.
import {
  predictPortablePipeline,
  runPortablePipeline,
  type PortablePlsModel,
} from 'nirs4all';

import { regressionMetrics } from '../../metrics.js';
import { evaluationLabel, validateCalibrationDataset, validateSelectionSplit, type Evaluation } from '../../evaluation.js';
import { validatePreprocessingStep } from '../../preprocessing.js';
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
} from '../../port.js';

interface PortableFitState {
  backendId: 'nirs4all-core-wasm';
  result: {
    preprocessing: Awaited<ReturnType<typeof runPortablePipeline>>['preprocessing'];
    model: PortablePlsModel;
  };
}

function numComponents(value: unknown): number {
  if (value === undefined) return 10;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('PLS n_components must be a positive integer.');
  }
  return value;
}

/** Lower the app pipeline DSL to a portable class-path source (the nirs4all runtime contract). */
function toPortableSource(dsl: PipelineDSL): Record<string, unknown> {
  if (dsl.model && dsl.model.type !== 'PLS') throw new Error(`Unsupported WASM model '${dsl.model.type}'.`);
  for (const key of Object.keys(dsl.model?.params ?? {})) {
    if (key !== 'n_components') throw new Error(`Unsupported PLS parameter '${key}'.`);
  }
  const pipeline: unknown[] = [
    // Selection validation via Kennard-Stone; reused to choose components.
    { class: 'nirs4all.operators.splitters.KennardStoneSplitter', params: { test_size: 0.25 } },
  ];
  for (const step of dsl.steps) {
    validatePreprocessingStep(step, 'wasm');
    if (step.type === 'StandardNormalVariate') {
      pipeline.push({ class: 'nirs4all.operators.transforms.StandardNormalVariate', params: {} });
    } else if (step.type === 'SavitzkyGolay') {
      pipeline.push({ class: 'nirs4all.operators.transforms.SavitzkyGolay', params: { ...step.params } });
    }
  }
  // Sweep n_components 1..max so we get the RMSE-vs-components curve; the runtime
  // selects the best and reports every variant's RMSE.
  const maxComp = numComponents(dsl.model?.params?.['n_components']);
  pipeline.push({
    model: { class: 'sklearn.cross_decomposition.PLSRegression', params: { n_components: maxComp } },
    param: 'n_components',
    _range_: [1, maxComp, 1],
  });
  return { name: dsl.name, pipeline };
}

export const wasmEngine: LabEngine = {
  name: 'nirs4all-core-wasm',

  async run(ds: MaterializedDataset, dsl: PipelineDSL, opts?: RunOptions): Promise<RunResult> {
    validateCalibrationDataset(ds);
    opts?.onProgress?.({ phase: 'preprocess', pct: 5, message: 'pipeline portable nirs4all (libn4m WASM)' });
    const result = await runPortablePipeline(toPortableSource(dsl), {
      X: ds.X,
      y: ds.y,
      rows: ds.nSamples,
      cols: ds.nFeatures,
    });

    validateSelectionSplit(result.split.trainIndices, result.split.testIndices);
    // Older Core runtimes predate the evaluation DTO. Their sweep still uses
    // validation for selection; never infer a test from the split's name.
    const evaluation = (result as typeof result & { evaluation?: Evaluation }).evaluation
      ?? { scope: 'selection_validation' as const, independent_test: false };
    const scoreIdx = result.split.testIndices;
    const preds = result.selected.predictions;
    const rows: PredRow[] = scoreIdx.map((row, i) => {
      const actual = ds.y[row] ?? Number.NaN;
      const predicted = preds[i] ?? Number.NaN;
      return { sampleId: ds.sampleIds[row] ?? `s${row}`, actual, predicted, residual: predicted - actual };
    });
    const refit: ScoreNode = {
      id: 'refit',
      name: evaluationLabel(evaluation),
      kind: 'refit',
      metrics: regressionMetrics(rows),
      predictions: rows,
      status: 'completed',
    };

    opts?.onProgress?.({ phase: 'done', pct: 100 });
    const state: PortableFitState = {
      backendId: 'nirs4all-core-wasm',
      result: { preprocessing: result.preprocessing, model: result.model },
    };
    const variants = result.variants.map((v) => ({
      x: v.n_components, rmse: v.rmse, selected: v.n_components === result.selected.n_components,
    }));
    return {
      id: `wasm-${ds.nSamples}-${dsl.name}`,
      pipelineName: dsl.name,
      taskType: 'regression',
      targetName: ds.targetName,
      refit,
      folds: [],
      seed: 0,
      engine: 'nirs4all-core-wasm',
      scoreMetric: 'rmse',
      evaluation,
      model: { taskType: 'regression', nFeatures: ds.nFeatures, state },
      createdAt: new Date().toISOString(),
      ...(variants.length > 1 ? { variants, variantAxis: { fr: 'nb de composantes PLS', en: 'PLS components' } } : {}),
    };
  },

  async predict(model: FittedModel, Xnew: Float64Array, nSamples: number, nFeatures: number): Promise<PredictResult> {
    const state = model.state as PortableFitState;
    const out = await predictPortablePipeline(state.result, { X: Xnew, rows: nSamples, cols: nFeatures });
    return { values: Float64Array.from(out.data) };
  },
};
