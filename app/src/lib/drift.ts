// Drift analysis for the maintenance screen. Honest, in-browser: a joint PCA of
// the calibration set + a new routine batch, then a per-new-sample novelty score
// (distance to the calibration cloud in PC units). Points beyond the threshold
// are "out of the model's domain" → the drift signal that drives the maintenance
// recommendation. Deterministic.
import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { computePca } from './pca';

export interface Mat { X: Float64Array; n: number; p: number; }

function gaussian(t: number, mu: number, sigma: number): number { const d = t - mu; return Math.exp(-(d * d) / (2 * sigma * sigma)); }
function hash(i: number, s: number): number { const x = Math.sin(i * 71.9 + s * 41.3) * 43758.5453; return x - Math.floor(x); }

/** Mean spectrum per calibration sample → a dense matrix. When `ids` is given,
 *  only those samples form the cloud (drift is measured vs the CALIBRATION set,
 *  not vs unreferenced routine/pool spectra that would themselves widen it). */
export function calibrationMatrix(spectra: SpectraDataset, ids?: Set<string>): Mat {
  const p = spectra.axis.length;
  const samples = ids ? spectra.samples.filter((s) => ids.has(s.sampleId)) : spectra.samples;
  const n = samples.length;
  const X = new Float64Array(n * p);
  samples.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[i * p + j] = m[j] ?? 0; });
  return { X, n, p };
}

/** Linear (index-based) resample of a spectrum to a target length — so an
 *  uploaded batch on a different-length grid is aligned to the calibration axis
 *  instead of being truncated / padded with a repeated last value. */
export function resampleTo(values: ArrayLike<number>, targetLen: number): Float64Array {
  const src = Float64Array.from(values);
  const out = new Float64Array(targetLen);
  if (src.length === 0 || targetLen === 0) return out;
  if (src.length === targetLen) { out.set(src); return out; }
  for (let i = 0; i < targetLen; i++) {
    const t = targetLen === 1 ? 0 : (i * (src.length - 1)) / (targetLen - 1);
    const lo = Math.floor(t);
    const hi = Math.min(src.length - 1, lo + 1);
    out[i] = (src[lo] ?? 0) + ((src[hi] ?? 0) - (src[lo] ?? 0)) * (t - lo);
  }
  return out;
}

/** A synthetic "new routine batch" with drift — ~1/3 of samples carry a baseline
 *  shift + a new absorption band (a new site / instrument), the rest look normal.
 *  Same spectral shape as the demo calibration so the overlay is meaningful. */
export function makeDriftBatch(p: number, n = 24): Mat {
  const X = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const drift = i % 3 === 0;
    const bshift = drift ? 0.10 + 0.05 * hash(i, 1) : 0.01 * (hash(i, 1) - 0.5);
    const newBand = drift ? 0.16 + 0.06 * hash(i, 7) : 0;
    const yc = hash(i, 5) - 0.5;
    const l2 = hash(i, 6) - 0.5;
    for (let j = 0; j < p; j++) {
      const t = j / (p - 1);
      const baseline = 0.35 + 0.12 * t + 0.05 * Math.sin(2.5 * t);
      const water = 0.25 * gaussian(t, 0.62, 0.05) + 0.18 * gaussian(t, 0.95, 0.06);
      const yBand = yc * 0.03 * gaussian(t, 0.4, 0.04);
      const l2Band = l2 * 0.3 * gaussian(t, 0.75, 0.05);
      const driftBand = newBand * gaussian(t, 0.55, 0.04);
      X[i * p + j] = baseline + water + yBand + l2Band + driftBand + bshift + 0.004 * (hash(i, j + 3) - 0.5);
    }
  }
  return { X, n, p };
}

export type DriftVerdict = 'stable' | 'moderate' | 'strong';
export interface DriftPoint { x: number; y: number; novelty: number; out: boolean; idx: number; }
export interface DriftAnalysis {
  calPts: { x: number; y: number }[];
  newPts: DriftPoint[];
  share: number;         // fraction of the new batch out of domain
  outN: number;
  verdict: DriftVerdict;
  ev: (k: number) => string;
  threshold: number;
}

const THRESHOLD = 2.5; // PC-space std units beyond which a new sample is out-of-domain

export function analyzeDrift(cal: Mat, nb: Mat): DriftAnalysis {
  const p = cal.p;
  const n = cal.n + nb.n;
  const X = new Float64Array(n * p);
  X.set(cal.X, 0);
  X.set(nb.X, cal.n * p);
  // maxSamples = full count so every calibration + new-batch point gets a real
  // score (no sub-sampling fallback aliasing unsampled rows to row 0).
  const pca = computePca(X, n, p, 2, n);
  const pos = new Map(pca.usedIdx.map((r, i) => [r, i]));
  const scoreOf = (row: number): number[] => pca.scores[pos.get(row) ?? 0] ?? [0, 0];

  const cal2 = Array.from({ length: cal.n }, (_, i) => scoreOf(i));
  const new2 = Array.from({ length: nb.n }, (_, i) => scoreOf(cal.n + i));

  const c = [0, 0];
  cal2.forEach((s) => { c[0]! += s[0] ?? 0; c[1]! += s[1] ?? 0; });
  c[0]! /= Math.max(1, cal.n); c[1]! /= Math.max(1, cal.n);
  const sd = [0, 0];
  cal2.forEach((s) => { sd[0]! += ((s[0] ?? 0) - c[0]!) ** 2; sd[1]! += ((s[1] ?? 0) - c[1]!) ** 2; });
  sd[0] = Math.sqrt(sd[0]! / Math.max(1, cal.n)) || 1;
  sd[1] = Math.sqrt(sd[1]! / Math.max(1, cal.n)) || 1;

  const newPts: DriftPoint[] = new2.map((s, i) => {
    const dx = ((s[0] ?? 0) - c[0]!) / sd[0]!;
    const dy = ((s[1] ?? 0) - c[1]!) / sd[1]!;
    const novelty = Math.sqrt(dx * dx + dy * dy);
    return { x: s[0] ?? 0, y: s[1] ?? 0, novelty, out: novelty > THRESHOLD, idx: i };
  });
  const outN = newPts.filter((z) => z.out).length;
  const share = nb.n ? outN / nb.n : 0;
  const verdict: DriftVerdict = share < 0.1 ? 'stable' : share < 0.35 ? 'moderate' : 'strong';

  return {
    calPts: cal2.map((s) => ({ x: s[0] ?? 0, y: s[1] ?? 0 })),
    newPts, share, outN, verdict,
    ev: (k: number) => ((pca.explained[k] ?? 0) * 100).toFixed(1),
    threshold: THRESHOLD,
  };
}
