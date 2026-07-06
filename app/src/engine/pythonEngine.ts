// Python target (ANTICIPATED) — a backend implementing the SAME `LabEngine` port
// over the `nirs4all` runtime. Per the engine map, the cleanest reuse is either
// (a) a numerics-only `ModelBackend` inside the WASM orchestration, or (b) a
// remote service that owns the whole run loop. This file sketches (b): a thin
// REST client that POSTs the dataset + recipe and returns a RunResult. It exists
// to pin the contract now; the server side lands with the Python target.

import type {
  FittedModel,
  LabEngine,
  MaterializedDataset,
  PipelineDSL,
  PredictResult,
  RunOptions,
  RunResult,
} from './port.js';

export interface PythonEngineConfig {
  /** base URL of the nirs4all Python service, e.g. "http://localhost:8000" */
  baseUrl: string;
  /** optional auth header value */
  authorization?: string;
}

/** Serialize a Float64Array to a plain array for JSON transport. */
function encodeMatrix(x: Float64Array): number[] {
  return Array.from(x);
}

export function createPythonEngine(config: PythonEngineConfig): LabEngine {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.authorization) headers['authorization'] = config.authorization;

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`python engine ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    name: 'python',
    async run(ds: MaterializedDataset, dsl: PipelineDSL, opts?: RunOptions): Promise<RunResult> {
      opts?.onProgress?.({ phase: 'preprocess', pct: 5, message: 'envoi au service nirs4all' });
      const result = await post<RunResult>('/run', {
        dataset: { ...ds, X: encodeMatrix(ds.X), y: encodeMatrix(ds.y) },
        pipeline: dsl,
      }, opts?.signal);
      opts?.onProgress?.({ phase: 'done', pct: 100 });
      return { ...result, engine: 'python' };
    },
    async predict(model: FittedModel, Xnew: Float64Array, nSamples: number, nFeatures: number): Promise<PredictResult> {
      const out = await post<{ values: number[]; labels?: string[] }>('/predict', {
        model, X: encodeMatrix(Xnew), nSamples, nFeatures,
      });
      return { values: Float64Array.from(out.values), ...(out.labels ? { labels: out.labels } : {}) };
    },
  };
}
