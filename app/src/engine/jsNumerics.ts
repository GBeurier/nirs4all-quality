// Existing display-preview transforms only. Calibration and replay use DAG/Methods.
// Frozen historical calibration math lives under testing/oracle.

import { NativeEstimator, methodClass, loadModule, version, abiVersion, type Matrix as MethodsMatrix, type RoleStep, type Transformer } from '@nirs4all/methods';
import { assertMethodsRuntime } from './methodsCohort';

/** A strict-linear preprocessing operator (the compact AOM bank uses these). */
export type Operator = 'identity' | 'snv' | 'diff1' | 'diff2' | 'detrend';

export const OPERATOR_LABEL: Record<Operator, { fr: string; en: string }> = {
  identity: { fr: 'brut', en: 'raw' },
  snv: { fr: 'SNV', en: 'SNV' },
  diff1: { fr: 'dérivée 1re', en: '1st derivative' },
  diff2: { fr: 'dérivée 2de', en: '2nd derivative' },
  detrend: { fr: 'detrend', en: 'detrend' },
};

interface Matrix { data: Float64Array; n: number; p: number; }

/** Apply a strict-linear operator row-wise. Returns a new (possibly narrower) matrix. */
export function applyOperator(X: Float64Array, n: number, p: number, op: Operator): Matrix {
  if (op === 'identity') return { data: X.slice(), n, p };
  if (op === 'diff1' || op === 'diff2') {
    const k = op === 'diff1' ? 1 : 2;
    if (p <= k) throw new Error(`Insufficient features for ${op}.`);
    const q = p - k;
    const out = new Float64Array(n * q);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < q; j++) {
        const base = i * p + j;
        out[i * q + j] = op === 'diff1'
          ? (X[base + 1]! - X[base]!)
          : (X[base + 2]! - 2 * X[base + 1]! + X[base]!);
      }
    }
    return { data: out, n, p: q };
  }
  if (op === 'snv') {
    const out = new Float64Array(n * p);
    for (let i = 0; i < n; i++) {
      let mean = 0;
      for (let j = 0; j < p; j++) mean += X[i * p + j]!;
      mean /= p;
      let v = 0;
      for (let j = 0; j < p; j++) { const d = X[i * p + j]! - mean; v += d * d; }
      const sd = Math.sqrt(v / Math.max(1, p - 1)) || 1;
      for (let j = 0; j < p; j++) out[i * p + j] = (X[i * p + j]! - mean) / sd;
    }
    return { data: out, n, p };
  }
  if (op !== 'detrend') throw new Error(`Unsupported preprocessing operator '${op}'.`);
  // detrend: subtract the least-squares line (index vs value) per row
  const out = new Float64Array(n * p);
  const xs = Array.from({ length: p }, (_, j) => j);
  const xmean = (p - 1) / 2;
  let sxx = 0;
  for (let j = 0; j < p; j++) sxx += (xs[j]! - xmean) ** 2;
  for (let i = 0; i < n; i++) {
    let ymean = 0;
    for (let j = 0; j < p; j++) ymean += X[i * p + j]!;
    ymean /= p;
    let sxy = 0;
    for (let j = 0; j < p; j++) sxy += (xs[j]! - xmean) * (X[i * p + j]! - ymean);
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = ymean - slope * xmean;
    for (let j = 0; j < p; j++) out[i * p + j] = X[i * p + j]! - (intercept + slope * j);
  }
  return { data: out, n, p };
}

// Active display previews use the public owner lifecycle. The unused operators
// above are retained outside this migration; no preview calls them.
let initialization: Promise<void> | undefined;

function initializePreviewMethods(): Promise<void> {
  return initialization ??= loadModule().then(() => {
    assertMethodsRuntime(version(), abiVersion());
  }).catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
}

/** Descriptive display fit only; no fitted state escapes into calibration/replay. */
export async function applySteps(X: MethodsMatrix, steps: readonly RoleStep[]): Promise<MethodsMatrix> {
  if (steps.length === 0) return X;
  if (steps.length !== 1) throw new Error('Preview processing supports exactly one transformer step.');
  const step = steps[0]!;
  if (typeof step !== 'object' || Array.isArray(step) || !('methodId' in step)) {
    throw new Error('Preview processing requires a methodId transformer step.');
  }
  await initializePreviewMethods();
  const estimator = new (methodClass(step.methodId))();
  if (!(estimator instanceof NativeEstimator)) throw new Error('Preview processing requires a native transformer estimator.');
  try {
    if (!('transform' in estimator) || typeof estimator.transform !== 'function') {
      throw new Error('Preview processing requires a native transformer estimator.');
    }
    estimator.params = { ...step.params };
    estimator.fit(X);
    return (estimator as NativeEstimator & Transformer).transform(X);
  } finally {
    estimator.dispose();
  }
}
