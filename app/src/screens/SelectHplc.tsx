import {
  buildWorklistViews, resolveSafety, summarizeWorklist,
  TrafficLightLegend, type EnrichmentReason, type WorklistItemInput,
} from '@lab';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

import { meanSpectrum, type SpectraDataset } from '@/domain/spectra';
import { downloadText, slug, toCsv } from '@/lib/export';
import { scoreCandidates, type Candidate, type SelectionModel } from '@/lib/selection';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { decisionIcons, safetyIcons } from '@/ui/icons';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

const SELECTED = 'var(--warning)'; // budget-selected candidates drawn in a distinct colour
const H = 260;
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(3)) : '—');

// §3 Écran 3 — the star feature: choose which samples to send to HPLC, under a
// budget. Selection is driven by a REAL information score (distance to the
// calibration domain, in PCA std-dev units); strong outliers are flagged to
// VERIFY, never auto-sent (golden rule). Each candidate shows its metric + why.
export function SelectHplc({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const spectra = useProjectSpectra(projectId);

  const pool = samples.filter((s) => !s.reference && s.status !== 'excluded');

  const model = useMemo(() => {
    if (!spectra) return null;
    const labelledIds = new Set(samples.filter((s) => s.reference?.value != null).map((s) => s.id));
    const poolIds = new Set(pool.map((s) => s.id));
    return scoreCandidates(spectra, labelledIds, poolIds);
  }, [spectra, samples, pool]);

  // The app PROPOSES a count (informative candidates before diminishing returns);
  // the slider is free from 1 to the number of DISTINCT spectra — near-identical
  // spectra (doublons) are held back so the budget never pays twice for the same one.
  const recommended = model?.recommended ?? Math.min(15, pool.length);
  const dupCount = model?.duplicates ?? 0;
  const distinctCount = Math.max(1, pool.length - dupCount);
  const [budgetOverride, setBudgetOverride] = useState<number | null>(null);
  const budget = Math.max(1, Math.min(budgetOverride ?? recommended, distinctCount));

  const chosen = (model?.candidates ?? []).slice(0, budget);
  const noveltyById = new Map(chosen.map((c) => [c.sampleId, c.novelty]));
  const maxNovelty = model?.maxNovelty ?? 1;

  const candidates: WorklistItemInput[] = chosen.map((c, i) => ({
    sampleId: c.sampleId,
    barcode: samples.find((s) => s.id === c.sampleId)?.barcode ?? null,
    reason: c.reason as EnrichmentReason,
    strongOutlier: c.strongOutlier,
    rank: i + 1,
  }));
  const rows = buildWorklistViews(candidates, lang);
  const summary = summarizeWorklist(candidates, 'hplc', lang);
  const chosenIds = useMemo(() => new Set(chosen.map((c) => c.sampleId)), [chosen]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{tr("Choisir quoi envoyer à l'HPLC", 'Choose what to send to HPLC')}</h1>
        <Explain content={EXPLAIN.hplcSelection} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{summary.headline}</p>

      <div className="mb-4 card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>{tr(`À envoyer : ${budget} / ${distinctCount} spectre(s) distinct(s)`, `To send: ${budget} / ${distinctCount} distinct spectra`)}</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {tr('Recommandé', 'Recommended')} : <span className="font-semibold text-warning">{recommended}</span>
            <Explain content={EXPLAIN.budgetRecommendation} />
            {budget !== recommended && (
              <button className="text-primary underline hover:text-primary-hover" onClick={() => setBudgetOverride(recommended)}>{tr('utiliser la reco', 'use rec.')}</button>
            )}
          </span>
        </div>
        <div className="relative pt-1">
          <input type="range" min={1} max={distinctCount} value={budget} onChange={(e) => setBudgetOverride(Number(e.target.value))} className="w-full" />
          {distinctCount > 1 && (
            <div className="pointer-events-none absolute top-0 h-3 w-0.5 rounded bg-warning"
              style={{ left: `${((Math.min(recommended, distinctCount) - 1) / (distinctCount - 1)) * 100}%` }} title={tr('recommandé', 'recommended')} />
          )}
        </div>
        {dupCount > 0 && (
          <p className="mt-1.5 text-xs text-warning">
            {tr(`${dupCount} spectre(s) quasi-identique(s) écarté(s) de la sélection (doublons) — l’HPLC ne paie jamais deux fois le même spectre.`,
              `${dupCount} near-identical spectrum(s) held back from selection (doublons) — HPLC never pays twice for the same spectrum.`)}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {tr(`Suggestion : ${recommended} échantillon(s) ont un score d’information ≥ 0,75 σ (ils étendent réellement le domaine du modèle). Au-delà, les candidats ressemblent de plus en plus à la calibration (gain décroissant) — vous restez libre d’en envoyer plus ou moins, jusqu’à la totalité (${pool.length}).`,
            `Suggestion: ${recommended} sample(s) have an information score ≥ 0.75 σ (they genuinely extend the model’s domain). Beyond that, candidates increasingly resemble the calibration (diminishing return) — you stay free to send more or fewer, up to all ${pool.length}.`)}
        </p>
      </div>

      {/* WHAT is being selected: the candidate spectra (with calibration quantile
          bands) + the PCA enrichment map, budget-selected samples in amber. */}
      {model && model.candidates.length > 0 && spectra && (
        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {tr('Spectres sélectionnés', 'Selected spectra')} <Explain content={EXPLAIN.selectionSpectra} />
            </div>
            <SpectraSelectionChart spectra={spectra} chosen={chosen} />
            <p className="mt-1 text-xs text-muted-foreground">{tr('Bandes = quantiles des spectres de calibration (P10–P90, P25–P75, médiane). Lignes ambre = les spectres retenus au budget.', 'Bands = calibration spectra quantiles (P10–P90, P25–P75, median). Amber lines = the budget-selected spectra.')}</p>
          </div>
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {tr('Carte d’enrichissement (PCA)', 'Enrichment map (PCA)')} <Explain content={EXPLAIN.selectionPca} />
            </div>
            <PcaSelectionChart model={model} chosenIds={chosenIds} />
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Dot color="var(--muted-foreground)" /> {tr('calibration', 'calibration')}</span>
              <span className="flex items-center gap-1.5"><Dot color="var(--chart-1)" /> {tr('candidats', 'candidates')}</span>
              <span className="flex items-center gap-1.5"><Dot color={SELECTED} /> {tr('retenus au budget', 'selected in budget')}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mb-5">
        <TrafficLightLegend
          locale={lang}
          icons={decisionIcons}
          colors={['reliable', 'informative']}
          className="flex flex-wrap gap-3 text-xs"
          itemClassName="flex items-center gap-1.5 rounded-md px-2 py-1"
        />
      </div>

      {!model || model.candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {tr('Aucun échantillon en attente de référence (ou pas de spectres). Rien à sélectionner.', 'No samples awaiting a reference (or no spectra). Nothing to select.')}
        </div>
      ) : (
        <div className="card p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">{tr('Échantillon', 'Sample')}</th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">{tr('Pourquoi choisi', 'Why chosen')}<Explain content={EXPLAIN.enrichmentReasons} wide><ReasonsLegend /></Explain></span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">{tr('Score d’information', 'Information score')}<Explain content={EXPLAIN.infoScore} /></span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">{tr('Sécurité', 'Safety')}<Explain content={EXPLAIN.safetyFlag}><SafetyLegend /></Explain></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const nov = noveltyById.get(r.sampleId) ?? 0;
                const t = Math.min(1, nov / (maxNovelty || 1));
                const barColor = nov > 3 ? 'var(--warning)' : `hsl(${(174 - 120 * t).toFixed(0)} 68% 42%)`;
                return (
                  <tr key={r.sampleId} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{r.rank}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sampleId}{r.barcode ? <span className="ml-2 text-muted-foreground">{r.barcode}</span> : null}</td>
                    <td className="px-3 py-2">{r.reasonLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div style={{ width: `${Math.round(t * 100)}%`, background: barColor }} className="h-full" />
                        </div>
                        <span className="font-mono text-xs tabular-nums">{nov.toFixed(2)} σ</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 ${r.safetyColorClass}`}>
                        {safetyIcons[r.safety]}{r.safetyLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          onClick={() => dispatch({
            kind: 'set_sample_status',
            projectId,
            // golden rule: only 'safe' candidates are auto-sent; every 'verify'
            // (strong outlier / out-of-domain / caution) is held back for review.
            sampleIds: candidates.filter((c) => resolveSafety(c) === 'safe').map((c) => c.sampleId),
            status: 'sent_hplc',
          })}
        >
          <Download size={16} /> {tr(`Exporter la liste HPLC (${summary.safe} sûrs)`, `Export HPLC worklist (${summary.safe} safe)`)}
        </button>
        <button
          className="btn-outline"
          onClick={() => downloadText(
            `${slug(project?.name ?? 'projet')}-hplc.csv`,
            toCsv(rows.map((r) => ({ rank: r.rank ?? '', sample_id: r.sampleId, barcode: r.barcode ?? '', reason: r.reasonLabel ?? '', info_score: (noveltyById.get(r.sampleId) ?? 0).toFixed(3), safety: r.safety })),
              ['rank', 'sample_id', 'barcode', 'reason', 'info_score', 'safety']),
          )}
        >
          <Download size={16} /> {tr('Exporter CSV', 'Export CSV')}
        </button>
        {summary.verify > 0 && (
          <span className="text-xs text-warning">{tr(`${summary.verify} à vérifier avant envoi (outliers)`, `${summary.verify} to check before sending (outliers)`)}</span>
        )}
      </div>
    </div>
  );
}

// Decodes each "why chosen" label for a neophyte — shown as the rich detail of
// the reasons "?" popover.
function ReasonsLegend() {
  const tr = useTr();
  const list: [string, string][] = [
    [tr('Étend la gamme', 'Extends the range'), tr('score d’information élevé → profil plus extrême que ceux appris → élargit la plage prédictible.', 'high information score → more extreme profile than what was learned → widens the predictable range.')],
    [tr('Comble un trou', 'Fills a gap'), tr('score intermédiaire → zone du domaine peu couverte → densifie une région sous-représentée.', 'medium score → sparsely-covered region of the domain → densifies an under-represented area.')],
    [tr('En bordure', 'At the boundary'), tr('proche de la frontière du domaine connu → clarifie où s’arrête la fiabilité.', 'near the edge of the known domain → clarifies where reliability ends.')],
    [tr('Type rare', 'Rare type'), tr('score très élevé (outlier) → sous-famille rare, mais à vérifier avant envoi.', 'very high score (outlier) → rare sub-family, but check before sending.')],
  ];
  return (
    <dl className="space-y-1.5">
      {list.map(([term, def]) => (
        <div key={term} className="grid grid-cols-[7.5rem_1fr] gap-2">
          <dt className="font-mono text-[11px] font-semibold text-primary">{term}</dt>
          <dd className="text-[13px] leading-snug text-foreground">{def}</dd>
        </div>
      ))}
    </dl>
  );
}

function SafetyLegend() {
  const tr = useTr();
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
        <div className="text-[13px] leading-snug">
          <span className="font-medium text-success">{tr('Sûr à envoyer', 'Safe to send')}</span> — {tr('informatif ET dans le domaine connu : à envoyer directement à l’HPLC.', 'informative AND within the known domain: send it straight to HPLC.')}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-warning" />
        <div className="text-[13px] leading-snug">
          <span className="font-medium text-warning">{tr('À vérifier', 'To check')}</span> — {tr('score > 3 σ : spectre très atypique, possible artefact. On le re-vérifie avant de payer l’HPLC — jamais envoyé automatiquement.', 'score > 3 σ: very atypical spectrum, possible artifact. Re-check it before paying for HPLC — never auto-sent.')}
        </div>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) { return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />; }

function q(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

// Calibration quantile bands + the budget-selected candidate spectra (amber).
function SpectraSelectionChart({ spectra, chosen }: { spectra: SpectraDataset; chosen: Candidate[] }) {
  const model = useMemo(() => {
    const p = spectra.axis.length;
    // reference = samples that are NOT in the candidate pool = calibration set;
    // here we use ALL project mean spectra as the "known" envelope backdrop.
    const chosenIds = new Set(chosen.map((c) => c.sampleId));
    const cal = spectra.samples.filter((s) => !chosenIds.has(s.sampleId)).map(meanSpectrum);
    const chosenSpectra = chosen.slice(0, 12)
      .map((c) => spectra.samples.find((s) => s.sampleId === c.sampleId))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map(meanSpectrum);
    const step = Math.max(1, Math.floor(p / 70));
    const rows: Record<string, number | number[] | null>[] = [];
    for (let j = 0; j < p; j += step) {
      const vals = cal.map((m) => m[j] ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
      const row: Record<string, number | number[] | null> = {
        x: spectra.axis[j] ?? j,
        b1090: vals.length ? [q(vals, 0.1), q(vals, 0.9)] : null,
        b2575: vals.length ? [q(vals, 0.25), q(vals, 0.75)] : null,
        med: vals.length ? q(vals, 0.5) : null,
      };
      chosenSpectra.forEach((m, k) => { row['c' + k] = m[j] ?? null; });
      rows.push(row);
    }
    return { rows, cKeys: chosenSpectra.map((_, k) => 'c' + k) };
  }, [spectra, chosen]);

  return (
    <ResponsiveContainer width="100%" height={H}>
      <ComposedChart data={model.rows} margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
          label={{ value: `λ (${spectra.axisUnit})`, position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={44} tickFormatter={fmt} />
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: unknown) => (Array.isArray(v) ? `${fmt(v[0])}…${fmt(v[1])}` : fmt(Number(v)))} labelFormatter={(l) => `λ ${l}`} />
        <Area type="monotone" dataKey="b1090" stroke="none" fill="var(--chart-1)" fillOpacity={0.1} isAnimationActive={false} connectNulls />
        <Area type="monotone" dataKey="b2575" stroke="none" fill="var(--chart-1)" fillOpacity={0.2} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="med" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {model.cKeys.map((k) => (
          <Line key={k} type="monotone" dataKey={k} stroke={SELECTED} strokeWidth={1} strokeOpacity={0.8} dot={false} isAnimationActive={false} connectNulls />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// PCA enrichment map: calibration cloud (grey) + candidates (teal) + selected (amber).
function PcaSelectionChart({ model, chosenIds }: { model: SelectionModel; chosenIds: Set<string> }) {
  const cal = model.calPts;
  const cand = model.candidates.map((c) => ({ x: c.pc1, y: c.pc2, sel: chosenIds.has(c.sampleId) }));
  return (
    <ResponsiveContainer width="100%" height={H}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" dataKey="x" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)"
          label={{ value: `PC1 (${model.ev(0)} %)`, position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <YAxis type="number" dataKey="y" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={44}
          label={{ value: `PC2 (${model.ev(1)} %)`, angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <ZAxis range={[34, 34]} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }} formatter={(v: number) => fmt(v)} />
        <Scatter data={cal} fill="var(--muted-foreground)" fillOpacity={0.3} isAnimationActive={false} />
        <Scatter data={cand} isAnimationActive={false}>
          {cand.map((c, i) => <Cell key={i} fill={c.sel ? SELECTED : 'var(--chart-1)'} fillOpacity={c.sel ? 0.95 : 0.55} />)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
