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
