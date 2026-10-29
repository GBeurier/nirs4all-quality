import { fitPcaReference, type Matrix } from '@/engine/nativeDiagnostics';

export interface PcaResult {
  scores: number[][];
  explained: number[];
  nComp: number;
  usedIdx: number[];
  reason: string | null;
}

export function rowsOf(X: Matrix): number[][] {
  return Array.from({ length: X.rows }, (_, i) => Array.from(X.data.subarray(i * X.cols, (i + 1) * X.cols)));
}

function varianceRatios(input: Matrix, scores: number[][]): number[] {
  const means = Array.from({ length: input.cols }, (_, j) => scores.reduce((sum, _, i) => sum + input.data[i * input.cols + j]!, 0) / input.rows);
  const total = input.data.reduce((sum, value, index) => sum + (value - means[index % input.cols]!) ** 2, 0);
  return Array.from({ length: scores[0]?.length ?? 0 }, (_, j) => total > 0 ? scores.reduce((sum, row) => sum + row[j]! ** 2, 0) / total : 0);
}

/** Native PCA for descriptive plots; any display subsampling is in usedIdx. */
export function computePca(X: Float64Array, nSamples: number, nFeatures: number, maxComp = 4, maxSamples = 2000): PcaResult {
  if (nSamples < 2 || nFeatures < 1) return { scores: [], explained: [], nComp: 0, usedIdx: [], reason: 'PCA needs at least two samples and a spectral band.' };
  const usedIdx = Array.from({ length: Math.min(nSamples, maxSamples) }, (_, i) => Math.floor(i * nSamples / Math.min(nSamples, maxSamples)));
  const data = Float64Array.from(usedIdx.flatMap((i) => Array.from(X.subarray(i * nFeatures, (i + 1) * nFeatures))));
  const input = { data, rows: usedIdx.length, cols: nFeatures };
  let reference: ReturnType<typeof fitPcaReference> | undefined;
  try {
    reference = fitPcaReference(input, maxComp);
    const scores = rowsOf(reference.transform(input));
    return { scores, explained: varianceRatios(input, scores), nComp: scores[0]?.length ?? 0, usedIdx, reason: null };
  } catch (error) {
    return { scores: [], explained: [], nComp: 0, usedIdx: [], reason: error instanceof Error ? error.message : String(error) };
  } finally { reference?.dispose(); }
}

/** Calibration-only fit and evaluation-only projection for applicability. */
export function referenceProjection(calibration: Matrix, evaluation: Matrix, components = 2) {
  const reference = fitPcaReference(calibration, components);
  try {
    const calibrationScores = rowsOf(reference.transform(calibration));
    const evaluationScores = evaluation.rows ? rowsOf(reference.transform(evaluation)) : [];
    return { calibrationScores, evaluationScores, explained: varianceRatios(calibration, calibrationScores) };
  } finally { reference.dispose(); }
}
