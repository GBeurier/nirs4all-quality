// The REAL training dataset for a project. Shared by Calibrate (fit) and Predict
// (auto-build a model), so both train on identical data. `repMode` decides whether
// each labelled sample contributes its mean spectrum ('mean', default) or every raw
// replicate as its own row ('raw', more rows, keeps replicate variability).
import type { Sample } from '@/domain/model';
import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import type { MaterializedDataset } from '@/engine';

export function buildTrainingDataset(
  spectra: SpectraDataset | undefined,
  samples: readonly Sample[],
  targetName: string,
  repMode: 'mean' | 'raw' = 'mean',
): MaterializedDataset {
  const labelled = samples.filter((s) => s.reference?.value != null);
  const yById = new Map(labelled.map((s) => [s.id, s.reference!.value as number]));
  const rows = (spectra?.samples ?? []).filter((s) => yById.has(s.sampleId));
  const p = spectra?.axis.length ?? 0;

  // build the row set: one mean vector per sample, or one per raw replicate
  const vecs: { id: string; v: Float64Array; y: number }[] = [];
  for (const s of rows) {
    const yv = yById.get(s.sampleId) ?? 0;
    if (repMode === 'raw' && s.reps.length > 0) {
      s.reps.forEach((r, k) => vecs.push({ id: `${s.sampleId}#${k + 1}`, v: r.values, y: yv }));
    } else {
      vecs.push({ id: s.sampleId, v: meanSpectrum(s), y: yv });
    }
  }

  const n = vecs.length;
  const X = new Float64Array(n * p);
  const y = new Float64Array(n);
  const sampleIds: string[] = [];
  vecs.forEach((row, i) => {
    for (let j = 0; j < p; j++) { const val = row.v[j]; X[i * p + j] = Number.isFinite(val) ? (val as number) : 0; }
    y[i] = row.y;
    sampleIds.push(row.id);
  });
  return {
    X, nSamples: n, nFeatures: p,
    axis: spectra?.axis ?? [], axisUnit: spectra?.axisUnit ?? 'nm',
    y, targetName, taskType: 'regression',
    sampleIds, partitions: vecs.map((): 'train' => 'train'),
  };
}
