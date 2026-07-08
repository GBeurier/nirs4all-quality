import { ModelReportCard } from 'nirs4all-ui/lab';
import { Loader2, Play, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { createEngine, type LabEngine, type RunResult } from '@/engine';
import { CALIB_VARIANTS, describeVariant, runVariant, variantScore, type CalibVariant, type VariantGroup } from '@/engine/variants';
import { downloadJson, downloadText, slug, toCsv } from '@/lib/export';
import { buildTrainingDataset } from '@/lib/trainingData';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra, type StoredModel } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';
import { TrainingResults } from '@/screens/TrainingResults';

interface Scored { variant: CalibVariant; result: RunResult; }

const GROUP_LABEL: Record<VariantGroup, { fr: string; en: string }> = {
  cart: { fr: 'Cartésien (matrice de préprocessing)', en: 'Cartesian (preprocessing matrix)' },
  aom: { fr: 'AOM (auto-sélection)', en: 'AOM (auto-selection)' },
};
const GROUP_ORDER: VariantGroup[] = ['cart', 'aom'];

// §3 Écran 4 — build the model. A RICH chooser: the tech ticks a matrix of
// preprocessing × PLS / Ridge / AOM variants and launches; each runs (PLS on real
// libn4m WASM, Ridge/AOM-Ridge on honest JS numerics) on the project's REAL
// spectra + references, ranked in a leaderboard with the best promoted to the
// report card + training charts.
export function Calibrate({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const spectra = useProjectSpectra(projectId);
  const repMode = state.repModeByProject[projectId] ?? 'mean';
  const labelled = samples.filter((s) => s.reference?.value != null);

  const storedCalib = state.calibByProject[projectId];
  const [checked, setChecked] = useState<Set<string>>(() => new Set(CALIB_VARIANTS.filter((v) => v.defaultOn).map((v) => v.id)));
  // restore the last leaderboard on remount (e.g. after navigating away and back)
  const [scored, setScored] = useState<Scored[] | null>(() =>
    storedCalib
      ? storedCalib.results
          .map((r) => ({ variant: CALIB_VARIANTS.find((v) => v.id === r.variantId), result: r.result }))
          .filter((s): s is Scored => !!s.variant)
      : null);
  const [selectedId, setSelectedId] = useState<string | null>(() => storedCalib?.selectedId ?? null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');

  const persistCalib = (results: Scored[], sel: string | null) =>
    dispatch({ kind: 'set_calibration', projectId, calibration: { results: results.map((s) => ({ variantId: s.variant.id, result: s.result })), selectedId: sel } });

  // The REAL training dataset (mean spectrum per labelled sample + its reference)
  // — shared with Predict so parity/metrics/predictions reflect the actual data.
  const ds = useMemo(() => buildTrainingDataset(spectra, samples, project?.method.target || 'y', repMode), [spectra, samples, project, repMode]);
  const trainable = ds.nSamples >= 8 && ds.nFeatures > 0;
  const yRange = useMemo((): [number, number] => {
    const ys = Array.from(ds.y);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1];
  }, [ds]);

  // deploy a scored pipeline as the project's active model (Predict uses it)
  const deploy = (s: Scored) => {
    const m: StoredModel = {
      model: s.result.model, engine: s.result.engine, pipelineName: tr(s.variant.label.fr, s.variant.label.en),
      metrics: s.result.refit.metrics, yRange, nFeatures: ds.nFeatures, createdAt: s.result.createdAt,
    };
    dispatch({ kind: 'set_model', projectId, model: m });
  };
  const pick = (s: Scored) => { setSelectedId(s.variant.id); deploy(s); if (scored) persistCalib(scored, s.variant.id); };

  async function launch() {
    const chosen = CALIB_VARIANTS.filter((v) => checked.has(v.id));
    if (chosen.length === 0) return;
    setRunning(true); setScored(null); setSelectedId(null);
    const wasm: LabEngine = await createEngine();
    const out: Scored[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const v = chosen[i]!;
      setProgress(tr(`Calibration ${i + 1}/${chosen.length} : ${v.label.fr}…`, `Calibrating ${i + 1}/${chosen.length}: ${v.label.en}…`));
      const result = await runVariant(ds, v, wasm);
      if (result) out.push({ variant: v, result });
    }
    out.sort((a, b) => variantScore(a.result) - variantScore(b.result));
    setScored(out);
    setSelectedId(out[0]?.variant.id ?? null);
    if (out[0]) deploy(out[0]); // the best pipeline becomes the project's active model
    persistCalib(out, out[0]?.variant.id ?? null); // survive navigation away and back
    setRunning(false); setProgress('');
  }

  const toggle = (id: string) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selected = scored?.find((s) => s.variant.id === selectedId) ?? null;
  const best = scored?.[0] ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Calibrer le modèle', 'Calibrate the model')}</h1>
        <Explain content={EXPLAIN.calibrationChooser} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {tr(`${labelled.length} échantillons avec référence. Cochez les pipelines à comparer, puis lancez — chacun est évalué sur un test gelé.`,
          `${labelled.length} samples with a reference. Tick the pipelines to compare, then run — each is scored on a frozen test.`)}
      </p>

      {/* variant chooser (checkbox matrix) */}
      <div className="mb-4 space-y-3">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="card p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr(GROUP_LABEL[g].fr, GROUP_LABEL[g].en)}
              {g === 'cart' && <Explain content={EXPLAIN.cartesianMatrix} />}
              {g === 'aom' && <Explain content={EXPLAIN.aomVariants} />}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CALIB_VARIANTS.filter((v) => v.group === g).map((v) => (
                <label key={v.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition ${checked.has(v.id) ? 'border-primary/50 bg-primary/[0.04]' : 'border-border hover:bg-muted/40'}`}>
                  <input type="checkbox" checked={checked.has(v.id)} onChange={() => toggle(v.id)} className="mt-0.5 accent-[var(--primary)]" />
                  <span>
                    <span className="font-medium">{tr(v.label.fr, v.label.en)}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{tr(v.desc.fr, v.desc.en)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex items-center gap-3">
        <button className="btn-primary disabled:opacity-50" onClick={launch} disabled={running || !trainable || checked.size === 0}>
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {running ? tr('Calibration…', 'Calibrating…') : tr(`Lancer la calibration (${checked.size})`, `Run calibration (${checked.size})`)}
        </button>
        {running && <span className="text-xs text-muted-foreground">{progress}</span>}
        {!trainable && <span className="text-xs text-warning">{tr('Il faut au moins 8 échantillons avec cible et des spectres.', 'Need at least 8 samples with a target and spectra.')}</span>}
      </div>

      {scored && scored.length > 0 && best && (
        <>
          {/* leaderboard */}
          <div className="mb-5 card p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
              <Trophy size={15} className="text-primary" /> {tr('Classement des pipelines', 'Pipeline leaderboard')}
              <Explain content={EXPLAIN.leaderboard} />
              <span className="ml-auto text-xs font-normal text-muted-foreground">{tr('trié par RMSE (test gelé)', 'sorted by RMSE (frozen test)')}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">#</th>
                  <th className="px-3 py-1.5">{tr('Pipeline', 'Pipeline')}</th>
                  <th className="px-3 py-1.5 text-right">RMSE</th>
                  <th className="px-3 py-1.5 text-right">R²</th>
                  <th className="px-3 py-1.5 text-right">RPD</th>
                  <th className="px-3 py-1.5 text-right">RPIQ</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((s, i) => {
                  const m = s.result.refit.metrics;
                  const on = s.variant.id === selectedId;
                  return (
                    <tr key={s.variant.id} onClick={() => pick(s)}
                      className={`cursor-pointer border-t border-border ${on ? 'bg-primary/[0.06]' : 'hover:bg-muted/40'}`}>
                      <td className="px-3 py-2">{i === 0 ? '🏆' : i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{tr(s.variant.label.fr, s.variant.label.en)}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.result.engine}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{fmt(m.rmse)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(m.r2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(m.rpd)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(m.rpiq)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* best (or selected) report card + training details */}
          {selected && <VariantDetail scored={selected} bestId={best.variant.id} lang={lang} tr={tr} />}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => selected && downloadText(
              `${slug(project?.name ?? 'projet')}-${slug(selected.variant.label.en)}-predictions.csv`,
              toCsv(selected.result.refit.predictions.map((r) => ({ sample_id: r.sampleId, observed: r.actual, predicted: r.predicted, residual: r.residual })),
                ['sample_id', 'observed', 'predicted', 'residual']))}>
              {tr('Exporter les prédictions (CSV)', 'Export predictions (CSV)')}
            </button>
            <button className="btn-outline" onClick={() => selected && downloadJson(`${slug(project?.name ?? 'projet')}.n4a.json`, {
              format: 'quali-nirs4all/n4a', version: 1, createdAt: selected.result.createdAt, engine: selected.result.engine,
              method: project?.method, pipeline: selected.variant.label.en, leaderboard: scored.map((s) => ({ pipeline: s.variant.label.en, engine: s.result.engine, metrics: s.result.refit.metrics })),
              metrics: selected.result.refit.metrics, model: selected.result.model,
              nFeatures: selected.result.model.nFeatures, yRange,
            })}>
              {tr('Exporter le modèle (.n4a)', 'Export model (.n4a)')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VariantDetail({ scored, bestId, lang, tr }: { scored: Scored; bestId: string; lang: 'fr' | 'en'; tr: (fr: string, en: string) => string }) {
  const m = scored.result.refit.metrics;
  const isBest = scored.variant.id === bestId;
  // pipeline-composition strip: the chosen setting (best n_components / α / operator)
  const sel = scored.result.variants?.find((z) => z.selected);
  const selLabel = sel ? (sel.label ?? String(sel.x)) : undefined;
  const dsl = describeVariant(scored.variant, selLabel);
  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-medium">{tr('Modèle retenu', 'Selected model')} : {tr(scored.variant.label.fr, scored.variant.label.en)}</span>
        {isBest && <span className="n4-pill n4-pill--green">🏆 {tr('meilleur', 'best')}</span>}
      </div>
      <ModelReportCard
        locale={lang}
        metrics={{ rmse: m.rmse ?? null, r2: m.r2 ?? null, rpd: m.rpd ?? null, rpiq: m.rpiq ?? null, bias: m.bias ?? null, n: m.n ?? null }}
        title={<span className="font-medium">{tr('Bulletin du modèle', 'Model report card')}</span>}
        className="mb-4 rounded-xl border border-border bg-card p-4"
        headerClassName="mb-3 flex flex-col gap-1"
        gradeLabelClassName="text-lg font-semibold"
        verdictClassName="text-sm"
        metricsClassName="grid grid-cols-1 gap-2 sm:grid-cols-2"
        metricRowClassName="rounded-lg bg-muted/40 p-2"
        metricLabelClassName="text-xs font-medium text-muted-foreground"
        metricValueClassName="text-lg font-semibold"
        metricReadingClassName="block text-xs text-muted-foreground"
      />
      <TrainingResults dsl={dsl} result={scored.result} />
    </>
  );
}

function fmt(v: number | undefined | null): string {
  return v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toExponential(2) : v.toFixed(3);
}
