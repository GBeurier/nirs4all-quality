// Minimal app store — React context + reducer over the lab domain model. Holds
// the current user, projects, samples, and the append-only audit trail. The
// engine lives outside the store (created lazily per run).
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';

import type { AuditEntry, Project, Sample, SampleStatus, User } from '@/domain/model';
import type { SpectraDataset } from '@/domain/spectra';
import { newId, nowIso } from '@/lib/ids';
import { loadState, saveState } from '@/lib/persist';

export interface LabState {
  user: User;
  projects: Project[];
  samplesByProject: Record<string, Sample[]>;
  /** actual spectra (per repetition) for the dataset viewer + replicate explorer */
  spectraByProject: Record<string, SpectraDataset>;
  audit: AuditEntry[];
}

export type LabAction =
  | { kind: 'create_project'; project: Project; samples: Sample[]; spectra?: SpectraDataset }
  | { kind: 'set_sample_status'; projectId: string; sampleIds: string[]; status: SampleStatus; justification?: string }
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
    case 'audit':
      return { ...state, audit: [...state.audit, action.entry] };
    case 'hydrate':
      return action.state;
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
    const t = setTimeout(() => { void saveState(state); }, 400);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab() {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error('useLab must be used within a LabProvider');
  return ctx;
}
