import type { FittedModel, LabEngine, MaterializedDataset, PipelineDSL, PredictResult, PredictionContext, RunResult } from './port.js';
import { validateCalibrationDataset, validateSelectionSplit } from './evaluation.js';
import { candidateIssue } from './preprocessing.js';
import { lowerPlsBank, type PlsBank, type RoleStep } from './ownerRecipes.js';
import { lowerRidgeBank, ridgeSelectionSplit, type RidgeBank } from './ownerRidgeBanks.js';
import { loadDataOwners, nativeDataset, numericFingerprint, type DataEnvelope } from './ownerData.js';
import { assertMethodsRuntime } from './methodsCohort.js';
import { loadDag } from './dagRuntime.js';
import { predictionIds, scoreKnownPredictions } from './ownerScores.js';
import { reportToMetrics, REPORT_PROFILE, type OwnerPredictionBlock, type OwnerRegressionReport } from './ownerReports.js';

interface BankProfile {
  model: 'pls' | 'ridge';
  backendId: 'dag-ml-methods-pls' | 'dag-ml-methods-ridge';
}
const PLS: BankProfile = { model: 'pls', backendId: 'dag-ml-methods-pls' };
const RIDGE: BankProfile = { model: 'ridge', backendId: 'dag-ml-methods-ridge' };
interface LoweredBank {
  chains: { chain: number; label: string; steps: RoleStep[] }[];
  modelAxis: { name: string; parameter: string; values: number[] };
  labels: string[];
  candidateIssues: NonNullable<RunResult['candidateIssues']>;
}
const nodeId = (profile: BankProfile) => `model:quali.${profile.model}`;
const requestId = (profile: BankProfile) => `quali:${profile.model}:x`;
const json = JSON.stringify;
type Dag = typeof import('dag-ml-wasm');
type FeatureDataset = Omit<MaterializedDataset, 'y'> & { y?: Float64Array };
type Controller = InstanceType<typeof import('dag-ml-wasm/n4m-controller')['N4mWasmRegressionController']>;
type ControllerOperators = import('dag-ml-wasm/n4m-controller').MethodsRegressionControllerOptions['operators'];
interface OwnerGraph {
  nodes: { id: string; operator: ControllerOperators[string]; params: Record<string, unknown>; [key: string]: unknown }[];
  [key: string]: unknown;
}
interface Identity {
  ordinal: string; variant_id: string; chain_label: string;
  params: Record<string, unknown>; recipe: RoleStep[]; n_components?: number;
}
interface Evidence {
  identity: Identity; validation_predictions: OwnerPredictionBlock | null;
  report: OwnerRegressionReport | null; eligible: boolean; failure: string | null;
}
interface BankResult {
  status: 'selected' | 'refused'; variants: Evidence[];
  chain_issues: { chain_label: string; failures: Record<string, string> }[];
  refusal: string | null;
  decision: { selected_candidate_id: string; ranked_candidates: { candidate_id: string; score: number }[] } | null;
  selected: { identity: Identity; selected_graph: OwnerGraph; params_by_node: Record<string, Record<string, unknown>>;
    training_sample_ids: string[]; validation_sample_ids: string[] } | null;
}
export interface DagPlsState {
  backendId: 'dag-ml-methods-pls'; packageJson: string; targetName: string; outputId: string;
  selectedCandidateId: string; selectedVariantId: string; trainingSampleIds: string[];
}
export interface DagRidgeState {
  backendId: 'dag-ml-methods-ridge'; packageJson: string; targetName: string; outputId: string;
  selectedOrdinal: string; selectedVariantId: string; chainLabel: string; params: { alpha: number };
  deploymentScope: 'all_labelled'; trainingSampleIds: string[];
}
export type DagOwnerState = DagPlsState | DagRidgeState;
let owners: Promise<{ dag: Dag; methods: typeof import('@nirs4all/methods'); Controller: typeof import('dag-ml-wasm/n4m-controller')['N4mWasmRegressionController'] } & Awaited<ReturnType<typeof loadDataOwners>>> | undefined;
async function dependencies() {
  owners ??= (async () => {
    const [dag, methods, adapter, data] = await Promise.all([loadDag(), import('@nirs4all/methods'), import('dag-ml-wasm/n4m-controller'), loadDataOwners()]);
    await methods.loadModule();
    assertMethodsRuntime(methods.version(), methods.abiVersion());
    return { dag, methods, Controller: adapter.N4mWasmRegressionController, ...data };
  })();
  return owners;
}
function sameOrder(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) throw new Error(`${label}: DAG must preserve the requested sample order; calibration refused.`);
}
/** Inference has no target access. Its root source authority is cloned by DAG
 * from the stored package; these are only the explicitly declared replay rows. */
function predictionRelations(ds: FeatureDataset, ids: string[]) {
  const groups = new Map(ds.sampleIds.map((id, row) => [id, ds.groupIds?.[row] ?? null]));
  return { records: ids.map(id => ({ observation_id: id, sample_id: id, source_id: 'nir', target_id: null,
    group_id: groups.get(id) ?? null, origin_sample_id: null, is_augmented: false })) };
}

type Envelope = DataEnvelope;
function binding(e: Envelope, profile: BankProfile) {
  return { node_id: nodeId(profile), input_name: 'x', request_id: requestId(profile), schema_fingerprint: e.schema_fingerprint,
    plan_fingerprint: e.plan_fingerprint, relation_fingerprint: e.relation_fingerprint,
    output_representation: e.plan.output_representation, feature_set_id: 'x', source_ids: ['nir'], require_relations: true };
}
function baseGraph(profile: BankProfile): OwnerGraph {
  const input = { name: 'x', kind: 'data', representation: 'tabular_numeric', cardinality: 'one', description: '' };
  const output = { name: 'oof', kind: 'prediction', representation: null, cardinality: 'one', description: '' };
  return { id: `graph:quali.${profile.model}`, interface: { inputs: [input], outputs: [output] },
    nodes: [{ id: nodeId(profile), kind: 'model', operator: { type: 'N4mRolePipeline' }, params: {},
      ports: { inputs: [input], outputs: [output] }, metadata: {}, seed_label: null }], edges: [], metadata: {} };
}
function campaign(e: Envelope, profile: BankProfile, split: unknown = null, bank?: LoweredBank) {
  return { id: `campaign:quali.${profile.model}`, root_seed: 0, split_invocation: split, data_bindings: { [nodeId(profile)]: [binding(e, profile)] },
    generation: bank ? { strategy: 'cartesian', dimensions: [
      { name: 'chain', choices: bank.chains.map(c => ({ label: c.label, value: c.chain,
        param_overrides: [{ node_id: nodeId(profile), params: { pipeline_steps_v1: c.steps } }] })) },
      { name: bank.modelAxis.name, choices: bank.modelAxis.values.map(n => ({ label: String(n), value: n,
        param_overrides: [{ node_id: nodeId(profile), params: { [bank.modelAxis.parameter]: n } }] })) },
    ], max_variants: bank.chains.length * bank.modelAxis.values.length } : { strategy: 'none', dimensions: [], max_variants: 1 },
  };
}
function controller(deps: Awaited<ReturnType<typeof dependencies>>, ds: FeatureDataset,
  operators: ControllerOperators, trainIds?: string[], validIds?: string[]): Controller {
  const indices = new Map(ds.sampleIds.map((id, i) => [id, i]));
  return new deps.Controller({ controllerVersion: '1.1.0', methods: deps.methods, operators, digest: deps.hash, targetNames: [ds.targetName],
    resolveFeatures: ({ view }) => {
      if (view.partition === 'fold_train' || view.partition === 'full_train') {
        if (!trainIds) throw new Error('Prediction must never fit.');
        sameOrder(view.sample_ids, trainIds, view.partition);
      }
      if (view.partition === 'fold_validation' && validIds) sameOrder(view.sample_ids, validIds, view.partition);
      const data = new Float64Array(view.sample_ids.length * ds.nFeatures);
      view.sample_ids.forEach((id, row) => {
        const index = indices.get(id);
        if (index === undefined) throw new Error(`Unknown sample '${id}' in DAG view.`);
        data.set(ds.X.subarray(index * ds.nFeatures, (index + 1) * ds.nFeatures), row * ds.nFeatures);
      });
      return { sampleIds: [...view.sample_ids], matrix: { data, rows: view.sample_ids.length, cols: ds.nFeatures } };
    },
    resolveTargets: ({ sampleIds }) => {
      const target = ds.y;
      if (!trainIds || !target) throw new Error('Prediction cannot read targets.');
      const data = Float64Array.from(sampleIds.map(id => {
        const index = indices.get(id);
        if (index === undefined) throw new Error(`Unknown target '${id}'.`);
        return target[index]!;
      }));
      return { sampleIds: [...sampleIds], matrix: { data, rows: sampleIds.length, cols: 1 } };
    },
  });
}


export class PlsCalibrationRefusal extends Error {
  constructor(public readonly candidateIssues: NonNullable<RunResult['candidateIssues']>, reason?: string) {
    super(`No PLS candidates could be scored: ${reason ?? candidateIssues.map(i => `${i.label}: ${i.reason}`).join('; ')}`);
  }
}

export class RidgeCalibrationRefusal extends Error {
  constructor(public readonly candidateIssues: NonNullable<RunResult['candidateIssues']>, reason?: string) {
    super(`No Ridge candidates could be scored: ${reason ?? candidateIssues.map(i => `${i.label}: ${i.reason}`).join('; ')}`);
  }
}

export async function runPlsBank(ds: MaterializedDataset, bank: PlsBank, name: string, id: string): Promise<RunResult> {
  validateCalibrationDataset(ds);
  const lowered = lowerPlsBank(bank, ds.nSamples, ds.nFeatures);
  return runOwnerBank(ds, { chains: lowered.chains, candidateIssues: lowered.candidateIssues,
    labels: bank.screen.map(chain => chain.label), modelAxis: { name: 'components', parameter: 'n_components', values: lowered.components } }, PLS, name, id);
}

export async function runRidgeBank(ds: MaterializedDataset, bank: RidgeBank, name: string, id: string): Promise<RunResult> {
  validateCalibrationDataset(ds);
  const lowered = lowerRidgeBank(bank);
  return runOwnerBank(ds, { chains: lowered.chains, candidateIssues: [], labels: bank.chains.map(chain => chain.label),
    modelAxis: { name: 'alpha', parameter: 'alpha', values: lowered.alphas } }, RIDGE, name, id);
}

/** Shared owner dispatch; profiles supply configuration, split and deployment scope. */
async function runOwnerBank(ds: MaterializedDataset, lowered: LoweredBank, profile: BankProfile, name: string, id: string): Promise<RunResult> {
  if (new Set(ds.sampleIds).size !== ds.nSamples) throw new Error('Calibration requires unique sample identities.');
  const issues = lowered.candidateIssues;
  const refusal = (failures: NonNullable<RunResult['candidateIssues']>, reason?: string) => profile.model === 'pls'
    ? new PlsCalibrationRefusal(failures, reason) : new RidgeCalibrationRefusal(failures, reason);
  if (!lowered.chains.length) throw refusal(issues);
  let deps: Awaited<ReturnType<typeof dependencies>>, served: ReturnType<typeof nativeDataset>;
  try {
    deps = await dependencies();
    served = nativeDataset(deps, ds, ds.sampleIds, { requestId: requestId(profile), nodeId: nodeId(profile), phase: 'FIT_CV' });
  } catch (error) { throw refusal([...issues, ...lowered.chains.map(c => candidateIssue(c.label, 'wasm', error))]); }
  ds = served.dataset;
  const { dag, methods } = deps;
  const { train, valid } = profile.model === 'ridge' ? ridgeSelectionSplit(ds, methods) : (() => {
    const split = methods.computeSplitIndices('KennardStone', { data: ds.X, rows: ds.nSamples, cols: ds.nFeatures }, null, { testSize: 0.25 });
    return { train: Array.from(split.trainIndices), valid: Array.from(split.testIndices) };
  })();
  validateSelectionSplit(train, valid);
  const trainIds = train.map(i => ds.sampleIds[i]!), validIds = valid.map(i => ds.sampleIds[i]!);
  const folds = { id: 'folds:quali.ks', sample_ids: ds.sampleIds, sample_groups: {}, partition_mode: 'resampled',
    folds: [{ fold_id: 'fold:0', train_sample_ids: trainIds, validation_sample_ids: validIds, metadata: {} }] };
  const cvEnvelope = served.envelope, graph = baseGraph(profile);
  const cvController = controller(deps, ds, { [nodeId(profile)]: graph.nodes[0]!.operator }, trainIds, validIds);
  let result: BankResult;
  try {
    const manifests = json([cvController.manifest(dag)]);
    const plan = dag.build_execution_plan_json(`plan:quali.${profile.model}.bank`, json(graph),
      json(campaign(cvEnvelope, profile, { id: 'split:quali.ks', params: {}, fold_set: folds }, lowered)), manifests);
    // One owner call executes the complete ordered bank and sole SELECT.
    result = JSON.parse(dag.execute_single_holdout_bank_json(plan, manifests, json(cvEnvelope), json({
      schema_version: 1, profile: 'single_resampled_holdout_bank.v1', report_profile: REPORT_PROFILE,
      failure_group_dimension: 'chain', target_node: nodeId(profile),
    }), `run:quali.${profile.model}.bank`, '0', cvController.callback)) as BankResult;
  } catch (error) {
    throw refusal([...issues, ...lowered.chains.map(c => candidateIssue(c.label, 'wasm', error))]);
  } finally { cvController.close(); }
  for (const issue of result.chain_issues) issues.push({ label: issue.chain_label, backend: 'wasm', status: 'failed',
    reason: Object.entries(issue.failures).map(([ordinal, error]) => `${ordinal}: ${error}`).join('; ') });
  issues.sort((a, b) => lowered.labels.indexOf(a.label) - lowered.labels.indexOf(b.label));
  const selected = result.selected;
  if (result.status !== 'selected' || !selected || !result.decision) throw refusal(issues, result.refusal ?? undefined);
  sameOrder(selected.training_sample_ids, trainIds, 'Selected KS train');
  sameOrder(selected.validation_sample_ids, validIds, 'Selected KS validation');
  const byOrdinal = new Map(result.variants.map(v => [v.identity.ordinal, v]));
  const winner = byOrdinal.get(selected.identity.ordinal);
  if (!winner?.eligible || !winner.report || !winner.validation_predictions
      || result.decision.selected_candidate_id !== selected.identity.ordinal) throw new Error('DAG returned incomplete winner evidence.');
  const metrics = reportToMetrics(winner.report);
  const chosen = selected.selected_graph;
  // PLS deploys KS-train; Ridge deliberately deploys all labelled rows in row order.
  const deploymentIds = profile.model === 'ridge' ? [...ds.sampleIds] : trainIds;
  const deployment = profile.model === 'ridge' ? 'all-labelled-winner' : 'train-winner';
  const training = nativeDataset(deps, ds, deploymentIds, { requestId: requestId(profile), nodeId: nodeId(profile), phase: 'REFIT' });
  const c = controller(deps, training.dataset, Object.fromEntries(chosen.nodes.map(node => [node.id, node.operator])), deploymentIds);
  let state: DagOwnerState;
  try {
    const trainEnvelope = training.envelope, manifests = json([c.manifest(dag)]);
    // Selected graph comes directly from DAG with every effective parameter frozen.
    const plan = dag.build_execution_plan_json(`plan:quali.${profile.model}.${deployment}`, json(chosen), json(campaign(trainEnvelope, profile)), manifests);
    const refit = JSON.parse(dag.execute_initial_full_refit_json(plan, manifests, json(trainEnvelope), json(deploymentIds),
      `package:quali.${profile.model}`, `run:quali.${profile.model}.${deployment}`, '0', c.callback)) as {
      initial_full_refit_package_json: string; initial_full_refit_package: { outputs: { output_id: string }[] };
    };
    const outputId = refit.initial_full_refit_package.outputs[0]?.output_id;
    if (!outputId || typeof refit.initial_full_refit_package_json !== 'string') throw new Error('DAG did not export an exact portable owner package.');
    const common = { packageJson: refit.initial_full_refit_package_json, outputId, targetName: ds.targetName,
      selectedVariantId: selected.identity.variant_id, trainingSampleIds: [...deploymentIds] };
    if (profile.model === 'ridge') {
      const alpha = selected.identity.params['alpha'];
      if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha <= 0) throw new Error('DAG returned no finite positive selected Ridge alpha.');
      state = { ...common, backendId: 'dag-ml-methods-ridge', selectedOrdinal: selected.identity.ordinal,
        chainLabel: selected.identity.chain_label, params: { alpha }, deploymentScope: 'all_labelled' };
    } else {
      state = { ...common, backendId: 'dag-ml-methods-pls', selectedCandidateId: selected.identity.ordinal };
    }
  } finally { c.close(); }
  const values = predictionValues(winner.validation_predictions, validIds);
  if (profile.model === 'pls') {
    const replay = predictionValues(await replayState(state, ds, validIds), validIds);
    replay.forEach((value, i) => {
      if (!Object.is(value, values[i])) throw new Error('PLS train-only REFIT differs from FIT_CV; owner G4 investigation required.');
    });
  }
  // Ridge performance remains the bank holdout. Deployment resubstitution is never reported.
  const rows = valid.map((r, i) => ({ sampleId: ds.sampleIds[r]!, actual: ds.y[r]!, predicted: values[i]!, residual: values[i]! - ds.y[r]! }));
  // Summaries consume DAG's native ranking; there is no second argmin/SELECT.
  const firstByChain = new Map<string, Evidence>();
  for (const ranked of result.decision.ranked_candidates) {
    const evidence = byOrdinal.get(ranked.candidate_id);
    if (evidence?.eligible && evidence.report && !firstByChain.has(evidence.identity.chain_label)) firstByChain.set(evidence.identity.chain_label, evidence);
  }
  const variants = lowered.chains.flatMap(chain => {
    const evidence = firstByChain.get(chain.label);
    return evidence?.report ? [{ x: chain.chain, label: chain.label, rmse: evidence.report.metrics['rmse']!, selected: chain.label === selected.identity.chain_label }] : [];
  });
  return { id: `${id}-${ds.nSamples}`, pipelineName: name, taskType: 'regression', targetName: ds.targetName,
    refit: { id: 'refit', name: 'Selection validation', kind: 'refit', metrics, ownerReport: winner.report, predictions: rows, status: 'completed' },
    population: { split: profile.model === 'ridge' ? { method: 'KennardStone', n_train: trainIds.length } : { method: 'KennardStone', test_size: 0.25 },
      trainingSampleIds: [...selected.training_sample_ids], validationSampleIds: [...selected.validation_sample_ids], foldId: winner.report.fold_id! },
    folds: [], seed: 0, engine: profile.backendId, scoreMetric: 'rmse', evaluation: { scope: 'selection_validation', independent_test: false },
    candidateIssues: issues, model: { taskType: 'regression', nFeatures: ds.nFeatures, state }, createdAt: new Date().toISOString(), variants,
    variantAxis: { fr: 'screened preprocessing combo', en: 'screened preprocessing combo', categorical: true } };
}

function predictionValues(block: OwnerPredictionBlock, requested: string[]): number[] {
  if (block.sample_ids.length !== requested.length || new Set(block.sample_ids).size !== requested.length
      || block.values.length !== requested.length) throw new Error('DAG returned an incomplete owner prediction cohort.');
  const byId = new Map(block.sample_ids.map((id, i) => [id, block.values[i]?.[0]]));
  return requested.map(id => {
    const value = byId.get(id);
    if (value === undefined || !Number.isFinite(value)) throw new Error(`Missing finite owner prediction for '${id}'.`);
    return value;
  });
}

async function replayState(state: DagOwnerState, ds: FeatureDataset, ids: string[]): Promise<OwnerPredictionBlock> {
  const deps = await dependencies(), { dag } = deps;
  dag.validate_initial_full_refit_package_json(state.packageJson);
  const pkg = JSON.parse(state.packageJson) as { effective_plan: { graph_plan: { graph: OwnerGraph } } };
  const c = controller(deps, ds, Object.fromEntries(pkg.effective_plan.graph_plan.graph.nodes.map(node => [node.id, node.operator])));
  try {
    const positions = new Map(ds.sampleIds.map((id, i) => [id, i]));
    const content = new Float64Array(ids.length * ds.nFeatures);
    ids.forEach((id, row) => {
      const i = positions.get(id);
      if (i === undefined) throw new Error(`Unknown prediction sample '${id}'.`);
      content.set(ds.X.subarray(i * ds.nFeatures, (i + 1) * ds.nFeatures), row * ds.nFeatures);
    });
    const predictEnvelope = dag.initial_full_refit_predict_envelope_json(state.packageJson, json({ role: 'inference',
      relations: predictionRelations(ds, ids), target_names: [state.targetName], data_content_fingerprint: numericFingerprint(deps.hash, content) }));
    const result = JSON.parse(dag.replay_initial_full_refit_json(state.packageJson, predictEnvelope, json([state.outputId]), '{}', `run:quali.${state.backendId === 'dag-ml-methods-ridge' ? 'ridge' : 'pls'}.predict`, c.callback)) as {
      replay_outcome: { outputs: { prediction: OwnerPredictionBlock }[] };
    };
    const prediction = result.replay_outcome.outputs[0]?.prediction;
    if (!prediction) throw new Error('DAG returned no owner prediction block.');
    predictionValues(prediction, ids);
    return prediction;
  } finally { c.close(); }
}

export async function predictDagModel(model: FittedModel, X: Float64Array, n: number, p: number, context?: PredictionContext): Promise<PredictResult> {
  if (p !== model.nFeatures || X.length !== n * p || !Number.isInteger(n) || n < 1 || !X.every(Number.isFinite)) throw new Error('Owner prediction requires finite spectra with the fitted feature width.');
  const state = model.state as DagOwnerState;
  if (!state || !['dag-ml-methods-pls', 'dag-ml-methods-ridge'].includes(state.backendId)) throw new Error('Unsupported owner fitted-model backend.');
  const ids = context ? predictionIds(context, n) : Array.from({ length: n }, (_, i) => `predict:${i}`);
  const ds: FeatureDataset = { X, nSamples: n, nFeatures: p, sampleIds: ids, axis: [], axisUnit: '',
    targetName: state.targetName, taskType: 'regression', partitions: Array(n).fill('predict') };
  const block = await replayState(state, ds, ids);
  const result = { values: Float64Array.from(predictionValues(block, ids)), sampleIds: ids, predictionBlock: block };
  return context ? scoreKnownPredictions(result, context) : result;
}

// Retained export name for the frozen PLS consumer; both names use one replay path.
export { predictDagModel as predictDagPls };

export const dagEngine: LabEngine = {
  name: 'dag-ml-methods', runPlsBank, runRidgeBank,
  async run(ds: MaterializedDataset, dsl: PipelineDSL) {
    if (dsl.model && dsl.model.type !== 'PLS') throw new Error(`Unsupported DAG model '${dsl.model.type}'.`);
    for (const key of Object.keys(dsl.model?.params ?? {})) if (key !== 'n_components') throw new Error(`Unsupported PLS parameter '${key}'.`);
    return runPlsBank(ds, { screen: [{ label: dsl.name, steps: dsl.steps }], maxComp: (dsl.model?.params['n_components'] ?? 10) as number }, dsl.name, 'pls');
  },
  predict: predictDagModel,
};
