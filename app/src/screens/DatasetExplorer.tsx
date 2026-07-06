import { useMemo, useState } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { histogram } from '@/lib/histogram';
import { computePca } from '@/lib/pca';
import { buildRepetitionModel, distanceColor, type RepSort } from '@/lib/repetitions';
import { downloadText, slug, toCsv } from '@/lib/export';
import { useTr } from '@/i18n';
import { useLab } from '@/store/store';
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
  const { state } = useLab();
  const tr = useTr();
  const spectra = state.spectraByProject[projectId];
  const samples = state.samplesByProject[projectId] ?? [];
  const [tab, setTab] = useState<Tab>('spectra');

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
        <button
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
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

      <div className="rounded-xl border border-border bg-card p-4">
        {tab === 'spectra' && <SpectraTab spectra={spectra} />}
        {tab === 'target' && <TargetTab y={Object.values(yBySample).filter((v): v is number => typeof v === 'number')} />}
        {tab === 'pca' && <PcaTab spectra={spectra} yBySample={yBySample} />}
        {tab === 'reps' && <RepsTab spectra={spectra} yBySample={yBySample} />}
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
function RepsTab({ spectra, yBySample }: { spectra: SpectraDataset; yBySample: Record<string, number | undefined> }) {
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
