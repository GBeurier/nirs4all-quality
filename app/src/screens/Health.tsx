import { summarizeHealth, type HealthFindingInput, type HealthSeverity } from '@lab';
import { AlertTriangle, Ban, Check, ChevronDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Cell, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { computePca } from '@/lib/pca';
import { applyPreviewPp, PREVIEW_PP } from '@/lib/preview';
import { buildRepetitionModel } from '@/lib/repetitions';
import { computeQuality } from '@/lib/quality';
import { useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

// each problematic category gets its OWN colour so you can tell saturated from flat
// from atypical at a glance (design: distinguish which is which).
type FlagCat = 'saturation' | 'flat' | 'atypical';
const CAT_COLOR: Record<FlagCat, string> = { saturation: 'var(--warning)', flat: 'var(--chart-4)', atypical: 'var(--destructive)' };
const CAT_LABEL: Record<FlagCat, { fr: string; en: string }> = {
  saturation: { fr: 'saturation', en: 'saturation' },
  flat: { fr: 'spectre plat', en: 'flat spectrum' },
  atypical: { fr: 'atypique T²/Q', en: 'atypical T²/Q' },
};

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
  const spectra = useProjectSpectra(projectId);
  const fullSpectra = state.spectraByProject[projectId];
  const crop = state.cropByProject[projectId] ?? { from: null, to: null };
  const previewPp = state.previewPpByProject[projectId] ?? 'none';
  const samples = state.samplesByProject[projectId] ?? [];
  // display spectra with the shared preprocessing preview (findings stay on raw)
  const displaySpectra = useMemo(() => (spectra ? applyPreviewPp(spectra, previewPp) : spectra), [spectra, previewPp]);

  const quality = useMemo(() => {
    if (!spectra || spectra.samples.length === 0) return null;
    const yBySample: Record<string, number | undefined> = {};
    const metaBySample: Record<string, Record<string, string | number | null>> = {};
    for (const s of samples) { if (typeof s.reference?.value === 'number') yBySample[s.id] = s.reference.value; metaBySample[s.id] = s.metadata; }
    return { Q: computeQuality(spectra, yBySample, metaBySample), rep: buildRepetitionModel(spectra, yBySample, 'variance') };
  }, [spectra, samples]);

  // per-category sets of problematic samples (so each can be toggled + coloured)
  const cats = useMemo(() => {
    const saturation = new Set(quality?.Q.saturation.flagged.map((f) => f.sampleId) ?? []);
    const flat = new Set(quality?.Q.flat.flagged.map((f) => f.sampleId) ?? []);
    const atypical = new Set(quality?.Q.outliers.flaggedIds ?? []);
    return { saturation, flat, atypical };
  }, [quality]);

  // which problematic categories are highlighted right now (check/uncheck cards)
  const [enabled, setEnabled] = useState<Record<FlagCat, boolean>>({ saturation: true, flat: true, atypical: true });

  // sample id → its dominant ENABLED category (for the coloured highlight)
  const flaggedCat = useMemo(() => {
    const map = new Map<string, FlagCat>();
    const order: FlagCat[] = ['saturation', 'flat', 'atypical'];
    for (const s of spectra?.samples ?? []) {
      for (const c of order) if (enabled[c] && cats[c].has(s.sampleId)) { map.set(s.sampleId, c); break; }
    }
    return map;
  }, [spectra, cats, enabled]);

  const findings = useMemo<Finding[]>(() => {
    if (!quality || !spectra) return [];
    const { Q, rep } = quality;
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
  }, [quality, spectra, tr]);

  const summary = useMemo(() => summarizeHealth(findings.map((f): HealthFindingInput => ({ id: f.id, title: f.title, severity: f.severity }))), [findings]);

  if (findings.length === 0) return <div className="mx-auto max-w-3xl text-sm text-muted-foreground">{tr('Aucun spectre chargé.', 'No spectra loaded.')}</div>;

  return (
    <div className="mx-auto max-w-4xl">
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

      {/* controls: which problematic categories to highlight + spectral-tail crop */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card p-3">
        <span className="text-xs font-medium text-muted-foreground">{tr('Afficher', 'Show')} :</span>
        {(['saturation', 'flat', 'atypical'] as FlagCat[]).map((c) => {
          const count = cats[c].size;
          return (
            <label key={c} className={`flex cursor-pointer items-center gap-1.5 text-xs ${count === 0 ? 'opacity-40' : ''}`}>
              <input type="checkbox" checked={enabled[c]} disabled={count === 0}
                onChange={(e) => setEnabled((prev) => ({ ...prev, [c]: e.target.checked }))} />
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[c] }} />
              <span className="font-medium">{tr(CAT_LABEL[c].fr, CAT_LABEL[c].en)}</span>
              <span className="tabular-nums text-muted-foreground">({count})</span>
            </label>
          );
        })}
        {fullSpectra && <CropControl full={fullSpectra} crop={crop} onApply={(from, to) => dispatch({ kind: 'set_crop', projectId, from, to })} tr={tr} />}
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span className="text-xs font-medium text-muted-foreground">{tr('Aperçu préprocessing', 'Preprocessing preview')} :</span>
          {PREVIEW_PP.map((pp) => (
            <button key={pp.id} onClick={() => dispatch({ kind: 'set_preview_pp', projectId, pp: pp.id })}
              className={`rounded-md px-2 py-0.5 text-xs transition ${previewPp === pp.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
              {tr(pp.fr, pp.en)}
            </button>
          ))}
          <Explain content={EXPLAIN.preprocessingPreview} />
        </div>
      </div>

      {displaySpectra && <HealthSpectraView spectra={displaySpectra} flaggedCat={flaggedCat} tr={tr} />}

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

// Spectral-tail crop: trim noisy ends for analysis AND calibration (one window, one
// feature axis everywhere). Persisted per project; drops any stale model on change.
function CropControl({ full, crop, onApply, tr }: { full: SpectraDataset; crop: { from: number | null; to: number | null }; onApply: (from: number | null, to: number | null) => void; tr: (fr: string, en: string) => string }) {
  const axis = full.axis;
  const lo = axis[0] ?? 0;
  const hi = axis[axis.length - 1] ?? 0;
  const [from, setFrom] = useState(String(crop.from ?? Math.round(lo)));
  const [to, setTo] = useState(String(crop.to ?? Math.round(hi)));
  const cropped = crop.from != null || crop.to != null;
  const apply = () => {
    const f = Number(from); const t = Number(to);
    onApply(Number.isFinite(f) && f > lo ? f : null, Number.isFinite(t) && t < hi ? t : null);
  };
  return (
    <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{tr('Couper les bords', 'Crop tails')} :</span>
      <input type="number" value={from} onChange={(e) => setFrom(e.target.value)} className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 tabular-nums" />
      <span className="text-muted-foreground">–</span>
      <input type="number" value={to} onChange={(e) => setTo(e.target.value)} className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 tabular-nums" />
      <span className="text-muted-foreground">{full.axisUnit}</span>
      <button onClick={apply} className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20">{tr('Appliquer', 'Apply')}</button>
      {cropped && <button onClick={() => onApply(null, null)} className="rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted">{tr('Réinit.', 'Reset')}</button>}
      <span className="w-full text-[11px] text-muted-foreground">
        {cropped
          ? tr(`Fenêtre active ${crop.from ?? lo.toFixed(0)}–${crop.to ?? hi.toFixed(0)} ${full.axisUnit} (gamme complète ${lo.toFixed(0)}–${hi.toFixed(0)}). Appliquée à l’analyse ET à la calibration.`, `Active window ${crop.from ?? lo.toFixed(0)}–${crop.to ?? hi.toFixed(0)} ${full.axisUnit} (full range ${lo.toFixed(0)}–${hi.toFixed(0)}). Applied to analysis AND calibration.`)
          : tr(`Gamme complète ${lo.toFixed(0)}–${hi.toFixed(0)} ${full.axisUnit}. Recadrer retire les bords bruités pour l’analyse et la calibration.`, `Full range ${lo.toFixed(0)}–${hi.toFixed(0)} ${full.axisUnit}. Cropping removes noisy tails for analysis and calibration.`)}
      </span>
    </div>
  );
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

// Explore/HPLC-style spectra + PCA views, with the problematic spectra (saturated
// / flat / atypical) drawn in a per-category colour so you can tell which is which.
function HealthSpectraView({ spectra, flaggedCat, tr }: { spectra: SpectraDataset; flaggedCat: Map<string, FlagCat>; tr: (fr: string, en: string) => string }) {
  const spec = useMemo(() => {
    const p = spectra.axis.length;
    const means = spectra.samples.map((s) => ({ m: meanSpectrum(s), cat: flaggedCat.get(s.sampleId) }));
    const good = means.filter((x) => !x.cat).map((x) => x.m);
    const bad = means.filter((x) => x.cat).slice(0, 15) as { m: Float64Array; cat: FlagCat }[];
    const step = Math.max(1, Math.floor(p / 70));
    const rows: Record<string, number | number[] | null>[] = [];
    for (let j = 0; j < p; j += step) {
      const vals = good.map((m) => m[j] ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
      const row: Record<string, number | number[] | null> = {
        x: spectra.axis[j] ?? j,
        b1090: vals.length ? [quantile(vals, 0.1), quantile(vals, 0.9)] : null,
        b2575: vals.length ? [quantile(vals, 0.25), quantile(vals, 0.75)] : null,
        med: vals.length ? quantile(vals, 0.5) : null,
      };
      bad.forEach((b, k) => { row['c' + k] = b.m[j] ?? null; });
      rows.push(row);
    }
    return { rows, cLines: bad.map((b, k) => ({ key: 'c' + k, color: CAT_COLOR[b.cat] })), nBad: means.filter((x) => x.cat).length };
  }, [spectra, flaggedCat]);

  const pca = useMemo(() => {
    const p = spectra.axis.length;
    const n = spectra.samples.length;
    const X = new Float64Array(n * p);
    spectra.samples.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < p; j++) X[i * p + j] = m[j] ?? 0; });
    const r = computePca(X, n, p, 2);
    const pts = r.scores.map((sc, i) => {
      const row = r.usedIdx[i] ?? i;
      const id = spectra.samples[row]?.sampleId ?? '';
      return { x: sc[0] ?? 0, y: sc[1] ?? 0, cat: flaggedCat.get(id) };
    });
    return { pts, ev: (k: number) => ((r.explained[k] ?? 0) * 100).toFixed(1) };
  }, [spectra, flaggedCat]);

  return (
    <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">{tr('Spectres — problématiques en rouge', 'Spectra — problematic in red')} <Explain content={EXPLAIN.healthSpectra} /></div>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={spec.rows} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
              label={{ value: `λ (${spectra.axisUnit})`, position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={44} tickFormatter={fmt} />
            <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: unknown) => (Array.isArray(v) ? `${fmt(v[0])}…${fmt(v[1])}` : fmt(Number(v)))} labelFormatter={(l) => `λ ${l}`} />
            <Area type="monotone" dataKey="b1090" stroke="none" fill="var(--chart-1)" fillOpacity={0.1} isAnimationActive={false} connectNulls />
            <Area type="monotone" dataKey="b2575" stroke="none" fill="var(--chart-1)" fillOpacity={0.2} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="med" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {spec.cLines.map((c) => (
              <Line key={c.key} type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={1} strokeOpacity={0.85} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(`Bandes = quantiles des spectres sains (P10–P90, P25–P75, médiane). Lignes colorées = ${spec.nBad} spectre(s) problématique(s), couleur par catégorie (saturation / plat / atypique).`,
            `Bands = healthy spectra quantiles (P10–P90, P25–P75, median). Coloured lines = ${spec.nBad} problematic spectrum(s), coloured by category (saturation / flat / atypical).`)}
        </p>
      </div>
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">{tr('PCA — problématiques en rouge', 'PCA — problematic in red')} <Explain content={EXPLAIN.healthPca} /></div>
        <ResponsiveContainer width="100%" height={230}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="x" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
              label={{ value: `PC1 (${pca.ev(0)} %)`, position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <YAxis type="number" dataKey="y" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={44}
              label={{ value: `PC2 (${pca.ev(1)} %)`, angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <ZAxis range={[34, 34]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} />
            <Scatter data={pca.pts} isAnimationActive={false}>
              {pca.pts.map((pt, i) => <Cell key={i} fill={pt.cat ? CAT_COLOR[pt.cat] : 'var(--chart-1)'} fillOpacity={pt.cat ? 0.95 : 0.5} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--chart-1)' }} /> {tr('sain', 'healthy')}</span>
          {(['saturation', 'flat', 'atypical'] as FlagCat[]).map((c) => (
            <span key={c} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CAT_COLOR[c] }} /> {tr(CAT_LABEL[c].fr, CAT_LABEL[c].en)}</span>
          ))}
        </div>
      </div>
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
