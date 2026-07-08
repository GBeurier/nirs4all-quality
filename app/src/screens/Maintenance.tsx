import { resolveSafety, summarizeWorklist, WorklistTable, type WorklistItemInput } from 'nirs4all-ui/lab';
import { Activity, FlaskConical, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { analyzeDrift, calibrationMatrix, makeDriftBatch, resampleTo, type DriftVerdict, type Mat } from '@/lib/drift';
import { predictWithModel } from '@/engine/predict';
import { analyzeFiles, readRawFiles } from '@/lib/dataset';
import { downloadText, slug, toCsv } from '@/lib/export';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { safetyIcons } from '@/ui/icons';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';
import { Dropzone } from '@/ui/Dropzone';

const VERDICT: Record<DriftVerdict, { fr: string; en: string; tone: string; pill: string }> = {
  stable: { fr: 'Stable', en: 'Stable', tone: 'text-success', pill: 'n4-pill n4-pill--green' },
  moderate: { fr: 'Dérive modérée', en: 'Moderate drift', tone: 'text-warning', pill: 'n4-pill n4-pill--amber' },
  strong: { fr: 'Dérive forte', en: 'Strong drift', tone: 'text-destructive', pill: 'n4-pill n4-pill--rose' },
};

// §3 Écran 6 — maintenance planner. Add a new routine batch (drop spectra or
// simulate one), re-run the domain analysis to ISOLATE drift (joint PCA of the
// calibration set + the new batch), and get a recommendation: keep monitoring,
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
    return calibrationMatrix(spectra, refIds.size >= 3 ? refIds : undefined);
  }, [spectra, samples]);
  const [batch, setBatch] = useState<Mat | null>(null);
  const [note, setNote] = useState<string>('');

  const analysis = useMemo(() => (cal && batch ? analyzeDrift(cal, batch) : null), [cal, batch]);
  const stored = state.modelByProject[projectId];

  // §8 — use the DEPLOYED calibration model (its PLS/Ridge space) to decide what to
  // re-send to HPLC: predict the new batch, then prioritize samples the model is
  // least sure of — spectrally out-of-domain (out-X) and/or predicted outside the
  // trained reference range (out-Y). Those are the most useful to re-measure.
  const [resend, setResend] = useState<{ idx: number; predicted: number; outX: boolean; outY: boolean; priority: number }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!analysis || !batch || !stored || stored.nFeatures !== batch.p) { setResend(null); return; }
      const out = await predictWithModel(stored.model, batch.X, batch.n, batch.p);
      if (cancelled) return;
      const [ylo, yhi] = stored.yRange;
      const list = analysis.newPts.map((z) => {
        const predicted = out.values[z.idx] ?? Number.NaN;
        const outX = z.out;
        const outY = Number.isFinite(predicted) && (predicted < ylo || predicted > yhi);
        return { idx: z.idx, predicted, outX, outY, priority: z.novelty + (outY ? 1.5 : 0) };
      }).filter((r) => r.outX || r.outY).sort((a, b) => b.priority - a.priority);
      setResend(list);
    })().catch(() => setResend(null));
    return () => { cancelled = true; };
  }, [analysis, batch, stored]);

  function simulate() {
    if (!cal) return;
    setBatch(makeDriftBatch(cal.p, 24));
    setNote(tr('Lot simulé : 24 spectres de routine (nouveau site partiel).', 'Simulated batch: 24 routine spectra (partial new site).'));
  }
  async function onFiles(files: File[]) {
    if (!cal || files.length === 0) return;
    try {
      const a = analyzeFiles(await readRawFiles(files));
      const p = cal.p;
      const n = a.xGrid.rows.length;
      const X = new Float64Array(n * p);
      // extract each spectrum's feature block and resample to the calibration axis
      a.xGrid.rows.forEach((row, i) => {
        const feat = row.slice(a.featureStart).map((c) => Number(String(c).replace(',', '.')));
        const rs = resampleTo(feat.map((v) => (Number.isFinite(v) ? v : 0)), p);
        for (let j = 0; j < p; j++) X[i * p + j] = rs[j] ?? 0;
      });
      setBatch({ X, n, p });
      setNote(tr(`${files[0]?.name} · ${n} spectres ajoutés au suivi.`, `${files[0]?.name} · ${n} spectra added to monitoring.`));
    } catch (e) {
      setNote(tr('CSV illisible : ', 'Unreadable CSV: ') + (e instanceof Error ? e.message : ''));
    }
  }

  // control / enrichment worklist = the out-of-domain new samples (golden rule → verify)
  const worklist: WorklistItemInput[] = useMemo(() => {
    if (!analysis) return [];
    return analysis.newPts.filter((z) => z.out)
      .sort((a, b) => b.novelty - a.novelty)
      .map((z, i) => ({
        sampleId: `N-${String(1000 + z.idx)}`,
        reason: z.novelty > analysis.threshold * 1.6 ? 'rare_type' : 'boundary',
        decisionColor: 'out_of_domain',
        rank: i + 1,
      }));
  }, [analysis]);
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
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <Dropzone onFiles={onFiles} compact accept=".csv,.txt,.tsv"
          title={tr('Déposez un nouveau lot de spectres', 'Drop a new batch of spectra')}
          hint={<>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — spectres de routine à surveiller', ' — routine spectra to monitor')}</>} />
        <button className="btn-outline h-fit" onClick={simulate} disabled={!cal}>
          <RefreshCw size={14} /> {tr('Simuler un nouveau lot', 'Simulate a batch')}
        </button>
      </div>
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
                  resend.map((r, i) => ({ rank: i + 1, sample_id: `N-${String(1000 + r.idx)}`, predicted: Number.isFinite(r.predicted) ? r.predicted.toFixed(3) : '', out_x: r.outX ? 'yes' : '', out_y: r.outY ? 'yes' : '' })),
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
                  <tbody>
                    {resend.slice(0, 30).map((r, i) => (
                      <tr key={r.idx} className="border-t border-border/60">
                        <td className="px-4 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">N-{1000 + r.idx}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(r.predicted) ? r.predicted.toFixed(2) : '—'}</td>
                        <td className="px-3 py-1.5">
                          <span className="flex flex-wrap gap-1.5">
                            {r.outX && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">{tr('spectre hors-domaine (X)', 'spectrum out-of-domain (X)')}</span>}
                            {r.outY && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">{tr('prédit hors-gamme (Y)', 'predicted out-of-range (Y)')}</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
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
            <div className="mt-4 card p-2">
              <div className="flex items-center justify-between px-2 py-2 text-sm font-medium">
                {tr('Lot de contrôle recommandé (échantillons dérivés à mesurer)', 'Recommended control batch (drifted samples to measure)')}
                <button className="btn-outline" onClick={() => downloadText(`${slug(project?.name ?? 'projet')}-controle.csv`, toCsv(
                  worklist.map((b) => ({ rank: b.rank ?? '', sample_id: b.sampleId, reason: b.reason ?? '', safety: resolveSafety(b) })),
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
