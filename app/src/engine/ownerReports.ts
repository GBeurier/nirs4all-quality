import type { Metrics } from './port.js';

export const REPORT_PROFILE = 'regression_report.population_rmse_ratios.v1';

/** Owner DTOs: identities and report metadata survive storage/export unchanged. */
export interface OwnerPredictionBlock {
  prediction_id?: string | null;
  producer_node: string;
  producer_port?: string | null;
  partition: 'train' | 'validation' | 'test' | 'final';
  fold_id: string | null;
  sample_ids: string[];
  values: number[][];
  target_names: string[];
}
export interface OwnerRegressionReport {
  producer_node: string;
  producer_port?: string | null;
  prediction_id?: string | null;
  variant_id?: string | null;
  variant_label?: string | null;
  partition: OwnerPredictionBlock['partition'];
  fold_id: string | null;
  level: 'sample';
  row_count: number;
  target_width: number;
  target_names: string[];
  metrics: Record<string, number>;
  metric_profile: string;
  undefined_metrics?: Record<string, string>;
}

/** Structural report admission, not a metric implementation or recomputation. */
export function isOwnerReport(value: unknown): value is OwnerRegressionReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as OwnerRegressionReport;
  if (r.metric_profile !== REPORT_PROFILE || r.level !== 'sample' || r.target_width !== 1
      || !Number.isSafeInteger(r.row_count) || r.row_count < 1 || typeof r.producer_node !== 'string'
      || !['train', 'validation', 'test', 'final'].includes(r.partition)
      || !(r.fold_id === null || typeof r.fold_id === 'string')
      || !Array.isArray(r.target_names) || r.target_names.length !== 1 || typeof r.target_names[0] !== 'string'
      || !r.metrics || typeof r.metrics !== 'object' || Array.isArray(r.metrics)
      || !Object.values(r.metrics).every(v => typeof v === 'number' && Number.isFinite(v))
      || typeof r.metrics['rmse'] !== 'number' || r.metrics['rmse'] < 0 || typeof r.metrics['bias'] !== 'number') return false;
  const reasons = r.undefined_metrics ?? {};
  if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons)) return false;
  for (const [key, reason] of Object.entries(reasons)) {
    if (Object.hasOwn(r.metrics, key) || !((key === 'r2' && reason === 'constant_target')
        || ((key === 'rpd' || key === 'rpiq') && reason === 'zero_rmse'))) return false;
  }
  return ['r2', 'rpd', 'rpiq'].every(key => Object.hasOwn(r.metrics, key) || Object.hasOwn(reasons, key));
}

export function reportToMetrics(report: OwnerRegressionReport): Metrics {
  if (!isOwnerReport(report)) throw new Error('DAG returned an invalid or unsupported regression report.');
  const metrics: Metrics = { n: report.row_count };
  for (const key of ['rmse', 'r2', 'rpd', 'rpiq', 'bias'] as const) {
    const value = report.metrics[key];
    if (value !== undefined) metrics[key] = value;
  }
  return metrics;
}

