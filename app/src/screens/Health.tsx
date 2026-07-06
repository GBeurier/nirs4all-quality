import { summarizeHealth, type HealthFindingInput, type HealthSeverity } from '@lab';
import { AlertTriangle, Ban, Check, ChevronDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Cell, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import { buildRepetitionModel } from '@/lib/repetitions';
import { computeQuality } from '@/lib/quality';
import { useTr } from '@/i18n';
import { useLab } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

const SEV: Record<HealthSeverity, { color: string; bg: string; icon: ReactNode }> = {
  ok: { color: 'text-success', bg: 'bg-success/10', icon: <Check size={16} /> },
  warning: { color: 'text-warning', bg: 'bg-warning/10', icon: <AlertTriangle size={16} /> },
  critical: { color: 'text-destructive', bg: 'bg-destructive/10', icon: <Ban size={16} /> },
};
const fmt = (v: number) => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : v.toFixed(3));

interface Finding {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  affected?: number;
  affectedIds?: string[];
  evidence: ReactNode;
}

export function Health({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const spectra = state.spectraByProject[projectId];
  const samples = state.samplesByProject[projectId] ?? [];

  const findings = useMemo<Finding[]>(() => {
    if (!spectra || spectra.samples.length === 0) return [];
    const yBySample: Record<string, number | undefined> = {};
    const metaBySample: Record<string, Record<string, string | number | null>> = {};
    for (const s of samples) { if (typeof s.reference?.value === 'number') yBySample[s.id] = s.reference.value; metaBySample[s.id] = s.metadata; }
    const Q = computeQuality(spectra, yBySample, metaBySample);
    const rep = buildRepetitionModel(spectra, yBySample, 'variance');
    const out: Finding[] = [];

    // 1. Saturation
    out.push({
      id: 'saturation',
      severity: Q.saturation.flagged.length > 0 ? 'critical' : 'ok',
      title: tr('Saturation du signal', 'Signal saturation'),
      detail: Q.saturation.flagged.length > 0
        ? tr(`${Q.saturation.flagged.length} spectre(s) atteignent le plafond (≥ 99 % du max)`, `${Q.saturation.flagged.length} spectrum(s) hit the ceiling (≥ 99% of max)`)
        : tr('Aucun spectre saturé.', 'No saturated spectra.'),
      affected: Q.saturation.flagged.length,
      affectedIds: Q.saturation.flagged.map((f) => f.sampleId),
      evidence: (
        <div className="text-xs">
          <p className="mb-1 text-muted-foreground">{tr('Seuil de saturation', 'Saturation threshold')} = 0,99 × max = <b>{fmt(Q.saturation.threshold)}</b>. {tr('Un échantillon est signalé si au moins une bande dépasse ce seuil.', 'A sample is flagged if at least one band exceeds this threshold.')}</p>
          {Q.saturation.flagged.length === 0 ? <p className="text-success">✓ {tr('rien à signaler', 'nothing to report')}</p>
            : <ul className="font-mono">{Q.saturation.flagged.slice(0, 8).map((f) => <li key={f.sampleId}>{f.sampleId}: {f.count} {tr('bandes', 'bands')}</li>)}</ul>}
        </div>
      ),
    });

    // 2. PCA T²/Q outliers — the key dataviz
    const pts = Q.outliers.points.map((o) => ({ x: o.t2, y: o.q, flagged: o.flagged, id: o.sampleId }));
    out.push({
      id: 'outliers',
      severity: Q.outliers.flaggedIds.length > 0 ? 'warning' : 'ok',
      title: tr('Spectres atypiques (T² / Q)', 'Atypical spectra (T² / Q)'),
      detail: Q.outliers.flaggedIds.length > 0
        ? tr(`${Q.outliers.flaggedIds.length} spectre(s) au-delà du 95e percentile (T² ou Q).`, `${Q.outliers.flaggedIds.length} spectrum(s) beyond the 95th percentile (T² or Q).`)
        : tr('Aucun spectre franchement atypique.', 'No clearly atypical spectra.'),
      affected: Q.outliers.flaggedIds.length,
      affectedIds: Q.outliers.flaggedIds,
      evidence: (
        <div className="text-xs">
          <p className="mb-1 text-muted-foreground">
            {tr(`PCA à ${Q.outliers.nComp} composantes. T² = leverage dans le modèle PCA ; Q = erreur de reconstruction (ce que la PCA n'explique pas). Seuils = 95e percentile : T²>`, `PCA with ${Q.outliers.nComp} components. T² = leverage in the PCA model; Q = reconstruction error (what PCA does not explain). Thresholds = 95th percentile: T²>`)}<b>{fmt(Q.outliers.t2p95)}</b>, Q&gt;<b>{fmt(Q.outliers.qp95)}</b>.
          </p>
          <ResponsiveContainer width="100%" height={190}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="x" name="T²" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
                label={{ value: 'T² (Hotelling)', position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <YAxis type="number" dataKey="y" name="Q" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={42}
                label={{ value: 'Q (SPE)', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} />
              <ReferenceLine x={Q.outliers.t2p95} stroke="var(--destructive)" strokeDasharray="3 3" />
              <ReferenceLine y={Q.outliers.qp95} stroke="var(--destructive)" strokeDasharray="3 3" />
              <Scatter data={pts} isAnimationActive={false}>
                {pts.map((pt, i) => <Cell key={i} fill={pt.flagged ? 'var(--destructive)' : 'var(--chart-1)'} fillOpacity={pt.flagged ? 0.9 : 0.5} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="mt-1 text-muted-foreground">{tr('En rouge : au-delà d’un seuil. Point à T² élevé = extrême mais expliqué ; à Q élevé = forme mal reconstruite (artefact possible).', 'Red: beyond a threshold. High-T² = extreme but explained; high-Q = poorly reconstructed shape (possible artefact).')}</p>
        </div>
      ),
    });

    // 3. Noise (per-band curve)
    const noiseRows = Q.noise.axis.map((a, j) => ({ x: a, noise: Q.noise.noise[j] }));
    out.push({
      id: 'noise',
      severity: 'ok',
      title: tr('Bruit spectral par bande', 'Per-band spectral noise'),
      detail: Q.noise.peakFrom !== null
        ? tr(`Variation la plus forte vers ${Q.noise.peakFrom}–${Q.noise.peakTo} nm (bandes d’eau).`, `Strongest variation around ${Q.noise.peakFrom}–${Q.noise.peakTo} nm (water bands).`)
        : tr('Bruit homogène.', 'Homogeneous noise.'),
      evidence: (
        <div className="text-xs">
          <p className="mb-1 text-muted-foreground">{tr('Courbe = moyenne, sur tous les spectres, de |ΔAbsorbance| entre bandes voisines (énergie de première différence). Zone ombrée = bandes au-delà du 90e percentile.', 'Curve = mean over all spectra of |ΔAbsorbance| between neighbouring bands (first-difference energy). Shaded = bands above the 90th percentile.')}</p>
          <ResponsiveContainer width="100%" height={170}>
            <ComposedChart data={noiseRows} margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
                label={{ value: `λ (${spectra.axisUnit})`, position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={42} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} labelFormatter={(l) => `λ ${l}`} />
              {Q.noise.peakFrom !== null && Q.noise.peakTo !== null ? <ReferenceArea x1={Q.noise.peakFrom} x2={Q.noise.peakTo} fill="var(--warning)" fillOpacity={0.12} /> : null}
              <Area type="monotone" dataKey="noise" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ),
    });

    // 4. Reference (y) outliers
    out.push({
      id: 'reference',
      severity: Q.reference.flagged.length > 0 ? 'warning' : 'ok',
      title: tr('Références incohérentes', 'Inconsistent references'),
      detail: Q.reference.flagged.length > 0
        ? tr(`${Q.reference.flagged.length} valeur(s) hors de l’intervalle IQR.`, `${Q.reference.flagged.length} value(s) outside the IQR fence.`)
        : tr('Références dans l’intervalle attendu.', 'References within the expected fence.'),
      affected: Q.reference.flagged.length,
      affectedIds: Q.reference.flagged.map((f) => f.sampleId),
      evidence: (
        <div className="text-xs text-muted-foreground">
          <p>{tr('Règle IQR (k = 1,5, comme YOutlierFilter). Intervalle acceptable :', 'IQR rule (k = 1.5, like YOutlierFilter). Acceptable fence:')} [<b>{fmt(Q.reference.lo)}</b>, <b>{fmt(Q.reference.hi)}</b>] {tr('sur', 'over')} {Q.reference.n} {tr('références', 'references')}.</p>
          {Q.reference.flagged.length > 0 && <ul className="mt-1 font-mono">{Q.reference.flagged.slice(0, 8).map((f) => <li key={f.sampleId}>{f.sampleId}: {fmt(f.value)}</li>)}</ul>}
        </div>
      ),
    });

    // 5. Replicates
    out.push({
      id: 'replicates',
      severity: rep.nOutliers > 0 ? 'warning' : 'ok',
      title: tr('Répétitions incohérentes', 'Inconsistent replicates'),
      detail: rep.nOutliers > 0
        ? tr(`${rep.nOutliers} répétition(s) au-delà du P95 des distances.`, `${rep.nOutliers} replicate(s) beyond the P95 of distances.`)
        : tr('Répétitions cohérentes.', 'Replicates are consistent.'),
      affected: rep.nOutliers,
      evidence: (
        <div className="text-xs text-muted-foreground">
          <p>{tr('Distance de chaque répétition à la moyenne de son échantillon. Seuil P95 =', 'Distance of each replicate to its sample mean. P95 threshold =')} <b>{fmt(rep.quantiles.p95)}</b>. {tr('Voir l’onglet « Répétitions » de l’explorateur pour le détail par échantillon.', 'See the "Replicates" tab of the explorer for per-sample detail.')}</p>
        </div>
      ),
    });

    // 6. Metadata structure → split
    const insts = Object.entries(Q.structure.byInstrument);
    out.push({
      id: 'structure',
      severity: 'ok',
      title: tr('Structure & découpage', 'Structure & split'),
      detail: Q.structure.multiInstrument
        ? tr(`Données réparties sur ${insts.length} instruments → découpage GroupKFold par instrument.`, `Data spread over ${insts.length} instruments → GroupKFold split by instrument.`)
        : tr('Pas de structure instrument marquée → KFold standard.', 'No strong instrument structure → standard KFold.'),
      evidence: (
        <div className="text-xs text-muted-foreground">
          <p className="mb-1">{tr('Répartition par instrument :', 'Distribution by instrument:')}</p>
          <ul className="font-mono">{insts.map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          <p className="mt-1">{tr('On découpe par groupe pour éviter qu’un instrument soit à la fois en apprentissage et en test (fuite).', 'We split by group so an instrument is never in both training and test (leakage).')} <Explain content={EXPLAIN.splitRecommendation} /></p>
        </div>
      ),
    });

    return out;
  }, [spectra, samples, tr, EXPLAIN]);

  const summary = useMemo(() => summarizeHealth(findings.map((f): HealthFindingInput => ({ id: f.id, title: f.title, severity: f.severity }))), [findings]);

  if (findings.length === 0) return <div className="mx-auto max-w-3xl text-sm text-muted-foreground">{tr('Aucun spectre chargé.', 'No spectra loaded.')}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Santé des données', 'Data health')}</h1>
        <Explain content={EXPLAIN.healthScore} />
      </div>
      <div className="mb-5 flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <div className="text-4xl font-bold text-primary">{summary.score}</div>
        <div>
          <div className="text-sm font-medium">/ 100</div>
          <div className="text-xs text-muted-foreground">
            {summary.counts.critical} {tr('bloquant', 'blocking')} · {summary.counts.warning} {tr('à vérifier', 'to check')} · {summary.counts.ok} OK
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {findings.map((f) => (
          <FindingCard key={f.id} f={f} tr={tr}
            onRemeasure={f.affectedIds && f.affectedIds.length > 0 && (f.id === 'saturation')
              ? () => dispatch({ kind: 'set_sample_status', projectId, sampleIds: f.affectedIds ?? [], status: 'to_remeasure' })
              : undefined} />
        ))}
      </ul>
    </div>
  );
}

function FindingCard({ f, tr, onRemeasure }: { f: Finding; tr: (fr: string, en: string) => string; onRemeasure?: (() => void) | undefined }) {
  const [open, setOpen] = useState(false);
  const sev = SEV[f.severity];
  return (
    <li className="rounded-lg border border-border bg-card">
      <div className={`flex items-start gap-3 p-3 ${sev.bg} rounded-t-lg`}>
        <span className={`mt-0.5 ${sev.color}`}>{sev.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{f.title}</div>
          <div className="text-xs text-muted-foreground">{f.detail}</div>
        </div>
        {onRemeasure && <button onClick={onRemeasure} className="rounded-md bg-warning/20 px-2 py-1 text-xs text-warning">{tr('Re-mesurer', 'Re-measure')}</button>}
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
          {tr('Détails & preuve', 'Details & evidence')} <ChevronDown size={13} className={open ? 'rotate-180 transition' : 'transition'} />
        </button>
      </div>
      {open && <div className="border-t border-border p-3">{f.evidence}</div>}
    </li>
  );
}
