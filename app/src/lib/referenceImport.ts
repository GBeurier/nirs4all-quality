// Keyed reference (y) import for an existing project. IO owns reading, NA handling,
// validity and numeric storage (describeTables + standalone validate/assembleDataset);
// this module only forwards the user's explicit choices, matches exact sample ids and
// plans/applies the resulting delta. No CSV parsing, no Number(text), no positional
// fallback and no change to the historical retained import.
import type { AssembledDataset, NamedFile, TableDescription } from '../../../../nirs4all-io/bindings/wasm/types/nirs4all-io';
import type { AuditEntry, Sample } from '@/domain/model';

export type ReferenceOwner = Pick<typeof import('../../../../nirs4all-io/bindings/wasm/types/nirs4all-io'),
  'describeTables' | 'validate' | 'assembleDataset'>;

export interface ReferenceFile { name: string; bytes: Uint8Array; sha256: string }

/** Explicit reader choices; null means "not declared by the user". */
export interface ReferenceOptions { hasHeader: boolean | null; delimiter: string | null }

export interface ReferenceDescription {
  table: TableDescription;
  /** The owner cannot tell whether the first row is a header: the user must declare it. */
  needsHeader: boolean;
  /** The owner has several delimiter candidates: the user must declare one. */
  delimiterCandidates: string[] | null;
}

export interface ReferenceUpdate { id: string; value: number; previous: number | null }

export interface ReferenceCounts {
  set: number;
  changed: number;
  unchanged: number;
  /** Known ids whose value is missing, invalid or non-finite; the existing reference is kept. */
  invalidKept: number;
  unknownIds: number;
  /** Project samples that the file does not mention (left unchanged). */
  absentFromFile: number;
}

export interface ReferenceDelta {
  file: { name: string; sha256: string };
  idColumn: string;
  valueColumn: string;
  reader: { delimiter: string; hasHeader: boolean };
  /** Only finite values that set or change a reference (unchanged values are not listed). */
  updates: ReferenceUpdate[];
  unknownIds: string[];
  counts: ReferenceCounts;
  /** Sample ids + reference values seen by the preview; the commit refuses if they moved. */
  expected: { id: string; value: number | null }[];
}

export type ReferencePreview = { ok: true; delta: ReferenceDelta } | { ok: false; reason: string };

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const fail = (reason: string): ReferencePreview => ({ ok: false, reason });

function readerParams(options: ReferenceOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (options.hasHeader !== null) params.has_header = options.hasHeader;
  if (options.delimiter !== null) params.delimiter = options.delimiter;
  return params;
}

const named = (file: ReferenceFile): NamedFile => ({ name: file.name, bytes: file.bytes });

/** Ask IO to describe the original table; nothing is joined, assembled or guessed here. */
export function describeReferenceFile(owner: ReferenceOwner, file: ReferenceFile, options: ReferenceOptions): ReferenceDescription {
  const params = readerParams(options);
  const [table] = owner.describeTables([named(file)], Object.keys(params).length ? { params: { [file.name]: params } } : undefined);
  if (!table) throw new Error('IO returned no table description.');
  return {
    table,
    needsHeader: table.header_ambiguous && options.hasHeader === null,
    delimiterCandidates: table.delimiter_unresolved && options.delimiter === null ? table.delimiter_unresolved.candidates : null,
  };
}

/** Standalone inspection table: the id as metadata and the chosen numeric column as a one-column table.
 *  Every other column is kept as metadata through IO's canonical `rest` selector (last, at most one per source). */
export function buildReferenceSpec(name: string, reader: { delimiter: string; hasHeader: boolean }, idColumn: string, valueColumn: string, hasOtherColumns = false): Record<string, unknown> {
  return {
    schema_version: 1,
    name: 'quali-reference-values',
    params: { delimiter: reader.delimiter, has_header: reader.hasHeader, na: { policy: 'ignore' } },
    sources: [{
      id: 'reference', input: name, role: 'mixed',
      columns: [
        { role: 'features', select: [valueColumn] },
        { role: 'metadata', select: [idColumn] },
        ...(hasOtherColumns ? [{ role: 'metadata', select: 'rest' }] : []),
      ],
    }],
  };
}

interface ParsedRow { id: string; value: number | null }

function parseOwnerTable(assembled: AssembledDataset, idColumn: string, valueColumn: string): ParsedRow[] | string {
  if (assembled.assembled_schema_version !== 3) return 'Unsupported IO assembled schema.';
  if (assembled.partition_order.length !== 1 || Object.keys(assembled.blocks).length !== 1 || assembled.folds.length) {
    return 'The reference table must be a single table without partitions or folds.';
  }
  const block = assembled.blocks[assembled.partition_order[0]!];
  const matrix = block?.x.length === 1 ? block.x[0] : undefined;
  if (!block || !matrix || matrix.n_cols !== 1 || matrix.n_rows !== block.n_samples) {
    return 'IO did not return exactly one value column.';
  }
  if (matrix.precision.dtype !== 'float64' || matrix.dtype !== 'float64') {
    return `IO returned ${matrix.precision.dtype} values; the reference import requires float64 and never rounds.`;
  }
  if (block.feature_headers[0]?.[0] !== valueColumn) return 'IO returned a different value column than the one selected.';
  if (matrix.data.length !== block.n_samples || matrix.validity.length !== block.n_samples) {
    return 'IO value and validity arrays do not align with the table rows.';
  }
  const ids = block.metadata?.columns.filter((column) => column.name === idColumn) ?? [];
  if (ids.length !== 1 || block.metadata?.n_rows !== block.n_samples || ids[0]!.values.length !== block.n_samples) {
    return 'IO did not return the selected id column aligned with the table rows.';
  }
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  for (let row = 0; row < block.n_samples; row++) {
    const id = ids[0]!.values[row];
    if (typeof id !== 'string' || !id.trim()) {
      return 'The id column must contain nonempty text ids (numeric-only or empty ids are not converted); add a sample-ID column.';
    }
    if (seen.has(id)) return `The id ${JSON.stringify(id)} appears more than once; duplicate or conflicting values per sample are not supported.`;
    seen.add(id);
    const value = matrix.data[row]!;
    rows.push({ id, value: matrix.validity[row] && Number.isFinite(value) ? value : null });
  }
  return rows;
}

/** Plan the sample-grain delta from owner-parsed rows. Exact string id equality only. */
export function planReferenceDelta(rows: readonly ParsedRow[], samples: readonly Sample[]): Pick<ReferenceDelta, 'updates' | 'unknownIds' | 'counts' | 'expected'> {
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  const counts: ReferenceCounts = { set: 0, changed: 0, unchanged: 0, invalidKept: 0, unknownIds: 0, absentFromFile: 0 };
  const updates: ReferenceUpdate[] = [];
  const unknownIds: string[] = [];
  const mentioned = new Set<string>();
  for (const row of rows) {
    const sample = byId.get(row.id);
    if (!sample) { unknownIds.push(row.id); counts.unknownIds++; continue; }
    mentioned.add(row.id);
    if (row.value === null) { counts.invalidKept++; continue; }
    const previous = typeof sample.reference?.value === 'number' ? sample.reference.value : null;
    if (previous === null) { counts.set++; updates.push({ id: row.id, value: row.value, previous }); }
    else if (previous !== row.value) { counts.changed++; updates.push({ id: row.id, value: row.value, previous }); }
    else counts.unchanged++;
  }
  counts.absentFromFile = samples.filter((sample) => !mentioned.has(sample.id)).length;
  return { updates, unknownIds, counts, expected: samples.map((sample) => ({ id: sample.id, value: sample.reference?.value ?? null })) };
}

/** Describe-checked, owner-parsed preview. Every refusal names the reason; nothing is applied here. */
export function previewReference(owner: ReferenceOwner, file: ReferenceFile, options: ReferenceOptions,
  idColumn: string, valueColumn: string, samples: readonly Sample[]): ReferencePreview {
  let description: ReferenceDescription;
  try { description = describeReferenceFile(owner, file, options); } catch (error) { return fail(message(error)); }
  const { table } = description;
  if (!table.readable) return fail(table.refusal ?? 'IO could not read the file.');
  if (description.needsHeader) return fail('Declare whether the first row is a header; it is never guessed.');
  if (description.delimiterCandidates) return fail('Declare the delimiter; it is never guessed.');
  if (table.columns.length < 2) return fail('The file needs a sample-ID column and a value column. Positional or unkeyed reference files are not supported; add a sample-ID column.');
  const count = (name: string) => table.columns.filter((column) => column.name === name).length;
  if (!idColumn || !valueColumn || idColumn === valueColumn) return fail('Choose two different columns: the sample-ID column and the numeric value column.');
  if (count(idColumn) !== 1 || count(valueColumn) !== 1) return fail('The chosen column names must each appear exactly once in the file.');
  const id = table.columns.find((column) => column.name === idColumn)!;
  const value = table.columns.find((column) => column.name === valueColumn)!;
  if (!id.is_unique) return fail(`The id column ${JSON.stringify(idColumn)} has repeated values; duplicate or conflicting values per sample are not supported.`);
  if (value.dtype !== 'numeric') return fail(`The value column ${JSON.stringify(valueColumn)} is not numeric according to IO.`);
  const { delimiter, has_header: hasHeader } = table.params;
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || typeof hasHeader !== 'boolean') {
    return fail('IO did not report an explicit delimiter and header setting; declare both.');
  }
  const reader = { delimiter, hasHeader };
  let rows: ParsedRow[] | string;
  try {
    const specJson = JSON.stringify(buildReferenceSpec(file.name, reader, idColumn, valueColumn, table.columns.length > 2));
    owner.validate(specJson);
    rows = parseOwnerTable(owner.assembleDataset([named(file)], [], specJson), idColumn, valueColumn);
  } catch (error) { return fail(message(error)); }
  if (typeof rows === 'string') return fail(rows);
  return { ok: true, delta: { file: { name: file.name, sha256: file.sha256 }, idColumn, valueColumn, reader, ...planReferenceDelta(rows, samples) } };
}

/** True when the samples still carry exactly the ids and reference values the preview saw. */
export function guardMatches(samples: readonly Sample[], expected: ReferenceDelta['expected']): boolean {
  return samples.length === expected.length
    && samples.every((sample, i) => sample.id === expected[i]!.id && (sample.reference?.value ?? null) === expected[i]!.value);
}

export interface ReferenceStateSlice {
  samplesByProject: Record<string, Sample[]>;
  modelByProject: Record<string, unknown>;
  calibByProject: Record<string, unknown>;
  audit: AuditEntry[];
}

/** Atomic store step: apply the delta by exact Sample.id, drop model/calibration only when a value really changed. */
export function applyReferenceDeltaToState<S extends ReferenceStateSlice>(state: S, projectId: string, delta: ReferenceDelta,
  makeAudit: (detail: Record<string, unknown>) => AuditEntry): S {
  const current = state.samplesByProject[projectId];
  if (!current || !guardMatches(current, delta.expected)) return state;
  const updates = new Map(delta.updates.map((update) => [update.id, update]));
  let valueChanged = false;
  const next = current.map((sample) => {
    const update = updates.get(sample.id);
    if (!update || sample.reference?.value === update.value) return sample;
    valueChanged = true;
    // Existing semantics: a finite value labels the sample (validated reference, integrated).
    return { ...sample, reference: { value: update.value, status: 'validated' as const }, status: 'integrated' as const };
  });
  if (!valueChanged) return state;
  const model = { ...state.modelByProject }; delete model[projectId];
  const calib = { ...state.calibByProject }; delete calib[projectId];
  return {
    ...state,
    samplesByProject: { ...state.samplesByProject, [projectId]: next },
    modelByProject: model,
    calibByProject: calib,
    audit: [...state.audit, makeAudit({
      alignment: 'owner-keyed', file: delta.file, idColumn: delta.idColumn, valueColumn: delta.valueColumn,
      reader: delta.reader, counts: delta.counts,
    })],
  };
}
