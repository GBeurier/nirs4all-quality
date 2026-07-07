// quali-nirs4all — engine PORT (hexagonal seam).
//
// The app never talks to a concrete engine; it talks to this port. Two targets
// implement it (the design's "WASM target + Python target anticipated"):
//
//   • WASM  — reuses studio-lite's shipped `Engine` (dag-ml scheduler + libn4m),
//             imported through the `@studio/engine/*` alias. See ./wasmEngine.ts.
//   • Python— a future backend implementing the SAME shape over the `nirs4all`
//             runtime (numerics as a ModelBackend, or the whole run remotely).
//             See ./pythonEngine.ts.
//
// The contract below is a deliberately MINIMAL, structurally-compatible subset
// of studio-lite's `src/engine/types.ts` (`Engine`, `MaterializedDataset`,
// `PipelineDSL`, `RunResult`). The WASM adapter satisfies it by delegating to the
// real engine; keeping it here (not importing it) lets the app compile without
// the sibling checkout and gives the Python target a single shape to satisfy.
// It must stay structurally compatible — see the compat check in ./wasmEngine.ts.

export type TaskType = 'regression' | 'binary' | 'multiclass';
export type Partition = 'train' | 'test' | 'predict';

/** Browser-materialized dataset view (mirrors studio-lite MaterializedDataset). */
export interface MaterializedDataset {
  /** row-major, length nSamples * nFeatures */
  X: Float64Array;
  nSamples: number;
  nFeatures: number;
  axis: number[];
  axisUnit: string;
  y: Float64Array;
  targetName: string;
  taskType: TaskType;
  classes?: string[];
  /** stable per-sample identity — joins keyed by this, never by row order */
  sampleIds: string[];
  partitions: Partition[];
}

/** One pipeline step (catalog `type` token + params). */
export interface PipelineStep {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

/** The pipeline DSL (a pre-chewed recipe; the lab tech never edits this). */
export interface PipelineDSL {
  name: string;
  split?: PipelineStep;
  steps: PipelineStep[];
  model?: PipelineStep;
  cv?: { folds: number; seed: number };
}

export interface Metrics {
  rmse?: number;
  r2?: number;
  rpd?: number;
  rpiq?: number;
  bias?: number;
  n?: number;
}

export interface PredRow {
  sampleId: string;
  actual: number;
  predicted: number;
  residual: number;
}

export interface ScoreNode {
  id: string;
  name: string;
  kind: 'refit' | 'cv' | 'fold';
  metrics: Metrics;
  predictions: PredRow[];
  status: 'completed' | 'running' | 'failed';
}

/** Opaque fitted model produced by run(), consumed by predict(). */
export interface FittedModel {
  taskType: TaskType;
  nFeatures: number;
  classes?: string[];
  /** engine-specific serialized state (preprocessing + model) */
  state: unknown;
}

export interface RunResult {
  id: string;
  pipelineName: string;
  taskType: TaskType;
  targetName: string;
  refit: ScoreNode;
  cv?: ScoreNode;
  folds: ScoreNode[];
  seed: number;
  /** which engine produced this ('dag-ml-wasm' | 'nirs4all-core-wasm' | 'python' | 'stub') */
  engine: string;
  scoreMetric: keyof Metrics;
  model: FittedModel;
  createdAt: string;
  /** per-hyperparameter sweep scores (RMSE vs components / alpha / operator), if swept */
  variants?: { x: number; rmse: number; selected: boolean; label?: string }[];
  /** what the sweep's x axis means (PLS components, Ridge alpha, AOM operator…) */
  variantAxis?: { fr: string; en: string; categorical?: boolean; logX?: boolean };
}

export interface RunProgress {
  phase: 'preprocess' | 'fit_cv' | 'select' | 'refit' | 'predict' | 'done';
  pct: number;
  message?: string;
}

export interface RunOptions {
  onProgress?: (p: RunProgress) => void;
  signal?: AbortSignal;
  allowFallback?: boolean;
}

export interface PredictResult {
  values: Float64Array;
  labels?: string[];
}

/**
 * The engine contract the app depends on. Structurally the same two-method
 * facade as studio-lite's `Engine`, so the WASM engine satisfies it directly.
 */
export interface LabEngine {
  readonly name: string;
  run(ds: MaterializedDataset, dsl: PipelineDSL, opts?: RunOptions): Promise<RunResult>;
  predict(model: FittedModel, Xnew: Float64Array, nSamples: number, nFeatures: number): Promise<PredictResult>;
}

/** Which backend the app is wired to. */
export type EngineTarget = 'wasm' | 'python' | 'stub';

/**
 * Cheap structural validation of a dataset before any engine consumes it — a
 * boundary guard (the design's "validate only at system boundaries"). Throws on
 * the shape errors that would otherwise surface as silent wrong numbers.
 */
export function validateDataset(ds: MaterializedDataset): void {
  if (!Number.isInteger(ds.nSamples) || ds.nSamples < 0) throw new Error('dataset: nSamples invalide');
  if (!Number.isInteger(ds.nFeatures) || ds.nFeatures < 0) throw new Error('dataset: nFeatures invalide');
  if (ds.X.length !== ds.nSamples * ds.nFeatures) {
    throw new Error(`dataset: X.length=${ds.X.length} ≠ nSamples*nFeatures=${ds.nSamples * ds.nFeatures}`);
  }
  if (ds.y.length !== ds.nSamples) throw new Error('dataset: y.length ≠ nSamples');
  if (ds.sampleIds.length !== ds.nSamples) throw new Error('dataset: sampleIds.length ≠ nSamples');
  if (ds.partitions.length !== ds.nSamples) throw new Error('dataset: partitions.length ≠ nSamples');
}
