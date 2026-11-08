import type { CandidateIssue, PipelineStep } from './port.js';
import { candidateIssue, PreprocessingRefusal, validatePreprocessingStep } from './preprocessing.js';

export interface PlsBank {
  screen: { label: string; steps: PipelineStep[] }[];
  maxComp: number;
}
export interface RoleStep { class: string; params: Record<string, unknown> }
export interface PlsChain { chain: number; label: string; steps: RoleStep[] }
export interface LoweredPlsBank {
  chains: PlsChain[];
  components: number[];
  candidateIssues: CandidateIssue[];
}

/** B1 mapping. Component values are a separate native generation axis. */
export function lowerPlsSteps(steps: PipelineStep[], n?: number): RoleStep[] {
  const lowered = steps.map((step): RoleStep => {
    validatePreprocessingStep(step, 'wasm');
    if (step.type === 'StandardNormalVariate') return { class: 'n4m:preprocessing.scatter.snv', params: { ddof: 0 } };
    const p = step.params;
    return { class: 'n4m:preprocessing.derivatives.savitzky_golay', params: {
      window_length: p['window_length'] ?? 11, polyorder: p['polyorder'] ?? 3,
      deriv: p['deriv'] ?? 0, delta: 1, mode: p['mode'] ?? 'nearest', cval: p['cval'] ?? 0,
    } };
  });
  return [...lowered, { class: 'n4m:models.pls.pls_regression', params: {
    ...(n === undefined ? {} : { n_components: n }),
    solver: 'simpls', center_x: true, scale_x: true, center_y: true, scale_y: true,
  } }];
}

/** Lower ordered bank data; DAG owns the Cartesian expansion and all selection. */
export function lowerPlsBank(bank: PlsBank, rows: number, cols: number): LoweredPlsBank {
  if (!Number.isInteger(bank.maxComp) || bank.maxComp < 1) throw new Error('PLS n_components must be a positive integer.');
  const cap = Math.max(1, Math.min(bank.maxComp, Math.floor(rows * 0.55), cols));
  const chains: PlsChain[] = [], candidateIssues: CandidateIssue[] = [];
  bank.screen.forEach((chain, k) => {
    try { chains.push({ chain: k, label: chain.label, steps: lowerPlsSteps(chain.steps) }); }
    catch (error) {
      if (!(error instanceof PreprocessingRefusal)) throw error;
      candidateIssues.push(candidateIssue(chain.label, 'wasm', error));
    }
  });
  return { chains, components: Array.from({ length: cap }, (_, i) => i + 1), candidateIssues };
}
