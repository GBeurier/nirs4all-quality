// Display-only owner preprocessing of every cropped repetition. No preview
// dataset or fitted state enters calibration, selection, persistence or replay.
import type { RoleStep } from '@nirs4all/methods';
import type { SpectraDataset } from '@/domain/spectra';
import { applySteps } from '@/engine/jsNumerics';
import { validateMatrix } from '@/engine/nativeDiagnostics';

export interface PreviewPp { id: string; en: string; steps: RoleStep[] }

export const PREVIEW_PP: PreviewPp[] = [
  { id: 'none', en: 'Raw', steps: [] },
  { id: 'snv', en: 'SNV', steps: [{ methodId: 'preprocessing.scatter.snv', params: { with_mean: true, with_std: true, ddof: 1 } }] },
  { id: 'd1', en: '1st derivative', steps: [{ methodId: 'preprocessing.derivatives.savitzky_golay', params: { window_length: 15, polyorder: 2, deriv: 1, mode: 'nearest', delta: 1, cval: 0 } }] },
  { id: 'd2', en: '2nd derivative', steps: [{ methodId: 'preprocessing.derivatives.savitzky_golay', params: { window_length: 17, polyorder: 2, deriv: 2, mode: 'nearest', delta: 1, cval: 0 } }] },
  { id: 'msc', en: 'MSC', steps: [{ methodId: 'preprocessing.scatter.msc', params: {} }] },
  { id: 'std', en: 'Standard scaler', steps: [{ methodId: 'preprocessing.scaling.standard_scale', params: { with_mean: true, with_std: true, ddof: 1 } }] },
];

/** Return a new dataset with the same ordered identities and physical axis.
 * Raw returns the input without initializing Methods; failures reject. */
export async function applyPreviewPp(ds: SpectraDataset, ppId: string): Promise<SpectraDataset> {
  if (ppId === 'none') return ds;
  const def = PREVIEW_PP.find((d) => d.id === ppId);
  if (!def) throw new Error(`Unsupported preview option '${ppId}'.`);
  const cols = ds.axis.length;
  let rows = 0;
  for (const sample of ds.samples) rows += sample.reps.length;
  const X = { data: new Float64Array(rows * cols), rows, cols };
  let row = 0;
  for (const sample of ds.samples) for (const rep of sample.reps) {
    if (rep.values.length !== cols) throw new Error('Ragged spectra are unavailable for preview processing.');
    for (let j = 0; j < cols; j++) {
      const value = rep.values[j];
      // Check before typed-array coercion: null/undefined must never become zero.
      if (typeof value !== 'number') throw new Error('Missing or non-numeric spectra are unavailable for preview processing.');
      X.data[row * cols + j] = value;
    }
    row++;
  }
  validateMatrix(X);
  const transformed = await applySteps(X, def.steps);
  validateMatrix(transformed);
  if (transformed.rows !== rows || transformed.cols !== cols) {
    throw new Error('Preview processing changed the spectral shape.');
  }
  row = 0;
  return { ...ds, samples: ds.samples.map((sample) => ({
    ...sample,
    reps: sample.reps.map((rep) => {
      const values = transformed.data.slice(row * cols, (row + 1) * cols);
      row++;
      return { ...rep, values };
    }),
  })) };
}
