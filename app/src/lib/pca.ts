// Client PCA — dependency-free Gram-matrix power-iteration + deflation, ported
// from studio-lite's pca.ts (n×n Gram is ideal for wide NIRS data). Deterministic.
export interface PcaResult {
  scores: number[][];   // [usedRow][component]
  explained: number[];  // explained-variance ratio per component (0..1)
  nComp: number;
  usedIdx: number[];    // sample rows used
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v: Float64Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const nrm = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= nrm;
}

export function computePca(
  X: Float64Array,
  nSamples: number,
  nFeatures: number,
  maxComp = 4,
  maxSamples = 2000,
): PcaResult {
  let usedIdx: number[];
  if (nSamples > maxSamples) {
    const idx = Array.from({ length: nSamples }, (_, i) => i);
    const rnd = mulberry32(12345);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = idx[i]!; idx[i] = idx[j]!; idx[j] = tmp;
    }
    usedIdx = idx.slice(0, maxSamples).sort((a, b) => a - b);
  } else {
    usedIdx = Array.from({ length: nSamples }, (_, i) => i);
  }

  const n = usedIdx.length;
  const p = nFeatures;
  const mean = new Float64Array(p);
  for (const row of usedIdx) {
    for (let j = 0; j < p; j++) {
      const v = X[row * p + j];
      if (Number.isFinite(v)) mean[j] += v;
    }
  }
  for (let j = 0; j < p; j++) mean[j] /= n || 1;

  const Xc = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const row = usedIdx[i]!;
    for (let j = 0; j < p; j++) {
      const v = X[row * p + j];
      Xc[i * p + j] = Number.isFinite(v) ? v - mean[j] : 0;
    }
  }

  const K = new Float64Array(n * n);
  let trace = 0;
  for (let i = 0; i < n; i++) {
    for (let k = i; k < n; k++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += Xc[i * p + j] * Xc[k * p + j];
      K[i * n + k] = s;
      K[k * n + i] = s;
      if (i === k) trace += s;
    }
  }

  const comps = Math.max(0, Math.min(maxComp, n - 1, p));
  const scores: number[][] = Array.from({ length: n }, () => new Array<number>(comps).fill(0));
  const explained: number[] = [];
  for (let c = 0; c < comps; c++) {
    const rnd = mulberry32(7 + c);
    let v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = rnd() - 0.5;
    normalize(v);
    let lambda = 0;
    for (let it = 0; it < 160; it++) {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += K[i * n + k] * v[k];
        w[i] = s;
      }
      lambda = 0;
      for (let i = 0; i < n; i++) lambda += v[i] * w[i];
      normalize(w);
      v = w;
    }
    const sigma = Math.sqrt(Math.max(lambda, 0));
    for (let i = 0; i < n; i++) scores[i]![c] = v[i] * sigma;
    explained.push(trace > 0 ? Math.max(lambda, 0) / trace : 0);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < n; k++) K[i * n + k] -= lambda * v[i] * v[k];
    }
  }

  return { scores, explained, nComp: comps, usedIdx };
}
