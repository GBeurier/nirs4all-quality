import { validateDataset, type MaterializedDataset } from './port.js';

type Dmd = typeof import('dag-ml-data-wasm');
export type OwnerHash = typeof import('@nirs4all/datasets-wasm')['sha256'];
let loaded: Promise<{ dmd: Dmd; hash: OwnerHash }> | undefined;

/** Actual staged data owners; a missing owner is an explicit loading failure. */
export function loadDataOwners() {
  loaded ??= (async () => {
    const [dmd, datasets] = await Promise.all([import('dag-ml-data-wasm'), import('@nirs4all/datasets-wasm')]);
    await Promise.all([dmd.default(), datasets.default()]);
    return { dmd, hash: datasets.sha256 };
  })();
  return loaded;
}

export interface DataEnvelope {
  schema_version: number;
  schema_fingerprint: string;
  plan_fingerprint: string;
  relation_fingerprint: string;
  data_content_fingerprint: string;
  target_content_fingerprint: string;
  plan: { output_representation: string };
  coordinator_relations: unknown;
  [key: string]: unknown;
}
export interface DataRequest {
  requestId: string;
  nodeId: string;
  phase: 'FIT_CV' | 'REFIT';
}

/** Byte transport only; SHA-256 is the existing Datasets owner implementation. */
export function numericFingerprint(hash: OwnerHash, values: Float64Array): string {
  return hash(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

/** Project original rows by their declared IDs, retaining the requested fit order. */
export function orderedCohort(ds: MaterializedDataset, ids: string[]): MaterializedDataset {
  validateDataset(ds);
  if (ds.partitions.length !== ds.nSamples || ds.groupIds && ds.groupIds.length !== ds.nSamples) {
    throw new Error('DMD cohort metadata must align with the original sample rows.');
  }
  const positions = new Map(ds.sampleIds.map((id, i) => [id, i]));
  if (!ids.length || positions.size !== ds.nSamples || new Set(ids).size !== ids.length) {
    throw new Error('A DMD cohort requires distinct declared sample IDs.');
  }
  const rows = ids.map(id => {
    const row = positions.get(id);
    if (row === undefined) throw new Error(`Unknown DMD cohort sample '${id}'.`);
    return row;
  });
  const X = new Float64Array(ids.length * ds.nFeatures);
  rows.forEach((row, i) => X.set(ds.X.subarray(row * ds.nFeatures, (row + 1) * ds.nFeatures), i * ds.nFeatures));
  return { ...ds, X, y: Float64Array.from(rows, row => ds.y[row]!), nSamples: ids.length,
    sampleIds: [...ids], partitions: rows.map(row => ds.partitions[row]!),
    ...(ds.groupIds ? { groupIds: rows.map(row => ds.groupIds![row]!) } : {}) };
}

/** The current Quali profile declares one dense independent observation per sample.
 * Stable sample IDs are also its explicitly synthetic 1:1 observation IDs. Only
 * supplied groups are retained; no origin or stronger grouping is inferred. */
export function nativeDataset(owners: { dmd: Dmd; hash: OwnerHash }, source: MaterializedDataset,
  ids: string[], request: DataRequest): { dataset: MaterializedDataset; envelope: DataEnvelope } {
  const ds = orderedCohort(source, ids), { dmd, hash } = owners;
  if (ds.axis.length !== ds.nFeatures) throw new Error('DMD requires the declared spectral axis to match the feature width.');
  const featureNames = ds.axis.map(String);
  const sampleAxis = { name: 'sample', kind: 'sample', unit: null, size: ds.nSamples, variable: false };
  const schema = {
    dataset_id: 'quali', sample_ids: ds.sampleIds,
    sources: [{ id: 'nir', name: 'NIR spectrum', type_id: 'dense_signal', modality: 'spectroscopy',
      native_representation: { id: 'signal_1d', type_id: 'dense_signal', rank: 2,
        axes: [sampleAxis, { name: 'wavelength', kind: 'wavelength', unit: ds.axisUnit, size: ds.nFeatures, variable: false,
          coordinate: { dtype: 'numeric', ordered: true, values: { kind: 'explicit', values: ds.axis } } }],
        container: 'ndarray', dtype: 'float64', sparse: false, ragged: false },
      sample_key: 'sample_id', granularity: 'per_sample', schema: {}, tags: {} }],
    targets: { y: { id: 'tabular_numeric', type_id: 'table', rank: 2,
      axes: [sampleAxis, { name: 'target', kind: 'target', unit: null, size: 1, variable: false,
        coordinate: { dtype: 'categorical', ordered: false, values: { kind: 'explicit', values: [ds.targetName] } } }],
      container: 'dataframe', dtype: 'float64', sparse: false, ragged: false } },
    metadata: {},
  };
  const relations = { rows: ds.sampleIds.map((id, row) => ({ observation_id: id, sample_id: id,
    source_id: 'nir', target_id: 'y', group_id: ds.groupIds?.[row] ?? null, origin_id: null, repetition_id: null,
    augmented: false, excluded: false, metadata: { partition: ds.partitions[row],
      identity_profile: 'quali.one_observation_per_sample.v1', identity_basis: 'positional', observation_id_basis: 'synthetic_1_to_1_from_declared_sample_id' } })) };
  const schemaJson = JSON.stringify(schema);
  const planJson = dmd.plan_model_input_json(schemaJson, dmd.tabular_numeric_model_input_spec_json(),
    dmd.builtin_adapter_registry_json(), JSON.stringify({ id: request.requestId, source_ids: ['nir'] }));
  const envelope: DataEnvelope = JSON.parse(dmd.build_coordinator_data_plan_envelope_json(schemaJson, planJson, JSON.stringify(relations)));
  const targetTables = [{ target_id: 'y', values: ds.sampleIds.map((id, row) => ({ sample_id: id, value: ds.y[row] })) }];
  const provider = dmd.WasmInMemoryProvider.withF64Features(JSON.stringify(envelope), JSON.stringify(targetTables),
    JSON.stringify({ feature_set_id: 'x', representation_id: envelope.plan.output_representation,
      feature_names: featureNames, observation_ids: ds.sampleIds }), ds.X);
  let data: string | null = null, view: string | null = null;
  try {
    data = provider.materialize(JSON.stringify({ run_id: 'run:quali.data', node_id: request.nodeId, input_name: 'x',
      phase: request.phase, request_id: request.requestId, schema_fingerprint: envelope.schema_fingerprint,
      plan_fingerprint: envelope.plan_fingerprint, relation_fingerprint: envelope.relation_fingerprint,
      output_representation: envelope.plan.output_representation, source_ids: ['nir'], require_relations: true }));
    view = provider.make_view(data, JSON.stringify({ sample_ids: ds.sampleIds, include_augmented: false, include_excluded: false }));
    const block = provider.featureBlockF64(view, 'x');
    const layoutJson = block.layout, values = block.into_values();
    const layout: { observation_ids: string[]; sample_ids: string[]; feature_names: string[]; n_rows: number; n_cols: number } = JSON.parse(layoutJson);
    if (layout.n_rows !== ds.nSamples || layout.n_cols !== ds.nFeatures || values.length !== ds.X.length
        || layout.observation_ids.length !== ds.nSamples || layout.sample_ids.length !== ds.nSamples
        || new Set(layout.observation_ids).size !== ds.nSamples
        || JSON.stringify(layout.feature_names) !== JSON.stringify(featureNames)) throw new Error('DMD returned incomplete feature identities or dimensions.');
    const positions = new Map(layout.observation_ids.map((id, row) => [id, row]));
    const X = new Float64Array(ds.X.length);
    ds.sampleIds.forEach((id, row) => {
      const position = positions.get(id);
      if (position === undefined || layout.sample_ids[position] !== id) throw new Error(`DMD did not preserve sample/observation '${id}'.`);
      X.set(values.subarray(position * ds.nFeatures, (position + 1) * ds.nFeatures), row * ds.nFeatures);
    });
    const targets: { sample_ids: string[]; values: number[] } = JSON.parse(provider.target_block(view, 'y'));
    if (targets.sample_ids.length !== ds.nSamples || targets.values.length !== ds.nSamples
        || new Set(targets.sample_ids).size !== ds.nSamples) throw new Error('DMD returned incomplete target identities.');
    const byId = new Map(targets.sample_ids.map((id, row) => [id, targets.values[row]]));
    const y = Float64Array.from(ds.sampleIds, id => {
      const value = byId.get(id);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`DMD returned no finite target for '${id}'.`);
      return value;
    });
    // Keep DMD's schema/plan/source S and exact derived records. C belongs to DAG.
    envelope.data_content_fingerprint = numericFingerprint(hash, X);
    envelope.target_content_fingerprint = numericFingerprint(hash, y);
    return { dataset: { ...ds, X, y }, envelope };
  } finally {
    if (view !== null) provider.release(view);
    if (data !== null) provider.release(data);
    provider.free();
  }
}
