// Calibration variant catalog — SIX presets the lab tech ticks and runs
// (design §3 Écran 4). Two families:
//   • Cartesian — screen a Cartesian MATRIX of preprocessing (scatter × derivative)
//     with PLS (real libn4m WASM) or Ridge (honest JS numerics), keep the best combo.
//   • AOM (auto-selection) — screen a strict-linear operator bank with PLS or Ridge,
//     in a fast (compact bank) or slow (extended bank) tier.
// Grounded in nirs4all `examples/configs/pipelines/generator_search.yaml`
// (`_or_[SNV, MSC, Detrend]` × PLS `_range_`) and studio-lite's preset gallery.
import type { LabEngine, MaterializedDataset, PipelineDSL, PipelineStep, RunResult } from './port.js';
import { runJsVariant, runPlsScreenSteps, type JsRidgeScreenSpec, type RidgeChain } from './jsEngine.js';
import { OPERATOR_LABEL, type Operator } from './jsNumerics.js';
import { regressionMetrics } from './metrics.js';

export type VariantGroup = 'cart' | 'aom';
export type VariantTier = 'fast' | 'thorough';

interface WasmPlsScreenSpec { kind: 'wasm_pls_screen'; screen: { label: string; steps: PipelineStep[] }[]; maxComp: number; }
type Spec = WasmPlsScreenSpec | JsRidgeScreenSpec;

export interface CalibVariant {
  id: string;
  group: VariantGroup;
  tier: VariantTier;
  label: { fr: string; en: string };
  desc: { fr: string; en: string };
  spec: Spec;
  defaultOn: boolean;
}

// --- preprocessing building blocks (window-aware: SNV / MSC / detrend / Savitzky-Golay) ---
const snv = (): PipelineStep => ({ id: 'snv', type: 'StandardNormalVariate', params: {} });
const msc = (): PipelineStep => ({ id: 'msc', type: 'MultiplicativeScatterCorrection', params: {} });
const detrend = (degree = 1): PipelineStep => ({ id: `dt${degree}`, type: 'Detrend', params: { degree } });
const sg = (deriv: number, window = 15, poly = 2): PipelineStep =>
  ({ id: `sg${deriv}_${window}_${poly}`, type: 'SavitzkyGolay', params: { window_length: window, polyorder: poly, deriv } });

type StepOpt = { label: string; steps: PipelineStep[] };
function cartSteps(stages: StepOpt[][]): StepOpt[] {
  return stages.reduce<StepOpt[]>((acc, stage) => acc.flatMap((a) => stage.map((o) => ({
    label: [a.label, o.label].filter(Boolean).join(' + ') || 'brut',
    steps: [...a.steps, ...o.steps],
  }))), [{ label: '', steps: [] }]);
}
type OpOpt = { label: string; ops: Operator[] };
function cartOps(stages: OpOpt[][]): OpOpt[] {
  return stages.reduce<OpOpt[]>((acc, stage) => acc.flatMap((a) => stage.map((o) => ({
    label: [a.label, o.label].filter(Boolean).join(' + ') || 'brut',
    ops: [...a.ops, ...o.ops],
  }))), [{ label: '', ops: [] }]);
}

// --- Cartesian preprocessing matrices ---------------------------------------
// PLS: scatter {none, SNV} × derivative {none, smooth, d1, d2}  → 8 combos
const PLS_CART = cartSteps([
  [{ label: '', steps: [] }, { label: 'SNV', steps: [snv()] }],
  [{ label: '', steps: [] }, { label: 'liss.', steps: [sg(0)] }, { label: 'd1', steps: [sg(1)] }, { label: 'd2', steps: [sg(2, 17)] }],
]);
// Ridge: scatter {none, SNV} × derivative {none, d1, d2, detrend}  → 8 chains
const RIDGE_CART: RidgeChain[] = cartOps([
  [{ label: '', ops: [] }, { label: 'SNV', ops: ['snv'] }],
  [{ label: '', ops: [] }, { label: 'd1', ops: ['diff1'] }, { label: 'd2', ops: ['diff2'] }, { label: 'detrend', ops: ['detrend'] }],
]).map((c) => ({ label: c.label, ops: c.ops }));

// --- AOM operator banks (autonomous strict-linear operators, no manual scatter) ---
const AOM_PLS_FAST: StepOpt[] = [
  { label: 'brut', steps: [] }, { label: 'liss.', steps: [sg(0)] }, { label: 'd1', steps: [sg(1)] }, { label: 'd2', steps: [sg(2, 17)] },
];
// Extended AOM-PLS bank — a real ~19-combo screen grounded in nirs4all-aom's
// `default_bank()` SG family (windows 11/15/21/31, poly 2/3, deriv 0/1/2) +
// scatter {SNV, MSC, detrend} + the composed scatter×derivative chains the
// examples advertise (SNV+d1, MSC+d1, detrend+d1). Every window/deriv now yields
// a genuinely distinct column set (real Savitzky-Golay), so the matrix is not a
// window-blind duplicate list.
const AOM_PLS_SLOW: StepOpt[] = [
  { label: 'brut', steps: [] },
  { label: 'SNV', steps: [snv()] },
  { label: 'MSC', steps: [msc()] },
  { label: 'detrend¹', steps: [detrend(1)] },
  { label: 'detrend²', steps: [detrend(2)] },
  { label: 'liss.·w11', steps: [sg(0, 11)] },
  { label: 'liss.·w21', steps: [sg(0, 21)] },
  { label: 'd1·w11', steps: [sg(1, 11)] },
  { label: 'd1·w15', steps: [sg(1, 15)] },
  { label: 'd1·w21', steps: [sg(1, 21)] },
  { label: 'd1·w25·p3', steps: [sg(1, 25, 3)] },
  { label: 'd2·w15', steps: [sg(2, 15)] },
  { label: 'd2·w21', steps: [sg(2, 21)] },
  { label: 'd2·w25·p3', steps: [sg(2, 25, 3)] },
  { label: 'SNV+d1·w11', steps: [snv(), sg(1, 11)] },
  { label: 'SNV+d2·w21', steps: [snv(), sg(2, 21)] },
  { label: 'MSC+d1·w15', steps: [msc(), sg(1, 15)] },
  { label: 'detrend¹+d1·w15', steps: [detrend(1), sg(1, 15)] },
  { label: 'SNV+liss.·w11', steps: [snv(), sg(0, 11)] },
];
const AOM_RIDGE_FAST: RidgeChain[] = [
  { label: 'brut', ops: [] }, { label: 'd1', ops: ['diff1'] }, { label: 'd2', ops: ['diff2'] },
];
const AOM_RIDGE_SLOW: RidgeChain[] = [
  { label: 'brut', ops: [] }, { label: 'd1', ops: ['diff1'] }, { label: 'd2', ops: ['diff2'] },
  { label: 'detrend', ops: ['detrend'] }, { label: 'detrend+d1', ops: ['detrend', 'diff1'] }, { label: 'SNV', ops: ['snv'] }, { label: 'SNV+d1', ops: ['snv', 'diff1'] },
];

const jsAxis = { fr: 'combo de préprocessing screené', en: 'screened preprocessing combo' };

export const CALIB_VARIANTS: CalibVariant[] = [
  {
    id: 'pls-cart', group: 'cart', tier: 'thorough',
    label: { fr: 'PLS + cartésien', en: 'PLS + cartesian' },
    desc: { fr: `Balaie une matrice cartésienne de préprocessing — diffusion {aucune, SNV} × dérivée {aucune, lissage, 1re, 2de} = ${PLS_CART.length} combinaisons — avec PLS (composantes balayées), et retient la meilleure.`, en: `Sweeps a Cartesian preprocessing matrix — scatter {none, SNV} × derivative {none, smooth, 1st, 2nd} = ${PLS_CART.length} combos — with PLS (components swept), keeping the best.` },
    spec: { kind: 'wasm_pls_screen', screen: PLS_CART, maxComp: 15 }, defaultOn: true,
  },
  {
    id: 'ridge-cart', group: 'cart', tier: 'thorough',
    label: { fr: 'Ridge + cartésien', en: 'Ridge + cartesian' },
    desc: { fr: `Même matrice cartésienne — diffusion {aucune, SNV} × dérivée {aucune, 1re, 2de, detrend} = ${RIDGE_CART.length} combinaisons — avec une régression Ridge (α balayé), meilleure combinaison retenue.`, en: `Same Cartesian matrix — scatter {none, SNV} × derivative {none, 1st, 2nd, detrend} = ${RIDGE_CART.length} combos — with Ridge regression (α swept), keeping the best combo.` },
    spec: { kind: 'js_ridge_screen', chains: RIDGE_CART, alphas: [0.01, 0.1, 1, 10, 100], axis: jsAxis }, defaultOn: true,
  },
  {
    id: 'fast-aom-pls', group: 'aom', tier: 'fast',
    label: { fr: 'AOM-PLS rapide', en: 'Fast AOM-PLS' },
    desc: { fr: 'AOM-PLS, banc d’opérateurs compact (brut / lissage / dérivées) avec PLS — sélection rapide du meilleur opérateur.', en: 'AOM-PLS, compact operator bank (raw / smooth / derivatives) with PLS — fast best-operator selection.' },
    spec: { kind: 'wasm_pls_screen', screen: AOM_PLS_FAST, maxComp: 10 }, defaultOn: true,
  },
  {
    id: 'fast-aom-ridge', group: 'aom', tier: 'fast',
    label: { fr: 'AOM-Ridge rapide', en: 'Fast AOM-Ridge' },
    desc: { fr: 'AOM-Ridge, banc compact (brut / dérivées) avec Ridge et petite grille α — rapide.', en: 'AOM-Ridge, compact bank (raw / derivatives) with Ridge and a small α grid — fast.' },
    spec: { kind: 'js_ridge_screen', chains: AOM_RIDGE_FAST, alphas: [0.1, 1, 10], axis: jsAxis }, defaultOn: true,
  },
  {
    id: 'slow-aom-pls', group: 'aom', tier: 'thorough',
    label: { fr: 'AOM-PLS approfondi', en: 'Slow AOM-PLS' },
    desc: { fr: `AOM-PLS, banc étendu de ${AOM_PLS_SLOW.length} préprocessings (diffusion SNV/MSC/detrend × dérivées SG 1re/2de à fenêtres 11–25 × compositions) avec PLS jusqu'à 25 composantes — plus lent, calqué sur le banc « default » de nirs4all-aom.`, en: `AOM-PLS, extended ${AOM_PLS_SLOW.length}-preprocessing bank (scatter SNV/MSC/detrend × SG 1st/2nd derivatives at windows 11–25 × compositions) with PLS up to 25 components — slower, mirroring nirs4all-aom's "default" bank.` },
    spec: { kind: 'wasm_pls_screen', screen: AOM_PLS_SLOW, maxComp: 25 }, defaultOn: false,
  },
  {
    id: 'slow-aom-ridge', group: 'aom', tier: 'thorough',
    label: { fr: 'AOM-Ridge approfondi', en: 'Slow AOM-Ridge' },
    desc: { fr: 'AOM-Ridge, banc étendu (dérivées + detrend + compositions SNV) avec Ridge et grande grille α — plus lent, plus exhaustif.', en: 'AOM-Ridge, extended bank (derivatives + detrend + SNV compositions) with Ridge and a large α grid — slower, more exhaustive.' },
    spec: { kind: 'js_ridge_screen', chains: AOM_RIDGE_SLOW, alphas: [0.001, 0.01, 0.1, 1, 10, 100, 1000], axis: jsAxis }, defaultOn: false,
  },
];

function plsDsl(name: string, steps: PipelineStep[], maxComp: number): PipelineDSL {
  return { name, steps, model: { id: 'm', type: 'PLS', params: { n_components: maxComp } } };
}

/** Run one variant, returning its RunResult (or null if it failed to fit). */
export async function runVariant(ds: MaterializedDataset, v: CalibVariant, wasm: LabEngine): Promise<RunResult | null> {
  const spec = v.spec;
  const cap = (want: number) => Math.max(1, Math.min(want, Math.floor(ds.nSamples * 0.55), ds.nFeatures));
  try {
    if (spec.kind === 'wasm_pls_screen') {
      let best: RunResult | null = null;
      const variants: NonNullable<RunResult['variants']> = [];
      for (let k = 0; k < spec.screen.length; k++) {
        const s = spec.screen[k]!;
        try {
          const res = await wasm.run(ds, plsDsl(`${v.label.fr} · ${s.label}`, s.steps, cap(spec.maxComp)));
          const rmse = res.refit.metrics.rmse ?? Number.POSITIVE_INFINITY;
          variants.push({ x: k, rmse, selected: false, label: s.label });
          if (!best || (best.refit.metrics.rmse ?? Infinity) > rmse) best = res;
        } catch { /* combo failed to fit on the WASM path — the JS fallback below covers it */ }
      }
      if (!best) {
        // the libn4m WASM PLS path is unavailable/incompatible → in-browser PLS,
        // screening the REAL preprocessing steps (window-aware Savitzky-Golay/MSC)
        const res = runPlsScreenSteps(ds, spec.screen, cap(spec.maxComp), v.label.fr);
        return { ...res, engine: v.group === 'aom' ? `${res.engine} · AOM` : `${res.engine} · cart` };
      }
      const bestRmse = best.refit.metrics.rmse ?? Infinity;
      variants.forEach((z) => { z.selected = z.rmse === bestRmse; });
      return {
        ...best,
        id: `${v.id}-${ds.nSamples}`,
        pipelineName: v.label.fr,
        engine: v.group === 'aom' ? `${best.engine} · AOM` : `${best.engine} · cart`,
        variants,
        variantAxis: { fr: 'combo de préprocessing screené', en: 'screened preprocessing combo', categorical: true },
      };
    }
    // js_ridge_screen
    return runJsVariant(ds, spec, v.label.fr);
  } catch (err) {
    console.warn(`[quali-nirs4all] variante ${v.id} échouée`, err);
    return null;
  }
}

/** Convenience: RMSE for leaderboard sort (missing → +∞). */
export function variantScore(r: RunResult): number {
  return r.refit.metrics.rmse ?? Number.POSITIVE_INFINITY;
}

/** A display-only pipeline description (composition strip in TrainingResults). */
export function describeVariant(v: CalibVariant, selectedLabel?: string): { name: string; steps: PipelineStep[]; model: PipelineStep } {
  const s = v.spec;
  const total = s.kind === 'wasm_pls_screen' ? s.screen.length : s.chains.length;
  // when a combo was selected, show the CHOSEN preprocessing prominently as the step
  // (design §8: display the preprocessing AOM/PLS/Ridge actually picked), with the
  // screen size as its parameter; otherwise show the screen itself.
  const step: PipelineStep = selectedLabel
    ? { id: 'preproc', type: `préproc. retenu : ${selectedLabel}`, params: { 'sur': `${total} testés` } }
    : { id: 'screen', type: s.kind === 'wasm_pls_screen' ? `cartésien (${total} combos)` : `screen (${total} chaînes)`, params: {} };
  const model: PipelineStep = { id: 'm', type: s.kind === 'wasm_pls_screen' ? 'PLS' : 'Ridge', params: {} };
  return { name: v.label.fr, steps: [step], model };
}

export { regressionMetrics, OPERATOR_LABEL };
