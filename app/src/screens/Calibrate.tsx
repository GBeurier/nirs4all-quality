import { ModelReportCard } from '@lab';
import { useState } from 'react';

import { createEngine, type MaterializedDataset, type PipelineDSL, type RunResult } from '@/engine';
import { downloadJson, downloadText, slug, toCsv } from '@/lib/export';
import { useLang, useTr } from '@/i18n';
import { useLab } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';
import { TrainingResults } from '@/screens/TrainingResults';

// §3 Écran 4 — build the model + show the "bulletin". Here we exercise the ENGINE
// PORT with the stub (null model) so the flow is real end-to-end; the WASM engine
// (dag-ml + libn4m) drops in behind the same port with no UI change.
export function Calibrate({ projectId }: { projectId: string }) {
  const { state } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const [result, setResult] = useState<RunResult | null>(null);
  const [dsl, setDslState] = useState<PipelineDSL | null>(null);
  const [running, setRunning] = useState(false);

  const labelled = samples.filter((s) => s.reference?.value != null);

  async function build() {
    setRunning(true);
    const n = labelled.length;
    const nFeatures = 40;
    const X = new Float64Array(n * nFeatures);
    const y = Float64Array.from(labelled.map((s) => s.reference?.value ?? 0));
    const yMean = y.reduce((s, v) => s + v, 0) / Math.max(1, n);
    // Well-conditioned synthetic spectra: a smooth baseline + TWO latent bands —
    // one whose height tracks the reference y (band ~0.4) and one carrying an
    // independent latent (band ~0.7) — plus tiny deterministic per-band variation.
    // This is full-rank enough for a real libn4m PLS (avoids deflation failure).
    for (let i = 0; i < n; i++) {
      const yi = (y[i] ?? yMean) - yMean;
      const latent2 = ((i % 7) / 7) - 0.5;
      for (let j = 0; j < nFeatures; j++) {
        const t = j / (nFeatures - 1);
        const band1 = Math.exp(-((t - 0.4) ** 2) / 0.03);
        const band2 = Math.exp(-((t - 0.7) ** 2) / 0.03);
        X[i * nFeatures + j] =
          0.3 + 0.1 * Math.sin(3 * t) + 0.05 * t
          + yi * 0.02 * band1
          + latent2 * 0.3 * band2
          + ((i * 13 + j * 7) % 9) * 0.0005;
      }
    }
    const ds: MaterializedDataset = {
      X, nSamples: n, nFeatures,
      axis: Array.from({ length: nFeatures }, (_, i) => i), axisUnit: 'index',
      y, targetName: 'Protéines', taskType: 'regression',
      sampleIds: labelled.map((s) => s.id),
      partitions: labelled.map((): 'train' => 'train'),
    };
    const nComp = Math.max(2, Math.min(6, Math.floor(n / 3)));
    const builtDsl: PipelineDSL = { name: 'SNV + PLS', steps: [{ id: 's0', type: 'StandardNormalVariate', params: {} }], model: { id: 'm', type: 'PLS', params: { n_components: nComp } } };
    let engine = await createEngine();            // wasm (real libn4m); falls back to stub on load failure
    let res: RunResult;
    try {
      res = await engine.run(ds, builtDsl);
    } catch (err) {
      console.warn('[quali-nirs4all] run WASM échoué → stub', err);
      engine = await createEngine({ target: 'stub' });
      res = await engine.run(ds, builtDsl);
    }
    setResult(res);
    setDslState(builtDsl);
    setRunning(false);
  }

  const m = result?.refit.metrics;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Calibrer le modèle', 'Calibrate the model')}</h1>
        <Explain content={EXPLAIN.modelReport} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{tr(`${labelled.length} échantillons avec référence disponibles.`, `${labelled.length} samples with a reference available.`)}</p>

      <button
        className="mb-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        onClick={build}
        disabled={running || labelled.length < 8}
      >
        {running ? tr('Construction…', 'Building…') : tr('Construire le modèle', 'Build the model')}
      </button>

      {result && m && (
        <>
          <div className="mb-3 text-xs text-muted-foreground">
            {tr('Moteur', 'Engine')} : <span className="font-medium">{result.engine}</span>{' '}
            {result.engine === 'stub'
              ? <span className="italic">— {tr('baseline null-model (WASM indisponible ici).', 'null-model baseline (WASM unavailable here).')}</span>
              : <span className="italic">— {tr('libn4m WASM via nirs4all-core (spectres synthétiques de démo).', 'libn4m WASM via nirs4all-core (synthetic demo spectra).')}</span>}
          </div>
          <ModelReportCard
            locale={lang}
            metrics={{ rmse: m.rmse ?? null, r2: m.r2 ?? null, rpd: m.rpd ?? null, rpiq: m.rpiq ?? null, bias: m.bias ?? null, n: m.n ?? null }}
            title={<span className="font-medium">{tr('Bulletin du modèle', 'Model report card')}</span>}
            className="rounded-xl border border-border bg-card p-4"
            headerClassName="mb-3 flex flex-col gap-1"
            gradeLabelClassName="text-lg font-semibold"
            verdictClassName="text-sm"
            metricsClassName="grid grid-cols-1 gap-2 sm:grid-cols-2"
            metricRowClassName="rounded-lg bg-muted/40 p-2"
            metricLabelClassName="text-xs font-medium text-muted-foreground"
            metricValueClassName="text-lg font-semibold"
            metricReadingClassName="block text-xs text-muted-foreground"
          />
          {dsl && <TrainingResults dsl={dsl} result={result} />}
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => downloadText(
                `${slug(project?.name ?? 'projet')}-predictions.csv`,
                toCsv(result.refit.predictions.map((r) => ({ sample_id: r.sampleId, observed: r.actual, predicted: r.predicted, residual: r.residual })),
                  ['sample_id', 'observed', 'predicted', 'residual']),
              )}
            >
              {tr('Exporter les prédictions (CSV)', 'Export predictions (CSV)')}
            </button>
            <button
              className="rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => downloadJson(`${slug(project?.name ?? 'projet')}.n4a.json`, {
                format: 'quali-nirs4all/n4a', version: 1, createdAt: result.createdAt, engine: result.engine,
                method: project?.method, pipeline: dsl, metrics: result.refit.metrics, model: result.model,
              })}
            >
              {tr('Exporter le modèle (.n4a)', 'Export model (.n4a)')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
