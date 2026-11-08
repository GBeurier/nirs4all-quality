import type { MaterializedDataset } from './port.js';
import type { RoleStep } from './ownerRecipes.js';
import { validateCalibrationDataset, validateSelectionSplit } from './evaluation.js';

export type RidgeOperator = 'identity' | 'snv' | 'diff1' | 'diff2' | 'detrend';
export interface RidgeChain { label: string; ops: RidgeOperator[] }
/** Historical catalog token retained as bank data; execution belongs to DAG. */
export interface RidgeBank {
  kind: 'js_ridge_screen';
  chains: RidgeChain[];
  alphas: number[];
  axis: { fr: string; en: string };
}
export const OPERATOR_LABEL: Record<RidgeOperator, { fr: string; en: string }> = {
  identity: { fr: 'brut', en: 'raw' },
  snv: { fr: 'SNV', en: 'SNV' },
  diff1: { fr: 'dérivée 1re', en: '1st derivative' },
  diff2: { fr: 'dérivée 2de', en: '2nd derivative' },
  detrend: { fr: 'detrend', en: 'detrend' },
};

/** B1 mapping: row-wise operators, shrinking differences, index-only detrend. */
export function lowerRidgeSteps(ops: readonly RidgeOperator[], alpha?: number): RoleStep[] {
  const steps = ops.flatMap((op): RoleStep[] => {
    switch (op) {
      case 'identity': return [];
      case 'snv': return [{ class: 'n4m:preprocessing.scatter.snv', params: { ddof: 1 } }];
      case 'diff1': case 'diff2': return [{ class: 'n4m:preprocessing.derivatives.derivate',
        params: { order: op === 'diff1' ? 1 : 2, delta: 1 } }];
      case 'detrend': return [{ class: 'n4m:preprocessing.baselines.detrend', params: { polyorder: 1 } }];
      default: throw new Error(`Unsupported Ridge operator '${String(op)}'.`);
    }
  });
  return [...steps, { class: 'n4m:models.regularized.ridge', params: {
    ...(alpha === undefined ? {} : { alpha }), center_x: true, scale_x: false, center_y: true,
  } }];
}

/** Two ordered axes only. No host Cartesian execution or PLS refusal policy. */
export function lowerRidgeBank(bank: RidgeBank) {
  if (!bank.chains.length || !bank.alphas.length) throw new Error('Ridge screening requires chains and alpha candidates.');
  if (bank.alphas.some(alpha => typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0)) {
    throw new Error('Ridge alpha candidates must be finite and positive.');
  }
  return { chains: bank.chains.map((chain, index) => ({ chain: index, label: chain.label, steps: lowerRidgeSteps(chain.ops) })),
    alphas: [...bank.alphas] };
}

/** Protocol count only; Methods owns the KS distances, membership and ties. */
export const ridgeTrainCount = (rows: number): number => Math.max(2, Math.round(0.75 * rows));

export function ridgeSelectionSplit(ds: MaterializedDataset, methods: typeof import('@nirs4all/methods')) {
  validateCalibrationDataset(ds);
  const nTrain = ridgeTrainCount(ds.nSamples);
  if (typeof methods.KennardStone !== 'function') throw new Error('Ridge requires the current Methods counted splitters.kennard_stone role.');
  // The generated class calls the generic native procedure. Never pass test_size.
  let folds: { train: number[]; test: number[] }[];
  try { folds = new methods.KennardStone({ n_train: nTrain }).split({ data: ds.X, rows: ds.nSamples, cols: ds.nFeatures }); }
  catch (cause) { throw new Error('Methods counted splitters.kennard_stone refused Ridge calibration; no alternate split is used.', { cause }); }
  if (folds.length !== 1) throw new Error('Ridge requires exactly one Methods KS holdout.');
  // Historical Ridge gathers training rows in materialized row order, not ID order.
  const train = [...folds[0]!.train].sort((a, b) => a - b), valid = [...folds[0]!.test];
  validateSelectionSplit(train, valid);
  const all = [...train, ...valid];
  if (train.length !== nTrain || all.length !== ds.nSamples || new Set(all).size !== ds.nSamples
      || all.some(i => !Number.isInteger(i) || i < 0 || i >= ds.nSamples)
      || valid.some((i, k) => k > 0 && i <= valid[k - 1]!)) {
    throw new Error('Methods counted KS must return the complete disjoint cohort and ascending validation rows.');
  }
  return { train, valid };
}
