import { useState } from 'react';
import {
  CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import type { PipelineDSL, RunResult } from '@/engine';
import { evaluationLabel, evaluationNote } from '@/engine/evaluation';
import { useTr } from '@/i18n';

const fmt = (v: number | undefined | null): string =>
  v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : v.toFixed(3);

function paddedExtent(values: number[], pad = 0.05): [number, number] {
  const f = values.filter((v) => Number.isFinite(v));
  if (f.length === 0) return [0, 1];
  let lo = Math.min(...f), hi = Math.max(...f);
  if (lo === hi) { const e = Math.abs(lo) || 1; lo -= e; hi += e; }
  const s = (hi - lo) * pad;
  return [lo - s, hi + s];
}

type Tab = 'parity' | 'residuals' | 'sweep';

// The "scientific detail" for a fitted model: what pipeline ran + how it scored,
// with the training-result charts (ported from studio-lite ResultsVisualization).
export function TrainingResults({ dsl, result }: { dsl: PipelineDSL; result: RunResult }) {
  const tr = useTr();
  const [tab, setTab] = useState<Tab>('parity');
  const rows = result.refit.predictions;
  const m = result.refit.metrics;
  const [lo, hi] = paddedExtent([...rows.map((r) => r.actual), ...rows.map((r) => r.predicted)]);
  const [xlo, xhi] = paddedExtent(rows.map((r) => r.predicted));

  // linear fit of residual vs predicted → a slope ≠ 0 reveals a trend/bias
  const resFit = (() => {
    const pts = rows.filter((r) => Number.isFinite(r.predicted) && Number.isFinite(r.residual));
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, r) => s + r.predicted, 0) / n;
    const my = pts.reduce((s, r) => s + r.residual, 0) / n;
    let sxx = 0; let sxy = 0;
    pts.forEach((r) => { const dx = r.predicted - mx; sxx += dx * dx; sxy += dx * (r.residual - my); });
    const slope = sxx > 0 ? sxy / sxx : 0;
    return { slope, intercept: my - slope * mx, meanResidual: my };
  })();

  const steps: { label: string; params?: string }[] = [];
  if (dsl.split) steps.push({ label: dsl.split.type });
  for (const s of dsl.steps) steps.push({ label: s.type, params: fmtParams(s.params) });
  if (dsl.model) steps.push({ label: dsl.model.type, params: fmtParams(dsl.model.params) });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-medium">{tr('Détails scientifiques', 'Scientific details')}</div>

      {/* pipeline composition */}
      <div className="mb-3">
        <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{tr('Composition du pipeline', 'Pipeline composition')}</div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {steps.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono">
                {s.label}{s.params ? <span className="text-muted-foreground"> {s.params}</span> : null}
              </span>
              {i < steps.length - 1 ? <span className="text-muted-foreground">→</span> : null}
            </span>
          ))}
        </div>
      </div>

      {!result.refit.ownerReport && <p className="mb-2 text-xs text-muted-foreground">Historical metric profile (recorded values).</p>}
      {/* metrics */}
      <p className="mb-2 text-xs text-muted-foreground">{evaluationLabel(result.evaluation)}. {evaluationNote(result.evaluation)}</p>
      {!!result.candidateIssues?.length && <details className="mb-2 text-xs">
        <summary>{result.candidateIssues.length} backend refusals or failures</summary>
        <ul>{result.candidateIssues.map((candidate, i) => <li key={i}>{candidate.label} ({candidate.backend}, {candidate.status}): {candidate.reason}</li>)}</ul>
      </details>}
      {!!Object.keys(result.refit.ownerReport?.undefined_metrics ?? {}).length && <p className="mb-2 text-xs text-muted-foreground">
        Undefined diagnostics: {Object.entries(result.refit.ownerReport!.undefined_metrics!).map(([metric, reason]) => `${metric}: ${reason}`).join('; ')}.
      </p>}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {([['RMSE', 'rmse'], ['R²', 'r2'], ['RPD', 'rpd'], ['RPIQ', 'rpiq'], ['bias', 'bias'], ['n', 'n']] as const).map(([k, key]) => (
          <span key={k} className="inline-flex items-baseline gap-1 rounded-md bg-muted px-2 py-1">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-medium">{result.refit.ownerReport?.undefined_metrics?.[key] ? `undefined (${result.refit.ownerReport.undefined_metrics[key]})` : fmt(m[key])}</span>
          </span>
        ))}
        <span className="inline-flex items-baseline gap-1 rounded-md bg-muted px-2 py-1">
          <span className="text-muted-foreground">{tr('moteur', 'engine')}</span>
          <span className="font-mono font-medium">{result.engine}</span>
        </span>
      </div>

      {/* chart tabs */}
      <div className="mb-2 flex gap-1 rounded-lg bg-muted p-1 text-xs">
        <TabBtn active={tab === 'parity'} onClick={() => setTab('parity')}>{tr('Observé vs prédit', 'Observed vs predicted')}</TabBtn>
        <TabBtn active={tab === 'residuals'} onClick={() => setTab('residuals')}>{tr('Résidus', 'Residuals')}</TabBtn>
        {result.variants && result.variants.length > 1 && (
          <TabBtn active={tab === 'sweep'} onClick={() => setTab('sweep')}>{tr('RMSE vs réglage', 'RMSE vs setting')}</TabBtn>
        )}
      </div>

      {tab === 'parity' && (
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 16, left: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="actual" domain={[lo, hi]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
              tickFormatter={fmt} label={{ value: tr('Observé', 'Observed'), position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <YAxis type="number" dataKey="predicted" domain={[lo, hi]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48}
              tickFormatter={fmt} label={{ value: tr('Prédit', 'Predicted'), angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <ZAxis range={[36, 36]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} />
            <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke="var(--chart-3)" strokeDasharray="6 4" ifOverflow="extendDomain" />
            <Scatter data={rows} fill="var(--chart-1)" fillOpacity={0.65} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {tab === 'residuals' && (
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 16, left: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="predicted" domain={[xlo, xhi]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
              tickFormatter={fmt} label={{ value: tr('Prédit', 'Predicted'), position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <YAxis type="number" dataKey="residual" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48}
              tickFormatter={fmt} label={{ value: tr('Résidu', 'Residual'), angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <ZAxis range={[36, 36]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} />
            <ReferenceLine y={0} stroke="var(--chart-5)" strokeDasharray="5 5" />
            {resFit && (
              <ReferenceLine ifOverflow="extendDomain" stroke="var(--chart-3)" strokeWidth={2}
                segment={[{ x: xlo, y: resFit.intercept + resFit.slope * xlo }, { x: xhi, y: resFit.intercept + resFit.slope * xhi }]} />
            )}
            <Scatter data={rows} fill="var(--chart-2)" fillOpacity={0.65} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {tab === 'sweep' && result.variants && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={result.variants} margin={{ top: 10, right: 20, bottom: 16, left: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="x" type={result.variantAxis?.categorical ? 'category' : 'number'}
              {...(result.variantAxis?.logX ? { scale: 'log' as const, domain: ['auto', 'auto'] as [string, string] } : {})}
              tickFormatter={(v: number) => result.variants?.find((z) => z.x === v)?.label ?? fmt(v)}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
              label={{ value: tr(result.variantAxis?.fr ?? 'réglage', result.variantAxis?.en ?? 'setting'), position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={48} tickFormatter={fmt}
              label={{ value: 'RMSE', angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)}
              labelFormatter={(l) => result.variants?.find((z) => z.x === l)?.label ?? `${fmt(Number(l))}`} />
            <Line type="monotone" dataKey="rmse" stroke="var(--chart-1)" strokeWidth={2} isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: { selected?: boolean } }) => {
                const sel = props.payload?.selected;
                return <circle cx={props.cx} cy={props.cy} r={sel ? 5 : 3} fill={sel ? 'var(--chart-3)' : 'var(--chart-1)'} stroke="white" strokeWidth={sel ? 2 : 0} />;
              }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {tab === 'parity' && 'Each point is a scored sample. The diagonal marks perfect predictions. The evaluation scope above states how these samples were used.'}
        {tab === 'residuals' && (
          <>
            {tr('Résidu = prédit − observé. Ils doivent être répartis autour de 0 sans tendance.', 'Residual = predicted − observed. They should scatter around 0 with no trend.')}
            {resFit && ' '}
            {resFit && (
              <span className={Math.abs(resFit.slope) > 0.05 || Math.abs(resFit.meanResidual) > (m.rmse ?? 1) * 0.3 ? 'text-warning' : ''}>
                {tr(`Droite ajustée : biais moyen ${fmt(resFit.meanResidual)}, pente ${fmt(resFit.slope)}${Math.abs(resFit.slope) > 0.05 ? ' → tendance (biais dépendant de la valeur)' : ' → pas de tendance nette'}.`,
                  `Fitted line: mean bias ${fmt(resFit.meanResidual)}, slope ${fmt(resFit.slope)}${Math.abs(resFit.slope) > 0.05 ? ' → trend (value-dependent bias)' : ' → no clear trend'}.`)}
              </span>
            )}
          </>
        )}
        {tab === 'sweep' && 'RMSE across candidate settings. The highlighted setting was selected using these scores; they are not an independent test.'}
      </p>
      <details className="mt-2 text-xs">
        <summary>View scored samples</summary>
        <table className="w-full text-left">
          <caption>{evaluationLabel(result.evaluation)} predictions</caption>
          <thead><tr><th scope="col">Sample</th><th scope="col">Observed</th><th scope="col">Predicted</th><th scope="col">Residual</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.sampleId}><th scope="row">{r.sampleId}</th><td>{fmt(r.actual)}</td><td>{fmt(r.predicted)}</td><td>{fmt(r.residual)}</td></tr>)}</tbody>
        </table>
      </details>
      {result.variants && result.variants.length > 1 && <details className="mt-2 text-xs">
        <summary>View selection scores</summary>
        <table className="w-full text-left">
          <caption>Settings compared using selection RMSE</caption>
          <thead><tr><th scope="col">Setting</th><th scope="col">RMSE</th><th scope="col">Selected</th></tr></thead>
          <tbody>{result.variants.map((v) => <tr key={v.x}><th scope="row">{v.label ?? v.x}</th><td>{fmt(v.rmse)}</td><td>{v.selected ? 'Yes' : 'No'}</td></tr>)}</tbody>
        </table>
      </details>}
    </div>
  );
}

function fmtParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join(' ');
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`flex-1 rounded-md px-2 py-1 transition ${active ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{children}</button>;
}
