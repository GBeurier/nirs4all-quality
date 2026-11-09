import { buildModelReportView, ModelReportCard } from 'nirs4all-ui/lab';
import { Loader2, Play } from 'lucide-react';
import { useMemo, useState } from 'react';

import { createEngine, evaluationLabel, evaluationNote, type LabEngine, type RunResult } from '@/engine';
import { CALIB_VARIANTS, describeVariant, runVariant, type CalibVariant, type VariantGroup } from '@/engine/variants';
import { downloadBytes, downloadText, slug, toCsv } from '@/lib/export';
import { buildTrainingDataset } from '@/lib/trainingData';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra, type StoredModel } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';
import { TrainingResults } from '@/screens/TrainingResults';
import { exportModelContainer, QUALI_HOST } from '@/lib/modelIo';
import { populationLabel } from '@/engine/evaluation';
import { validateCalibrationDataset } from '@/engine/evaluation';

interface Scored { variant: CalibVariant; result: RunResult; }
interface Failure { label: string; reason: string; candidateIssues?: RunResult['candidateIssues'] }

const GROUP_LABEL: Record<VariantGroup, { fr: string; en: string }> = {
  cart: { fr: 'Cartésien (matrice de préprocessing)', en: 'Cartesian (preprocessing matrix)' },
  aom: { fr: 'AOM (auto-sélection)', en: 'AOM (auto-selection)' },
};
const GROUP_ORDER: VariantGroup[] = ['cart', 'aom'];

// Every owner profile keeps its own selection population. Activation is explicit.
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
  const [failures, setFailures] = useState<Failure[]>(storedCalib?.failures ?? []);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const persistCalib = (results: Scored[], sel: string | null, recordedFailures = failures) =>
    dispatch({ kind: 'set_calibration', projectId, calibration: { results: results.map((s) => ({ variantId: s.variant.id, result: s.result })), selectedId: sel, failures: recordedFailures } });

  // The REAL training dataset (mean spectrum per labelled sample + its reference)
  // — shared with Predict so parity/metrics/predictions reflect the actual data.
  const ds = useMemo(() => buildTrainingDataset(spectra, samples, project?.method.target || 'y', repMode), [spectra, samples, project, repMode]);
  const calibrationError = useMemo(() => {
    try { validateCalibrationDataset(ds); return null; }
    catch (err) { return err instanceof Error ? err.message : String(err); }
  }, [ds]);
  const trainable = calibrationError === null;
  const yRange = useMemo((): [number, number] => {
    const ys = Array.from(ds.y);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1];
  }, [ds]);

  // deploy a scored pipeline as the project's active model (Predict uses it)
  const deploy = (s: Scored) => {
    const m: StoredModel = {
      model: s.result.model, engine: s.result.engine, pipelineName: tr(s.variant.label.fr, s.variant.label.en),
      ...(s.result.refit.ownerReport ? { ownerReport: s.result.refit.ownerReport } : {}),
      population: s.result.population!, selectedProfileId: s.variant.id,
      metrics: s.result.refit.metrics, yRange, nFeatures: ds.nFeatures, createdAt: s.result.createdAt,
      ...(s.result.evaluation ? { evaluation: s.result.evaluation } : {}),
    };
    dispatch({ kind: 'set_model', projectId, model: m });
  };
  const pick = (s: Scored) => { setSelectedId(s.variant.id); deploy(s); if (scored) persistCalib(scored, s.variant.id); };

  async function launch() {
    const chosen = CALIB_VARIANTS.filter((v) => checked.has(v.id));
    if (chosen.length === 0) return;
    setRunning(true); setScored(null); setSelectedId(null); setFailures([]);
    try {
      const wasm: LabEngine = await createEngine();
      const out: Scored[] = [];
      const recordedFailures: Failure[] = [];
      for (let i = 0; i < chosen.length; i++) {
        const v = chosen[i]!;
        setProgress(tr(`Calibration ${i + 1}/${chosen.length} : ${v.label.fr}…`, `Calibrating ${i + 1}/${chosen.length}: ${v.label.en}…`));
        try {
          const result = await runVariant(ds, v, wasm);
          out.push({ variant: v, result });
        } catch (err) {
          const issues = err && typeof err === 'object' && 'candidateIssues' in err && Array.isArray(err.candidateIssues)
            ? err.candidateIssues as NonNullable<RunResult['candidateIssues']> : undefined;
          recordedFailures.push({ label: v.label.en, reason: err instanceof Error ? err.message : String(err),
            ...(issues ? { candidateIssues: issues } : {}) });
          setFailures([...recordedFailures]);
        }
      }
      setScored(out); // Catalog order, with every completed profile retained.
      setSelectedId(null);
      persistCalib(out, null, recordedFailures); // No automatic deployment or inter-profile rank.
    } catch (err) {
      const failed = [{ label: 'Calibration', reason: err instanceof Error ? err.message : String(err) }];
      setFailures(failed); setScored([]); persistCalib([], null, failed);
    } finally {
      setRunning(false); setProgress('');
    }
  }

  const toggle = (id: string) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selected = scored?.find((s) => s.variant.id === selectedId) ?? null;
  async function exportSelected() {
    if (!selected || !scored) return;
    setExporting(true); setExportError(null);
    try {
      const r = selected.result;
      const bytes = await exportModelContainer({
        schema: QUALI_HOST.schema, schema_version: 1, selectedProfileId: selected.variant.id,
        createdAt: r.createdAt, engine: r.engine, method: project?.method, pipeline: selected.variant.label.en,
        targetName: r.targetName, model: r.model, nFeatures: r.model.nFeatures, yRange,
        population: r.population, metrics: r.refit.metrics, ownerReport: r.refit.ownerReport,
        evaluation: r.evaluation, candidateIssues: r.candidateIssues ?? [], failedPipelines: failures,
        leaderboard: scored.map(({ variant, result }) => ({ profileId: variant.id, pipeline: variant.label.en,
          engine: result.engine, metrics: result.refit.metrics, ownerReport: result.refit.ownerReport,
          population: result.population, evaluation: result.evaluation, candidateIssues: result.candidateIssues ?? [] })),
      });
      downloadBytes(`${slug(project?.name ?? 'project')}.n4a`, bytes);
    } catch (error) { setExportError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Calibrer le modèle', 'Calibrate the model')}</h1>
        <Explain content={EXPLAIN.calibrationChooser} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {`${labelled.length} samples with a reference. Select pipelines to compare using selection validation. Independent prediction error is not measured by this screen. Backend refusals and failures are listed in result details.`}
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
        {calibrationError && <span className="text-xs text-warning">{calibrationError}</span>}
      </div>

      {failures.length > 0 && <div role="alert" className="mb-4 card p-3 text-sm">
        <p>Some pipelines could not be scored:</p>
        <ul>{failures.map((failure, i) => <li key={i}>{failure.label}: {failure.reason}</li>)}</ul>
      </div>}
      {scored && scored.length > 0 && (
        <>
          {/* leaderboard */}
          <div className="mb-5 card p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
              Profile results
              <span className="ml-auto text-xs font-normal text-muted-foreground">Catalog order; click a profile to activate it</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5">Selected</th>
                  <th className="px-3 py-1.5">{tr('Pipeline', 'Pipeline')}</th>
                  <th className="px-3 py-1.5 text-right">RMSE</th>
                  <th className="px-3 py-1.5 text-right">R²</th>
                  <th className="px-3 py-1.5 text-right">RPD</th>
                  <th className="px-3 py-1.5 text-right">RPIQ</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((s) => {
                  const m = s.result.refit.metrics;
                  const reasons = s.result.refit.ownerReport?.undefined_metrics;
                  const on = s.variant.id === selectedId;
                  return (
                    <tr key={s.variant.id} onClick={() => pick(s)}
                      className={`cursor-pointer border-t border-border ${on ? 'bg-primary/[0.06]' : 'hover:bg-muted/40'}`}>
                      <td className="px-3 py-2">{on ? '✓' : ''}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{tr(s.variant.label.fr, s.variant.label.en)}</span>
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.result.engine}</span>
                        <span className="block text-xs text-muted-foreground">{evaluationLabel(s.result.evaluation)} · {populationLabel(s.result.population)}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{fmt(m.rmse)}</td>
                      <td className="px-3 py-2 text-right font-mono">{reasons?.['r2'] ? `undefined (${reasons['r2']})` : fmt(m.r2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{reasons?.['rpd'] ? `undefined (${reasons['rpd']})` : fmt(m.rpd)}</td>
                      <td className="px-3 py-2 text-right font-mono">{reasons?.['rpiq'] ? `undefined (${reasons['rpiq']})` : fmt(m.rpiq)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!selected && <p className="mb-3 text-sm">No profile was activated by this launch. Populations are not ranked against each other. Click a completed profile to activate it.</p>}
          {/* Explicitly selected report and training details. */}
          {selected && <VariantDetail scored={selected} lang={lang} tr={tr} />}

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => selected && downloadText(
              `${slug(project?.name ?? 'projet')}-${slug(selected.variant.label.en)}-predictions.csv`,
              toCsv(selected.result.refit.predictions.map((r) => ({ sample_id: r.sampleId, observed: r.actual, predicted: r.predicted, residual: r.residual,
                evaluation_scope: selected.result.evaluation?.scope ?? 'unknown', independent_test: selected.result.evaluation?.independent_test ?? false,
                owner_report: selected.result.refit.ownerReport ? JSON.stringify(selected.result.refit.ownerReport) : '' })),
                ['sample_id', 'observed', 'predicted', 'residual', 'evaluation_scope', 'independent_test', 'owner_report']))}>
              {tr('Exporter les prédictions (CSV)', 'Export predictions (CSV)')}
            </button>
            <button className="btn-outline" disabled={!selected || exporting} onClick={() => { void exportSelected(); }}>
              {exporting ? 'Exporting owner container…' : 'Export model (.n4a)'}
            </button>
            {exportError && <p role="alert">{exportError}</p>}
            <p className="text-xs text-muted-foreground">Quali host profile only; other hosts may inventory this container but cannot execute it. These fitted states hold no training rows; the file still contains training IDs, graph, parameters and reports.</p>
          </div>
        </>
      )}
    </div>
  );
}

function VariantDetail({ scored, lang, tr }: { scored: Scored; lang: 'fr' | 'en'; tr: (fr: string, en: string) => string }) {
  const m = scored.result.refit.metrics;
  const independent = scored.result.evaluation?.scope === 'independent_test' && scored.result.evaluation.independent_test;
  const report = buildModelReportView(m, undefined, 'en');
  const reportView = {
    ...report,
    gradeLabel: independent ? report.gradeLabel : evaluationLabel(scored.result.evaluation),
    verdict: independent ? report.verdict : 'Independent validation is required before qualifying routine use.',
    metrics: report.metrics.map((metric) => {
      const reason = scored.result.refit.ownerReport?.undefined_metrics?.[metric.key];
      return {
        ...metric,
        label: metric.key === 'rmse' ? 'RMSE' : metric.label,
        display: reason ? `undefined (${reason})` : metric.display,
        reading: reason ?? (metric.key === 'rmse' ? evaluationLabel(scored.result.evaluation) : independent ? metric.reading : ''),
      };
    }),
  };
  // pipeline-composition strip: the chosen setting (best n_components / α / operator)
  const sel = scored.result.variants?.find((z) => z.selected);
  const selLabel = sel ? (sel.label ?? String(sel.x)) : undefined;
  const dsl = describeVariant(scored.variant, selLabel, scored.result.variants?.length ?? 1);
  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-medium">{tr('Modèle retenu', 'Selected model')} : {tr(scored.variant.label.fr, scored.variant.label.en)}</span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{evaluationLabel(scored.result.evaluation)}. {evaluationNote(scored.result.evaluation)}</p>
      <p className="mb-3 text-xs">{populationLabel(scored.result.population)}. Deployment fit: {scored.result.engine === 'dag-ml-methods-ridge' ? 'all labelled rows' : 'KS training rows only'}. Reported scores remain selection validation.</p>
      <ModelReportCard
        locale={lang}
        view={reportView}
        applyTone={independent}
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
