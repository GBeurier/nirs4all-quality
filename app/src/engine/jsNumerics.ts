// Honest closed-form numerics for the calibration variants the portable libn4m
// WASM path does NOT cover (Ridge, and the compact AOM operator-bank screen).
//
// This is REAL, exact linear algebra — not a fake or a stand-in for PLS. Ridge is
// the closed-form (XᵀX + αI)⁻¹Xᵀy; the AOM "operator bank" applies genuine
// strict-linear operators (finite differences, detrend, SNV) and selects the best
// by held-out RMSE, which is exactly the AOM idea (a compact form of it). PLS
// itself stays on real libn4m WASM. Everything here is deterministic.

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
    if (p <= k) return { data: X.slice(), n, p }; // too few features to differentiate → identity
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

/** Kennard-Stone test selection on raw X — mirrors the WASM portable path's
 *  KennardStoneSplitter (test_size ≈ 0.25) so the JS variants are scored on the
 *  SAME kind of spread-based hold-out as the PLS variants (comparable metrics).
 *  KS selects the most-spread points as the calibration set; the remainder (the
 *  interior points) is the test set. */
export function kennardStoneTest(X: Float64Array, n: number, p: number, testFrac = 0.25): number[] {
  if (n < 4) return [0];
  const m = Math.max(2, Math.round(n * (1 - testFrac))); // calibration (training) size
  const dist = (a: number, b: number): number => {
    let s = 0;
    for (let j = 0; j < p; j++) { const d = X[a * p + j]! - X[b * p + j]!; s += d * d; }
    return Math.sqrt(s);
  };
  // seed with the two most distant points
  let a = 0;
  let b = 1;
  let best = -1;
  for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const d = dist(i, k); if (d > best) { best = d; a = i; b = k; } }
  const selected = new Set<number>([a, b]);
  const minDist = new Array<number>(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (!selected.has(i)) minDist[i] = Math.min(dist(i, a), dist(i, b));
  while (selected.size < m) {
    let bestI = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) { if (selected.has(i)) continue; if (minDist[i]! > bestD) { bestD = minDist[i]!; bestI = i; } }
    if (bestI < 0) break;
    selected.add(bestI);
    for (let i = 0; i < n; i++) if (!selected.has(i)) minDist[i] = Math.min(minDist[i]!, dist(i, bestI));
  }
  const test: number[] = [];
  for (let i = 0; i < n; i++) if (!selected.has(i)) test.push(i);
  return test.length ? test : [0];
}

/** Apply a chain of strict-linear operators in sequence (composition). */
export function applyChain(X: Float64Array, n: number, p: number, ops: readonly Operator[]): Matrix {
  let cur: Matrix = { data: X, n, p };
  for (const op of ops) cur = applyOperator(cur.data, cur.n, cur.p, op);
  return cur;
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
  let cur: Matrix = { data: X, n, p };
  for (const s of steps) {
    if (s.type === 'StandardNormalVariate') cur = applyOperator(cur.data, cur.n, cur.p, 'snv');
    else if (s.type === 'Detrend') cur = applyOperator(cur.data, cur.n, cur.p, 'detrend');
    else if (s.type === 'MultiplicativeScatterCorrection') {
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
    // other step types (smoothing we don't model) fall through as identity
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

export interface RidgeModel { w: number[]; colMean: number[]; yMean: number; p: number; }

/** Closed-form ridge regression on centred X: (XᵀX + αI) w = Xᵀ y_c. */
export function ridgeFit(X: Float64Array, n: number, p: number, y: Float64Array, alpha: number): RidgeModel {
  const colMean = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) colMean[j]! += X[i * p + j]!;
  for (let j = 0; j < p; j++) colMean[j]! /= n;
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += y[i]!;
  yMean /= n;

  // A = XcᵀXc + αI  (p×p),  b = Xcᵀ yc
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const yc = y[i]! - yMean;
    for (let a = 0; a < p; a++) {
      const xa = X[i * p + a]! - colMean[a]!;
      b[a]! += xa * yc;
      for (let c = a; c < p; c++) {
        A[a]![c]! += xa * (X[i * p + c]! - colMean[c]!);
      }
    }
  }
  for (let a = 0; a < p; a++) {
    for (let c = a + 1; c < p; c++) A[c]![a]! = A[a]![c]!; // symmetrize
    A[a]![a]! += alpha;
  }
  const w = solve(A, b);
  return { w, colMean, yMean, p };
}

export function ridgePredictRow(model: RidgeModel, row: Float64Array, offset: number): number {
  let acc = model.yMean;
  for (let j = 0; j < model.p; j++) acc += (row[offset + j]! - model.colMean[j]!) * model.w[j]!;
  return acc;
}

export interface PlsModel { B: number[]; colMean: number[]; yMean: number; p: number; nComp: number; }

/** Exact PLS regression (NIPALS) on centred X → regression coefficients B such
 *  that ŷ = ȳ + (x − x̄)·B. A dependency-free in-browser fallback for the libn4m
 *  WASM path (used when the staged methods WASM is unavailable/incompatible). */
export function plsFit(X: Float64Array, n: number, p: number, y: Float64Array, ncomp: number): PlsModel {
  const colMean = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) colMean[j]! += X[i * p + j]!;
  for (let j = 0; j < p; j++) colMean[j]! /= n;
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += y[i]!;
  yMean /= n;

  const Xres = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xres[i * p + j] = X[i * p + j]! - colMean[j]!;
  const yres = new Float64Array(n);
  for (let i = 0; i < n; i++) yres[i] = y[i]! - yMean;

  const A = Math.max(1, Math.min(ncomp, n - 1, p));
  const Ws: number[][] = [];
  const Ps: number[][] = [];
  const qs: number[] = [];
  for (let a = 0; a < A; a++) {
    const w = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) { const yi = yres[i]!; const b = i * p; for (let j = 0; j < p; j++) w[j]! += Xres[b + j]! * yi; }
    let nw = 0; for (let j = 0; j < p; j++) nw += w[j]! * w[j]!;
    nw = Math.sqrt(nw); if (nw < 1e-12) break;
    for (let j = 0; j < p; j++) w[j]! /= nw;
    const t = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) { let s = 0; const b = i * p; for (let j = 0; j < p; j++) s += Xres[b + j]! * w[j]!; t[i] = s; }
    let tt = 0; for (let i = 0; i < n; i++) tt += t[i]! * t[i]!;
    if (tt < 1e-12) break;
    const pl = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) { const ti = t[i]!; const b = i * p; for (let j = 0; j < p; j++) pl[j]! += Xres[b + j]! * ti; }
    for (let j = 0; j < p; j++) pl[j]! /= tt;
    let q = 0; for (let i = 0; i < n; i++) q += yres[i]! * t[i]!; q /= tt;
    for (let i = 0; i < n; i++) { const ti = t[i]!; const b = i * p; for (let j = 0; j < p; j++) Xres[b + j]! -= ti * pl[j]!; yres[i]! -= ti * q; }
    Ws.push(w); Ps.push(pl); qs.push(q);
  }

  // B = W (PᵀW)⁻¹ q
  const Aeff = Ws.length;
  const B = new Array<number>(p).fill(0);
  if (Aeff > 0) {
    const PtW: number[][] = Array.from({ length: Aeff }, () => new Array<number>(Aeff).fill(0));
    for (let a = 0; a < Aeff; a++) for (let b = 0; b < Aeff; b++) {
      let s = 0; for (let j = 0; j < p; j++) s += Ps[a]![j]! * Ws[b]![j]!;
      PtW[a]![b] = s;
    }
    const r = solve(PtW, qs.slice(0, Aeff));
    for (let j = 0; j < p; j++) { let s = 0; for (let a = 0; a < Aeff; a++) s += Ws[a]![j]! * r[a]!; B[j] = s; }
  }
  return { B, colMean, yMean, p, nComp: Aeff };
}

export function plsPredictRow(model: PlsModel, row: Float64Array, offset: number): number {
  let acc = model.yMean;
  for (let j = 0; j < model.p; j++) acc += (row[offset + j]! - model.colMean[j]!) * model.B[j]!;
  return acc;
}
