// Deterministic demo spectra generator — NIRS-like absorbance curves so the
// dataset viewer, replicate explorer, and calibration have real data to show.
// (Real deployments get these from nirs4all-io WASM.)
import type { Sample } from '@/domain/model';
import type { RepetitionSpectrum, SampleSpectra, SpectraDataset } from '@/domain/spectra';

const N = 200;
const WL_MIN = 1000;
const WL_MAX = 2500;

function makeAxis(): number[] {
  return Array.from({ length: N }, (_, j) => Math.round(WL_MIN + (j / (N - 1)) * (WL_MAX - WL_MIN)));
}

function gaussian(t: number, mu: number, sigma: number): number {
  const d = t - mu;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Deterministic pseudo-noise in ~[-0.5, 0.5]. */
function noise(i: number, j: number, k: number): number {
  const s = Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/** A base NIRS-like absorbance spectrum encoding y + an independent latent. */
function baseSpectrum(yCentered: number, latent2: number): Float64Array {
  const v = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const t = j / (N - 1);
    const baseline = 0.35 + 0.12 * t + 0.05 * Math.sin(2.5 * t);
    const water = 0.25 * gaussian(t, 0.62, 0.05) + 0.18 * gaussian(t, 0.95, 0.06);
    const yBand = yCentered * 0.03 * gaussian(t, 0.4, 0.04);
    const l2Band = latent2 * 0.3 * gaussian(t, 0.75, 0.05);
    v[j] = baseline + water + yBand + l2Band;
  }
  return v;
}

export function makeDemoSpectra(samples: readonly Sample[]): SpectraDataset {
  const axis = makeAxis();
  const ys = samples.map((s) => s.reference?.value).filter((v): v is number => typeof v === 'number');
  const yMean = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 7;

  const out: SampleSpectra[] = samples.map((s, i) => {
    const yc = (s.reference?.value ?? yMean) - yMean;
    const latent2 = ((i % 7) / 7) - 0.5;
    // the spectrum encodes y IMPERFECTLY (reference/analytical error + NIR blind
    // spots) via a per-SAMPLE deterministic wobble — shared by every replicate so
    // it doesn't affect replicate distances, but it keeps calibration honest
    // (a believable RPD ~3–5 instead of a synthetic-perfect fit).
    const yEncoded = yc + 1.4 * noise(i, 997, 0);
    const base = baseSpectrum(yEncoded, latent2);
    const nReps = s.repetitions.length;
    const reps: RepetitionSpectrum[] = s.repetitions.map((rep, k) => {
      // Realistic replicate variation: an additive baseline offset, a slight
      // slope tilt, and multiplicative scatter (particle packing / repositioning)
      // — deterministic per (sample, rep) so every replicate lands at a distinct
      // distance from its group mean. ~1 sample in 6 has one clearly divergent
      // replicate (bad packing / bubble / mis-scan) → it sits above P95 and the
      // explorer rings it and flags the sample.
      const suspect = i % 6 === 2 && k === nReps - 1;
      const sgn = (v: number) => (v >= 0 ? 1 : -1);
      const offset = suspect ? 0.08 * sgn(noise(i, 101, k)) : 0.008 * noise(i, 101, k);
      const slope = suspect ? 0.05 * sgn(noise(i, 202, k)) : 0.005 * noise(i, 202, k);
      const scale = 1 + (suspect ? 0.05 * sgn(noise(i, 303, k)) : 0.008 * noise(i, 303, k));
      const values = new Float64Array(N);
      for (let j = 0; j < N; j++) {
        const t = j / (N - 1);
        values[j] = (base[j] ?? 0) * scale + offset + slope * t + 0.0015 * noise(i, j, k);
      }
      return suspect ? { repId: rep.id, values, suspect: true } : { repId: rep.id, values };
    });
    return { sampleId: s.id, reps };
  });

  return { axis, axisUnit: 'nm', samples: out };
}
