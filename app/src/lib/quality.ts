// Native PCA diagnostics plus explicitly descriptive lab screening summaries.
// Relative maxima and first differences are heuristics, not physical root causes.
import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { nativeOutliers } from '@/engine/nativeDiagnostics';

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
  /** Native Hotelling T²/Q limits (alpha=0.05), never dataset percentile flags. */
  outliers: { t2Limit: number; qLimit: number; available: boolean; reason: string | null; points: OutlierPoint[]; flaggedIds: string[]; nComp: number };
  /** reference (y) IQR outliers, k = 1.5 (YOutlierFilter default) */
  reference: { flagged: { sampleId: string; value: number }[]; lo: number; hi: number; n: number };
  /** metadata structure → split recommendation */
  structure: { byInstrument: Record<string, number>; multiInstrument: boolean };
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * (q / 100);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
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
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) X[i * p + j] = means[i][j] ?? NaN;

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

  // Native diagnostic policy supplies both values and control limits. A missing
  // kernel/unsupported population is unknown evidence, never a clean bill.
  const k = Math.max(1, Math.min(5, n - 2, p - 1));
  let outliers: QualityReport['outliers'];
  try {
    if (n < 3 || p < 2) throw new Error('PCA diagnostics need at least three samples and two bands.');
    const result = nativeOutliers({ data: X, rows: n, cols: p }, k);
    const points = samples.map((sample, i) => ({ sampleId: sample.sampleId, t2: result.t2[i]!, q: result.q[i]!, flagged: result.t2[i]! > result.t2Limit || result.q[i]! > result.qLimit }));
    outliers = { ...result, points, flaggedIds: points.filter((pt) => pt.flagged).map((pt) => pt.sampleId), nComp: k, available: true, reason: null };
  } catch (error) {
    outliers = { t2Limit: NaN, qLimit: NaN, points: [], flaggedIds: [], nComp: k, available: false, reason: error instanceof Error ? error.message : String(error) };
  }

  // reference IQR outliers (k=1.5)
  const refPairs = samples.map((s) => ({ id: s.sampleId, y: yBySample[s.sampleId] })).filter((r): r is { id: string; y: number } => typeof r.y === 'number' && Number.isFinite(r.y));
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
    outliers,
    reference: { flagged: refFlag, lo, hi, n: ys.length },
    structure: { byInstrument, multiInstrument: Object.keys(byInstrument).length > 1 },
  };
}
