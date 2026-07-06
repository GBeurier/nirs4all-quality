// Equal-width histogram — ported verbatim from studio-lite's _helpers.ts.
export interface HistBin {
  bin: string;
  count: number;
  center: number;
}

export function histogram(values: number[], nBins = 24): HistBin[] {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return [{ bin: min.toFixed(2), count: vals.length, center: min }];
  const width = (max - min) / nBins;
  const bins: HistBin[] = Array.from({ length: nBins }, (_, i) => {
    const lo = min + i * width;
    return { bin: lo.toFixed(2), count: 0, center: lo + width / 2 };
  });
  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    const b = bins[idx];
    if (b) b.count += 1;
  }
  return bins;
}
