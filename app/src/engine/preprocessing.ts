import type { CandidateIssue, PipelineStep } from './port.js';

type Step = Pick<PipelineStep, 'type' | 'params'>;

export class PreprocessingRefusal extends Error {}

export function candidateIssue(label: string, backend: CandidateIssue['backend'], err: unknown): CandidateIssue {
  return { label, backend, status: err instanceof PreprocessingRefusal ? 'refused' : 'failed', reason: err instanceof Error ? err.message : String(err) };
}

/** Fail closed before a backend can discard an operation or parameter. */
export function validatePreprocessingStep(step: Step, backend: 'wasm' | 'js' | 'preview'): void {
  const { type, params } = step;
  let supported: string[];
  switch (type) {
    case 'StandardNormalVariate':
    case 'MultiplicativeScatterCorrection':
    case 'StandardScaler': supported = []; break;
    case 'Detrend': supported = ['degree']; break;
    case 'SavitzkyGolay': supported = ['window_length', 'polyorder', 'deriv', 'delta', 'mode', 'cval']; break;
    default: throw new PreprocessingRefusal(`Unsupported preprocessing step '${type}' (${backend}).`);
  }
  if (backend === 'wasm' && type !== 'StandardNormalVariate' && type !== 'SavitzkyGolay') {
    throw new PreprocessingRefusal(`Unsupported preprocessing step '${type}' (wasm).`);
  }
  if (backend === 'js' && type === 'StandardScaler') {
    throw new PreprocessingRefusal('StandardScaler is supported only for display previews; calibration state cannot be replayed.');
  }
  for (const key of Object.keys(params)) {
    if (!supported.includes(key)) throw new PreprocessingRefusal(`Unsupported ${type} parameter '${key}' (${backend}).`);
  }
  if (type === 'Detrend' && (params['degree'] ?? 1) !== 1) {
    throw new PreprocessingRefusal('JS Detrend supports degree=1 only.');
  }
  if (type === 'SavitzkyGolay') {
    const window = params['window_length'] ?? (backend === 'wasm' ? 11 : 15);
    const order = params['polyorder'] ?? (backend === 'wasm' ? 3 : 2);
    const deriv = params['deriv'] ?? 0;
    if (typeof window !== 'number' || !Number.isInteger(window) || window < (backend === 'wasm' ? 1 : 3) || window % 2 !== 1
        || typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order >= window
        || typeof deriv !== 'number' || !Number.isInteger(deriv) || deriv < 0 || deriv > order) {
      throw new PreprocessingRefusal('Invalid SavitzkyGolay window_length, polyorder or deriv.');
    }
    if ((params['delta'] ?? 1) !== 1) throw new PreprocessingRefusal('SavitzkyGolay supports delta=1 only.');
    if (backend !== 'wasm' && ((params['mode'] ?? 'nearest') !== 'nearest' || (params['cval'] ?? 0) !== 0)) {
      throw new PreprocessingRefusal('JS SavitzkyGolay supports mode=nearest and cval=0 only.');
    }
  }
}
