// quali-nirs4all — lab data model (§1bis "Réalités labo").
//
// The operational "paillasse" backbone that PRECEDES any ML: identity, lots,
// references, statuses, roles, and an immutable audit trail. Pure TypeScript,
// framework-free — the app store, the screens, and the (WASM/Python) engine
// port all speak these types. This is the source of truth for the domain shape;
// keep it engine-agnostic (no Float64Array / no numerics here — that lives in
// the engine port's MaterializedDataset).

import type { SampleStatus } from './sampleStatusRef.js';
export type { SampleStatus } from './sampleStatusRef.js';

// ---------------------------------------------------------------------------
// Identity & roles
// ---------------------------------------------------------------------------

/** Two roles, per §1bis: operator measures/predicts; method owner validates/deploys/overrides. */
export type Role = 'operator' | 'method_owner';

export interface User {
  id: string;
  name: string;
  role: Role;
}

/** How a task type is expressed to the lab (drives model + metrics). */
export type TaskType = 'regression' | 'binary' | 'multiclass';

/** Reference-value basis — a real lab distinction that changes the number. */
export type MeasurementBasis = 'as_is' | 'dry' | 'wet';

// ---------------------------------------------------------------------------
// Project / Method — one analytical method (e.g. "protein in cassava flour")
// ---------------------------------------------------------------------------

export interface Method {
  /** target name, e.g. "Protéines" */
  target: string;
  /** unit, e.g. "%" */
  unit: string;
  basis: MeasurementBasis;
  /** matrix, e.g. "farine de manioc" */
  matrix: string;
  /** the reference analytical method, e.g. "Kjeldahl / HPLC" */
  referenceMethod: string;
  /** SOP identifier + version (traceability) */
  sopVersion: string;
  taskType: TaskType;
}

/** Lifecycle status of a MODEL (qualification vs production), per §1bis. */
export type ModelLifecycle = 'in_qualification' | 'in_production' | 'retired';

export interface Project {
  id: string;
  name: string;
  method: Method;
  /** primary instrument id this project calibrates for */
  instrumentId: string | null;
  /** wet-chemistry budget the lab can afford (number of samples) */
  hplcBudget: number;
  createdAt: string;
  updatedAt: string;
  /** currently deployed model version id, if any */
  activeModelVersionId: string | null;
  /** frozen C/P/T design (AR-NIRS), keyed by sampleId; set once the design is
   *  built — until then the leakage guarantee is only declarative. */
  cpt?: CptDesign;
}

// ---------------------------------------------------------------------------
// Lots — decisions are taken by batch (reception / instrument / campaign / HPLC)
// ---------------------------------------------------------------------------

export type LotKind = 'reception' | 'instrument' | 'campaign' | 'hplc_batch';

export interface Lot {
  id: string;
  projectId: string;
  kind: LotKind;
  label: string;
  createdAt: string;
  /** site / year / season descriptors (drive split + drift detection) */
  site?: string;
  year?: number;
  season?: string;
}

// ---------------------------------------------------------------------------
// Samples, repetitions, references
// ---------------------------------------------------------------------------

/** Analytical status of a wet-chemistry reference (not an instant truth). */
export type ReferenceStatus =
  | 'pending'
  | 'validated'
  | 'repeatability_check'
  | 'below_loq'
  | 'diluted'
  | 'redo'
  | 'subcontracted';

export interface ReferenceMeasurement {
  /** the reference (HPLC / wet chemistry) value in the method's unit */
  value: number | null;
  status: ReferenceStatus;
  /** the HPLC batch lot this came back in */
  hplcLotId?: string;
  measuredAt?: string;
  /** free-text analytical note (dilution factor, LOQ, etc.) */
  note?: string;
}

/** One spectral acquisition (a repetition) of a sample. */
export interface Repetition {
  id: string;
  /** opaque reference to the spectrum stored by the engine (never the bytes here) */
  spectrumRef: string;
  acquiredAt: string;
  operatorId?: string;
  /** instrument-drift metadata captured at acquisition (§1bis) */
  instrumentEvent?: InstrumentEvent;
  /** excluded from modelling (kept for trace) */
  excluded?: boolean;
}

export interface InstrumentEvent {
  instrumentId: string;
  lampHours?: number;
  cleanedAt?: string;
  temperatureC?: number;
  humidityPct?: number;
  cellType?: string;
  granulometry?: string;
}

export interface Sample {
  /** stable identity — joins are keyed by this, never by row order */
  id: string;
  projectId: string;
  lotId: string | null;
  /** scannable barcode / QR payload */
  barcode: string | null;
  status: SampleStatus;
  repetitions: Repetition[];
  reference: ReferenceMeasurement | null;
  /** free metadata (site/year/instrument/variety…) for split + drift */
  metadata: Record<string, string | number | null>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit trail — immutable, who/when/what/justification (§1bis, ISO 17025)
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'project_created'
  | 'samples_imported'
  | 'reference_imported'
  | 'sample_status_changed'
  | 'quality_finding_actioned'
  | 'worklist_exported'
  | 'model_built'
  | 'model_deployed'
  | 'model_rolled_back'
  | 'decision_overridden';

export interface AuditEntry {
  /** monotonic id; the log is append-only and never mutated */
  id: string;
  projectId: string;
  action: AuditAction;
  /** who performed it */
  userId: string;
  role: Role;
  /** absolute ISO timestamp (stamped by the app, never inside pure helpers) */
  at: string;
  /** human justification (required for overrides) */
  justification?: string;
  /** structured payload (ids affected, before/after, etc.) */
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// C / P / T design — the AR-NIRS methodological split (§ doc "Design C/P/T")
// ---------------------------------------------------------------------------

/** Which of the three AR-NIRS sets a sample belongs to. */
export type CptRole = 'support' | 'pool' | 'test';

/**
 * The C/P/T assignment for a project. `T` (frozen test) is never used for
 * tuning/selection/normalization; `P` candidate Y is forbidden before selection.
 * Keyed by sampleId so it survives re-imports and never depends on row order.
 */
export interface CptDesign {
  /** sampleId → role */
  assignment: Record<string, CptRole>;
  /** seed used to build the frozen test set (traceable) */
  seed: number;
}

// ---------------------------------------------------------------------------
// Model versions — semantic versioning + provenance (§ doc "Versioning")
// ---------------------------------------------------------------------------

export interface ModelVersion {
  id: string;
  projectId: string;
  /** incrementing label, e.g. "v3" */
  label: string;
  lifecycle: ModelLifecycle;
  createdAt: string;
  /** the engine that produced it (e.g. 'dag-ml-wasm', 'nirs4all-core-wasm', 'python') */
  engine: string;
  /** opaque fitted-model reference (the engine owns the bytes / .n4a) */
  modelRef: string;
  /** the metrics recorded at build time */
  metrics: ProjectModelMetrics;
  /** sampleIds that were added to calibration for this version (enrichment trace) */
  addedSampleIds: string[];
  /** selection method used for the added samples (audit) */
  selectionMethod?: string;
}

export interface ProjectModelMetrics {
  rmsep?: number;
  r2?: number;
  rpd?: number;
  rpiq?: number;
  bias?: number;
  n?: number;
}
