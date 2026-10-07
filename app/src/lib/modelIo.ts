// Load a trained model from a JSON .n4a bundle so a calibration made elsewhere
// (this app, or another quali/core export) can be deployed and used to predict.
//
// The app's own portable PLS state also runs in the shipped WASM engine.
// Other native archives remain unsupported; a backend label alone is not proof
// that an imported state has the portable shape this engine consumes.
import type { FittedModel } from '@/engine';
import type { StoredModel } from '@/store/store';

const OK_FORMATS = ['quali-nirs4all/n4a', 'nirs4all-core/n4a', 'nirs4all-web/n4a'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteVector(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isOwnPortableModel(bundle: Record<string, unknown>, model: unknown): boolean {
  if (bundle['format'] !== 'quali-nirs4all/n4a' || bundle['version'] !== 1
      || !isRecord(model) || model['taskType'] !== 'regression') return false;
  const features = model['nFeatures'];
  if (typeof features !== 'number' || !Number.isSafeInteger(features) || features < 1
      || bundle['nFeatures'] !== features) return false;
  const state = model['state'];
  if (!isRecord(state) || !exactKeys(state, ['backendId', 'result'])
      || state['backendId'] !== 'nirs4all-core-wasm') return false;
  const result = state['result'];
  if (!isRecord(result) || !exactKeys(result, ['preprocessing', 'model'])
      || !Array.isArray(result['preprocessing'])) return false;
  for (const step of result['preprocessing']) {
    if (!isRecord(step) || !exactKeys(step, ['type', 'params'])) return false;
    if (step['type'] === 'StandardNormalVariate') {
      if (!finiteVector(step['params'], 0)) return false;
    } else if (step['type'] === 'SavitzkyGolay') {
      if (!finiteVector(step['params'], 5)) return false;
      const [window, order, derivative, mode, constant] = step['params'] as number[];
      if (!Number.isSafeInteger(window) || window < 1 || window > features || window % 2 !== 1
          || !Number.isSafeInteger(order) || order < 0 || order >= window
          || !Number.isSafeInteger(derivative) || derivative < 0 || derivative > order
          || !Number.isSafeInteger(mode) || mode < 0 || mode > 4
          || !Number.isFinite(constant)) return false;
    } else return false;
  }
  const pls = result['model'];
  if (!isRecord(pls) || pls['type'] !== 'PLSRegression'
      || !exactKeys(pls, ['type', 'n_components', 'coefficients', 'xMean', 'yMean', 'intercept', 'n_features', 'n_targets'])
      || pls['n_features'] !== features || pls['n_targets'] !== 1) return false;
  const components = pls['n_components'];
  if (typeof components !== 'number' || !Number.isSafeInteger(components)
      || components < 1 || components > features) return false;
  return finiteVector(pls['coefficients'], features) && finiteVector(pls['xMean'], features)
    && finiteVector(pls['yMean'], 1)
    && (pls['intercept'] === null || finiteVector(pls['intercept'], 1));
}

export function parseModelBundle(text: string): { model: StoredModel } | { error: string } {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(text) as Record<string, unknown>; } catch { return { error: 'JSON invalide.' }; }
  if (!obj || typeof obj !== 'object') return { error: 'Fichier modèle invalide.' };
  const format = String(obj['format'] ?? '');
  if (!OK_FORMATS.includes(format)) return { error: `Format non reconnu : « ${format || '?'} ». Attendu : ${OK_FORMATS.join(', ')}.` };

  const m = obj['model'] as (FittedModel & { state?: Record<string, unknown> }) | undefined;
  if (!m || !m.state) return { error: 'Bundle sans modèle exploitable (champ "model" manquant).' };
  const backend = (m.state as { backendId?: string }).backendId;
  if (backend === 'nirs4all-core-wasm') {
    if (!isOwnPortableModel(obj, m)) return { error: 'Modèle portable WASM invalide ou incompatible.' };
  } else if (backend !== 'js-pls' && backend !== 'js-ridge') {
    return { error: `Ce modèle utilise un moteur natif (${backend ?? 'libn4m/WASM'}) que cette version navigateur ne peut pas exécuter. Exportez-le au format quali-nirs4all/n4a (coefficients js-pls/js-ridge) pour le charger ici.` };
  }

  // Float64Array fields (the MSC reference) survive JSON as a keyed object → revive
  const st = m.state as { stepState?: { mscRef?: unknown } };
  if (st.stepState?.mscRef && !(st.stepState.mscRef instanceof Float64Array)) {
    st.stepState.mscRef = Float64Array.from(Object.values(st.stepState.mscRef as Record<string, number>));
  }

  const metrics = (obj['metrics'] ?? (m as { metrics?: unknown }).metrics ?? {}) as StoredModel['metrics'];
  const nFeatures = Number((m as { nFeatures?: number }).nFeatures ?? obj['nFeatures'] ?? 0);
  const yr = obj['yRange'];
  const yRange: [number, number] = Array.isArray(yr) && yr.length === 2 ? [Number(yr[0]), Number(yr[1])] : [0, 1];
  const stored: StoredModel = {
    model: m as FittedModel,
    engine: String(obj['engine'] ?? backend),
    pipelineName: String(obj['pipeline'] ?? 'modèle importé'),
    metrics,
    yRange,
    nFeatures,
    createdAt: String(obj['createdAt'] ?? new Date().toISOString()),
  };
  return { model: stored };
}
