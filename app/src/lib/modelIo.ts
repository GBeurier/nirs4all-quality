// Load a trained model from a JSON .n4a bundle so a calibration made elsewhere
// (this app, or another quali/core export) can be deployed and used to predict.
//
// Browser reality: only a JS-runnable fitted state (js-pls / js-ridge — plain
// coefficients + preprocessing steps) can predict in this WASM-thin build. A model
// whose state is a native libn4m blob (e.g. a Studio/Python export via the
// dag-ml/n4a JSON) carries its numerics opaquely and needs the libn4m WASM predict
// path, which is not wired here — we detect and report that honestly rather than
// pretend to load it.
import type { FittedModel } from '@/engine';
import type { StoredModel } from '@/store/store';

const OK_FORMATS = ['quali-nirs4all/n4a', 'nirs4all-core/n4a', 'nirs4all-web/n4a'];

export function parseModelBundle(text: string): { model: StoredModel } | { error: string } {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(text) as Record<string, unknown>; } catch { return { error: 'JSON invalide.' }; }
  if (!obj || typeof obj !== 'object') return { error: 'Fichier modèle invalide.' };
  const format = String(obj['format'] ?? '');
  if (!OK_FORMATS.includes(format)) return { error: `Format non reconnu : « ${format || '?'} ». Attendu : ${OK_FORMATS.join(', ')}.` };

  const m = obj['model'] as (FittedModel & { state?: Record<string, unknown> }) | undefined;
  if (!m || !m.state) return { error: 'Bundle sans modèle exploitable (champ "model" manquant).' };
  const backend = (m.state as { backendId?: string }).backendId;
  if (backend !== 'js-pls' && backend !== 'js-ridge') {
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
