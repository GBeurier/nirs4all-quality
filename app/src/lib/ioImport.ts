// Setup host orchestration only. IO owns parsing, inference and assembly.
import type { AssembledDataset, ConfirmedLock, NamedFile, Proposal, ProposeResult } from '../../../../nirs4all-io/bindings/wasm/types/nirs4all-io';
import { numericCoordinates } from '@quali/io-import-numeric';
import type { Sample } from '@/domain/model';
import type { SpectraDataset } from '@/domain/spectra';
import type { DatasetPreviewView } from 'nirs4all-ui/dataset';
import type { OwnerProposalDisplay } from 'nirs4all-ui/datasetBuilder';

export interface ImportBinding extends NamedFile {
  /** UI handle, never an observation/sample identity. */
  bindingId: string;
  bytesSha256: string;
}

export interface ImportStage {
  wasm_sha256: string;
  loader_sha256: string;
  companion_sha256: string;
  companion_declaration_sha256: string;
  public_types_sha256: string;
  publication_claimed: false;
}

export interface TargetRowConfirmation {
  targetBindingId: string;
  targetBytesSha256: string;
  rows: { row: number; sampleId: string }[];
}

/** Presentation facts read from IO results, separate from the retained owner objects. */
export interface MappingContext {
  targetSourceId: string;
  anchorSourceId: string;
  targetBindingId: string;
  targetBytesSha256: string;
  targetName: string;
  sampleIdColumn: string;
  sampleIds: string[];
  rowCount: number;
  targetColumns: string[];
  delimiter: string;
  baseAssembly: AssembledDataset;
  targetInspection: AssembledDataset;
}

export interface ImportDiagnostic {
  phase: 'runtime' | 'proposal' | 'validation' | 'assembly' | 'mapping';
  message: string;
}

export interface ImportAttempt {
  revision: number;
  specJson: string;
  diagnostics: ImportDiagnostic[];
}

export interface RetainedImport {
  importedAt: string;
  revision: number;
  status: 'idle' | 'pending' | 'ready' | 'refused';
  files: ImportBinding[];
  /** Exact user/owner JSON before the optional explicit witness is applied. */
  reviewSpecJson: string;
  /** A deliberately cleared editor must refuse, not regenerate inferred JSON. */
  specEdited: boolean;
  /** Exact JSON submitted to validate/assembleDataset. */
  specJson: string;
  proposal: ProposeResult | null;
  confirmed: ConfirmedLock[];
  diagnostics: ImportDiagnostic[];
  attempts: ImportAttempt[];
  validationSucceeded: boolean;
  /** Unmodified owner object, including unknown fields and logical typed arrays. */
  assembled: AssembledDataset | null;
  mapping: MappingContext | null;
  targetConfirmation: TargetRowConfirmation | null;
  witness: ImportBinding | null;
  ioVersion: string | null;
  stage: ImportStage | null;
}

/** The IO public type handshake supplies every owner operation and DTO. */
export type ImportOwner = Pick<typeof import('../../../../nirs4all-io/bindings/wasm/types/nirs4all-io'),
  'version' | 'proposeDataset' | 'validate' | 'assembleDataset'>;

export function emptyImport(): RetainedImport {
  return {
    importedAt: new Date().toISOString(), revision: 0, status: 'idle', files: [], reviewSpecJson: '', specEdited: false, specJson: '',
    proposal: null, confirmed: [], diagnostics: [], attempts: [],
    validationSucceeded: false, assembled: null, mapping: null,
    targetConfirmation: null, witness: null, ioVersion: null, stage: null,
  };
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A checked view for presentation/field edits; never replaces a retained IO object. */
export function objectFields(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const items = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown): string[] => items(value).filter((v): v is string => typeof v === 'string');

export function readSpec(text: string): Record<string, unknown> {
  const value = objectFields(JSON.parse(text));
  if (!value || !Array.isArray(value.sources)) throw new Error('The IO specification must be an object with sources.');
  return value;
}

function sources(spec: Record<string, unknown>): Record<string, unknown>[] {
  return items(spec.sources).flatMap((value) => { const s = objectFields(value); return s ? [s] : []; });
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

export async function readImportFiles(files: File[]): Promise<ImportBinding[]> {
  return Promise.all(files.map(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { name: file.name, bytes, bytesSha256: await sha256(bytes), bindingId: crypto.randomUUID() };
  }));
}

/** Every input change makes an older successful result ineligible immediately. */
export function invalidateImport(record: RetainedImport): RetainedImport {
  return {
    ...record, revision: record.revision + 1, status: record.files.length ? 'pending' : 'idle',
    specJson: record.reviewSpecJson, assembled: null, validationSucceeded: false,
    diagnostics: [], mapping: null, witness: null, targetConfirmation: null,
  };
}

export function replaceBindings(record: RetainedImport, added: ImportBinding[], removeName?: string): RetainedImport {
  const byName = new Map(record.files.filter((f) => f.name !== removeName).map((f) => [f.name, f]));
  for (const file of added) byName.set(file.name, file);
  // Keep the prior owner proposal only as the delta baseline. Its controls are
  // disabled while pending; independent/unknown spec fields must survive.
  return invalidateImport({ ...record, files: [...byName.values()], confirmed: [] });
}

/** Apply only differences returned by IO, retaining unrelated/unknown user fields. */
function applyOwnerDelta(current: unknown, before: unknown, after: unknown, key = ''): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return current;
  if (key === 'sources' && Array.isArray(current) && Array.isArray(before) && Array.isArray(after)) {
    const previous = new Map(before.map((s) => [objectFields(s)?.id, s]));
    const next = new Map(after.map((s) => [objectFields(s)?.id, s]));
    const retained = current.filter((s) => !previous.has(objectFields(s)?.id) || next.has(objectFields(s)?.id));
    const merged = retained.map((s) => {
      const id = objectFields(s)?.id;
      return next.has(id) ? applyOwnerDelta(s, previous.get(id), next.get(id)) : s;
    });
    const ids = new Set(retained.map((s) => objectFields(s)?.id));
    return [...merged, ...after.filter((s) => !ids.has(objectFields(s)?.id))];
  }
  const oldObject = objectFields(before), nextObject = objectFields(after), currentObject = objectFields(current);
  if (oldObject && nextObject && currentObject) {
    const result = { ...currentObject };
    for (const field of new Set([...Object.keys(oldObject), ...Object.keys(nextObject)])) {
      if (JSON.stringify(oldObject[field]) === JSON.stringify(nextObject[field])) continue;
      if (!Object.hasOwn(nextObject, field)) delete result[field];
      else result[field] = applyOwnerDelta(currentObject[field], oldObject[field], nextObject[field], field);
    }
    return result;
  }
  return after;
}

function blocksOf(assembly: unknown): Record<string, unknown>[] {
  const blocks = objectFields(objectFields(assembly)?.blocks);
  if (!blocks) return [];
  const order = strings(objectFields(assembly)?.partition_order);
  const values = order.length ? order.map((name) => blocks[name]) : Object.values(blocks);
  return values.flatMap((b) => { const block = objectFields(b); return block ? [block] : []; });
}

function declaredSampleColumn(assembly: unknown): string | null {
  const identity = objectFields(objectFields(assembly)?.identity);
  const column = objectFields(identity?.provenance)?.sample_id;
  return typeof column === 'string' && column.length ? column : null;
}

function sampleValues(assembly: unknown, column: string): unknown[] {
  return blocksOf(assembly).flatMap((block) => {
    const metadata = objectFields(block.metadata);
    const matches = items(metadata?.columns).map(objectFields).filter((c) => c?.name === column);
    return matches.length === 1 ? items(matches[0]?.values) : [];
  });
}

/** Separate owner-only inspections provide mapping facts even when the full join refuses. */
function prepareMapping(owner: ImportOwner, record: RetainedImport, spec: Record<string, unknown>): MappingContext | null {
  const allSources = sources(spec);
  const targets = allSources.filter((s) => s.role === 'targets' || items(s.columns).some((c) => objectFields(c)?.role === 'targets'));
  if (targets.length !== 1) return null;
  const target = targets[0]!;
  const file = record.files.find((f) => target.input === f.name);
  if (!file || typeof target.id !== 'string') return null;
  const baseSpec = { ...spec, sources: allSources.filter((s) => s.id !== target.id) };
  const baseJson = JSON.stringify(baseSpec);
  owner.validate(baseJson);
  const baseAssembly = owner.assembleDataset(record.files, [], baseJson);
  const sampleIdColumn = declaredSampleColumn(baseAssembly);
  if (!sampleIdColumn) throw new Error('Mapping requires a declared sample-ID metadata column. Anonymous IDs cannot create a lab project.');
  const values = sampleValues(baseAssembly, sampleIdColumn);
  if (!values.length || values.some((v) => typeof v !== 'string' || !v.trim())) {
    throw new Error('Mapping requires nonempty string sample IDs from IO. Numeric-only IDs are not supported; values are never converted.');
  }
  const sampleIds = [...new Set(values.filter((v): v is string => typeof v === 'string'))];
  const anchor = allSources.find((s) => s.role === 'features' || items(s.columns).some((c) => objectFields(c)?.role === 'features'));
  if (!anchor || typeof anchor.id !== 'string') return null;
  const params = { ...objectFields(spec.params), ...objectFields(target.params) };
  if (typeof params.delimiter !== 'string' || params.delimiter.length !== 1) {
    throw new Error('Declare the target delimiter in the IO specification before confirming target-row identities.');
  }
  if (params.has_header !== true) throw new Error('Explicit target-row mapping requires a declared target header. Configure has_header in IO first.');
  // Inspection only: ask IO to read the target's numeric columns as a standalone
  // table. Row positions below refer to this table, never to observation identity.
  const inspectionSource: Record<string, unknown> = { ...target, input: file.name, role: 'features' };
  for (const field of ['kind', 'key', 'join', 'columns', 'partition', 'merge']) delete inspectionSource[field];
  const inspectionSpec: Record<string, unknown> = { ...spec, sources: [inspectionSource] };
  for (const field of ['sample_index', 'repetition', 'partitions', 'folds', 'aggregate']) delete inspectionSpec[field];
  const inspectionJson = JSON.stringify(inspectionSpec);
  owner.validate(inspectionJson);
  const targetInspection = owner.assembleDataset([file], [], inspectionJson);
  const inspectionBlocks = blocksOf(targetInspection);
  if (inspectionBlocks.length !== 1) throw new Error('Target inspection must produce one table.');
  const block = inspectionBlocks[0]!;
  const rowCount = block.n_samples;
  const targetColumns = strings(items(block.feature_headers)[0]);
  if (typeof rowCount !== 'number' || !Number.isSafeInteger(rowCount) || rowCount <= 0 || !targetColumns.length) {
    throw new Error('IO did not expose target row counts and headers for explicit mapping.');
  }
  if (targetColumns.includes(sampleIdColumn)) throw new Error('The target already contains the sample-ID column; configure its keyed join directly.');
  return {
    targetSourceId: target.id, anchorSourceId: anchor.id, targetBindingId: file.bindingId,
    targetBytesSha256: file.bytesSha256, targetName: file.name, sampleIdColumn,
    sampleIds, rowCount, targetColumns, delimiter: params.delimiter, baseAssembly, targetInspection,
  };
}

export function confirmProposal(record: RetainedImport, proposal: Proposal, value: unknown = proposal.value): RetainedImport {
  const confirmed = record.confirmed.filter((c) => c.kind !== proposal.kind || c.target !== proposal.target);
  return invalidateImport({ ...record, confirmed: [...confirmed, { kind: proposal.kind, target: proposal.target, value, status: 'confirmed' }] });
}

export function undoProposal(record: RetainedImport, kind: string, target: string): RetainedImport {
  return invalidateImport({ ...record, confirmed: record.confirmed.filter((c) => c.kind !== kind || c.target !== target) });
}

function csvCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function confirmTargetRows(record: RetainedImport, rows: TargetRowConfirmation['rows']): Promise<RetainedImport> {
  const context = record.mapping;
  if (!context || record.status === 'pending') throw new Error('Wait for the current IO mapping preview.');
  const target = record.files.find((f) => f.bindingId === context.targetBindingId && f.bytesSha256 === context.targetBytesSha256);
  if (!target || rows.length !== context.rowCount || rows.some((r, i) => r.row !== i || !context.sampleIds.includes(r.sampleId))) {
    throw new Error('Select an owner-declared sample ID for every target row.');
  }
  const usedNames = new Set(record.files.map((f) => f.name));
  const stem = target.name.replace(/\.csv$/i, '');
  let name = `${stem}.confirmed-identities.csv`;
  for (let suffix = 1; usedNames.has(name); suffix++) name = `${stem}.confirmed-identities-${suffix}.csv`;
  const bytes = new TextEncoder().encode([context.sampleIdColumn, ...rows.map((r) => r.sampleId)].map((v) => csvCell(v, context.delimiter)).join('\n'));
  const witness: ImportBinding = { bindingId: crypto.randomUUID(), name, bytes, bytesSha256: await sha256(bytes) };
  const spec = readSpec(record.reviewSpecJson);
  const nextSources = sources(spec).map((s) => {
    if (s.id !== context.targetSourceId) return s;
    const next: Record<string, unknown> = {
      ...s, kind: 'lookup', role: 'mixed', input: [target.name, witness.name], merge: 'concat_features',
      columns: [
        { ...items(s.columns).map(objectFields).find((c) => c?.role === 'targets'), role: 'targets', select: context.targetColumns },
        { ...items(s.columns).map(objectFields).find((c) => c?.role === 'metadata'), role: 'metadata', select: [context.sampleIdColumn] },
      ],
      join: { ...objectFields(s.join), left: context.anchorSourceId, right: context.targetSourceId,
        left_on: context.sampleIdColumn, right_on: context.sampleIdColumn, cardinality: 'm:1', coverage: 'complete' },
    };
    // This ID is data for the keyed join, not a source key removed from roles.
    delete next.key;
    return next;
  });
  return {
    ...record, revision: record.revision + 1, status: 'pending', assembled: null, validationSucceeded: false,
    specJson: JSON.stringify({ ...spec, sources: nextSources }), diagnostics: [], witness,
    targetConfirmation: { targetBindingId: target.bindingId, targetBytesSha256: target.bytesSha256, rows: rows.map((r) => ({ ...r })) },
  };
}

export function runOwnerCycle(owner: ImportOwner, input: RetainedImport, stage: ImportStage): RetainedImport {
  let record: RetainedImport = { ...input, stage, ioVersion: owner.version(), diagnostics: [], assembled: null, validationSucceeded: false };
  const diagnostics: ImportDiagnostic[] = [];
  let reviewSpecJson = record.reviewSpecJson;
  try {
    const proposal = owner.proposeDataset(record.files, [], { confirmed: record.confirmed });
    if (!reviewSpecJson && !record.specEdited) reviewSpecJson = JSON.stringify(proposal.spec);
    else if (record.proposal && JSON.stringify(record.proposal.spec) !== JSON.stringify(proposal.spec)) {
      reviewSpecJson = JSON.stringify(applyOwnerDelta(readSpec(reviewSpecJson), record.proposal.spec, proposal.spec));
    }
    record = { ...record, proposal, reviewSpecJson };
    diagnostics.push(...proposal.validation_errors.map((message) => ({ phase: 'proposal' as const, message })));
  } catch (error) { diagnostics.push({ phase: 'proposal', message: errorMessage(error) }); }
  const hasConfirmation = record.targetConfirmation !== null && record.witness !== null;
  const specJson = hasConfirmation ? record.specJson : reviewSpecJson;
  {
    try {
      owner.validate(specJson);
      record.validationSucceeded = true;
      try { record.assembled = owner.assembleDataset(hasConfirmation ? [...record.files, record.witness!] : record.files, [], specJson); }
      catch (error) { diagnostics.push({ phase: 'assembly', message: errorMessage(error) }); }
    } catch (error) { diagnostics.push({ phase: 'validation', message: errorMessage(error) }); }
    try { record.mapping = prepareMapping(owner, record, readSpec(reviewSpecJson)); }
    catch (error) { diagnostics.push({ phase: 'mapping', message: errorMessage(error) }); record.mapping = null; }
  }
  const status = record.validationSucceeded && record.assembled !== null ? 'ready' : 'refused';
  return {
    ...record, specJson, status, diagnostics,
    attempts: [...record.attempts, { revision: record.revision, specJson, diagnostics }],
  };
}

export type LabProjection = { ok: true; samples: Sample[]; spectra: SpectraDataset; targetName: string | null }
  | { ok: false; reasons: string[] };

/** Gate the existing alltrain lab model without changing any owner values. */
export function projectForLab(record: RetainedImport, projectId: string): LabProjection {
  const refuse = (...reasons: string[]): LabProjection => ({ ok: false, reasons });
  if (record.status !== 'ready' || !record.validationSucceeded || record.assembled === null) {
    return refuse('Using data requires successful validation and assembly of the current import.');
  }
  const assembled = record.assembled;
  const spec = readSpec(record.specJson);
  const inputs = new Set(sources(spec).flatMap((source) => typeof source.input === 'string' ? [source.input] : strings(source.input)));
  const unused = [...record.files, ...(record.witness ? [record.witness] : [])].filter((file) => !inputs.has(file.name));
  if (unused.length) return refuse(`Every attached binding must be explicitly named as an input in the validated IO specification. Unreferenced files: ${unused.map((file) => file.name).join(', ')}.`);
  if (assembled.assembled_schema_version !== 3) return refuse('Unsupported IO assembled schema.');
  if (assembled.partition_order.length !== 1 || assembled.partition_order[0] !== 'train'
      || Object.keys(assembled.blocks).length !== 1 || assembled.folds.length || assembled.fold_provenance.length) {
    return refuse('Held-out partitions and folds cannot be preserved by this lab execution route. Only alltrain imports without folds can be used.');
  }
  const block = assembled.blocks.train;
  if (!block || block.x.length !== 1 || block.feature_axes.length !== 1 || block.feature_axes[0]?.length !== 1) {
    return refuse('The lab projection requires exactly one X matrix with one numeric feature axis.');
  }
  const x = block.x[0]!, featureAxis = block.feature_axes[0]![0]!;
  if (featureAxis.coordinates?.kind !== 'numeric') return refuse('A numeric owner feature axis is required; feature-header text is never decoded by Quali.');
  let axis: number[];
  try { axis = Array.from(numericCoordinates(featureAxis.coordinates, x.n_cols)); }
  catch (error) { return refuse(`The owner axis accessor refused the feature axis: ${errorMessage(error)}`); }
  if (block.n_samples <= 0 || x.n_rows !== block.n_samples || x.n_cols <= 0
      || x.data.length !== x.n_rows * x.n_cols || x.validity.length !== x.data.length
      || x.data.some((value, index) => x.validity[index] && !Number.isFinite(value))) {
    return refuse('X dimensions and validity must align, and every valid X cell must be finite. Missing cells are retained as NaN.');
  }
  const y = block.y, target = y?.columns[0];
  if (y !== null) {
    if (y.columns.length !== 1 || target?.kind !== 'numeric'
        || block.y_headers.length !== 1 || block.y_headers[0] !== target.name) {
      return refuse('Exactly one owner numeric target column is supported. Classification and multiple targets remain previewable only.');
    }
    if (assembled.task_type !== 'regression') {
      return refuse(assembled.task_type === 'auto' ? 'Please confirm the regression task type in the IO specification.'
        : 'A present numeric target requires an explicit regression task. Classification tasks cannot create a quantitative lab project.');
    }
    if (y.data.length !== block.n_samples || target.block.n_rows !== block.n_samples
        || target.block.n_cols !== 1 || target.block.validity.length !== block.n_samples) {
      return refuse('The owner target column does not align with the observation rows.');
    }
  } else if (spec.task_type === 'binary' || spec.task_type === 'multiclass') {
    return refuse('The IO specification explicitly declares a classification task, which contradicts the quantitative lab method.');
  }
  if (block.weights !== null) return refuse('Weights cannot be handed to the current lab model; the complete owner weights remain retained.');
  const sampleColumn = assembled.identity.provenance.sample_id;
  if (!sampleColumn) return refuse('No sample-ID metadata column is declared. Anonymous imports stay previewable; positional sample IDs are never invented.');
  const matches = block.metadata?.columns.filter((column) => column.name === sampleColumn) ?? [];
  if (matches.length !== 1 || block.metadata?.n_rows !== block.n_samples || matches[0]!.values.length !== block.n_samples) {
    return refuse('The declared sample-ID column must be present and aligned in owner metadata.');
  }
  const ids = matches[0]!.values;
  if (ids.some((id) => typeof id !== 'string' || !id.trim())) {
    return refuse('Quali requires nonempty string sample IDs. Numeric-only IDs are unsupported and are never converted to strings.');
  }
  const rowsBySample = new Map<string, number[]>();
  for (let row = 0; row < block.n_samples; row++) {
    const id = ids[row];
    if (typeof id !== 'string') return refuse('The owner sample-ID column contains a non-string value.');
    const existingRows = rowsBySample.get(id);
    if (existingRows && assembled.repetition !== sampleColumn) {
      return refuse('Repeated sample IDs require an owner-declared repetition relationship.');
    }
    const rows = existingRows ?? [];
    rows.push(row); rowsBySample.set(id, rows);
  }
  const samples: Sample[] = [], spectra: SpectraDataset = {
    axis, axisUnit: featureAxis.unit ?? block.header_units[0] ?? '', samples: [],
  };
  for (const [id, rows] of rowsBySample) {
    const firstRow = rows[0]!;
    const valid = y !== null && target!.block.validity[firstRow];
    const value = y === null ? null : y.data[firstRow]!;
    if (y !== null && rows.some((row) => target!.block.validity[row] !== valid
      || valid && (!Number.isFinite(y.data[row]) || !Object.is(y.data[row], value)))) {
      return refuse(`Target validity and observed values must be constant within sample ${JSON.stringify(id)}.`);
    }
    const metadata: Sample['metadata'] = {};
    for (const column of block.metadata!.columns) {
      const cell = column.values[firstRow];
      if ((cell === null || typeof cell === 'string' || typeof cell === 'number')
          && rows.every((row) => Object.is(column.values[row], cell))) metadata[column.name] = cell;
    }
    // Handles identify host objects only. They never populate owner observation IDs.
    const repetitions = rows.map((row) => ({ id: `${projectId}:import-row:${row}`, spectrumRef: `${projectId}:import-spectrum:${row}`,
      acquiredAt: '' })); // No acquisition timestamp was declared by the owner.
    samples.push({ id, projectId, lotId: null, barcode: null, status: valid ? 'integrated' : 'nirs_measured',
      repetitions, reference: valid ? { value, status: 'validated' } : null, metadata, createdAt: record.importedAt });
    spectra.samples.push({ sampleId: id, reps: rows.map((row, index) => ({
      repId: repetitions[index]!.id,
      values: Float64Array.from(x.data.subarray(row * x.n_cols, (row + 1) * x.n_cols),
        (value, column) => x.validity[row * x.n_cols + column] ? value : Number.NaN),
    })) });
  }
  return { ok: true, samples, spectra, targetName: y === null ? null : target!.name };
}

export function proposalViews(record: RetainedImport): OwnerProposalDisplay[] {
  return (record.proposal?.proposals ?? []).map((p, index) => ({
    id: String(index), kind: p.kind, target: p.target, valueLabel: JSON.stringify(p.value) ?? 'undefined',
    score: p.score, ambiguous: p.ambiguous, evidence: p.evidence,
    status: p.status ?? null,
    alternatives: p.alternatives.map((candidate, choice) => {
      const fields = objectFields(candidate);
      return { choiceId: String(choice), label: JSON.stringify(fields?.value) ?? 'undefined',
        score: typeof fields?.score === 'number' ? fields.score : null };
    }),
    canUndo: record.confirmed.some((c) => c.kind === p.kind && c.target === p.target),
  }));
}

export function previewView(record: RetainedImport): DatasetPreviewView | null {
  if (record.assembled === null) return null;
  const assembly = objectFields(record.assembled);
  const blocks = blocksOf(record.assembled);
  const rows = blocks.reduce((n, b) => n + (typeof b.n_samples === 'number' ? b.n_samples : 0), 0);
  const column = declaredSampleColumn(record.assembled);
  const values = column ? sampleValues(record.assembled, column) : [];
  const samples = values.length === rows ? new Set(values).size : null;
  const featureCount = objectFields(items(blocks[0]?.x)[0])?.n_cols;
  const targetCount = items(blocks[0]?.y_headers).length;
  return {
    id: null, title: typeof assembly?.name === 'string' ? assembly.name : 'IO dataset preview',
    description: `${rows} observation rows · ${samples ?? 'unknown'} distinct samples. Complete owner record retained.`,
    taskKind: 'unknown', taskLabel: typeof assembly?.task_type === 'string' ? assembly.task_type : 'Unknown task',
    sampleCount: samples, sampleCountLabel: samples === null ? null : String(samples),
    featureCount: typeof featureCount === 'number' ? featureCount : null,
    featureCountLabel: typeof featureCount === 'number' ? String(featureCount) : null,
    targetCount, targetCountLabel: String(targetCount), classCount: null, classCountLabel: null,
    spectralRangeLabel: null, splitCounts: [], splitSummaryLabel: null, tags: [], badges: [],
    stats: [{ id: 'samples', label: 'Observation rows', value: String(rows), detail: `${samples ?? 'Unknown'} distinct samples`, tone: 'default' }],
  };
}

/** A bounded table view, never a replacement or truncation of the retained record. */
export function previewRows(assembly: unknown, limit = 20): { partition: string; row: number; values: string }[] {
  const blocks = objectFields(objectFields(assembly)?.blocks);
  if (!blocks) return [];
  return Object.entries(blocks).flatMap(([partition, value]) => {
    const block = objectFields(value);
    if (!block || typeof block.n_samples !== 'number') return [];
    const x = items(block.x).map(objectFields), y = objectFields(block.y);
    const metadata = items(objectFields(block.metadata)?.columns).map(objectFields);
    return Array.from({ length: Math.min(block.n_samples, limit) }, (_, row) => {
      const entries: [string, unknown][] = [];
      for (let source = 0; source < x.length; source++) {
        const matrix = x[source];
        if (matrix?.data instanceof Float64Array && typeof matrix.n_cols === 'number') {
          entries.push([`X[${source}]`, Array.from(matrix.data.subarray(row * matrix.n_cols, (row + 1) * matrix.n_cols))]);
        }
      }
      if (y?.data instanceof Float64Array) {
        const width = items(block.y_headers).length;
        entries.push(['y', Array.from(y.data.subarray(row * width, (row + 1) * width))]);
      }
      for (const c of metadata) if (c && typeof c.name === 'string') entries.push([c.name, items(c.values)[row]]);
      return { partition, row, values: entries.map(([key, v]) => `${key}: ${Array.isArray(v) ? v.map(String).join(', ') : String(v)}`).join(' | ') };
    });
  });
}

export interface ImportWorkerRequest { id: number; record: RetainedImport }
export interface ImportWorkerResponse { id: number; record: RetainedImport }

export function startImportWorker(): Worker {
  if (location.protocol === 'file:') throw new Error('IO import preview requires an HTTP(S) host; file:// worker loading is unsupported.');
  return new Worker(new URL('./ioImport.worker.ts', import.meta.url), { type: 'module' });
}
