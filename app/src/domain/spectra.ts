// Client-side spectra for a project — the actual arrays the dataset viewer, the
// replicate explorer, and calibration consume. (In a real deployment these come
// from nirs4all-io WASM; the demo generates them.) A spectrum is stored per
// repetition so replicate consistency can be inspected; joins are keyed by id.

export interface RepetitionSpectrum {
  repId: string;
  /** absorbance values, length = axis.length */
  values: Float64Array;
  /** flagged as a suspect replicate (e.g. far from its siblings) */
  suspect?: boolean;
}

export interface SampleSpectra {
  sampleId: string;
  reps: RepetitionSpectrum[];
}

export interface SpectraDataset {
  /** shared spectral axis (wavelengths), length = nFeatures */
  axis: number[];
  axisUnit: string;
  samples: SampleSpectra[];
}

/** Mean spectrum across a sample's repetitions (row-major safe). */
export function meanSpectrum(sample: SampleSpectra): Float64Array {
  const reps = sample.reps;
  const n = reps[0]?.values.length ?? 0;
  const out = new Float64Array(n);
  if (reps.length === 0) return out;
  for (const r of reps) {
    for (let j = 0; j < n; j++) out[j]! += r.values[j] ?? 0;
  }
  for (let j = 0; j < n; j++) out[j]! /= reps.length;
  return out;
}

/** Crop the spectral axis to a wavelength window [from, to] (null = open bound).
 *  Returns a NEW dataset with axis + every repetition sliced to the kept bands.
 *  Used to trim noisy tails for analysis AND calibration (same crop everywhere so
 *  the feature count stays consistent between training and prediction). */
export function cropSpectra(ds: SpectraDataset, from: number | null, to: number | null): SpectraDataset {
  if (from == null && to == null) return ds;
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  const keep: number[] = [];
  for (let j = 0; j < ds.axis.length; j++) { const a = ds.axis[j]!; if (a >= lo && a <= hi) keep.push(j); }
  if (keep.length === 0 || keep.length === ds.axis.length) return ds;
  const axis = keep.map((j) => ds.axis[j]!);
  const samples = ds.samples.map((s) => ({
    sampleId: s.sampleId,
    reps: s.reps.map((r) => {
      const v = new Float64Array(keep.length);
      keep.forEach((j, k) => { v[k] = r.values[j] ?? 0; });
      return r.suspect ? { repId: r.repId, values: v, suspect: r.suspect } : { repId: r.repId, values: v };
    }),
  }));
  return { axis, axisUnit: ds.axisUnit, samples };
}

/** Euclidean distance between two equal-length spectra. */
export function spectralDistance(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let j = 0; j < n; j++) {
    const d = (a[j] ?? 0) - (b[j] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}
