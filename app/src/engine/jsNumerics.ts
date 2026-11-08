// Existing display-preview transforms only. Calibration and replay use DAG/Methods.
// Frozen historical calibration math lives under testing/oracle.

import { validatePreprocessingStep } from './preprocessing.js';

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

// --- Real preprocessing steps (window-aware) for the PLS-screen bank ----------
// The AOM-PLS banks are parameterized by Savitzky-Golay window/polyorder/deriv and
// scatter corrections (SNV/MSC/detrend). These mirror nirs4all's operators so the
// enlarged screen matrix produces genuinely distinct columns per window — not the
// window-blind finite differences of the coarse Operator union.

/** Savitzky-Golay convolution weights (length = window) for the deriv-th derivative
 *  of the local least-squares polynomial of the given polyorder. */
function savgolCoeffs(window: number, poly: number, deriv: number): Float64Array {
  const w = window % 2 === 0 ? window + 1 : Math.max(3, window);
  const h = (w - 1) >> 1;
  const cols = Math.min(poly, w - 1) + 1;
  // A[i][a] = (i-h)^a  — the Vandermonde design over the window offsets
  const A: number[][] = [];
  for (let i = 0; i < w; i++) { const z = i - h; const row: number[] = []; let pw = 1; for (let a = 0; a < cols; a++) { row.push(pw); pw *= z; } A.push(row); }
  const AtA: number[][] = Array.from({ length: cols }, () => new Array<number>(cols).fill(0));
  for (let a = 0; a < cols; a++) for (let b = 0; b < cols; b++) { let s = 0; for (let i = 0; i < w; i++) s += A[i]![a]! * A[i]![b]!; AtA[a]![b] = s; }
  const dd = Math.min(deriv, cols - 1);
  const e = new Array<number>(cols).fill(0); e[dd] = 1;
  const x = solve(AtA, e); // (AᵀA)⁻¹ eₖ  (symmetric → the k-th row of the inverse)
  let fact = 1; for (let k = 2; k <= dd; k++) fact *= k; // k-th derivative = k!·βₖ
  const coeffs = new Float64Array(w);
  for (let i = 0; i < w; i++) { let s = 0; for (let a = 0; a < cols; a++) s += x[a]! * A[i]![a]!; coeffs[i] = s * fact; }
  return coeffs;
}

/** Length-preserving Savitzky-Golay filter (edge-clamped padding). */
function applySavgol(X: Float64Array, n: number, p: number, window: number, poly: number, deriv: number): Float64Array {
  const coeffs = savgolCoeffs(window, poly, deriv);
  const w = coeffs.length; const h = (w - 1) >> 1;
  const out = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const base = i * p;
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < w; k++) { let idx = j + k - h; if (idx < 0) idx = 0; else if (idx >= p) idx = p - 1; s += coeffs[k]! * X[base + idx]!; }
      out[base + j] = s;
    }
  }
  return out;
}

/** Multiplicative Scatter Correction against a reference spectrum (the calibration
 *  column mean). Each row x ≈ a + b·ref → corrected = (x − a)/b. The reference must
 *  be the SAME at predict time as at fit time, so it is captured/replayed. */
function applyMsc(X: Float64Array, n: number, p: number, refIn?: Float64Array): { data: Float64Array; ref: Float64Array } {
  let ref = refIn;
  if (!ref) { ref = new Float64Array(p); for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) ref[j]! += X[i * p + j]!; for (let j = 0; j < p; j++) ref[j]! /= Math.max(1, n); }
  let rmean = 0; for (let j = 0; j < p; j++) rmean += ref[j]!; rmean /= p;
  let srr = 0; for (let j = 0; j < p; j++) srr += (ref[j]! - rmean) ** 2;
  const out = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const base = i * p;
    let xmean = 0; for (let j = 0; j < p; j++) xmean += X[base + j]!; xmean /= p;
    let srx = 0; for (let j = 0; j < p; j++) srx += (ref[j]! - rmean) * (X[base + j]! - xmean);
    const b = srr > 0 ? srx / srr : 1; const a = xmean - b * rmean;
    for (let j = 0; j < p; j++) out[base + j] = b !== 0 ? (X[base + j]! - a) / b : X[base + j]!;
  }
  return { data: out, ref };
}

/** A preprocessing step as it appears in the pipeline DSL (SNV / SG / MSC / detrend). */
export interface PreprocStep { type: string; params: Record<string, unknown>; }
/** Captured stateful preprocessing (currently only the MSC reference) so predict
 *  replays the exact same transform as fit. */
export interface StepState { mscRef?: Float64Array; }

/** Apply a chain of real preprocessing steps (window-aware). `opts.state` supplies
 *  captured references at predict time; `opts.capture` collects them at fit time. */
export function applySteps(X: Float64Array, n: number, p: number, steps: readonly PreprocStep[], opts?: { state?: StepState; capture?: StepState }): Matrix {
  steps.forEach((step) => validatePreprocessingStep(step, 'preview'));
  if (steps.filter((step) => step.type === 'MultiplicativeScatterCorrection').length > 1) {
    throw new Error('JS preprocessing supports only one MSC step per chain.');
  }
  let cur: Matrix = { data: X, n, p };
  for (const s of steps) {
    if (s.type === 'StandardNormalVariate') cur = applyOperator(cur.data, cur.n, cur.p, 'snv');
    else if (s.type === 'Detrend') cur = applyOperator(cur.data, cur.n, cur.p, 'detrend');
    else if (s.type === 'MultiplicativeScatterCorrection') {
      if (opts?.state && !opts.state.mscRef) throw new Error('MSC prediction requires a fitted training reference.');
      const { data, ref } = applyMsc(cur.data, cur.n, cur.p, opts?.state?.mscRef);
      if (opts?.capture && !opts?.state?.mscRef) opts.capture.mscRef = ref;
      cur = { data, n: cur.n, p: cur.p };
    } else if (s.type === 'SavitzkyGolay') {
      const window = Number(s.params['window_length'] ?? 15);
      const poly = Number(s.params['polyorder'] ?? 2);
      const deriv = Number(s.params['deriv'] ?? 0);
      cur = { data: applySavgol(cur.data, cur.n, cur.p, window, poly, deriv), n: cur.n, p: cur.p };
    } else if (s.type === 'StandardScaler') {
      // per-band standardization across samples (display preview; not stateful-safe
      // for predict, so kept out of the calibration banks)
      const out = new Float64Array(cur.n * cur.p);
      for (let j = 0; j < cur.p; j++) {
        let m = 0; for (let i = 0; i < cur.n; i++) m += cur.data[i * cur.p + j]!; m /= cur.n || 1;
        let v = 0; for (let i = 0; i < cur.n; i++) { const d = cur.data[i * cur.p + j]! - m; v += d * d; }
        const sd = Math.sqrt(v / Math.max(1, cur.n - 1)) || 1;
        for (let i = 0; i < cur.n; i++) out[i * cur.p + j] = (cur.data[i * cur.p + j]! - m) / sd;
      }
      cur = { data: out, n: cur.n, p: cur.p };
    }
  }
  return cur;
}

/** Solve A w = b for a symmetric positive-(semi)definite A (Gaussian elimination, partial pivot). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => (M[i]![i]! !== 0 ? row[n]! / M[i]![i]! : 0));
}

