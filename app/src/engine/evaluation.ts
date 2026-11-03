import type { MaterializedDataset } from './port.js';
import { validateDataset } from './port.js';

/** Evaluation context travels with scores, persisted models and exports. */
export interface Evaluation {
  scope: 'training' | 'selection_validation' | 'independent_test';
  independent_test: boolean;
}

export function evaluationLabel(evaluation?: Evaluation): string {
  if (evaluation?.scope === 'training') return 'Training (resubstitution)';
  if (evaluation?.scope === 'selection_validation') return 'Selection validation';
  if (evaluation?.scope === 'independent_test' && evaluation.independent_test) return 'Independent test';
  return 'Evaluation scope unavailable';
}

export function evaluationNote(evaluation?: Evaluation): string {
  if (evaluation?.scope === 'training') return 'Training scores reuse fitted samples and do not estimate independent prediction error.';
  if (evaluation?.scope === 'selection_validation') return 'These samples select settings and pipelines. Scores are selection scores; independent prediction error has not been measured.';
  if (evaluation?.scope === 'independent_test' && evaluation.independent_test) return 'Scores use an independent test cohort.';
  return 'This saved result has no evaluation metadata. Independent prediction error has not been established.';
}

export function validateCalibrationDataset(ds: MaterializedDataset): void {
  validateDataset(ds);
  const groups = ds.groupIds ?? ds.sampleIds;
  if (groups.length !== ds.nSamples) throw new Error('Calibration group identities must match the row count.');
  if (new Set(groups).size !== ds.nSamples) {
    throw new Error('Repeated samples require a group-aware split, which this calibration profile does not support. Use mean replicate spectra.');
  }
  if (ds.nSamples < 8 || ds.nFeatures < 1) {
    throw new Error('Insufficient samples: calibration requires at least 8 labelled samples and one feature; resubstitution is refused.');
  }
  if (ds.taskType !== 'regression') throw new Error('Calibration currently supports regression only.');
  if (!ds.X.every(Number.isFinite) || !ds.y.every(Number.isFinite)) {
    throw new Error('Calibration requires finite spectra and targets.');
  }
}

/** Refuse overlap even if an upstream runtime silently switches to resubstitution. */
export function validateSelectionSplit(train: number[], validation: number[]): void {
  const fitted = new Set(train);
  if (train.length < 2 || validation.length < 2 || validation.some((r) => fitted.has(r))) {
    throw new Error('Insufficient disjoint samples for selection validation; resubstitution is refused.');
  }
}
