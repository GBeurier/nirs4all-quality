// Display-only preprocessing preview for the dataset viewer + Data-health: apply a
// classic correction (SNV / 1st-2nd derivative / MSC / standard scaler) to EVERY
// spectrum so the tech can see the corrected signal. Reuses the real window-aware
// numerics (jsNumerics.applySteps); the whole rep matrix is transformed at once so
// MSC/std use a consistent dataset reference. This never touches calibration data.
import type { SpectraDataset } from '@/domain/spectra';
import { applySteps, type PreprocStep } from '@/engine/jsNumerics';

export interface PreviewPp { id: string; fr: string; en: string; steps: PreprocStep[] }

export const PREVIEW_PP: PreviewPp[] = [
  { id: 'none', fr: 'Brut', en: 'Raw', steps: [] },
  { id: 'snv', fr: 'SNV', en: 'SNV', steps: [{ type: 'StandardNormalVariate', params: {} }] },
  { id: 'd1', fr: 'Dérivée 1re', en: '1st deriv.', steps: [{ type: 'SavitzkyGolay', params: { window_length: 15, polyorder: 2, deriv: 1 } }] },
  { id: 'd2', fr: 'Dérivée 2de', en: '2nd deriv.', steps: [{ type: 'SavitzkyGolay', params: { window_length: 17, polyorder: 2, deriv: 2 } }] },
  { id: 'msc', fr: 'MSC', en: 'MSC', steps: [{ type: 'MultiplicativeScatterCorrection', params: {} }] },
  { id: 'std', fr: 'Std scaler', en: 'Std scaler', steps: [{ type: 'StandardScaler', params: {} }] },
];

/** Return a NEW dataset with the chosen preview preprocessing applied to every
 *  repetition (length-preserving; axis unchanged). 'none' returns the input. */
export function applyPreviewPp(ds: SpectraDataset, ppId: string): SpectraDataset {
  const def = PREVIEW_PP.find((d) => d.id === ppId);
  if (!def || def.steps.length === 0) return ds;
  const p = ds.axis.length;
  if (p === 0) return ds;
  // stack every repetition into one matrix (sample-major, rep order)
  let n = 0;
  for (const s of ds.samples) n += s.reps.length;
  const X = new Float64Array(n * p);
  let k = 0;
  for (const s of ds.samples) for (const r of s.reps) { for (let j = 0; j < p; j++) X[k * p + j] = r.values[j] ?? 0; k++; }
  const { data, p: q } = applySteps(X, n, p, def.steps);
  // rebuild in the same order (all preview steps are length-preserving → q === p)
  let row = 0;
  const samples = ds.samples.map((s) => ({
    sampleId: s.sampleId,
    reps: s.reps.map((r) => {
      const vv = new Float64Array(q);
      for (let j = 0; j < q; j++) vv[j] = data[row * q + j] ?? 0;
      row++;
      return { repId: r.repId, values: vv };
    }),
  }));
  return { axis: q === p ? ds.axis : ds.axis.slice(0, q), axisUnit: ds.axisUnit, samples };
}
