// Display-only preview API: applySteps delegates numerical execution to Methods.
// Public Operator names and OPERATOR_LABEL remain presentation metadata.
// Calibration/replay use DAG/Methods; historical math stays in testing/oracle.

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
