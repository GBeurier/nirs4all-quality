// Repetition (replicate) distance model — ports nirs4all-studio's playground
// logic: group by sample, distance of each repetition to its group's mean
// spectrum, P95-outlier flag, quantile lines, and ordering. Pure + in-app (the
// distance that studio computes on the backend is computed here directly).
import { meanSpectrum, spectralDistance, type SpectraDataset } from '@/domain/spectra';

export interface RepPoint {
  x: number;          // group (bio-sample) index — one column per sample
  groupIndex: number;
  groupSize: number;
  y: number;          // distance of this repetition to the group mean
  bioSample: string;
  repIndex: number;
  sampleId: string;
  targetY: number | null;
  isOutlier: boolean; // distance > P95
}

export type RepSort = 'index' | 'distance' | 'variance' | 'name';

export interface RepModel {
  points: RepPoint[];
  order: string[];
  quantiles: { p50: number; p75: number; p90: number; p95: number };
  maxDistance: number;
  nGroups: number;
  nWithReps: number;
  nOutliers: number;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * (q / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? sorted[0]!;
  const b = sorted[hi] ?? sorted[sorted.length - 1]!;
  return a + (b - a) * (pos - lo);
}

export function buildRepetitionModel(
  spectra: SpectraDataset,
  yBySample: Record<string, number | undefined>,
  sort: RepSort = 'index',
): RepModel {
  const groups = spectra.samples.filter((s) => s.reps.length >= 1);

  interface GStat { sampleId: string; dists: number[]; meanDist: number; variance: number; order: number; }
  const stats: GStat[] = groups.map((s, order) => {
    const mean = meanSpectrum(s);
    const dists = s.reps.map((r) => spectralDistance(r.values, mean));
    const meanDist = dists.reduce((a, b) => a + b, 0) / Math.max(1, dists.length);
    const variance = dists.length > 1
      ? dists.reduce((a, d) => a + (d - meanDist) ** 2, 0) / (dists.length - 1)
      : 0;
    return { sampleId: s.sampleId, dists, meanDist, variance, order };
  });

  const allDist = stats.flatMap((g) => g.dists).filter((d) => Number.isFinite(d));
  const quantiles = {
    p50: percentile(allDist, 50),
    p75: percentile(allDist, 75),
    p90: percentile(allDist, 90),
    p95: percentile(allDist, 95),
  };
  const maxDistance = allDist.length ? Math.max(...allDist) : 1;

  const statBy = new Map(stats.map((g) => [g.sampleId, g]));
  const order = stats.map((g) => g.sampleId);
  order.sort((a, b) => {
    const ga = statBy.get(a);
    const gb = statBy.get(b);
    if (sort === 'name') return a.localeCompare(b, undefined, { numeric: true });
    if (sort === 'distance') return (gb?.meanDist ?? 0) - (ga?.meanDist ?? 0);
    if (sort === 'variance') return (gb?.variance ?? 0) - (ga?.variance ?? 0);
    return (ga?.order ?? 0) - (gb?.order ?? 0);
  });
  const indexOf = new Map(order.map((id, i) => [id, i]));

  const p95 = quantiles.p95;
  let nOutliers = 0;
  const points: RepPoint[] = [];
  for (const s of groups) {
    const gi = indexOf.get(s.sampleId) ?? 0;
    const mean = meanSpectrum(s);
    s.reps.forEach((r, k) => {
      const d = spectralDistance(r.values, mean);
      const isOutlier = d > p95 && p95 > 0;
      if (isOutlier) nOutliers += 1;
      points.push({
        x: gi, groupIndex: gi, groupSize: s.reps.length, y: d,
        bioSample: s.sampleId, repIndex: k, sampleId: s.sampleId,
        targetY: yBySample[s.sampleId] ?? null, isOutlier,
      });
    });
  }

  return {
    points, order, quantiles, maxDistance,
    nGroups: groups.length,
    nWithReps: groups.filter((s) => s.reps.length >= 2).length,
    nOutliers,
  };
}

/** green→red distance ramp (studio-lite parity). */
export function distanceColor(distance: number, maxDistance: number): string {
  if (maxDistance <= 0) return 'hsl(120 60% 45%)';
  const t = Math.min(distance / maxDistance, 1);
  const hue = 120 - t * 120;
  return `hsl(${hue.toFixed(0)} 70% 45%)`;
}
