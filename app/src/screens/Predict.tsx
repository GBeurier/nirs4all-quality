import {
  buildDecisionView, DecisionCard,
  type DecisionColor, type DecisionInput, type DecisionView,
} from 'nirs4all-ui/lab';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { meanSpectrum, type SampleSpectra } from '@/domain/spectra';
import { createEngine } from '@/engine';
import { predictWithModel } from '@/engine/predict';
import { CALIB_VARIANTS, runVariant } from '@/engine/variants';
import { analyzeFiles, assembleDataset, readRawFiles } from '@/lib/dataset';
import { resampleTo } from '@/lib/drift';
import { downloadText, slug, toCsv } from '@/lib/export';
import { histogram } from '@/lib/histogram';
import { parseModelBundle } from '@/lib/modelIo';
import { buildRoutinePredictions, type AlertLevel, type PredictionAlerts, type ReliabilityModel } from '@/lib/reliability';
import { buildTrainingDataset } from '@/lib/trainingData';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra, type StoredModel } from '@/store/store';
import { decisionIcons } from '@/ui/icons';
import { Dropzone } from '@/ui/Dropzone';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

const CHART_COLOR: Record<DecisionColor, string> = {
  reliable: 'var(--success)',
  caution: 'var(--warning)',
  out_of_domain: 'var(--destructive)',
  informative: 'var(--chart-3)',
};
const ORDER: DecisionColor[] = ['reliable', 'caution', 'out_of_domain', 'informative'];
const H = 260;
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

interface Pred { sampleId: string; predicted: number; input: DecisionInput; view: DecisionView; interval: string; alerts: PredictionAlerts; yNovelty: number; }

// §3 Écran 5 — predict & decide. REAL predictions: the project's routine
// (un-referenced) spectra are run through the deployed model (from Calibrate, or
// a fast one auto-built here), then each prediction gets a reliability feu from
// its real applicability-domain signals (§4bis).
export function Predict({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const spectra = useProjectSpectra(projectId);
  const stored = state.modelByProject[projectId];
  const unit = project?.method.unit ?? '';

  const referencedCount = samples.filter((s) => s.reference?.value != null).length;

  const [loaded, setLoaded] = useState<SampleSpectra[] | null>(null);
  const [loadedName, setLoadedName] = useState('');
  const [rel, setRel] = useState<ReliabilityModel | null>(null);
  const [usedModel, setUsedModel] = useState<StoredModel | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function onImportModel(file: File | undefined) {
    if (!file) return;
    const res = parseModelBundle(await file.text());
    if ('error' in res) { setImportMsg(res.error); return; }
    dispatch({ kind: 'set_model', projectId, model: res.model });
    setImportMsg(tr(`Modèle « ${res.model.pipelineName} » chargé (${res.model.nFeatures} variables).`, `Model "${res.model.pipelineName}" loaded (${res.model.nFeatures} features).`));
  }

  // routine batch = freshly LOADED spectra if any, else the project's un-referenced samples
  const projectRoutineCount = samples.filter((s) => !s.reference && s.status !== 'excluded').length;
  const routineCount = loaded ? loaded.length : projectRoutineCount;

  async function onLoadFiles(files: File[]) {
    if (!spectra || files.length === 0) return;
    try {
      const a = analyzeFiles(await readRawFiles(files));
      const asm = assembleDataset('routine', a, a.leading);
      const p = spectra.axis.length;
      const routine: SampleSpectra[] = asm.spectra.samples.map((s) => ({
        sampleId: s.sampleId,
        reps: s.reps.map((r) => ({ repId: r.repId, values: resampleTo(r.values, p) })),
      }));
      setLoaded(routine);
      setLoadedName(tr(`${files[0]?.name} · ${routine.length} échantillons chargés`, `${files[0]?.name} · ${routine.length} samples loaded`));
    } catch (e) {
      setError(tr('Fichier illisible : ', 'Unreadable file: ') + (e instanceof Error ? e.message : ''));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      if (!spectra || spectra.axis.length === 0) { setRel(null); return; }
      const refIds = new Set(samples.filter((s) => s.reference?.value != null).map((s) => s.id));
      const routineIds = new Set(samples.filter((s) => !s.reference && s.status !== 'excluded').map((s) => s.id));
      const cal = spectra.samples.filter((s) => refIds.has(s.sampleId));
      const routine = loaded ?? spectra.samples.filter((s) => routineIds.has(s.sampleId));
      if (routine.length === 0) { setRel({ preds: [], ev: () => '0.0' }); setUsedModel(stored ?? null); return; }

      // get (or build) the deployed model
      let sm = stored;
      if (!sm) {
        if (refIds.size < 8) { setRel(null); return; }
        setBuilding(true);
        const ds = buildTrainingDataset(spectra, samples, project?.method.target || 'y', state.repModeByProject[projectId] ?? 'mean');
        const wasm = await createEngine();
        const variant = CALIB_VARIANTS.find((v) => v.id === 'fast-aom-pls') ?? CALIB_VARIANTS[0]!;
        const res = await runVariant(ds, variant, wasm);
        if (cancelled) return;
        setBuilding(false);
        if (!res) { setError(tr('Échec de la construction du modèle.', 'Model build failed.')); return; }
        const ys = Array.from(ds.y);
        sm = {
          model: res.model, engine: res.engine, pipelineName: variant.label.fr,
          metrics: res.refit.metrics, yRange: [Math.min(...ys), Math.max(...ys)], nFeatures: ds.nFeatures, createdAt: res.createdAt,
        };
        dispatch({ kind: 'set_model', projectId, model: sm });
        return; // the re-run (stored now set) performs the prediction
      }

      // predict on the routine spectra with the deployed model
      const p = spectra.axis.length;
      if (sm.nFeatures !== p) { setError(tr('Le modèle ne correspond pas à ces spectres.', 'The model does not match these spectra.')); return; }
      const n = routine.length;
      const X = new Float64Array(n * p);
      routine.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[i * p + j] = m[j] ?? 0; });
      const out = await predictWithModel(sm.model, X, n, p);
      if (cancelled) return;
      const refVal = new Map(samples.filter((s) => s.reference?.value != null).map((s) => [s.id, s.reference!.value!]));
      const calY = cal.map((s) => refVal.get(s.sampleId) ?? Number.NaN);
      const r = buildRoutinePredictions({
        cal, routine, predicted: Array.from(out.values), axisLen: p,
        yMin: sm.yRange[0], yMax: sm.yRange[1], rmsep: sm.metrics.rmse ?? 1, calY,
      });
      setUsedModel(sm);
      setRel(r);
    })().catch((e) => { if (!cancelled) { setBuilding(false); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { cancelled = true; };
    // deps are the data inputs; tr/project/dispatch are stable enough and left
    // out on purpose to avoid re-predicting on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, spectra, samples, projectId, loaded]);

  const batch: Pred[] = useMemo(() => (rel?.preds ?? []).map((p) => ({
    sampleId: p.sampleId, predicted: p.predicted, input: p.input, interval: p.interval,
    alerts: p.alerts, yNovelty: p.yNovelty,
    view: buildDecisionView(p.input, null, lang),
  })), [rel, lang]);

  const counts = useMemo(() => {
    const c: Record<DecisionColor, number> = { reliable: 0, caution: 0, out_of_domain: 0, informative: 0 };
    for (const p of batch) c[p.view.color] += 1;
    return c;
  }, [batch]);
  const bins = useMemo(() => histogram(batch.map((p) => p.predicted).filter((v) => Number.isFinite(v)), 16), [batch]);
  const yLo = usedModel?.yRange[0] ?? 0;
  const yHi = usedModel?.yRange[1] ?? 1;
  const attention = batch.filter((p) => p.view.color !== 'reliable').slice(0, 6);

  const header = (
    <>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{tr('Prédire & décider', 'Predict & decide')}</h1>
        <Explain content={EXPLAIN.reliability} />
        <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/5"
          title={tr('Charger un modèle .n4a (fait ici, ou exporté depuis Studio/lib au format dag-ml/JSON)', 'Load a .n4a model (made here, or exported from Studio/lib in dag-ml/JSON format)')}>
          {tr('Importer un modèle (.n4a)', 'Import a model (.n4a)')}
          <input type="file" accept=".json,.n4a" className="hidden" onChange={(e) => { void onImportModel(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {batch.length > 0 && (
          <button className="ml-auto btn-outline" onClick={() => downloadText(
            `${slug(project?.name ?? 'projet')}-predictions.csv`,
            toCsv(batch.map((p) => ({
              sample_id: p.sampleId, predicted: Number.isFinite(p.predicted) ? p.predicted.toFixed(3) : '', interval: p.interval,
              reliability: p.view.color, reason: p.view.reason, applicability: f2(p.input.applicabilityScore ?? NaN),
              extrapolation_outY: p.alerts.outY, conformal_yDensity: p.alerts.yDens, spectral_outX: p.alerts.outX,
            })), ['sample_id', 'predicted', 'interval', 'reliability', 'reason', 'applicability', 'extrapolation_outY', 'conformal_yDensity', 'spectral_outX']))}>
            {tr('Exporter le lot (CSV)', 'Export batch (CSV)')}
          </button>
        )}
      </div>
      <div className="mb-4">
        <Dropzone onFiles={onLoadFiles} multiple compact accept=".csv,.txt,.tsv"
          title={tr('Charger de nouveaux spectres à prédire', 'Load new spectra to predict')}
          hint={<>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — un lot de routine ; sinon les échantillons non-référencés du projet sont prédits', ' — a routine batch; otherwise the project’s un-referenced samples are predicted')}</>} />
        {loaded && (
          <p className="mt-1 text-xs text-muted-foreground">
            {loadedName} · <button className="underline hover:text-foreground" onClick={() => { setLoaded(null); setLoadedName(''); }}>{tr('revenir aux échantillons du projet', 'back to project samples')}</button>
          </p>
        )}
        {importMsg && <p className={`mt-1 text-xs ${/non reconnu|natif|invalide|manquant/i.test(importMsg) ? 'text-warning' : 'text-success'}`}>{importMsg}</p>}
      </div>
    </>
  );

  if (building) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {tr('Construction d’un modèle rapide pour prédire…', 'Building a quick model to predict…')}
        </div>
      </div>
    );
  }
  if (!spectra || spectra.axis.length === 0) {
    return <div className="mx-auto max-w-4xl">{header}<Empty text={tr('Aucun spectre dans ce projet.', 'No spectra in this project.')} /></div>;
  }
  if (routineCount === 0) {
    return <div className="mx-auto max-w-4xl">{header}<Empty text={tr('Aucun échantillon de routine à prédire (tous ont déjà une référence).', 'No routine samples to predict (all already have a reference).')} /></div>;
  }
  if (!usedModel && referencedCount < 8) {
    return <div className="mx-auto max-w-4xl">{header}<Empty text={tr('Calibrez d’abord un modèle (au moins 8 échantillons avec référence sont nécessaires).', 'Calibrate a model first (at least 8 samples with a reference are needed).')} /></div>;
  }
  if (error) {
    return <div className="mx-auto max-w-4xl">{header}<Empty text={error} /></div>;
  }
  if (!rel) {
    return (
      <div className="mx-auto max-w-4xl">{header}
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {tr('Prédiction en cours…', 'Predicting…')}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {header}
      <p className="mb-3 text-sm text-muted-foreground">
        {tr(`${batch.length} spectres de routine prédits.`, `${batch.length} routine spectra predicted.`)}
        {usedModel && <span className="ml-1">{tr('Modèle', 'Model')} : <span className="font-medium">{usedModel.pipelineName}</span> · <span className="font-mono">{usedModel.engine}</span> · RMSEP {f2(usedModel.metrics.rmse ?? NaN)}</span>}
      </p>

      {/* reliability breakdown */}
      <div className="mb-4 card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {tr('Répartition des fiabilités', 'Reliability breakdown')} <Explain content={EXPLAIN.reliabilityMix} />
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {ORDER.map((c) => counts[c] > 0 ? (
            <div key={c} style={{ width: `${(counts[c] / batch.length) * 100}%`, background: CHART_COLOR[c] }} />
          ) : null)}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {ORDER.map((c) => {
            const v = buildDecisionView(sampleInputFor(c), null, lang);
            return (
              <span key={c} className="flex items-center gap-1.5">
                <span style={{ color: CHART_COLOR[c] }} className="flex">{decisionIcons[v.icon]}</span>
                <span className="font-medium">{v.label}</span>
                <span className="text-muted-foreground tabular-nums">{counts[c]} · {Math.round((counts[c] / batch.length) * 100)}%</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* predicted-value histogram */}
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {tr('Valeurs prédites', 'Predicted values')} {unit && <span className="text-xs text-muted-foreground">({unit})</span>}
            <Explain content={EXPLAIN.predictionHistogram} />
          </div>
          <ResponsiveContainer width="100%" height={H}>
            <BarChart data={bins} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bin" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={36} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => [`${v}`, tr('nb', 'count')]} labelFormatter={(l) => `≥ ${l}`} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {bins.map((b, i) => (
                  <Cell key={i} fill={b.center >= yLo && b.center <= yHi ? 'var(--chart-1)' : 'var(--warning)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr('Bleu = dans la gamme apprise ; orange = extrapolation (hors gamme).', 'Teal = within the learned range; amber = extrapolation (out of range).')}
          </p>
        </div>

        {/* applicability-domain map */}
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {tr('Carte du domaine', 'Domain map')} <Explain content={EXPLAIN.domainMap} />
          </div>
          <ResponsiveContainer width="100%" height={H}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="ad" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
                label={{ value: tr('distance au domaine', 'distance to domain'), position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis type="number" dataKey="width" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={40}
                label={{ value: tr('intervalle', 'interval'), angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <ZAxis range={[40, 40]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => f2(v)} />
              <ReferenceLine x={1} stroke="var(--warning)" strokeDasharray="4 3" label={{ value: tr('bordure', 'border'), position: 'top', fontSize: 9, fill: 'var(--warning)' }} />
              <ReferenceLine x={2} stroke="var(--destructive)" strokeDasharray="4 3" label={{ value: tr('hors-domaine', 'out-of-domain'), position: 'top', fontSize: 9, fill: 'var(--destructive)' }} />
              <Scatter data={batch.map((p) => ({ ad: p.input.applicabilityScore, width: p.input.intervalWidth, color: CHART_COLOR[p.view.color] }))} isAnimationActive={false}>
                {batch.map((p, i) => <Cell key={i} fill={CHART_COLOR[p.view.color]} fillOpacity={0.75} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* per-prediction alert table (out-Y extrapolation · Y-density conformal · out-X spectral) */}
      <div className="mb-4 card p-0 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
          {tr('Alertes par échantillon', 'Per-sample alerts')} <Explain content={EXPLAIN.predictionAlerts} />
          <span className="ml-auto text-xs font-normal text-muted-foreground">{batch.length} {tr('prédictions', 'predictions')}</span>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{tr('Échantillon', 'Sample')}</th>
                <th className="px-2 py-2 text-right font-medium">{tr('Prédit', 'Predicted')}</th>
                <th className="px-2 py-2 text-right font-medium">{tr('Interv.', 'Interval')}</th>
                <th className="px-2 py-2 text-center font-medium" title={tr('valeur hors de la gamme apprise', 'value outside the learned range')}>{tr('Extrap. (hors Y)', 'Extrap. (out-Y)')}</th>
                <th className="px-2 py-2 text-center font-medium" title={tr('peu de références au niveau prédit', 'few references at the predicted level')}>{tr('Conformal (densité Y)', 'Conformal (Y-density)')}</th>
                <th className="px-4 py-2 text-center font-medium" title={tr('spectre éloigné du domaine de calibration', 'spectrum far from the calibration domain')}>{tr('Dist. spectrale (hors X)', 'Spectral dist. (out-X)')}</th>
              </tr>
            </thead>
            <tbody>
              {batch.map((p) => (
                <tr key={p.sampleId} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-1.5 font-mono text-xs">{p.sampleId}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f2(p.predicted)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{p.interval}</td>
                  <td className="px-2 py-1.5"><AlertCell level={p.alerts.outY} okLabel={tr('dans la gamme', 'in range')} warnLabel={tr('bordure', 'edge')} badLabel={tr('extrapolation', 'extrapolation')} /></td>
                  <td className="px-2 py-1.5"><AlertCell level={p.alerts.yDens} okLabel={tr('bien couvert', 'well covered')} warnLabel={tr('peu couvert', 'sparse')} badLabel={tr('quasi isolé', 'near-isolated')} /></td>
                  <td className="px-4 py-1.5"><AlertCell level={p.alerts.outX} okLabel={`${f2(p.input.applicabilityScore ?? NaN)} σ`} warnLabel={`${f2(p.input.applicabilityScore ?? NaN)} σ`} badLabel={`${f2(p.input.applicabilityScore ?? NaN)} σ`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* prediction cards needing attention (working "see details") */}
      <div className="mb-2 text-sm font-medium">
        {attention.length > 0
          ? tr(`Prédictions à examiner (${attention.length})`, `Predictions to review (${attention.length})`)
          : tr('Toutes les prédictions sont fiables 🟢', 'All predictions are reliable 🟢')}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {attention.map((p) => (
          <DecisionCard
            key={p.sampleId}
            locale={lang}
            sampleId={p.sampleId}
            predicted={Number.isFinite(p.predicted) ? Number(p.predicted.toFixed(2)) : '—'}
            interval={p.interval}
            unit={unit}
            view={p.view}
            icons={decisionIcons}
            renderDetailLink={() => <DetailToggle p={p} />}
            className="rounded-xl border border-border p-4"
            headerClassName="mb-2 flex items-center gap-2"
            iconClassName="flex"
            labelClassName="font-medium"
            confidenceClassName="ml-auto text-[11px] uppercase text-muted-foreground"
            valueClassName="text-2xl font-bold tabular-nums"
            intervalClassName="ml-2 text-sm text-muted-foreground"
            reasonClassName="mt-2 text-sm"
            actionClassName="mt-1 text-xs text-muted-foreground"
          />
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

const ALERT_STYLE: Record<AlertLevel, { bg: string; fg: string; dot: string }> = {
  ok: { bg: 'var(--success-muted, rgba(16,185,129,0.12))', fg: 'var(--success)', dot: 'var(--success)' },
  warn: { bg: 'rgba(217,119,6,0.12)', fg: 'var(--warning)', dot: 'var(--warning)' },
  bad: { bg: 'rgba(220,38,38,0.12)', fg: 'var(--destructive)', dot: 'var(--destructive)' },
};

// A compact alert pill: green dot when clear, amber/red with a label when it fires.
function AlertCell({ level, okLabel, warnLabel, badLabel }: { level: AlertLevel; okLabel: string; warnLabel: string; badLabel: string }) {
  const s = ALERT_STYLE[level];
  const label = level === 'ok' ? okLabel : level === 'warn' ? warnLabel : badLabel;
  return (
    <span className="inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: level === 'ok' ? 'transparent' : s.bg, color: level === 'ok' ? 'var(--muted-foreground)' : s.fg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {label}
    </span>
  );
}

// A representative input that yields each colour (for the legend labels).
function sampleInputFor(c: DecisionColor): DecisionInput {
  if (c === 'reliable') return { applicabilityScore: 0.3, localDensity: 0.6 };
  if (c === 'caution') return { applicabilityScore: 1.3 };
  if (c === 'out_of_domain') return { applicabilityScore: 2.5 };
  return { applicabilityScore: 0.4, localDensity: 0.05 };
}

const CATEGORY_LABEL: Record<string, { fr: string; en: string }> = {
  in_domain: { fr: 'dans le domaine', en: 'in domain' },
  near_border: { fr: 'en bordure', en: 'near border' },
  out_of_domain: { fr: 'hors domaine', en: 'out of domain' },
  measurement_artifact: { fr: 'artefact de mesure possible', en: 'possible measurement artifact' },
  rare_sample: { fr: 'échantillon rare', en: 'rare sample' },
  uncertain_prediction: { fr: 'prédiction incertaine', en: 'uncertain prediction' },
  enrichment_candidate: { fr: 'candidat à l’enrichissement', en: 'enrichment candidate' },
};

// The working "see details" disclosure — the evidence behind the colour.
function DetailToggle({ p }: { p: Pred }) {
  const [open, setOpen] = useState(false);
  const tr = useTr();
  const { input, view } = p;
  const rows: [string, string][] = [
    [tr('Catégorie', 'Category'), tr(CATEGORY_LABEL[view.category]?.fr ?? view.category, CATEGORY_LABEL[view.category]?.en ?? view.category)],
    [tr('Confiance', 'Confidence'), view.confidence],
    [tr('Distance au domaine', 'Distance to domain'), `${f2(input.applicabilityScore ?? NaN)} σ ${tr('(bordure ≥ 1 · hors-domaine ≥ 2)', '(border ≥ 1 · out-of-domain ≥ 2)')}`],
    [tr('Intervalle estimé', 'Estimated interval'), p.interval],
    [tr('Densité locale', 'Local density'), `${f2(input.localDensity ?? NaN)} ${tr('(rare si ≤ 0.15)', '(rare if ≤ 0.15)')}`],
    [tr('Extrapolation', 'Extrapolation'), input.extrapolation ? tr('oui', 'yes') : tr('non', 'no')],
    [tr('Modifiable par', 'Overridable by'), view.overridableBy === 'none' ? '—' : tr('responsable méthode', 'method owner')],
  ];
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="text-xs text-primary underline">
        {open ? tr('Masquer le détail', 'Hide details') : tr('Voir le détail', 'See details')}
      </button>
      {open && (
        <dl className="mt-2 space-y-1 rounded-lg bg-muted/50 p-2.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
