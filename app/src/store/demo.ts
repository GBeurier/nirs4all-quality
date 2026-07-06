// A small demo project so the app is explorable before real data is loaded.
import type { Project, Sample, User } from '@/domain/model';
import type { SampleStatus } from '@/domain/sampleStatusRef';
import { newId, nowIso } from '@/lib/ids';
import { makeDemoSpectra } from './demoSpectra';
import type { LabState } from './store';

const DEMO_USER: User = { id: 'u_demo', name: 'Opérateur démo', role: 'method_owner' };

function demoSamples(projectId: string): Sample[] {
  const sites = ['Montpellier', 'Cotonou', 'Yaoundé'];
  const samples: Sample[] = [];
  for (let i = 0; i < 42; i++) {
    // ~60% integrated (with a reference) so calibration has enough labelled data;
    // the rest split between measured and to-re-measure to drive the other screens.
    const cycle = i % 5;
    const status: SampleStatus = cycle < 3 ? 'integrated' : cycle === 3 ? 'nirs_measured' : 'to_remeasure';
    const hasRef = status === 'integrated';
    samples.push({
      id: `S${String(i + 1).padStart(3, '0')}`,
      projectId,
      lotId: `L${(i % 4) + 1}`,
      barcode: `QN-${String(100000 + i)}`,
      status,
      repetitions: [
        { id: newId('rep'), spectrumRef: `spec_${i}_a`, acquiredAt: nowIso() },
        { id: newId('rep'), spectrumRef: `spec_${i}_b`, acquiredAt: nowIso() },
      ],
      reference: hasRef
        ? { value: 5 + (i % 11) * 0.6, status: 'validated' }
        : null,
      metadata: { site: sites[i % sites.length] ?? 'Montpellier', year: 2024 + (i % 2), instrument: i % 2 === 0 ? 'FOSS-1' : 'Bruker-2' },
      createdAt: nowIso(),
    });
  }
  return samples;
}

export function makeDemoState(): LabState {
  const projectId = 'p_cassava';
  const project: Project = {
    id: projectId,
    name: 'Protéines — farine de manioc',
    method: {
      target: 'Protéines',
      unit: '%',
      basis: 'dry',
      matrix: 'farine de manioc',
      referenceMethod: 'Kjeldahl',
      sopVersion: 'SOP-PROT-v3',
      taskType: 'regression',
    },
    instrumentId: 'FOSS-1',
    hplcBudget: 15,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    activeModelVersionId: null,
  };
  const samples = demoSamples(projectId);
  return {
    user: DEMO_USER,
    projects: [project],
    samplesByProject: { [projectId]: samples },
    spectraByProject: { [projectId]: makeDemoSpectra(samples) },
    audit: [],
  };
}
