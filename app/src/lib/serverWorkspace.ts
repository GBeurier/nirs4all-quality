// Host persistence only: IO, numerical execution and fitted state remain owner APIs.
import { openN4aContainer, writeN4aContainer, type N4aSource } from 'nirs4all';
import { packState, unpackState } from '@nirs4all/server-client/state';
import type { WorkspaceSnapshot } from '@nirs4all/server-client';
import type { LabState, StoredModel } from '@/store/store';
import type { Project, Sample, AuditEntry } from '@/domain/model';
import type { SpectraDataset } from '@/domain/spectra';
import { cropSpectra } from '@/domain/spectra';
import type { RetainedImport } from '@/lib/ioImport';
import { artifactDigest } from '@/engine/artifactDigest';

export const QUALI_WORKSPACE = {
  owner: 'nirs4all.quali.workspace', schema: 'nirs4all.quali.workspace', version: 1,
  feature: 'nirs4all-quali-workspace@1', path: 'workspace/state.json',
} as const;

export interface ProjectWorkspace {
  schema: typeof QUALI_WORKSPACE.schema;
  schema_version: 1;
  mode: 'settings' | 'project';
  project: Project;
  crop: LabState['cropByProject'][string];
  previewPp: string;
  repMode: 'mean' | 'raw';
  modelDisposition: 'none' | 'excluded' | 'included';
  modelArchive?: Blob;
  samples?: Sample[];
  spectra?: SpectraDataset;
  audit?: AuditEntry[];
  retainedImport?: RetainedImport;
}

function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// Audit identities are immutable. Compare stored values without JSON rounding or
// losing BigInt/nonfinite/negative-zero metadata. Opaque unequal objects refuse.
function sameAuditValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
    if (left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
    const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    return a.every((value, index) => value === b[index]);
  }
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
    return left.byteLength === right.byteLength && new Uint8Array(left).every((value, index) => value === new Uint8Array(right)[index]);
  }
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameAuditValue(value, right[index]));
  if (!record(left) || !record(right) || Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameAuditValue(left[key], right[key]));
}

/** Select explicit host fields, excluding WASM handles, other projects and user state. */
export function selectProjectWorkspace(state: LabState, projectId: string, includeData: boolean): ProjectWorkspace {
  const project = state.projects.find(item => item.id === projectId);
  requireValue(project, 'Select a local project first.');
  // A settings save never implicitly exports rows, source files, split identities or fitted state.
  const settingsProject: Project = {
    id: project.id, name: project.name, method: {
      target: project.method.target, unit: project.method.unit, basis: project.method.basis,
      matrix: project.method.matrix, referenceMethod: project.method.referenceMethod,
      sopVersion: project.method.sopVersion, taskType: project.method.taskType,
    }, instrumentId: project.instrumentId,
    hplcBudget: project.hplcBudget, createdAt: project.createdAt, updatedAt: project.updatedAt,
    activeModelVersionId: null,
  };
  const snapshot: ProjectWorkspace = {
    schema: QUALI_WORKSPACE.schema, schema_version: 1, mode: includeData ? 'project' : 'settings',
    project: includeData ? project : settingsProject,
    crop: state.cropByProject[projectId] ?? { from: null, to: null },
    previewPp: state.previewPpByProject[projectId] ?? 'none',
    repMode: state.repModeByProject[projectId] ?? 'mean',
    modelDisposition: includeData && (state.modelByProject[projectId] || project.activeModelVersionId) ? 'excluded' : 'none',
  };
  if (includeData) {
    snapshot.samples = state.samplesByProject[projectId] ?? [];
    snapshot.spectra = state.spectraByProject[projectId] ?? { axis: [], axisUnit: 'nm', samples: [] };
    snapshot.audit = state.audit.filter(entry => entry.projectId === projectId);
    const retainedImport = state.importsByProject[projectId];
    if (retainedImport) snapshot.retainedImport = retainedImport;
  }
  return snapshot;
}

/** Admission validates host shape/identities, never infers data or scientific validity. */
export function admitProjectWorkspace(value: unknown): ProjectWorkspace {
  requireValue(record(value) && value.schema === QUALI_WORKSPACE.schema && value.schema_version === 1
    && (value.mode === 'settings' || value.mode === 'project'), 'Unsupported Quali workspace profile/version.');
  const project = value.project;
  requireValue(record(project) && nonempty(project.id) && nonempty(project.name) && record(project.method)
    && ['target', 'unit', 'matrix', 'referenceMethod', 'sopVersion'].every(key => typeof project.method[key] === 'string')
    && ['as_is', 'dry', 'wet'].includes(project.method.basis)
    && ['regression', 'binary', 'multiclass'].includes(project.method.taskType)
    && (project.instrumentId === null || typeof project.instrumentId === 'string')
    && Number.isFinite(project.hplcBudget) && typeof project.createdAt === 'string' && typeof project.updatedAt === 'string'
    && (project.activeModelVersionId === null || nonempty(project.activeModelVersionId)), 'Invalid project settings.');
  requireValue(record(value.crop) && [value.crop.from, value.crop.to].every(v => v === null || Number.isFinite(v))
    && typeof value.previewPp === 'string' && ['mean', 'raw'].includes(value.repMode), 'Invalid Quali presentation settings.');
  requireValue(['none', 'excluded', 'included'].includes(value.modelDisposition)
    && (value.modelDisposition === 'included' ? value.mode === 'project' && value.modelArchive instanceof Blob : value.modelArchive === undefined),
  'Unsupported fitted-state disposition.');
  const commonKeys = ['schema', 'schema_version', 'mode', 'project', 'crop', 'previewPp', 'repMode', 'modelDisposition'];
  const allowedKeys = value.mode === 'project' ? [...commonKeys, 'samples', 'spectra', 'audit', 'retainedImport', 'modelArchive'] : commonKeys;
  requireValue(Object.keys(value).every(key => allowedKeys.includes(key)), 'Unsupported workspace fields; nothing was applied.');
  if (value.mode === 'settings') {
    requireValue(value.modelDisposition === 'none' && project.activeModelVersionId === null, 'Settings-only workspaces exclude fitted state.');
    requireValue(Object.keys(project).every(key => ['id', 'name', 'method', 'instrumentId', 'hplcBudget', 'createdAt', 'updatedAt', 'activeModelVersionId'].includes(key))
      && Object.keys(project.method).every(key => ['target', 'unit', 'basis', 'matrix', 'referenceMethod', 'sopVersion', 'taskType'].includes(key)),
    'Settings-only workspaces cannot contain data or split identities.');
    return value as unknown as ProjectWorkspace;
  }
  requireValue(Array.isArray(value.samples) && value.samples.every((sample: unknown) => record(sample)
    && nonempty(sample.id) && sample.projectId === project.id && Array.isArray(sample.repetitions)
    && record(sample.metadata) && typeof sample.status === 'string')
    && new Set(value.samples.map((sample: Sample) => sample.id)).size === value.samples.length,
  'Invalid or duplicate project sample identities.');
  const sampleIds = new Set(value.samples.map((sample: Sample) => sample.id));
  const spectra = value.spectra;
  requireValue(record(spectra) && Array.isArray(spectra.axis) && spectra.axis.every((v: unknown) => typeof v === 'number')
    && typeof spectra.axisUnit === 'string' && Array.isArray(spectra.samples)
    && spectra.samples.every((sample: unknown) => record(sample) && sampleIds.has(sample.sampleId)
      && Array.isArray(sample.reps) && sample.reps.every((rep: unknown) => record(rep) && nonempty(rep.repId)
        && rep.values instanceof Float64Array && rep.values.length === spectra.axis.length)
      && new Set(sample.reps.map((rep: { repId: string }) => rep.repId)).size === sample.reps.length)
    && new Set(spectra.samples.map((sample: { sampleId: string }) => sample.sampleId)).size === spectra.samples.length,
  'Invalid spectra shape, dtype or sample/repetition identities.');
  requireValue(Array.isArray(value.audit) && value.audit.every((entry: unknown) => record(entry)
    && nonempty(entry.id) && entry.projectId === project.id && typeof entry.action === 'string'
    && typeof entry.userId === 'string' && ['operator', 'method_owner'].includes(entry.role) && typeof entry.at === 'string')
    && new Set(value.audit.map((entry: AuditEntry) => entry.id)).size === value.audit.length, 'Invalid project audit trail.');
  if (value.retainedImport !== undefined) {
    const imported = value.retainedImport;
    requireValue(record(imported) && Array.isArray(imported.files) && typeof imported.specJson === 'string'
      && typeof imported.reviewSpecJson === 'string' && Array.isArray(imported.confirmed)
      && Array.isArray(imported.attempts) && Array.isArray(imported.diagnostics), 'Invalid retained IO import.');
  }
  return value as unknown as ProjectWorkspace;
}

/** Targeted merge keeps other projects, current user and existing immutable audit entries. */
export function restoreProjectWorkspace(state: LabState, input: ProjectWorkspace, importedModel?: StoredModel): LabState {
  const snapshot = admitProjectWorkspace(input), id = snapshot.project.id;
  requireValue(snapshot.modelDisposition !== 'included' || importedModel?.archiveBlob === snapshot.modelArchive,
    'The included model must be admitted through the existing owner import route before local activation.');
  const existing = state.projects.find(project => project.id === id);
  const project = snapshot.mode === 'settings' && existing
    ? { ...snapshot.project, ...(existing.cpt ? { cpt: existing.cpt } : {}), activeModelVersionId: existing.activeModelVersionId }
    : { ...snapshot.project };
  const common = {
    ...state, projects: existing ? state.projects.map(item => item.id === id ? project : item) : [...state.projects, project],
    cropByProject: { ...state.cropByProject, [id]: snapshot.crop },
    previewPpByProject: { ...state.previewPpByProject, [id]: snapshot.previewPp },
    repModeByProject: { ...state.repModeByProject, [id]: snapshot.repMode },
  };
  const modelByProject = { ...state.modelByProject }, calibByProject = { ...state.calibByProject };
  // A changed crop/rep mode invalidates a predictor exactly as the existing local reducer does.
  if (snapshot.mode === 'project' || state.cropByProject[id]?.from !== snapshot.crop.from
    || state.cropByProject[id]?.to !== snapshot.crop.to || state.repModeByProject[id] !== snapshot.repMode
    || existing && (JSON.stringify(existing.method) !== JSON.stringify(project.method) || existing.instrumentId !== project.instrumentId)) {
    delete modelByProject[id]; delete calibByProject[id];
    project.activeModelVersionId = snapshot.modelDisposition === 'included' ? snapshot.project.activeModelVersionId : null;
  }
  if (snapshot.mode === 'settings') return { ...common, modelByProject, calibByProject };
  if (importedModel) modelByProject[id] = importedModel;
  const auditById = new Map(state.audit.map(entry => [entry.id, entry]));
  for (const entry of snapshot.audit!) {
    const prior = auditById.get(entry.id);
    requireValue(!prior || sameAuditValue(prior, entry), 'Conflicting immutable audit identity; local work was preserved.');
  }
  const importsByProject = { ...state.importsByProject };
  if (snapshot.retainedImport) importsByProject[id] = snapshot.retainedImport;
  else delete importsByProject[id];
  return {
    ...common, modelByProject, calibByProject, importsByProject,
    samplesByProject: { ...state.samplesByProject, [id]: snapshot.samples! },
    spectraByProject: { ...state.spectraByProject, [id]: snapshot.spectra! },
    setupImportDraft: state.setupImportDraft?.projectId === id ? null : state.setupImportDraft,
    audit: [...state.audit, ...snapshot.audit!.filter(entry => !auditById.has(entry.id))],
  };
}

/** Prepare the requested optional model fully before any network write. */
export async function exportProjectModel(state: LabState, projectId: string): Promise<Blob> {
  const stored = state.modelByProject[projectId];
  requireValue(stored, 'No active imported or calibrated model is available for this project.');
  const { buildModelBundle, exportModelContainer, importModelContainer } = await import('@/lib/modelIo');
  if (stored.archiveBlob) {
    const checked = await importModelContainer(stored.archiveBlob);
    requireValue('model' in checked && checked.model.model.state
      && JSON.stringify(checked.model.model) === JSON.stringify(stored.model), 'The retained model archive no longer matches the active model.');
    return stored.archiveBlob;
  }
  const calibration = state.calibByProject[projectId];
  let bundle = stored.sourceBundle;
  if (!bundle) {
    requireValue(calibration && stored.selectedProfileId && calibration.selectedId === stored.selectedProfileId
      && calibration.results.find(item => item.variantId === stored.selectedProfileId)?.result.model === stored.model,
    'The active model has no exact completed export provenance. Model inclusion is refused before upload.');
    bundle = buildModelBundle(stored.selectedProfileId, state.projects.find(project => project.id === projectId)?.method,
      stored.yRange, calibration.results, calibration.failures);
  } else {
    requireValue(bundle.model === stored.model && bundle.selectedProfileId === stored.selectedProfileId
      && bundle.engine === stored.engine && bundle.nFeatures === stored.nFeatures,
    'The retained owner export no longer describes the active fitted model; nothing was uploaded.');
  }
  return new Blob([await exportModelContainer(bundle)], { type: 'application/vnd.nirs4all.n4a' });
}

export async function importProjectModel(snapshot: ProjectWorkspace): Promise<StoredModel | undefined> {
  if (snapshot.modelDisposition !== 'included') return undefined;
  requireValue(snapshot.modelArchive, 'Missing included model archive.');
  const { importModelContainer } = await import('@/lib/modelIo');
  const result = await importModelContainer(snapshot.modelArchive);
  requireValue('model' in result, 'The included model is unsupported by the existing Quali owner import route.');
  const target = (result.model.model.state as { targetName?: string }).targetName;
  requireValue(target === (snapshot.project.method.target || 'y') && snapshot.spectra
    && result.model.nFeatures === cropSpectra(snapshot.spectra, snapshot.crop.from, snapshot.crop.to).axis.length,
  'Included model target or feature count differs from this project; no local state was applied.');
  return result.model;
}

export async function exportProjectWorkspace(snapshot: ProjectWorkspace): Promise<Blob> {
  admitProjectWorkspace(snapshot);
  const h = QUALI_WORKSPACE, packed = await packState(snapshot);
  const members = [{ path: h.path, bytes: packed.document }, ...packed.members];
  const paths = members.map(member => member.path), fingerprint = artifactDigest(packed.document);
  const manifest = {
    schema: 'nirs4all.n4a.container.v1', schema_version: 1, minimum_reader_version: 1,
    container_id: `container:quali.workspace.${crypto.randomUUID()}`, physical_profile: 'zip-stored.v1',
    required_features: [h.feature], links: [], entrypoints: [],
    members: paths.map(path => ({ path, byte_length: 0, sha256: '0'.repeat(64) })),
    artifacts: [{ id: h.path, kind: 'attachment', owner: h.owner,
      content_type: { id: h.schema, version: h.version },
      identity: { owner: h.owner, schema: h.schema, schema_version: h.version, fingerprint_profile: 'sha256.raw.v1', fingerprint },
      storage: { kind: 'embedded', root_member: h.path, member_paths: paths }, requirements: null }],
  };
  const { archiveBytes } = await writeN4aContainer(manifest, members);
  return new Blob([archiveBytes], { type: 'application/vnd.nirs4all.n4a' });
}

export async function importProjectWorkspace(source: N4aSource, expectedSha?: string): Promise<ProjectWorkspace> {
  const container = await openN4aContainer(source);
  try {
    const readability = container.view().readability;
    requireValue(expectedSha === undefined || /^[0-9a-f]{64}$/.test(expectedSha)
      && readability.container_sha256 === expectedSha, 'Downloaded workspace identity differs from its server artifact reference.');
    const manifest = readability.manifest, h = QUALI_WORKSPACE;
    const artifact = manifest.artifacts?.[0];
    const paths: unknown = artifact?.storage?.member_paths;
    requireValue(manifest.schema === 'nirs4all.n4a.container.v1' && manifest.schema_version === 1
      && manifest.physical_profile === 'zip-stored.v1'
      && JSON.stringify(manifest.required_features) === JSON.stringify([h.feature])
      && manifest.links?.length === 0 && manifest.entrypoints?.length === 0 && manifest.artifacts?.length === 1
      && artifact?.id === h.path && artifact.kind === 'attachment' && artifact.owner === h.owner
      && artifact.content_type?.id === h.schema && artifact.content_type?.version === h.version
      && artifact.identity?.owner === h.owner && artifact.identity?.schema === h.schema
      && artifact.identity?.schema_version === h.version && artifact.identity?.fingerprint_profile === 'sha256.raw.v1'
      && artifact.storage?.kind === 'embedded' && artifact.storage?.root_member === h.path
      && artifact.requirements === null && Array.isArray(paths) && paths.includes(h.path)
      && paths.every(path => path === h.path || typeof path === 'string' && /^workspace\/data\/[a-zA-Z0-9._/-]+$/.test(path))
      && manifest.members?.length === paths.length
      && manifest.members.every((member: { path: string }) => paths.includes(member.path)),
    'Readable container is not the supported Quali workspace attachment profile.');
    const document = await container.readMember(h.path);
    requireValue(document && artifact.identity.fingerprint === artifactDigest(document), 'Invalid workspace document identity.');
    const accessed = new Set<string>([h.path]);
    const value = await unpackState(document, async path => {
      requireValue(paths.includes(path), 'Workspace references an undeclared member.');
      const bytes = await container.readMember(path);
      requireValue(bytes, 'Missing workspace member.');
      accessed.add(path);
      return bytes;
    });
    requireValue(accessed.size === paths.length, 'Unreferenced workspace members are not supported.');
    return admitProjectWorkspace(value);
  } finally { container.close(); }
}

export function projectWorkspaceRecord(name: string, artifactSha: string): WorkspaceSnapshot {
  return { name, artifacts: [artifactSha], resources: [],
    metadata: { app: 'quali', schema_version: 1, workspace_artifact: artifactSha } };
}

export function workspaceArtifact(snapshot: WorkspaceSnapshot): string {
  const sha = snapshot.metadata.workspace_artifact;
  requireValue(snapshot.metadata.app === 'quali' && snapshot.metadata.schema_version === 1
    && typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha)
    && snapshot.artifacts.length === 1 && snapshot.artifacts[0] === sha && snapshot.resources.length === 0,
  'Unsupported server workspace metadata or artifact references.');
  return sha;
}
