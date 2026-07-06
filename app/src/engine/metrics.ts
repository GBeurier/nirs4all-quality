// Shared regression metrics (used by both the stub and the WASM engine) so the
// numbers are computed identically regardless of backend. Adds RPIQ (IQR/RMSE).
import type { Metrics, PredRow } from './port.js';

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? sorted[0]!;
  const b = sorted[hi] ?? sorted[sorted.length - 1]!;
  return a + (b - a) * (pos - lo);
}

export function regressionMetrics(rows: readonly PredRow[]): Metrics {
  const valid = rows.filter((r) => Number.isFinite(r.actual) && Number.isFinite(r.predicted));
  const n = valid.length;
  if (n === 0) return { n: 0 };
  const meanActual = valid.reduce((s, r) => s + r.actual, 0) / n;
  const sse = valid.reduce((s, r) => s + (r.predicted - r.actual) ** 2, 0);
  const sst = valid.reduce((s, r) => s + (r.actual - meanActual) ** 2, 0);
  const rmse = Math.sqrt(sse / n);
  const sd = Math.sqrt(sst / n);
  const sortedActual = valid.map((r) => r.actual).sort((a, b) => a - b);
  const iqr = quantileSorted(sortedActual, 0.75) - quantileSorted(sortedActual, 0.25);
  const bias = valid.reduce((s, r) => s + (r.predicted - r.actual), 0) / n;
  return {
    rmse,
    r2: sst > 0 ? 1 - sse / sst : 0,
    rpd: rmse > 0 ? sd / rmse : 0,
    rpiq: rmse > 0 ? iqr / rmse : 0,
    bias,
    n,
  };
}
