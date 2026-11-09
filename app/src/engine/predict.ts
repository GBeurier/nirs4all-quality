import type { FittedModel, PredictResult, PredictionContext } from './port.js';
import { refuseLegacyState } from './legacyState.js';

export async function predictWithModel(model: FittedModel, X: Float64Array, n: number, p: number, context?: PredictionContext): Promise<PredictResult> {
  const backend = (model.state as { backendId?: string } | null)?.backendId;
  refuseLegacyState(backend);
  if (backend !== 'dag-ml-methods-pls' && backend !== 'dag-ml-methods-ridge') throw new Error('Unsupported fitted-model backend. Recalibrate; your original file is unchanged.');
  return (await import('./dagEngine.js')).predictDagModel(model, X, n, p, context);
}
