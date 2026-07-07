import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { parseReferenceColumn } from '@/lib/dataset';
import { histogram } from '@/lib/histogram';
import { computePca } from '@/lib/pca';
import { applyPreviewPp, PREVIEW_PP } from '@/lib/preview';
import { buildRepetitionModel, distanceColor, type RepSort } from '@/lib/repetitions';
import { downloadText, slug, toCsv } from '@/lib/export';
import { useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const H = 320;

function fmt(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 1e-3)) return n.toExponential(2);
  return n.toFixed(3);
}
function continuousColor(t: number): string {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return `hsl(${(174 - 142 * c).toFixed(0)} 68% 42%)`;
}

type Tab = 'spectra' | 'target' | 'pca' | 'reps';

export function DatasetExplorer({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const spectra = useProjectSpectra(projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const previewPp = state.previewPpByProject[projectId] ?? 'none';
  const repMode = state.repModeByProject[projectId] ?? 'mean';
  // display-only preprocessing preview (shared with Data-health), applied to the
  // spectra + PCA views so the tech sees the corrected signal
  const displaySpectra = useMemo(() => (spectra ? applyPreviewPp(spectra, previewPp) : spectra), [spectra, previewPp]);
  const [tab, setTab] = useState<Tab>('spectra');
  const yInputRef = useRef<HTMLInputElement>(null);
  const [yMsg, setYMsg] = useState('');

  async function onAddY(file: File | undefined) {
    if (!file) return;
    try {
      const values = parseReferenceColumn(await file.text());
      // align to the samples by order (a value per row of X, missing cells = null)
      const aligned = samples.map((_, i) => values[i] ?? null);
      const added = aligned.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).length;
      if (added === 0) { setYMsg(tr('Aucune valeur numérique trouvée.', 'No numeric value found.')); return; }
      dispatch({ kind: 'set_references', projectId, values: aligned });
      setYMsg(tr(`${added} référence(s) ajoutée(s) — prêtes pour la calibration.`, `${added} reference(s) added — ready for calibration.`));
    } catch (e) {
      setYMsg(tr('Fichier illisible : ', 'Unreadable file: ') + (e instanceof Error ? e.message : ''));
    }
  }

  const yBySample = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    for (const s of samples) if (typeof s.reference?.value === 'number') m[s.id] = s.reference.value;
    return m;
  }, [samples]);

  if (!spectra || spectra.samples.length === 0) {
    return <Empty />;
  }

  const nRep = spectra.samples.reduce((s, x) => s + x.reps.length, 0);
  const nLabelled = Object.keys(yBySample).length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Explorer les données', 'Explore data')}</h1>
        <Explain content={EXPLAIN.datasetOverview} />
        <div className="ml-auto flex items-center gap-2">
          <button
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/5"
            title={tr('Ajouter les valeurs de référence y (une par échantillon, cellules vides = manquant)', 'Add reference values y (one per sample, empty cells = missing)')}
            onClick={() => yInputRef.current?.click()}
          >
            <Plus size={13} /> {tr('Ajouter y', 'Add y')}
          </button>
          <Explain content={EXPLAIN.addY} />
          <input ref={yInputRef} type="file" accept=".csv,.txt,.tsv" className="hidden"
            onChange={(e) => { void onAddY(e.target.files?.[0]); e.target.value = ''; }} />
          <button
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => downloadText('lims-samples.csv', toCsv(
              samples.map((s) => ({
                sample_id: s.id, barcode: s.barcode ?? '', lot_id: s.lotId ?? '', status: s.status,
                reference_value: s.reference?.value ?? '', reference_status: s.reference?.status ?? '',
                site: s.metadata['site'] ?? '', year: s.metadata['year'] ?? '', instrument: s.metadata['instrument'] ?? '',
              })),
              ['sample_id', 'barcode', 'lot_id', 'status', 'reference_value', 'reference_status', 'site', 'year', 'instrument']))}
          >
            {tr('Export LIMS (CSV)', 'Export LIMS (CSV)')}
          </button>
        </div>
      </div>
      {yMsg && <p className="mb-2 text-xs text-success">{yMsg}</p>}
      <p className="mb-4 text-sm text-muted-foreground">
        {tr(
          `${spectra.samples.length} échantillons · ${nRep} spectres · ${spectra.axis.length} longueurs d'onde (${spectra.axisUnit}) · ${nLabelled} avec référence`,
          `${spectra.samples.length} samples · ${nRep} spectra · ${spectra.axis.length} wavelengths (${spectra.axisUnit}) · ${nLabelled} with a reference`,
        )}
      </p>

      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm">
        <TabBtn active={tab === 'spectra'} onClick={() => setTab('spectra')}>{tr('Spectres', 'Spectra')}</TabBtn>
        <TabBtn active={tab === 'target'} onClick={() => setTab('target')}>{tr('Cible', 'Target')}</TabBtn>
        <TabBtn active={tab === 'pca'} onClick={() => setTab('pca')}>PCA</TabBtn>
        <TabBtn active={tab === 'reps'} onClick={() => setTab('reps')}>{tr('Répétitions', 'Replicates')}</TabBtn>
      </div>

      {/* preprocessing preview — applied to the spectra + PCA views (display only) */}
      {(tab === 'spectra' || tab === 'pca') && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{tr('Aperçu préprocessing', 'Preprocessing preview')} :</span>
          <div className="flex flex-wrap gap-1">
            {PREVIEW_PP.map((pp) => (
              <button key={pp.id} onClick={() => dispatch({ kind: 'set_preview_pp', projectId, pp: pp.id })}
                className={`rounded-md px-2 py-0.5 text-xs transition ${previewPp === pp.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                {tr(pp.fr, pp.en)}
              </button>
            ))}
          </div>
          <Explain content={EXPLAIN.preprocessingPreview} />
          <span className="w-full text-[11px] text-muted-foreground">{tr('Aperçu visuel — n’altère pas les données brutes ; le choix est partagé avec « Santé des données ».', 'Visual preview — does not alter the raw data; the choice is shared with "Data health".')}</span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        {tab === 'spectra' && <SpectraTab spectra={displaySpectra ?? spectra} />}
        {tab === 'target' && <TargetTab y={Object.values(yBySample).filter((v): v is number => typeof v === 'number')} />}
        {tab === 'pca' && <PcaTab spectra={displaySpectra ?? spectra} yBySample={yBySample} />}
        {tab === 'reps' && <RepsTab spectra={spectra} yBySample={yBySample} repMode={repMode} onRepMode={(m) => dispatch({ kind: 'set_rep_mode', projectId, mode: m })} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Spectra tab
function SpectraTab({ spectra }: { spectra: SpectraDataset }) {
  const model = useMemo(() => {
    const nF = spectra.axis.length;
    const means = spectra.samples.map(meanSpectrum);
    const n = means.length;
    const mn = new Array<number>(nF).fill(Infinity);
    const mx = new Array<number>(nF).fill(-Infinity);
    const sum = new Array<number>(nF).fill(0);
    const cnt = new Array<number>(nF).fill(0);
    for (const m of means) {
      for (let c = 0; c < nF; c++) {
        const v = m[c] ?? NaN;
        if (Number.isFinite(v)) { if (v < mn[c]!) mn[c] = v; if (v > mx[c]!) mx[c] = v; sum[c]! += v; cnt[c]! += 1; }
      }
    }
    const step = Math.max(1, Math.floor(n / 40));
    const lineIdx: number[] = [];
    for (let i = 0; i < n; i += step) lineIdx.push(i);
    const rows: Record<string, number | number[] | null>[] = [];
    for (let c = 0; c < nF; c++) {
      const row: Record<string, number | number[] | null> = {
        x: spectra.axis[c] ?? c,
        band: cnt[c]! > 0 ? [mn[c]!, mx[c]!] : null,
        mean: cnt[c]! > 0 ? sum[c]! / cnt[c]! : null,
      };
      lineIdx.forEach((si, li) => { row['l' + li] = means[si]?.[c] ?? null; });
      rows.push(row);
    }
    return { rows, lineKeys: lineIdx.map((_, li) => 'l' + li) };
  }, [spectra]);

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        Spectres (moyenne par échantillon + enveloppe min–max) <Explain content={EXPLAIN.spectra} />
      </div>
      <ResponsiveContainer width="100%" height={H}>
        <ComposedChart data={model.rows} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
            label={{ value: `Longueur d'onde (${spectra.axisUnit})`, position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
            formatter={(v: unknown) => (Array.isArray(v) ? `${fmt(v[0])} … ${fmt(v[1])}` : fmt(v))} labelFormatter={(l) => `λ ${l} ${spectra.axisUnit}`} />
          <Area type="monotone" dataKey="band" stroke="none" fill="var(--chart-1)" fillOpacity={0.12} isAnimationActive={false} connectNulls />
          {model.lineKeys.map((k) => (
            <Line key={k} type="monotone" dataKey={k} stroke="var(--chart-1)" strokeOpacity={0.16} strokeWidth={1} dot={false} isAnimationActive={false} />
          ))}
          <Line type="monotone" dataKey="mean" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

// ----------------------------------------------------------------- Target tab
function TargetTab({ y }: { y: number[] }) {
  const bins = useMemo(() => histogram(y, 20), [y]);
  const stats = useMemo(() => {
    if (y.length === 0) return null;
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    const std = Math.sqrt(y.reduce((a, b) => a + (b - mean) ** 2, 0) / y.length);
    return { min: Math.min(...y), max: Math.max(...y), mean, std };
  }, [y]);

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">Distribution de la référence (y) <Explain content={EXPLAIN.target} /></div>
      {stats && (
        <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Chip>min {fmt(stats.min)}</Chip><Chip>moy {fmt(stats.mean)}</Chip><Chip>max {fmt(stats.max)}</Chip><Chip>écart-type {fmt(stats.std)}</Chip>
        </div>
      )}
      <ResponsiveContainer width="100%" height={H}>
        <BarChart data={bins} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="bin" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={40} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }} formatter={(v: unknown) => [`${v}`, 'nb']} labelFormatter={(l) => `≥ ${l}`} />
          <Bar dataKey="count" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// -------------------------------------------------------------------- PCA tab
function PcaTab({ spectra, yBySample }: { spectra: SpectraDataset; yBySample: Record<string, number | undefined> }) {
  const { pts, ev } = useMemo(() => {
    const nF = spectra.axis.length;
    const n = spectra.samples.length;
    const X = new Float64Array(n * nF);
    spectra.samples.forEach((s, i) => { const m = meanSpectrum(s); for (let j = 0; j < nF; j++) X[i * nF + j] = m[j] ?? 0; });
    const pca = computePca(X, n, nF, 2);
    const ys = spectra.samples.map((s) => yBySample[s.sampleId]).filter((v): v is number => typeof v === 'number');
    const lo = ys.length ? Math.min(...ys) : 0;
    const hi = ys.length ? Math.max(...ys) : 1;
    const pts = pca.scores.map((sc, i) => {
      const row = pca.usedIdx[i] ?? i;
      const sample = spectra.samples[row];
      const yv = sample ? yBySample[sample.sampleId] : undefined;
      const t = typeof yv === 'number' && hi > lo ? (yv - lo) / (hi - lo) : 0.5;
      return { x: sc[0] ?? 0, y: sc[1] ?? 0, color: continuousColor(t), id: sample?.sampleId ?? String(row) };
    });
    const ev = (i: number) => `${((pca.explained[i] ?? 0) * 100).toFixed(1)} %`;
    return { pts, ev };
  }, [spectra, yBySample]);

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">PCA — carte des échantillons (couleur = référence) <Explain content={EXPLAIN.pca} /></div>
      <ResponsiveContainer width="100%" height={H}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="x" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
            label={{ value: `PC1 (${ev(0)})`, position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <YAxis type="number" dataKey="y" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48}
            label={{ value: `PC2 (${ev(1)})`, angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }} />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }} formatter={(v: unknown) => fmt(v)} />
          <Scatter data={pts} isAnimationActive={false}>
            {pts.map((p, i) => <Cell key={i} fill={p.color} fillOpacity={0.8} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}

// ------------------------------------------------------------ Repetitions tab
function RepsTab({ spectra, yBySample, repMode, onRepMode }: { spectra: SpectraDataset; yBySample: Record<string, number | undefined>; repMode: 'mean' | 'raw'; onRepMode: (m: 'mean' | 'raw') => void }) {
  const [sort, setSort] = useState<RepSort>('index');
  const model = useMemo(() => buildRepetitionModel(spectra, yBySample, sort), [spectra, yBySample, sort]);
  const xMax = Math.max(1, model.order.length - 1);
  const qLines: { q: number; v: number; color: string }[] = [
    { q: 75, v: model.quantiles.p75, color: 'var(--chart-2)' },
    { q: 90, v: model.quantiles.p90, color: 'var(--chart-5)' },
    { q: 95, v: model.quantiles.p95, color: 'var(--destructive)' },
  ];

  return (
    <>
      {/* how replicates feed calibration: the per-sample mean, or every raw replicate */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
        <span className="font-medium text-muted-foreground">Répétitions pour la calibration :</span>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(['mean', 'raw'] as const).map((m) => (
            <button key={m} onClick={() => onRepMode(m)}
              className={`px-2.5 py-1 ${repMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
              {m === 'mean' ? 'moyenne par échantillon' : 'répétitions brutes'}
            </button>
          ))}
        </div>
        <Explain content={EXPLAIN.repMode} />
        <span className="w-full text-[11px] text-muted-foreground">
          {repMode === 'mean'
            ? 'Chaque échantillon = son spectre moyen (défaut, robuste au bruit de répétition).'
            : 'Chaque répétition = une ligne d’apprentissage (garde la variabilité inter-répétitions).'}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
        Consistance des répétitions (distance de chaque répétition à la moyenne de son échantillon)
        <Explain content={EXPLAIN.repetitions} />
        <span className="ml-auto text-xs font-normal text-muted-foreground">trier :</span>
        {(['index', 'distance', 'variance', 'name'] as RepSort[]).map((s) => (
          <button key={s} onClick={() => setSort(s)} className={`rounded px-2 py-0.5 text-xs ${sort === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {s === 'index' ? 'ordre' : s === 'distance' ? 'distance' : s === 'variance' ? 'variance' : 'nom'}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Chip>{model.nWithReps} échantillons avec répétitions</Chip>
        <Chip>{model.nOutliers} répétitions suspectes (&gt; P95)</Chip>
      </div>
      <ResponsiveContainer width="100%" height={H}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="x" domain={[-0.5, xMax + 0.5]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
            label={{ value: 'échantillon (une colonne = un échantillon, ses répétitions empilées)', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--muted-foreground)' }} />
          <YAxis type="number" dataKey="y" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={44}
            label={{ value: 'Distance', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted-foreground)' }} />
          <ZAxis range={[24, 60]} />
          <Tooltip isAnimationActive={false} cursor={{ strokeDasharray: '4 2' }} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
            formatter={(v: unknown, name: unknown) => (name === 'y' ? [fmt(v), 'distance'] : [fmt(v), String(name)])} />
          {qLines.map((q) => q.v > 0 ? (
            <ReferenceLine key={q.q} y={q.v} stroke={q.color} strokeDasharray="3 3" strokeWidth={1}
              label={{ value: `P${q.q}`, position: 'right', fontSize: 9, fill: q.color }} />
          ) : null)}
          <Scatter data={model.points} isAnimationActive={false}>
            {model.points.map((p, i) => (
              <Cell key={i} fill={distanceColor(p.y, model.maxDistance)}
                stroke={p.isOutlier ? 'var(--warning)' : 'none'} strokeWidth={p.isOutlier ? 1.5 : 0}
                r={p.isOutlier ? 4 : 2.5} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}

// --------------------------------------------------------------------- shared
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex-1 rounded-md px-3 py-1.5 transition ${active ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {children}
    </button>
  );
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5">{children}</span>;
}
function Empty() {
  return <div className="mx-auto max-w-4xl p-6 text-sm text-muted-foreground">Aucun spectre chargé pour ce projet.</div>;
}
