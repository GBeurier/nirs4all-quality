// HPLC enrichment scoring — a REAL, interpretable metric per candidate.
//
// For each un-referenced sample we compute an "information score" = its distance
// to the calibration cloud in PCA space (in std-dev units): how far the spectrum
// sits from what the model already knows. High score ⇒ it extends coverage
// (informative); a very high score ⇒ a strong outlier held back to verify (the
// golden rule — an outlier isn't automatically a good candidate). Deterministic.
import type { EnrichmentReason } from 'nirs4all-ui/lab';

import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { computePca } from './pca';

export interface Candidate {
  sampleId: string;
  /** distance to the calibration cloud, in PC std-dev units (the info score) */
  novelty: number;
  reason: EnrichmentReason;
  strongOutlier: boolean;
  /** near-identical to an already-ranked (or already-measured) spectrum → not worth
   *  paying twice; de-prioritized so the budget never picks a doublon */
  duplicate: boolean;
  pc1: number;
  pc2: number;
}

export interface SelectionModel {
  candidates: Candidate[];    // pool, sorted by novelty desc (duplicates sunk to the end)
  calPts: { x: number; y: number }[];
  maxNovelty: number;
  /** suggested number of samples to send — those that meaningfully extend the
   *  domain (info score ≥ INFORMATIVE_SIGMA), before diminishing returns */
  recommended: number;
  /** count of near-identical spectra held back from selection (no doublons) */
  duplicates: number;
  ev: (k: number) => string;
}

const OUTLIER_SIGMA = 3;
// a candidate at least this far (in PC std-dev units) from the calibration
// centroid genuinely extends coverage; closer ones resemble the calibration.
const INFORMATIVE_SIGMA = 0.75;
// two spectra closer than this (σ units in normalized PC space) are treated as the
// same measurement — a replicate or a true duplicate — so only one is ever selected.
const DUPLICATE_EPS = 0.05;

export function scoreCandidates(spectra: SpectraDataset, labelledIds: Set<string>, poolIds: Set<string>): SelectionModel {
  const cal = spectra.samples.filter((s) => labelledIds.has(s.sampleId));
  const pool = spectra.samples.filter((s) => poolIds.has(s.sampleId));
  const p = spectra.axis.length;
  const nPool = pool.length;
  if (nPool < 2 || p === 0) {
    return { candidates: [], calPts: [], maxNovelty: 1, recommended: 0, duplicates: 0, ev: () => '0.0' };
  }

  // COLD START (no references yet, e.g. a dataset uploaded without Y): rank the
  // pool by diversity WITHIN itself — distance to the pool centroid — so we still
  // propose an initial diverse set to send to HPLC. Otherwise measure distance to
  // the existing calibration cloud.
  const coldStart = cal.length < 2;
  const ref = coldStart ? pool : cal;
  const nRef = ref.length;
  const allRows = coldStart ? pool : cal.concat(pool);
  const nAll = allRows.length;
  const X = new Float64Array(nAll * p);
  allRows.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[i * p + j] = m[j] ?? 0; });
  const pca = computePca(X, nAll, p, 2, nAll);
  const pos = new Map(pca.usedIdx.map((r, i) => [r, i]));
  const scoreOf = (row: number): number[] => pca.scores[pos.get(row) ?? 0] ?? [0, 0];

  const ref2 = Array.from({ length: nRef }, (_, i) => scoreOf(i));
  const c = [0, 0];
  ref2.forEach((s) => { c[0]! += s[0] ?? 0; c[1]! += s[1] ?? 0; });
  c[0]! /= nRef; c[1]! /= nRef;
  const sd = [0, 0];
  ref2.forEach((s) => { sd[0]! += ((s[0] ?? 0) - c[0]!) ** 2; sd[1]! += ((s[1] ?? 0) - c[1]!) ** 2; });
  sd[0] = Math.sqrt(sd[0]! / nRef) || 1;
  sd[1] = Math.sqrt(sd[1]! / nRef) || 1;

  const poolStart = coldStart ? 0 : cal.length;
  // each candidate carries its normalized PC coordinates (nx, ny) so we can measure
  // spectral distance between candidates for de-duplication.
  const candidates: (Candidate & { nx: number; ny: number })[] = pool.map((s, i) => {
    const sc = scoreOf(poolStart + i);
    const nx = ((sc[0] ?? 0) - c[0]!) / sd[0]!;
    const ny = ((sc[1] ?? 0) - c[1]!) / sd[1]!;
    const novelty = Math.sqrt(nx * nx + ny * ny);
    return { sampleId: s.sampleId, novelty, nx, ny, pc1: sc[0] ?? 0, pc2: sc[1] ?? 0, strongOutlier: novelty > OUTLIER_SIGMA, duplicate: false, reason: 'representative' };
  });
  candidates.sort((a, b) => b.novelty - a.novelty);

  // greedy de-duplication: walk high→low novelty, keeping one representative per
  // near-identical spectral group. Seed with the calibration cloud so a candidate
  // that merely repeats an already-measured sample is a duplicate too. This is what
  // guarantees the budget never spends twice on the same spectrum.
  const kept: { x: number; y: number }[] = coldStart ? [] : ref2.map((s) => ({ x: ((s[0] ?? 0) - c[0]!) / sd[0]!, y: ((s[1] ?? 0) - c[1]!) / sd[1]! }));
  let duplicates = 0;
  for (const cand of candidates) {
    const dup = kept.some((k) => Math.hypot(k.x - cand.nx, k.y - cand.ny) < DUPLICATE_EPS);
    if (dup) { cand.duplicate = true; duplicates += 1; }
    else kept.push({ x: cand.nx, y: cand.ny });
  }
  // sink duplicates to the end so a top-N budget slice never includes a doublon
  // while a distinct candidate remains.
  candidates.sort((a, b) => (a.duplicate === b.duplicate ? b.novelty - a.novelty : a.duplicate ? 1 : -1));

  const maxNovelty = candidates.find((cand) => !cand.duplicate)?.novelty ?? candidates[0]?.novelty ?? 1;
  for (const cand of candidates) {
    const t = cand.novelty / (maxNovelty || 1);
    cand.reason = cand.duplicate ? 'representative'
      : cand.novelty > OUTLIER_SIGMA ? 'rare_type'
        : t > 0.66 ? 'extends_range'
          : t > 0.33 ? 'fills_gap'
            : 'boundary';
  }
  // recommendation = count of genuinely informative, NON-duplicate candidates,
  // clamped so we always suggest at least a few and never more than the pool.
  const informative = candidates.filter((cand) => !cand.duplicate && cand.novelty >= INFORMATIVE_SIGMA).length;
  const nDistinct = nPool - duplicates;
  const recommended = Math.max(Math.min(3, nDistinct), Math.min(informative, nDistinct));
  // in cold start the pool IS the whole cloud → don't draw a separate grey set
  const calPts = coldStart ? [] : ref2.map((s) => ({ x: s[0] ?? 0, y: s[1] ?? 0 }));
  return { candidates, calPts, maxNovelty, recommended, duplicates, ev: (k) => ((pca.explained[k] ?? 0) * 100).toFixed(1) };
}
