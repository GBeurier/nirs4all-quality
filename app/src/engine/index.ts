// Engine selection. The app depends only on the `LabEngine` port; this factory
// wires a concrete target. WASM and Python are DYNAMICALLY imported so the stub
// path (and the standalone type-check) never pulls the sibling WASM checkout.

import type { EngineTarget, LabEngine } from './port.js';
import { StubEngine } from './stubEngine.js';

export * from './port.js';
export { evaluationLabel, evaluationNote, type Evaluation } from './evaluation.js';
export { StubEngine } from './stubEngine.js';
export { createPythonEngine } from './pythonEngine.js';
export type { PythonEngineConfig } from './pythonEngine.js';

export interface EngineSelection {
  target?: EngineTarget;
  /** Python service config (required when target = 'python') */
  python?: { baseUrl: string; authorization?: string };
}

/**
 * Create the engine for a target. Defaults to `wasm` — the REAL libn4m WASM path
 * via the `nirs4all` package's portable pipeline (see wasmEngine.ts). Lazily
 * imported so the stub/python paths don't pull the WASM chunk. Refuses a missing
 * WASM module rather than presenting demonstration scores as calibration.
 */
export async function createEngine(selection: EngineSelection = {}): Promise<LabEngine> {
  const target: EngineTarget = selection.target ?? 'wasm';
  if (target === 'stub') return new StubEngine();
  if (target === 'python') {
    if (!selection.python) throw new Error('python target requires a `python.baseUrl` config');
    const { createPythonEngine } = await import('./pythonEngine.js');
    return createPythonEngine(selection.python);
  }
  // target === 'wasm'
  try {
    const mod = await import('./wasmEngine.js');
    return mod.wasmEngine;
  } catch (err) {
    throw new Error('WASM engine unavailable; calibration cannot use the demonstration engine.', { cause: err });
  }
}
