// Real NIRS quality metrics computed client-side over the project's spectra —
// the exact formulas nirs4all/nirs4all-studio use (see agent audit), so each
// health finding shows the actual number that triggered it (not hardcoded text).
// Thresholds that are fixed in the ecosystem are fixed here; everything shape/
// noise-related is flagged relative to the dataset's own p95 (honest percentile
// rank), matching the ecosystem behaviour.
import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';

export interface OutlierPoint { sampleId: string; t2: number; q: number; flagged: boolean }
export interface NoiseCurve { axis: number[]; noise: number[]; peakFrom: number | null; peakTo: number | null; threshold: number }

export interface QualityReport {
  nSamples: number;
  nBands: number;
  axis: number[];
  /** saturation: bands ≥ 0.99·global-max (per-sample count) */
  saturation: { threshold: number; flagged: { sampleId: string; count: number }[] };
  /** per-band first-difference noise curve + the highest-variation region */
  noise: NoiseCurve;
  /** flat / low-variance spectra (var < 1e-8, ecosystem default) */
  flat: { threshold: number; flagged: { sampleId: string; variance: number }[] };
  /** PCA Hotelling T² + Q-residual (SPE); flag > p95 of each */
  outliers: { t2p95: number; qp95: number; points: OutlierPoint[]; flaggedIds: string[]; nComp: number };
  /** reference (y) IQR outliers, k = 1.5 (YOutlierFilter default) */
  reference: { flagged: { sampleId: string; value: number }[]; lo: number; hi: number; n: number };
  /** metadata structure → split recommendation */
  structure: { byInstrument: Record<string, number>; multiInstrument: boolean };
}

function norm(v: Float64Array): void {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * (q / 100);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Compact feature-space PCA (covariance power-iteration) → per-sample T² and Q. */
function pcaT2Q(X: Float64Array, n: number, p: number, k: number): { t2: number[]; q: number[] } {
  const mean = new Float64Array(p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mean[j] += X[i * p + j];
  for (let j = 0; j < p; j++) mean[j] /= n || 1;
  const Xc = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xc[i * p + j] = X[i * p + j] - mean[j];
  // covariance C (p×p)
  const C = new Float64Array(p * p);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let s = 0; for (let i = 0; i < n; i++) s += Xc[i * p + a] * Xc[i * p + b];
      const v = s / Math.max(1, n - 1); C[a * p + b] = v; C[b * p + a] = v;
    }
  }
  const loadings: Float64Array[] = [];
  const eig: number[] = [];
  for (let c = 0; c < k; c++) {
    let v = new Float64Array(p);
    for (let j = 0; j < p; j++) v[j] = Math.sin(j + c * 7) + 0.1;
    norm(v);
    let lambda = 0;
    for (let it = 0; it < 120; it++) {
      const w = new Float64Array(p);
      for (let a = 0; a < p; a++) { let s = 0; for (let b = 0; b < p; b++) s += C[a * p + b] * v[b]; w[a] = s; }
      lambda = 0; for (let a = 0; a < p; a++) lambda += v[a] * w[a];
      norm(w); v = w;
    }
    loadings.push(v); eig.push(Math.max(lambda, 1e-12));
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a * p + b] -= lambda * v[a] * v[b];
  }
  const t2: number[] = new Array(n).fill(0);
  const q: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const sc = new Array<number>(k).fill(0);
    for (let c = 0; c < k; c++) { let s = 0; const L = loadings[c]; for (let j = 0; j < p; j++) s += Xc[i * p + j] * L[j]; sc[c] = s; }
    let t = 0; for (let c = 0; c < k; c++) t += (sc[c] * sc[c]) / eig[c]; t2[i] = t;
    let qq = 0;
    for (let j = 0; j < p; j++) { let r = 0; for (let c = 0; c < k; c++) r += sc[c] * loadings[c][j]; const e = Xc[i * p + j] - r; qq += e * e; }
    q[i] = qq;
  }
  return { t2, q };
}

export function computeQuality(
  spectra: SpectraDataset,
  yBySample: Record<string, number | undefined>,
  metaBySample: Record<string, Record<string, string | number | null>>,
): QualityReport {
  const axis = spectra.axis;
  const p = axis.length;
  const samples = spectra.samples;
  const n = samples.length;
  const means = samples.map(meanSpectrum);
  const X = new Float64Array(n * p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) X[i * p + j] = means[i][j] ?? 0;

  // saturation
  let gmax = -Infinity;
  for (let i = 0; i < n * p; i++) if (X[i] > gmax) gmax = X[i];
  const satThr = gmax * 0.99;
  const satFlag: { sampleId: string; count: number }[] = [];
  for (let i = 0; i < n; i++) {
    let cnt = 0; for (let j = 0; j < p; j++) if (X[i * p + j] >= satThr) cnt++;
    if (cnt > 0 && satThr > 0 && gmax > 0) satFlag.push({ sampleId: samples[i].sampleId, count: cnt });
  }

  // per-band noise = mean over samples of |ΔX| at each band
  const noise = new Array<number>(p).fill(0);
  for (let j = 1; j < p; j++) {
    let s = 0; for (let i = 0; i < n; i++) s += Math.abs(X[i * p + j] - X[i * p + (j - 1)]);
    noise[j] = s / (n || 1);
  }
  noise[0] = noise[1] ?? 0;
  const noiseThr = percentile(noise, 90);
  let peakFrom: number | null = null, peakTo: number | null = null;
  for (let j = 0; j < p; j++) {
    if (noise[j] >= noiseThr && noiseThr > 0) {
      if (peakFrom === null) peakFrom = axis[j];
      peakTo = axis[j];
    }
  }

  // flat / low variance
  const flat: { sampleId: string; variance: number }[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0; for (let j = 0; j < p; j++) m += X[i * p + j]; m /= p;
    let v = 0; for (let j = 0; j < p; j++) { const d = X[i * p + j] - m; v += d * d; } v /= p;
    if (v < 1e-8) flat.push({ sampleId: samples[i].sampleId, variance: v });
  }

  // PCA T²/Q
  const k = Math.max(1, Math.min(5, n - 1, p));
  const { t2, q } = pcaT2Q(X, n, p, k);
  const t2p95 = percentile(t2, 95);
  const qp95 = percentile(q, 95);
  const points: OutlierPoint[] = samples.map((s, i) => ({
    sampleId: s.sampleId, t2: t2[i], q: q[i], flagged: t2[i] > t2p95 || q[i] > qp95,
  }));
  const flaggedIds = points.filter((pt) => pt.flagged).map((pt) => pt.sampleId);

  // reference IQR outliers (k=1.5)
  const refPairs = samples.map((s) => ({ id: s.sampleId, y: yBySample[s.sampleId] })).filter((r): r is { id: string; y: number } => typeof r.y === 'number');
  const ys = refPairs.map((r) => r.y);
  const q1 = percentile(ys, 25), q3 = percentile(ys, 75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const refFlag = refPairs.filter((r) => r.y < lo || r.y > hi).map((r) => ({ sampleId: r.id, value: r.y }));

  // metadata structure
  const byInstrument: Record<string, number> = {};
  for (const s of samples) {
    const inst = String(metaBySample[s.sampleId]?.['instrument'] ?? '—');
    byInstrument[inst] = (byInstrument[inst] ?? 0) + 1;
  }

  return {
    nSamples: n, nBands: p, axis,
    saturation: { threshold: satThr, flagged: satFlag },
    noise: { axis, noise, peakFrom, peakTo, threshold: noiseThr },
    flat: { threshold: 1e-8, flagged: flat },
    outliers: { t2p95, qp95, points, flaggedIds, nComp: k },
    reference: { flagged: refFlag, lo, hi, n: ys.length },
    structure: { byInstrument, multiInstrument: Object.keys(byInstrument).length > 1 },
  };
}
