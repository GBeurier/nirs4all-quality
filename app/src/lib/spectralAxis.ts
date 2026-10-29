import { Resampler } from '@nirs4all/methods';

/** Convert explicit physical coordinates to nm before native interpolation. */
function wavelength(axis: readonly number[], unit: string): number[] {
  const u = unit.toLowerCase().replace(/\s/g, '').replace('μ', 'u').replace('µ', 'u');
  if (!['nm', 'um', 'cm-1', 'cm^-1', 'cm⁻¹'].includes(u)) throw new Error('An explicit wavelength/wavenumber unit is required; index axes cannot be aligned.');
  if (axis.length < 2 || axis.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('A physical spectral axis needs at least two finite positive coordinates.');
  const direction = Math.sign(axis[1]! - axis[0]!);
  if (!direction || axis.some((v, i) => i > 0 && Math.sign(v - axis[i - 1]!) !== direction)) throw new Error('Spectral coordinates must be strictly monotonic without duplicates.');
  return axis.map((v) => u === 'nm' ? v : u === 'um' ? v * 1000 : 1e7 / v);
}

/** Native linear interpolation on physical wavelengths. No extrapolation,
 * invented axes, zero imputation or interpolation across missing observations. */
export function resampleTo(values: ArrayLike<number>, sourceAxis: readonly number[], targetAxis: readonly number[], sourceUnit: string, targetUnit: string): Float64Array {
  const source = wavelength(sourceAxis, sourceUnit);
  const target = wavelength(targetAxis, targetUnit);
  if (values.length !== source.length || Array.from(values).some((v) => !Number.isFinite(v))) throw new Error('Spectrum length/missing values do not match the physical axis.');
  const sourceOrder = source.map((_, i) => i).sort((a, b) => source[a]! - source[b]!);
  const targetOrder = target.map((_, i) => i).sort((a, b) => target[a]! - target[b]!);
  const axis = sourceOrder.map((i) => source[i]!);
  const lo = axis[0]!, hi = axis.at(-1)!;
  const tolerance = Math.max(1, hi) * 1e-12;
  if (target.some((v) => v < lo - tolerance || v > hi + tolerance)) throw new Error('Routine spectra do not cover the calibration wavelength range; extrapolation is disabled.');
  const input = { data: Float64Array.from(sourceOrder.map((i) => values[i]!)), rows: 1, cols: source.length };
  const model = new Resampler({ target_wavelengths: targetOrder.map((i) => Math.min(hi, Math.max(lo, target[i]!))), method: 'linear', bounds_error: true, extrapolate: false });
  try {
    model.fit(input, undefined, { axis });
    const aligned = model.transform(input).data;
    const out = new Float64Array(target.length);
    targetOrder.forEach((original, i) => { out[original] = aligned[i]!; });
    return out;
  } finally { model.dispose(); }
}
