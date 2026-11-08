import type { PredictResult, PredictionContext } from './port.js';
import { loadDag } from './dagRuntime.js';
import { REPORT_PROFILE, reportToMetrics, type OwnerPredictionBlock, type OwnerRegressionReport } from './ownerReports.js';

export function predictionIds(context: PredictionContext, rows: number): string[] {
  const ids = context.sampleIds;
  if (ids.length !== rows || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('Prediction requires one explicit unique sample ID per spectrum.');
  }
  return [...ids];
}

/** Only identity assembly and owner dispatch; no positional target pairing. */
export async function scoreKnownPredictions(result: PredictResult, context: PredictionContext): Promise<PredictResult> {
  const requested = predictionIds(context, result.values.length);
  if (result.sampleIds && (result.sampleIds.length !== requested.length
      || result.sampleIds.some((id, i) => id !== requested[i]))) {
    throw new Error('Prediction values do not have the requested sample identities.');
  }
  const refs = new Map<string, number>();
  const seen = new Set<string>();
  for (const ref of context.references ?? []) {
    if (typeof ref.sampleId !== 'string' || !ref.sampleId || seen.has(ref.sampleId)) throw new Error('Known references require unique nonempty sample IDs.');
    seen.add(ref.sampleId);
    if (ref.actual === null || ref.actual === undefined) continue;
    if (typeof ref.actual !== 'number' || !Number.isFinite(ref.actual)) throw new Error(`Nonfinite known reference for '${ref.sampleId}'.`);
    refs.set(ref.sampleId, ref.actual);
  }
  const requestedSet = new Set(requested);
  const known = new Set(requested.filter(id => refs.has(id)));
  const unscoredSampleIds = requested.filter(id => !known.has(id));
  if (!known.size) {
    const { report: _priorReport, ...unscored } = result;
    return { ...unscored, sampleIds: requested, unscoredSampleIds };
  }
  const block: OwnerPredictionBlock = result.predictionBlock ?? {
    producer_node: 'model:quali.saved', partition: 'final', fold_id: null,
    sample_ids: requested, values: Array.from(result.values, value => [value]), target_names: [context.targetName ?? 'y'],
  };
  if (context.targetName !== undefined && (block.target_names.length !== 1 || block.target_names[0] !== context.targetName)) {
    throw new Error('Known reference target name differs from the fitted prediction target.');
  }
  if (block.sample_ids.length !== requested.length || new Set(block.sample_ids).size !== requested.length
      || block.values.length !== block.sample_ids.length || block.sample_ids.some(id => !requestedSet.has(id))) {
    throw new Error('Owner prediction block identities differ from the requested cohort.');
  }
  // Preserve the owner's prediction order and independently preserve the input
  // reference order. The native scorer joins the two by explicit sample IDs.
  const selected = block.sample_ids.flatMap((id, i) => known.has(id) ? [i] : []);
  const predictions: OwnerPredictionBlock = { ...block,
    sample_ids: selected.map(i => block.sample_ids[i]!), values: selected.map(i => block.values[i]!),
  };
  const matching = [...refs].filter(([id]) => known.has(id));
  const targets = { level: 'sample', unit_ids: matching.map(([id]) => ({ level: 'sample', id })),
    values: matching.map(([, actual]) => [actual]), target_names: block.target_names };
  const dag = await loadDag();
  const report = JSON.parse(dag.score_regression_prediction_block_with_profile_json(
    JSON.stringify(predictions), JSON.stringify(targets), JSON.stringify(REPORT_PROFILE),
  )) as OwnerRegressionReport;
  reportToMetrics(report);
  return { ...result, sampleIds: requested, unscoredSampleIds, report };
}
