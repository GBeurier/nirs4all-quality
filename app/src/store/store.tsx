// Minimal app store — React context + reducer over the lab domain model. Holds
// the current user, projects, samples, and the append-only audit trail. The
// engine lives outside the store (created lazily per run).
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';

import type { AuditEntry, Project, Sample, SampleStatus, User } from '@/domain/model';
import { cropSpectra, type SpectraDataset } from '@/domain/spectra';
import type { FittedModel, Metrics, RunResult } from '@/engine';
import { newId, nowIso } from '@/lib/ids';
import { loadState, saveState } from '@/lib/persist';

/** The active fitted model for a project (produced by Calibrate, used by Predict). */
export interface StoredModel {
  model: FittedModel;
  engine: string;
  pipelineName: string;
  metrics: Metrics;
  /** training reference range (for extrapolation detection) */
  yRange: [number, number];
  nFeatures: number;
  createdAt: string;
}

/** The last calibration run for a project — kept so navigating away and back to
 *  Calibrate restores the leaderboard instead of forgetting it. */
export interface CalibrationState {
  results: { variantId: string; result: RunResult }[];
  selectedId: string | null;
}

export interface LabState {
  user: User;
  projects: Project[];
  samplesByProject: Record<string, Sample[]>;
  /** actual spectra (per repetition) for the dataset viewer + replicate explorer */
  spectraByProject: Record<string, SpectraDataset>;
  /** optional spectral-tail crop per project (wavelength window); applied uniformly
   *  to analysis AND calibration via useProjectSpectra so feature counts stay consistent */
  cropByProject: Record<string, { from: number | null; to: number | null }>;
  /** display-only preprocessing preview per project (none/snv/d1/d2/msc/std) — shown
   *  in Explore and Data-health so the tech sees the corrected spectra */
  previewPpByProject: Record<string, string>;
  /** replicate handling for calibration: keep every raw replicate as a row, or the
   *  per-sample mean (default) */
  repModeByProject: Record<string, 'mean' | 'raw'>;
  /** the deployed model per project — the real predictor Predict uses (ephemeral, not persisted) */
  modelByProject: Record<string, StoredModel>;
  /** the last calibration leaderboard per project (ephemeral, not persisted) */
  calibByProject: Record<string, CalibrationState>;
  audit: AuditEntry[];
}

export type LabAction =
  | { kind: 'create_project'; project: Project; samples: Sample[]; spectra?: SpectraDataset }
  | { kind: 'set_sample_status'; projectId: string; sampleIds: string[]; status: SampleStatus; justification?: string }
  | { kind: 'set_references'; projectId: string; values: (number | null)[] }
  | { kind: 'set_crop'; projectId: string; from: number | null; to: number | null }
  | { kind: 'set_preview_pp'; projectId: string; pp: string }
  | { kind: 'set_rep_mode'; projectId: string; mode: 'mean' | 'raw' }
  | { kind: 'set_model'; projectId: string; model: StoredModel }
  | { kind: 'set_calibration'; projectId: string; calibration: CalibrationState }
  | { kind: 'audit'; entry: AuditEntry }
  | { kind: 'hydrate'; state: LabState };

function auditEntry(state: LabState, projectId: string, action: AuditEntry['action'], detail?: Record<string, unknown>, justification?: string): AuditEntry {
  return {
    id: newId('audit'),
    projectId,
    action,
    userId: state.user.id,
    role: state.user.role,
    at: nowIso(),
    ...(justification ? { justification } : {}),
    ...(detail ? { detail } : {}),
  };
}

function reducer(state: LabState, action: LabAction): LabState {
  switch (action.kind) {
    case 'create_project': {
      return {
        ...state,
        projects: [...state.projects, action.project],
        samplesByProject: { ...state.samplesByProject, [action.project.id]: action.samples },
        spectraByProject: { ...state.spectraByProject, [action.project.id]: action.spectra ?? { axis: [], axisUnit: 'nm', samples: [] } },
        cropByProject: { ...state.cropByProject, [action.project.id]: { from: null, to: null } },
        previewPpByProject: { ...state.previewPpByProject, [action.project.id]: 'none' },
        repModeByProject: { ...state.repModeByProject, [action.project.id]: 'mean' },
        audit: [
          ...state.audit,
          auditEntry(state, action.project.id, 'project_created', { name: action.project.name }),
          auditEntry(state, action.project.id, 'samples_imported', { count: action.samples.length }),
        ],
      };
    }
    case 'set_sample_status': {
      const current = state.samplesByProject[action.projectId] ?? [];
      const existing = new Map(current.map((s) => [s.id, s.status]));
      // only touch ids that actually exist → no phantom audit entries
      const targetIds = action.sampleIds.filter((id) => existing.has(id));
      if (targetIds.length === 0) return state;
      const ids = new Set(targetIds);
      const next = current.map((s) => (ids.has(s.id) ? { ...s, status: action.status } : s));
      // record before → after per sample for an auditable trail
      const changes = targetIds.map((id) => ({ id, from: existing.get(id), to: action.status }));
      return {
        ...state,
        samplesByProject: { ...state.samplesByProject, [action.projectId]: next },
        audit: [
          ...state.audit,
          auditEntry(state, action.projectId, 'sample_status_changed', { changes }, action.justification),
        ],
      };
    }
    case 'set_references': {
      // add/update references a posteriori (aligned to samples by order); a finite
      // value labels the sample (→ integrated), an empty/null one is left untouched.
      const current = state.samplesByProject[action.projectId] ?? [];
      let added = 0;
      const next = current.map((s, i) => {
        const v = action.values[i];
        if (typeof v === 'number' && Number.isFinite(v)) {
          added += 1;
          return { ...s, reference: { value: v, status: 'validated' as const }, status: 'integrated' as const };
        }
        return s;
      });
      if (added === 0) return state;
      return {
        ...state,
        samplesByProject: { ...state.samplesByProject, [action.projectId]: next },
        audit: [...state.audit, auditEntry(state, action.projectId, 'reference_imported', { count: added })],
      };
    }
    case 'set_crop': {
      // changing the spectral window changes the feature count → any deployed model /
      // calibration is now stale; drop them so Calibrate/Predict rebuild on the crop.
      const model = { ...state.modelByProject }; delete model[action.projectId];
      const calib = { ...state.calibByProject }; delete calib[action.projectId];
      return {
        ...state,
        cropByProject: { ...state.cropByProject, [action.projectId]: { from: action.from, to: action.to } },
        modelByProject: model,
        calibByProject: calib,
      };
    }
    case 'set_preview_pp':
      return { ...state, previewPpByProject: { ...state.previewPpByProject, [action.projectId]: action.pp } };
    case 'set_rep_mode': {
      // rep mode changes the training rows (mean vs every replicate) → drop any stale model
      const model = { ...state.modelByProject }; delete model[action.projectId];
      const calib = { ...state.calibByProject }; delete calib[action.projectId];
      return { ...state, repModeByProject: { ...state.repModeByProject, [action.projectId]: action.mode }, modelByProject: model, calibByProject: calib };
    }
    case 'set_model':
      return { ...state, modelByProject: { ...state.modelByProject, [action.projectId]: action.model } };
    case 'set_calibration':
      return { ...state, calibByProject: { ...state.calibByProject, [action.projectId]: action.calibration } };
    case 'audit':
      return { ...state, audit: [...state.audit, action.entry] };
    case 'hydrate':
      // defensively fill fields that older persisted states may lack
      return { ...action.state, modelByProject: action.state.modelByProject ?? {}, calibByProject: action.state.calibByProject ?? {}, cropByProject: action.state.cropByProject ?? {}, previewPpByProject: action.state.previewPpByProject ?? {}, repModeByProject: action.state.repModeByProject ?? {} };
    default:
      return state;
  }
}

const LabContext = createContext<{ state: LabState; dispatch: Dispatch<LabAction> } | null>(null);

export function LabProvider({ initial, children }: { initial: LabState; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hydrated, setHydrated] = useState(false);

  // On mount: replace the demo state with the persisted one (if any).
  useEffect(() => {
    let cancelled = false;
    loadState<LabState>().then((persisted) => {
      if (!cancelled && persisted && persisted.projects?.length) dispatch({ kind: 'hydrate', state: persisted });
      if (!cancelled) setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  // After hydration, auto-save on change (debounced). Never saves before the
  // load attempt, so it can't clobber persisted data with the demo state.
  useEffect(() => {
    if (!hydrated) return;
    // models + calibration runs are ephemeral (may hold WASM state) — persist
    // everything else; a fresh session rebuilds the model on demand in Predict.
    const t = setTimeout(() => { void saveState({ ...state, modelByProject: {}, calibByProject: {} }); }, 400);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  // Flush the latest state when the tab is hidden / the page is being unloaded —
  // so a quick reload right after creating a big project (whose parse/render was
  // still blocking the debounced save) doesn't lose it.
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const flush = () => { if (hydrated) void saveState({ ...latest.current, modelByProject: {}, calibByProject: {} }); };
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHidden); };
  }, [hydrated]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab() {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error('useLab must be used within a LabProvider');
  return ctx;
}

/** The project's spectra with its tail-crop applied — the SINGLE source every screen
 *  reads, so analysis, calibration and prediction all see the same feature axis. */
export function useProjectSpectra(projectId: string): SpectraDataset | undefined {
  const { state } = useLab();
  const full = state.spectraByProject[projectId];
  const crop = state.cropByProject[projectId];
  return useMemo(() => (full && crop ? cropSpectra(full, crop.from, crop.to) : full), [full, crop]);
}
