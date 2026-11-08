import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { resolveSafety, summarizeWorklist, WorklistTable, type WorklistItemInput } from 'nirs4all-ui/lab';
import { Activity, FlaskConical, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { analyzeDrift, calibrationMatrix, makeDriftBatch, resampleTo, type DriftVerdict, type DriftAnalysis, type DriftPoint, type Mat } from '@/lib/drift';
import { predictWithModel } from '@/engine/predict';
import { errorMessage, projectForLab, type LabProjection, type RetainedImport } from '@/lib/ioImport';
import { newId } from '@/lib/ids';
import { downloadText, slug, toCsv } from '@/lib/export';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { safetyIcons } from '@/ui/icons';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';
import { Dropzone } from '@/ui/Dropzone';
import { DatasetConfig, ImportBindings, useDatasetImport } from '@/ui/DatasetConfig';

const VERDICT: Record<DriftVerdict, { fr: string; en: string; tone: string; pill: string }> = {
  stable: { fr: 'Stable', en: 'Stable', tone: 'text-success', pill: 'n4-pill n4-pill--green' },
  moderate: { fr: 'Dérive modérée', en: 'Moderate drift', tone: 'text-warning', pill: 'n4-pill n4-pill--amber' },
  strong: { fr: 'Dérive forte', en: 'Strong drift', tone: 'text-destructive', pill: 'n4-pill n4-pill--rose' },
};

type Projected = Extract<LabProjection, { ok: true }>;
export interface MaintenanceBatch extends Mat {
  record: RetainedImport | null;
  projection: Projected | null;
  sampleIds: string[];
}
type IdentifiedPoint = DriftPoint & { sampleId: string };
export interface ResendEntry { sampleId: string; idx: number; predicted: number; outX: boolean; outY: boolean; priority: number }

/** Host snapshot: owner identity order travels with the exact matrix it labels. */
export function maintenanceBatch(record: RetainedImport, projection: Projected, target: SpectraDataset): MaintenanceBatch {
  const source = projection.spectra;
  const p = target.axis.length, n = source.samples.length;
  const X = new Float64Array(n * p);
  source.samples.forEach((sample, row) => {
    if (!sample.reps.length || sample.reps.some((rep) => rep.values.length !== source.axis.length || !rep.values.every(Number.isFinite))) {
      throw new Error('Maintenance requires complete finite spectra; missing values are not imputed.');
    }
    const values = resampleTo(meanSpectrum(sample), source.axis, target.axis, source.axisUnit, target.axisUnit);
    X.set(values, row * p);
  });
  return { record, projection, sampleIds: source.samples.map((sample) => sample.sampleId), X, n, p };
}

export function identifiedDriftPoints(analysis: DriftAnalysis, batch: MaintenanceBatch): IdentifiedPoint[] {
  return analysis.newPts.map((point) => {
    const sampleId = batch.sampleIds[point.idx];
    if (sampleId === undefined) throw new Error('Drift output does not identify a row of the current batch.');
    return { ...point, sampleId };
  });
}

export function maintenanceResend(points: IdentifiedPoint[], sampleIds: string[], out: { values: Float64Array; sampleIds?: string[] }, yRange: [number, number]): ResendEntry[] {
  if (!out.sampleIds || out.sampleIds.length !== sampleIds.length || out.values.length !== sampleIds.length
      || out.sampleIds.some((id, row) => id !== sampleIds[row])) throw new Error('Prediction identities differ from the current maintenance batch.');
  const [ylo, yhi] = yRange;
  return points.map((z) => {
    const predicted = out.values[z.idx] ?? Number.NaN;
    const outX = z.out;
    const outY = Number.isFinite(predicted) && (predicted < ylo || predicted > yhi);
    return { sampleId: z.sampleId, idx: z.idx, predicted, outX, outY, priority: z.novelty + (outY ? 1.5 : 0) };
  }).filter((r) => r.outX || r.outY).sort((a, b) => b.priority - a.priority);
}

export function maintenanceWorklist(points: IdentifiedPoint[], threshold: number): WorklistItemInput[] {
  return points.filter((z) => z.out).sort((a, b) => b.novelty - a.novelty).map((z, i) => ({
    sampleId: z.sampleId, reason: z.novelty > threshold * 1.6 ? 'rare_type' : 'boundary', decisionColor: 'out_of_domain', rank: i + 1,
  }));
}
export const resendExportRows = (resend: ResendEntry[]) => resend.map((r, i) => ({ rank: i + 1, sample_id: r.sampleId,
  predicted: Number.isFinite(r.predicted) ? r.predicted.toFixed(3) : '', out_x: r.outX ? 'yes' : '', out_y: r.outY ? 'yes' : '' }));
export const controlExportRows = (worklist: WorklistItemInput[]) => worklist.map((b) => ({ rank: b.rank ?? '', sample_id: b.sampleId,
  reason: b.reason ?? '', safety: resolveSafety(b) }));

// §3 Écran 6 — maintenance planner. Add a new routine batch (drop spectra or
// simulate one), project it into a frozen calibration-only PCA reference, and get a recommendation: keep monitoring,
// resample (HPLC) the drifted samples, or retrain / transfer instrument.
export function Maintenance({ projectId }: { projectId: string }) {
  const { state } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const spectra = useProjectSpectra(projectId);
  const samples = state.samplesByProject[projectId] ?? [];

  // the calibration cloud = the REFERENCED (integrated) samples only, so
  // unreferenced routine/pool spectra can't widen it and mask drift.
  const cal = useMemo(() => {
    if (!spectra) return null;
    const refIds = new Set(samples.filter((s) => s.reference?.value != null).map((s) => s.id));
    return refIds.size >= 3 ? calibrationMatrix(spectra, refIds) : null;
  }, [spectra, samples]);
  const [simulated, setSimulated] = useState<MaintenanceBatch | null>(null);
  const [external, setExternal] = useState(false);
  const [handle] = useState(() => newId('maintenance'));
  const [note, setNote] = useState('');
  const predictionRequest = useRef(0);
  const [resendResult, setResendResult] = useState<{ batch: MaintenanceBatch; model: unknown; analysis: DriftAnalysis; items: ResendEntry[] } | null>(null);
  const upload = useDatasetImport(undefined, () => { predictionRequest.current++; setResendResult(null); setNote(''); });
  const projection = useMemo(() => projectForLab(upload.record, handle), [upload.record, handle]);
  const prepared = useMemo(() => {
    if (!external || !projection.ok || upload.readingFiles || upload.fileReadFailed || !spectra) return { batch: null, error: '' };
    try { return { batch: maintenanceBatch(upload.record, projection, spectra), error: '' }; }
    catch (reason) { return { batch: null, error: errorMessage(reason) }; }
  }, [external, projection, upload.record, upload.readingFiles, upload.fileReadFailed, spectra]);
  const batch = external ? prepared.batch : simulated;
  const analysis = useMemo(() => (cal && batch ? analyzeDrift(cal, batch) : null), [cal, batch]);
  const points = useMemo(() => analysis && batch ? identifiedDriftPoints(analysis, batch) : [], [analysis, batch]);
  const stored = state.modelByProject[projectId];
  const resend = resendResult && resendResult.batch === batch && resendResult.model === stored && resendResult.analysis === analysis ? resendResult.items : null;

  useEffect(() => {
    let cancelled = false;
    const request = ++predictionRequest.current;
    setResendResult(null);
    (async () => {
      if (!analysis || !batch || !stored || stored.nFeatures !== batch.p) return;
      const out = await predictWithModel(stored.model, batch.X, batch.n, batch.p, { sampleIds: batch.sampleIds });
      if (cancelled || request !== predictionRequest.current) return;
      const items = maintenanceResend(points, batch.sampleIds, out, stored.yRange);
      setResendResult({ batch, model: stored, analysis, items });
    })().catch((reason) => {
      if (!cancelled && request === predictionRequest.current) { setResendResult(null); setNote(errorMessage(reason)); }
    });
    return () => { cancelled = true; };
  }, [analysis, batch, points, stored]);

  function simulate() {
    if (!cal) return;
    predictionRequest.current++; setResendResult(null);
    setExternal(false); upload.reset();
    const matrix = makeDriftBatch(cal.p, 24);
    setSimulated({ ...matrix, record: null, projection: null, sampleIds: Array.from({ length: matrix.n }, (_, i) => `simulated:${i + 1}`) });
    setNote('Simulated batch: 24 routine spectra (partial new site). Sample labels are synthetic.');
  }
  function onFiles(files: File[]) {
    if (!files.length) return;
    setExternal(true); setSimulated(null);
    return upload.onFiles(files);
  }

  const worklist = useMemo(() => analysis ? maintenanceWorklist(points, analysis.threshold) : [], [analysis, points]);
  const summary = summarizeWorklist(worklist, 'remeasure', lang);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">Maintenance</h1>
        <Explain content={EXPLAIN.maintenanceDrift} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {tr('Ajoutez un lot de spectres de routine : on ré-analyse le domaine pour repérer une dérive et proposer une action (surveiller, ré-échantillonner en HPLC, ré-entraîner).',
          'Add a batch of routine spectra: we re-analyze the domain to spot drift and suggest an action (monitor, resample via HPLC, retrain).')}
      </p>

      {/* add spectra */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center" data-testid="quali-maintenance-import">
        <Dropzone onFiles={onFiles} multiple compact accept=".csv,.txt,.tsv" privacy error={upload.error || null}
          title={tr('Déposez un nouveau lot de spectres', 'Drop a new batch of spectra')}
          hint={<>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — spectres de routine à surveiller', ' — routine spectra to monitor')}</>} />
        <button className="btn-outline h-fit" onClick={simulate} disabled={!cal}>
          <RefreshCw size={14} /> {tr('Simuler un nouveau lot', 'Simulate a batch')}
        </button>
      </div>
      {external && <div className="mb-4">
        <ImportBindings record={upload.record} onRemove={upload.removeFile} />
        {upload.notice && <p className="text-xs" role="status">{upload.notice}</p>}
        {(upload.record.files.length > 0 || upload.readingFiles) && <DatasetConfig record={upload.record} onChange={upload.updateRecord}
          readingFiles={upload.readingFiles} projection={projection} />}
        {prepared.error && <p role="alert">{prepared.error}</p>}
      </div>}
      {note && <p className="mb-4 -mt-3 text-xs text-muted-foreground">{note}</p>}

      {!analysis && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {tr('Ajoutez ou simulez un lot pour lancer l’analyse de dérive.', 'Add or simulate a batch to run the drift analysis.')}
        </div>
      )}

      {analysis && (
        <>
          {/* verdict + stats */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label={tr('Nouveaux spectres', 'New spectra')} value={String(batch?.n ?? 0)} icon={<Activity size={15} />} />
            <Stat label={tr('Hors-domaine', 'Out of domain')} value={`${analysis.outN} · ${Math.round(analysis.share * 100)}%`} icon={<FlaskConical size={15} />} />
            <div className="kpi p-3">
              <div className="text-xs text-muted-foreground">{tr('Verdict de dérive', 'Drift verdict')}</div>
              <div className={`mt-1 text-lg font-semibold ${VERDICT[analysis.verdict].tone}`}>{tr(VERDICT[analysis.verdict].fr, VERDICT[analysis.verdict].en)}</div>
            </div>
          </div>

          {/* PCA overlay: calibration cloud vs new batch */}
          <div className="mb-4 card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {tr('Carte de dérive (PCA : calibration vs nouveau lot)', 'Drift map (PCA: calibration vs new batch)')} <Explain content={EXPLAIN.driftMap} />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" dataKey="x" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
                  label={{ value: `PC1 (${analysis.ev(0)} %)`, position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <YAxis type="number" dataKey="y" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48}
                  label={{ value: `PC2 (${analysis.ev(1)} %)`, angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <ZAxis range={[36, 36]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => v.toFixed(3)} />
                <Scatter name="cal" data={analysis.calPts} fill="var(--muted-foreground)" fillOpacity={0.3} isAnimationActive={false} />
                <Scatter name="new" data={analysis.newPts} isAnimationActive={false}>
                  {analysis.newPts.map((z, i) => <Cell key={i} fill={z.out ? 'var(--destructive)' : 'var(--chart-1)'} fillOpacity={0.85} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Dot color="var(--muted-foreground)" /> {tr('calibration', 'calibration')}</span>
              <span className="flex items-center gap-1.5"><Dot color="var(--chart-1)" /> {tr('nouveau — dans le domaine', 'new — in domain')}</span>
              <span className="flex items-center gap-1.5"><Dot color="var(--destructive)" /> {tr('nouveau — hors-domaine (dérive)', 'new — out of domain (drift)')}</span>
            </div>
          </div>

          {/* model-space re-send list: what to send back to HPLC per the calibration model */}
          {stored && resend && resend.length > 0 && (
            <div className="mb-4 card p-0 overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
                {tr('À renvoyer en HPLC — espace du modèle de calibration', 'To re-send to HPLC — calibration model space')}
                <Explain content={EXPLAIN.maintenanceModelSpace} />
                <span className="text-xs font-normal text-muted-foreground">{tr('modèle', 'model')} : {stored.pipelineName}</span>
                <button className="btn-outline ml-auto" onClick={() => downloadText(`${slug(project?.name ?? 'projet')}-renvoi-hplc.csv`, toCsv(
                  resendExportRows(resend),
                  ['rank', 'sample_id', 'predicted', 'out_x', 'out_y']))}>
                  {tr('Exporter CSV', 'Export CSV')}
                </button>
              </div>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2">#</th>
                      <th className="px-3 py-2">{tr('Échantillon', 'Sample')}</th>
                      <th className="px-3 py-2 text-right">{tr('Prédit', 'Predicted')}</th>
                      <th className="px-3 py-2">{tr('Pourquoi le renvoyer', 'Why re-send')}</th>
                    </tr>
                  </thead>
                  <MaintenanceResendBody resend={resend} tr={tr} />
                </table>
              </div>
              <p className="px-4 py-2 text-xs text-muted-foreground">
                {tr(`Priorité = nouveauté spectrale dans l’espace du modèle + prédiction hors de la gamme apprise [${stored.yRange[0].toFixed(1)} – ${stored.yRange[1].toFixed(1)}]. Mesurer ces échantillons en HPLC apporte le plus au modèle.`,
                  `Priority = spectral novelty in the model space + prediction outside the learned range [${stored.yRange[0].toFixed(1)} – ${stored.yRange[1].toFixed(1)}]. Measuring these via HPLC helps the model most.`)}
              </p>
            </div>
          )}

          {/* recommendation */}
          <Recommendation verdict={analysis.verdict} share={analysis.share} tr={tr} />

          {/* control / enrichment worklist */}
          {worklist.length > 0 && (
            <div className="mt-4 card p-2" data-testid="maintenance-control-worklist">
              <div className="flex items-center justify-between px-2 py-2 text-sm font-medium">
                {tr('Lot de contrôle recommandé (échantillons dérivés à mesurer)', 'Recommended control batch (drifted samples to measure)')}
                <button className="btn-outline" onClick={() => downloadText(`${slug(project?.name ?? 'projet')}-controle.csv`, toCsv(
                  controlExportRows(worklist),
                  ['rank', 'sample_id', 'reason', 'safety']))}>
                  {tr('Exporter CSV', 'Export CSV')}
                </button>
              </div>
              <p className="px-2 pb-2 text-xs text-muted-foreground">{summary.headline}</p>
              <WorklistTable
                items={worklist}
                locale={lang}
                safetyIcons={safetyIcons}
                headers={{ rank: '#', sampleId: tr('Échantillon', 'Sample'), reason: tr('Pourquoi', 'Why'), safety: tr('Sécurité', 'Safety') }}
                className="w-full text-sm"
                theadClassName="text-left text-xs text-muted-foreground"
                rowClassName="border-t border-border"
                cellClassName="px-2 py-2"
                safetyClassName="flex items-center gap-1"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MaintenanceResendBody({ resend, tr }: { resend: ResendEntry[]; tr: (fr: string, en: string) => string }) {
  return (<tbody>
    {resend.slice(0, 30).map((r, i) => (
      <tr key={r.idx} className="border-t border-border/60">
        <td className="px-4 py-1.5 text-muted-foreground">{i + 1}</td>
        <td className="px-3 py-1.5 font-mono text-xs">{r.sampleId}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(r.predicted) ? r.predicted.toFixed(2) : '—'}</td>
        <td className="px-3 py-1.5">
          <span className="flex flex-wrap gap-1.5">
            {r.outX && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">{tr('spectre hors-domaine (X)', 'spectrum out-of-domain (X)')}</span>}
            {r.outY && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">{tr('prédit hors-gamme (Y)', 'predicted out-of-range (Y)')}</span>}
          </span>
        </td>
      </tr>
    ))}
  </tbody>);
}

function Recommendation({ verdict, share, tr }: { verdict: DriftVerdict; share: number; tr: (fr: string, en: string) => string }) {
  const pct = Math.round(share * 100);
  const content: Record<DriftVerdict, { title: string; body: string; actions: string[] }> = {
    stable: {
      title: tr('✅ Modèle stable — poursuivez la surveillance', '✅ Model stable — keep monitoring'),
      body: tr(`Seulement ${pct} % du nouveau lot sort du domaine connu. Le modèle couvre bien ces échantillons.`, `Only ${pct}% of the new batch leaves the known domain. The model covers these samples well.`),
      actions: [tr('Planifier un lot de contrôle trimestriel', 'Schedule a quarterly control batch')],
    },
    moderate: {
      title: tr('🟠 Dérive modérée — enrichir puis ré-entraîner', '🟠 Moderate drift — enrich then retrain'),
      body: tr(`${pct} % du lot est hors-domaine. Envoyez ces échantillons en chimie humide (HPLC), intégrez-les, puis ré-entraînez pour étendre la couverture.`, `${pct}% of the batch is out of domain. Send those samples to wet chemistry (HPLC), integrate them, then retrain to extend coverage.`),
      actions: [tr('Ré-échantillonner (HPLC) les échantillons dérivés', 'Resample (HPLC) the drifted samples'), tr('Ré-entraîner avec les nouvelles références', 'Retrain with the new references')],
    },
    strong: {
      title: tr('🔴 Dérive forte — ré-entraînement ou transfert requis', '🔴 Strong drift — retraining or transfer required'),
      body: tr(`${pct} % du lot est hors-domaine : un nouveau type d’échantillon ou un nouvel instrument. Le modèle actuel n’est plus fiable dessus.`, `${pct}% of the batch is out of domain: a new sample type or a new instrument. The current model is no longer reliable on it.`),
      actions: [
        tr('Ré-échantillonner un jeu représentatif en HPLC', 'Resample a representative set via HPLC'),
        tr('Ré-entraîner le modèle', 'Retrain the model'),
        tr('Si nouvel appareil : lancer un transfert d’instrument (PDS/EPO)', 'If a new instrument: run an instrument transfer (PDS/EPO)'),
      ],
    },
  };
  const c = content[verdict];
  return (
    <div className="card card-hover p-4">
      <div className="mb-1 text-sm font-semibold">{c.title}</div>
      <p className="mb-2 text-sm text-muted-foreground">{c.body}</p>
      <ul className="space-y-1 text-sm">
        {c.actions.map((a) => (
          <li key={a} className="flex items-start gap-2"><span className="mt-0.5 text-primary">→</span><span>{a}</span></li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="kpi p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
function Dot({ color }: { color: string }) { return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />; }
