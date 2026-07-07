// Unified prediction: given a fitted model (from any variant) + new spectra,
// route to the right backend. JS-Ridge models predict in-browser (apply the
// operator chain + the closed-form ridge); WASM PLS models go through the
// portable pipeline. Same PredictResult shape for the caller.
import { applyChain, applySteps, plsPredictRow, ridgePredictRow, type Operator, type PlsModel, type PreprocStep, type RidgeModel, type StepState } from './jsNumerics.js';
import type { FittedModel, PredictResult } from './port.js';

interface JsRidgeState { backendId: 'js-ridge'; ops: Operator[]; ridge: RidgeModel; }
interface JsPlsState { backendId: 'js-pls'; ops?: Operator[]; steps?: PreprocStep[]; stepState?: StepState; pls: PlsModel; }

export async function predictWithModel(model: FittedModel, X: Float64Array, n: number, p: number): Promise<PredictResult> {
  const state = model.state as { backendId?: string } | null;
  if (state?.backendId === 'js-ridge') {
    const s = state as unknown as JsRidgeState;
    const { data, p: q } = applyChain(X, n, p, s.ops ?? []);
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = ridgePredictRow(s.ridge, data, i * q);
    return { values };
  }
  if (state?.backendId === 'js-pls') {
    const s = state as unknown as JsPlsState;
    const { data, p: q } = s.steps
      ? applySteps(X, n, p, s.steps, s.stepState ? { state: s.stepState } : undefined)
      : applyChain(X, n, p, s.ops ?? []);
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = plsPredictRow(s.pls, data, i * q);
    return { values };
  }
  // WASM PLS (real libn4m via the portable pipeline)
  const mod = await import('./wasmEngine.js');
  return mod.wasmEngine.predict(model, X, n, p);
}
