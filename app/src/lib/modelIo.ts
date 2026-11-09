// Quali's bounded host profile in a real Core V1 storage container.
// packageJson is inspected read-only and always transported as its exact string.
import { openN4aContainer, writeN4aContainer, type N4aSource } from 'nirs4all';
import type { FittedModel, SelectionPopulation } from '@/engine/port';
import type { StoredModel } from '@/store/store';
import { loadDag } from '@/engine/dagRuntime';
import { refuseLegacyState } from '@/engine/legacyState';
import { artifactDigest } from '@/engine/artifactDigest';
import { isOwnerReport, reportToMetrics } from '@/engine/ownerReports';
import { CALIB_VARIANTS } from '@/engine/variants';
import { lowerPlsBank } from '@/engine/ownerRecipes';
import { lowerRidgeBank } from '@/engine/ownerRidgeBanks';

export const QUALI_HOST = { owner: 'nirs4all.quali-host', feature: 'nirs4all-quali-host@1',
  schema: 'nirs4all.quali-host.bundle', version: 1, path: 'host/bundle.json',
  entrypoint: 'host-predict', operation: 'host.predict', fingerprintProfile: 'sha256.raw.v1' } as const;

// Boundary records are unknown until the checks below admit each used field.
type RecordValue = Record<string, any>;
function record(value: unknown): value is RecordValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function keys(value: unknown, expected: string[]): boolean {
  return record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]));
  if (record(a) && record(b)) return keys(a, Object.keys(b)) && Object.keys(b).every(key => same(a[key], b[key]));
  return a === b;
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 2 && value.every(id => typeof id === 'string' && !!id) && new Set(value).size === value.length;
}
function evaluation(value: unknown): boolean {
  return record(value) && typeof value.independent_test === 'boolean'
    && (value.scope === 'independent_test' ? value.independent_test : ['training', 'selection_validation'].includes(value.scope) && !value.independent_test);
}
function admitPopulation(value: unknown, report: RecordValue): asserts value is SelectionPopulation {
  requireValue(record(value) && keys(value, ['split', 'trainingSampleIds', 'validationSampleIds', 'foldId'])
    && ids(value.trainingSampleIds) && ids(value.validationSampleIds)
    && value.validationSampleIds.every((id: string) => !value.trainingSampleIds.includes(id))
    && typeof value.foldId === 'string' && value.foldId === report.fold_id
    && value.validationSampleIds.length === report.row_count && report.partition === 'validation', 'Invalid owner selection population.');
  requireValue(record(value.split) && value.split.method === 'KennardStone', 'Unsupported selection split.');
}

/** Finite reviewed recipes only. These specific fitted states retain no training
 * rows; IDs, graph, parameters and reports remain in the file. No retention opt-in.
 * DAG validates its sealed package; Methods validates actual fitted states at replay.
 */
function admitBundle(value: unknown): StoredModel {
  requireValue(record(value) && value.schema === QUALI_HOST.schema && value.schema_version === 1, 'Unsupported Quali host schema/version.');
  const bundle = value, model = bundle.model;
  requireValue(record(model) && record(model.state), 'Missing fitted owner model.');
  const state = model.state;
  refuseLegacyState(state.backendId);
  const ridge = state.backendId === 'dag-ml-methods-ridge';
  requireValue(ridge || state.backendId === 'dag-ml-methods-pls', 'Unsupported fitted owner family; recalibrate without changing the original file.');
  const stateKeys = ridge
    ? ['backendId', 'packageJson', 'targetName', 'outputId', 'selectedOrdinal', 'selectedVariantId', 'chainLabel', 'params', 'deploymentScope', 'trainingSampleIds']
    : ['backendId', 'packageJson', 'targetName', 'outputId', 'selectedCandidateId', 'selectedVariantId', 'trainingSampleIds'];
  requireValue(keys(state, stateKeys) && typeof state.packageJson === 'string' && !!state.packageJson
    && ['targetName', 'outputId', 'selectedVariantId'].every(key => typeof state[key] === 'string' && !!state[key])
    && ids(state.trainingSampleIds), 'Invalid exact-key owner state.');
  requireValue(model.taskType === 'regression' && Number.isSafeInteger(model.nFeatures) && model.nFeatures > 0
    && bundle.nFeatures === model.nFeatures && bundle.engine === state.backendId && bundle.targetName === state.targetName
    && Array.isArray(bundle.yRange) && bundle.yRange.length === 2 && bundle.yRange.every(Number.isFinite)
    && bundle.yRange[0] <= bundle.yRange[1], 'Invalid feature, target or range identity.');
  requireValue(isOwnerReport(bundle.ownerReport) && same(bundle.ownerReport.target_names, [state.targetName])
    && evaluation(bundle.evaluation) && typeof bundle.createdAt === 'string' && typeof bundle.engine === 'string'
    && typeof bundle.pipeline === 'string', 'Invalid owner report or evaluation metadata.');
  admitPopulation(bundle.population, bundle.ownerReport);
  const population = bundle.population;
  const total = population.trainingSampleIds.length + population.validationSampleIds.length;
  requireValue(['pls-cart', 'fast-aom-pls', 'slow-aom-pls', 'ridge-cart', 'fast-aom-ridge', 'slow-aom-ridge'].includes(bundle.selectedProfileId), 'Unsupported declared Quali profile.');
  const variant = CALIB_VARIANTS.find(candidate => candidate.id === bundle.selectedProfileId);
  requireValue(variant && (variant.spec.kind === 'js_ridge_screen') === ridge, 'Unsupported declared Quali profile.');
  const lowered = variant.spec.kind === 'js_ridge_screen' ? lowerRidgeBank(variant.spec) : lowerPlsBank(variant.spec, total, model.nFeatures);
  const parameter = ridge ? 'alpha' : 'n_components';
  const axis = 'alphas' in lowered ? lowered.alphas : lowered.components;
  // Inspection never replaces, normalizes or serializes state.packageJson.
  const pkg = JSON.parse(state.packageJson);
  const graph = pkg?.effective_plan?.graph_plan?.graph;
  requireValue(pkg?.schema_version === 1 && same(pkg.training_sample_ids, state.trainingSampleIds)
    && Array.isArray(pkg.outputs) && pkg.outputs.length === 1 && pkg.outputs[0].output_id === state.outputId
    && record(graph) && Array.isArray(graph.nodes) && graph.nodes.length === 1
    && Array.isArray(graph.edges) && graph.edges.length === 0, 'Owner package bindings or graph differ from the qualified profile.');
  const node = graph.nodes[0];
  requireValue(node.id === `model:quali.${ridge ? 'ridge' : 'pls'}` && node.kind === 'model'
    && same(node.operator, { type: 'N4mRolePipeline' })
    && Array.isArray(node.ports?.inputs) && node.ports.inputs.length === 1
    && node.ports.inputs[0].name === 'x' && node.ports.inputs[0].kind === 'data'
    && node.ports.inputs[0].representation === 'tabular_numeric' && node.ports.inputs[0].cardinality === 'one'
    && Array.isArray(node.ports.outputs) && node.ports.outputs.length === 1
    && node.ports.outputs[0].name === 'oof' && node.ports.outputs[0].kind === 'prediction'
    && node.ports.outputs[0].cardinality === 'one' && node.ports.outputs[0].representation === null
    && pkg.outputs[0].node_id === node.id && pkg.outputs[0].port_name === 'oof'
    && keys(node.params, ['pipeline_steps_v1', parameter]), 'Unqualified owner graph/operator/parameters.');
  const chain = lowered.chains.findIndex(candidate => same(candidate.steps, node.params.pipeline_steps_v1));
  const axisIndex = axis.indexOf(node.params[parameter]);
  requireValue(chain >= 0 && axisIndex >= 0, 'Owner recipe or model parameter is outside the reviewed finite bank.');
  const ordinal = `ord:${String(chain * axis.length + axisIndex).padStart(5, '0')}`;
  requireValue((ridge ? state.selectedOrdinal : state.selectedCandidateId) === ordinal, 'Selected ordinal differs from the declared bank parameters.');
  requireValue(bundle.ownerReport.variant_id === state.selectedVariantId && bundle.ownerReport.producer_node === node.id, 'Selected variant/node identity differs from the owner report.');
  if (ridge) {
    requireValue(keys(population.split, ['method', 'n_train']) && 'n_train' in population.split && population.split.n_train === Math.max(2, Math.round(total * 0.75))
      && population.split.n_train === population.trainingSampleIds.length && state.deploymentScope === 'all_labelled'
      && keys(state.params, ['alpha']) && state.params.alpha === node.params.alpha
      && state.chainLabel === lowered.chains[chain]!.label
      && state.trainingSampleIds.length === total
      && [...population.trainingSampleIds, ...population.validationSampleIds].every(id => state.trainingSampleIds.includes(id)), 'Ridge deployment/holdout scopes disagree.');
  } else {
    requireValue(keys(population.split, ['method', 'test_size']) && 'test_size' in population.split && population.split.test_size === 0.25
      && population.trainingSampleIds.length === Math.floor(total * 0.75)
      && same(state.trainingSampleIds, population.trainingSampleIds), 'PLS requires its exact greedy KS-train deployment scope.');
  }
  requireValue(same(bundle.metrics, reportToMetrics(bundle.ownerReport)) && Array.isArray(bundle.leaderboard) && bundle.leaderboard.length > 0
    && bundle.leaderboard.some((row: unknown) => record(row) && row.profileId === bundle.selectedProfileId
      && same(row.ownerReport, bundle.ownerReport) && same(row.population, bundle.population)) && bundle.leaderboard.every((row: unknown) => {
    if (!record(row) || !isOwnerReport(row.ownerReport) || !evaluation(row.evaluation)) return false;
    try { admitPopulation(row.population, row.ownerReport); return true; } catch { return false; }
  }) && Array.isArray(bundle.candidateIssues) && Array.isArray(bundle.failedPipelines), 'Missing reports, population or failure provenance.');
  return { model: model as FittedModel, engine: bundle.engine, pipelineName: bundle.pipeline,
    metrics: reportToMetrics(bundle.ownerReport), ownerReport: bundle.ownerReport,
    evaluation: bundle.evaluation, evaluationDeclaredOnly: true, population,
    selectedProfileId: bundle.selectedProfileId, sourceBundle: bundle,
    nFeatures: model.nFeatures, yRange: bundle.yRange as [number, number], createdAt: bundle.createdAt };
}

export function qualiHostManifest(fingerprint: string): Record<string, unknown> {
  const h = QUALI_HOST;
  return { schema: 'nirs4all.n4a.container.v1', schema_version: 1, minimum_reader_version: 1,
    container_id: `container:quali.${crypto.randomUUID()}`, physical_profile: 'zip-stored.v1', required_features: [h.feature],
    members: [{ path: h.path, byte_length: 0, sha256: '0'.repeat(64) }], links: [],
    artifacts: [{ id: h.path, kind: 'model', owner: h.owner, content_type: { id: h.schema, version: 1 },
      identity: { owner: h.owner, schema: h.schema, schema_version: 1, fingerprint_profile: h.fingerprintProfile, fingerprint },
      storage: { kind: 'embedded', root_member: h.path, member_paths: [h.path] }, requirements: null }],
    entrypoints: [{ id: h.entrypoint, owner: h.owner, operation: h.operation, root_artifact: h.path,
      input_artifacts: [], required_features: [h.feature], requirements: null }] };
}

export async function exportModelContainer(bundle: unknown): Promise<Uint8Array> {
  const admitted = admitBundle(bundle);
  const dag = await loadDag();
  dag.validate_initial_full_refit_package_json((admitted.model.state as { packageJson: string }).packageJson);
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const fingerprint = artifactDigest(bytes);
  const { archiveBytes, receipt } = await writeN4aContainer(qualiHostManifest(fingerprint), [{ path: QUALI_HOST.path, bytes }]);
  requireValue(receipt.members.length === 1 && receipt.members[0]?.path === QUALI_HOST.path
    && receipt.members[0]?.sha256 === fingerprint, 'Core receipt differs from the exact host payload; export discarded.');
  return archiveBytes;
}

export async function importModelContainer(source: N4aSource): Promise<{ model: StoredModel } | { error: string }> {
  try {
    const container = await openN4aContainer(source); // Core physical/inventory admission first, once.
    try {
      const manifest = container.view().readability.manifest;
      const h = QUALI_HOST, artifact = manifest.artifacts?.[0], entry = manifest.entrypoints?.[0], member = manifest.members?.[0];
      requireValue(manifest.schema === 'nirs4all.n4a.container.v1' && manifest.schema_version === 1
        && manifest.physical_profile === 'zip-stored.v1' && same(manifest.required_features, [h.feature])
        && same(manifest.links, []) && manifest.members?.length === 1 && member.path === h.path
        && manifest.artifacts?.length === 1 && artifact.id === h.path && artifact.owner === h.owner
        && same(artifact.content_type, { id: h.schema, version: 1 })
        && same(artifact.identity, { owner: h.owner, schema: h.schema, schema_version: 1,
          fingerprint_profile: h.fingerprintProfile, fingerprint: member.sha256 })
        && same(artifact.storage, { kind: 'embedded', root_member: h.path, member_paths: [h.path] })
        && artifact.requirements === null && manifest.entrypoints?.length === 1
        && same(entry, { id: h.entrypoint, owner: h.owner, operation: h.operation, root_artifact: h.path,
          input_artifacts: [], required_features: [h.feature], requirements: null }), 'Readable container is not the supported Quali host-predict profile.');
      const payload = await container.readMember(h.path);
      requireValue(payload, 'Missing verified Quali host member.');
      const model = admitBundle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)));
      const exact = (model.model.state as { packageJson: string }).packageJson;
      const dag = await loadDag();
      dag.validate_initial_full_refit_package_json(exact);
      requireValue((model.model.state as { packageJson: string }).packageJson === exact, 'Exact owner package string changed during admission.');
      return { model };
    } finally { container.close(); }
  } catch (error) {
    return { error: `Quali imports only its qualified Core V1 host container. Legacy raw JSON and Core-JS/js-state files require recalibration; originals are unchanged. ${error instanceof Error ? error.message : String(error)}` };
  }
}
