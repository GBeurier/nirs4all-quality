// Per-prediction reliability from REAL signals. For each routine sample we build
// the §4bis DecisionInput from its spectrum:
//   • applicabilityScore = distance to the calibration cloud (PC std-dev units)
//   • localDensity       = share of calibration points nearby (rare ⇒ 🔵)
//   • extrapolation      = predicted value outside the trained reference range
//   • intervalWidth      = a heuristic ± band (model RMSEP widened by distance)
// The traffic-light colour then comes from buildDecisionView (pure view-model).
import type { DecisionInput } from '@lab';

import { meanSpectrum, type SampleSpectra } from '@/domain/spectra';
import { computePca } from './pca';

/** The three explicit routine alerts (design §5, Predict table):
 *   • outX  — spectral distance to the calibration cloud (applicability domain)
 *   • outY  — predicted value outside the trained reference range (extrapolation)
 *   • yDens — conformal-style: how sparse the calibration references are at this
 *             predicted level (few analogues ⇒ wide/uncertain interval) */
export type AlertLevel = 'ok' | 'warn' | 'bad';
export interface PredictionAlerts { outX: AlertLevel; outY: AlertLevel; yDens: AlertLevel; }

export interface RoutinePrediction {
  sampleId: string;
  predicted: number;
  input: DecisionInput;
  interval: string;   // "± x"
  novelty: number;
  /** distance of the predicted value to the nearest calibration reference (σ_y units) */
  yNovelty: number;
  alerts: PredictionAlerts;
}

export interface ReliabilityModel {
  preds: RoutinePrediction[];
  ev: (k: number) => string;
}

export function buildRoutinePredictions(params: {
  cal: SampleSpectra[];
  routine: SampleSpectra[];
  predicted: number[];        // one per routine sample (from the engine)
  axisLen: number;
  yMin: number;
  yMax: number;
  rmsep: number;
  calY?: number[];            // calibration reference values (for the Y-density alert)
}): ReliabilityModel {
  const { cal, routine, predicted, axisLen: p, yMin, yMax, rmsep, calY = [] } = params;
  const nCal = cal.length;
  const nR = routine.length;
  if (nCal < 2 || nR === 0 || p === 0) return { preds: [], ev: () => '0.0' };

  const X = new Float64Array((nCal + nR) * p);
  cal.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[i * p + j] = m[j] ?? 0; });
  routine.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[(nCal + i) * p + j] = m[j] ?? 0; });

  const pca = computePca(X, nCal + nR, p, 2, nCal + nR);
  const pos = new Map(pca.usedIdx.map((r, i) => [r, i]));
  const scoreOf = (row: number): number[] => pca.scores[pos.get(row) ?? 0] ?? [0, 0];

  const cal2 = cal.map((_, i) => scoreOf(i));
  const c = [0, 0];
  cal2.forEach((s) => { c[0]! += s[0] ?? 0; c[1]! += s[1] ?? 0; });
  c[0]! /= nCal; c[1]! /= nCal;
  const sd = [0, 0];
  cal2.forEach((s) => { sd[0]! += ((s[0] ?? 0) - c[0]!) ** 2; sd[1]! += ((s[1] ?? 0) - c[1]!) ** 2; });
  sd[0] = Math.sqrt(sd[0]! / nCal) || 1;
  sd[1] = Math.sqrt(sd[1]! / nCal) || 1;

  // calibration-Y spread, for the conformal-style Y-density alert
  const ys = calY.filter((v) => Number.isFinite(v));
  const yMean = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  const ySd = ys.length ? Math.sqrt(ys.reduce((a, b) => a + (b - yMean) ** 2, 0) / ys.length) || 1 : 1;

  const preds: RoutinePrediction[] = routine.map((s, i) => {
    const sc = scoreOf(nCal + i);
    const dx = ((sc[0] ?? 0) - c[0]!) / sd[0]!;
    const dy = ((sc[1] ?? 0) - c[1]!) / sd[1]!;
    const novelty = Math.sqrt(dx * dx + dy * dy);
    // local density: share of calibration points within 1.5 σ (normalized units)
    const near = cal2.filter((z) => {
      const zx = ((z[0] ?? 0) - c[0]!) / sd[0]!;
      const zy = ((z[1] ?? 0) - c[1]!) / sd[1]!;
      return Math.hypot(zx - dx, zy - dy) < 1.5;
    }).length;
    const localDensity = near / nCal;
    const yhat = predicted[i] ?? Number.NaN;
    const extrapolation = Number.isFinite(yhat) && (yhat < yMin || yhat > yMax);
    const halfWidth = (rmsep > 0 ? rmsep : 1) * (1 + 0.5 * novelty);
    const input: DecisionInput = {
      applicabilityScore: novelty,
      localDensity,
      intervalWidth: halfWidth * 2,
      extrapolation,
    };
    // Y-density (conformal proxy): distance to the nearest calibration reference +
    // share of references within 0.5 σ_y of the predicted value.
    let yNovelty = 0; let yLocalDensity = 1;
    if (ys.length && Number.isFinite(yhat)) {
      yNovelty = Math.min(...ys.map((v) => Math.abs(v - yhat))) / ySd;
      yLocalDensity = ys.filter((v) => Math.abs(v - yhat) < 0.5 * ySd).length / ys.length;
    }
    const outX: AlertLevel = novelty > 3 ? 'bad' : novelty > 2 ? 'warn' : 'ok';
    const outY: AlertLevel = extrapolation ? 'bad' : (Number.isFinite(yhat) && (yhat < yMin + 0.05 * (yMax - yMin) || yhat > yMax - 0.05 * (yMax - yMin)) ? 'warn' : 'ok');
    const yDens: AlertLevel = (yLocalDensity < 0.03 || yNovelty > 3) ? 'bad' : (yLocalDensity < 0.10 || yNovelty > 1.5) ? 'warn' : 'ok';
    return { sampleId: s.sampleId, predicted: yhat, input, interval: `± ${halfWidth.toFixed(2)}`, novelty, yNovelty, alerts: { outX, outY, yDens } };
  });

  return { preds, ev: (k) => ((pca.explained[k] ?? 0) * 100).toFixed(1) };
}
