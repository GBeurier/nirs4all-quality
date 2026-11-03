// PCA fitting and diagnostic thresholds are owned by libn4m. This module only
// adapts row-major data and copied native outputs for the lab screens.
import { FlexiblePCA, HotellingT2, QResiduals, loadModule, version, abiVersion } from '@nirs4all/methods';
import { assertMethodsRuntime } from './methodsCohort';

export async function initializeDiagnostics(): Promise<void> {
  await loadModule();
  assertMethodsRuntime(version(), abiVersion());
}
export interface Matrix { data: Float64Array; rows: number; cols: number }

export function validateMatrix(X: Matrix): void {
  if (!Number.isInteger(X.rows) || X.rows < 1 || !Number.isInteger(X.cols) || X.cols < 1 || X.data.length !== X.rows * X.cols) {
    throw new Error('Invalid spectral matrix dimensions.');
  }
  if (!X.data.every(Number.isFinite)) throw new Error('Missing or non-finite spectra must be resolved before analysis.');
}

/** Evaluation rows never enter this fit. Dispose after all projections. */
export function fitPcaReference(X: Matrix, components = 2) {
  validateMatrix(X);
  if (X.rows < 2) throw new Error('PCA needs at least two calibration samples.');
  const model = new FlexiblePCA({ n_components: Math.min(components, X.rows - 1, X.cols) });
  try { model.fit(X); } catch (error) { model.dispose(); throw error; }
  return {
    transform(input: Matrix): Matrix {
      validateMatrix(input);
      if (input.cols !== X.cols) throw new Error('Spectral feature count differs from the fitted reference.');
      return model.transform(input);
    },
    dispose: () => model.dispose(),
  };
}

export function nativeOutliers(X: Matrix, components: number) {
  validateMatrix(X);
  const params = { n_components: components, alpha: 0.05 };
  const t = new HotellingT2(params).run(X);
  const q = new QResiduals(params).run(X);
  const t2 = (t.t2 as Matrix).data;
  const residuals = (q.q as Matrix).data;
  const t2Limit = Number(t.ucl), qLimit = Number(q.ucl);
  if (t2.length !== X.rows || residuals.length !== X.rows || !t2.every(Number.isFinite) || !residuals.every(Number.isFinite) || !Number.isFinite(t2Limit) || !Number.isFinite(qLimit)) {
    throw new Error('Native PCA diagnostics are unavailable for this population.');
  }
  return { t2: Array.from(t2), q: Array.from(residuals), t2Limit, qLimit };
}
