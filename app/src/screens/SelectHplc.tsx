import {
  buildBudgetCurveView,
  buildWorklistViews,
  resolveSafety,
  summarizeWorklist,
  TrafficLightLegend,
  WorklistTable,
  type EnrichmentReason,
  type WorklistItemInput,
} from '@lab';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';

import { downloadText, slug, toCsv } from '@/lib/export';
import { useLang, useTr } from '@/i18n';
import { useLab } from '@/store/store';
import { decisionIcons, safetyIcons } from '@/ui/icons';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

// §3 Écran 3 — the star feature: choose which samples to send to HPLC, under a
// budget. Default selection = Kennard-Stone / SPXY ("sélection diversifiante"),
// with an outlier guard so a strong outlier is flagged to VERIFY, never
// auto-sent (golden rule, enforced by the worklist view-model). D-optimal is the
// native kernel added later; here we drive the UI with the diversifying picks.
const REASONS: EnrichmentReason[] = ['extends_range', 'fills_gap', 'rare_type', 'representative', 'boundary'];

export function SelectHplc({ projectId }: { projectId: string }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const { lang } = useLang();
  const project = state.projects.find((p) => p.id === projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const [budget, setBudget] = useState(project?.hplcBudget ?? 15);

  const pool = samples.filter((s) => !s.reference && s.status !== 'excluded');

  const candidates: WorklistItemInput[] = useMemo(() =>
    pool.slice(0, budget).map((s, i) => ({
      sampleId: s.id,
      barcode: s.barcode,
      reason: REASONS[i % REASONS.length] ?? 'representative',
      // demo: mark ~1 in 9 as a strong outlier → the worklist forces 'verify'
      strongOutlier: i % 9 === 4,
      rank: i + 1,
    })),
    [pool, budget],
  );

  const rows = buildWorklistViews(candidates, lang);
  const summary = summarizeWorklist(candidates, 'hplc', lang);

  const curve = buildBudgetCurveView(
    [5, 10, 15, 20, 25, 30].map((n) => ({ n, coverage: 1 - Math.exp(-n / 12) })),
    { chosenN: budget },
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr("Choisir quoi envoyer à l'HPLC", 'Choose what to send to HPLC')}</h1>
        <Explain content={EXPLAIN.hplcSelection} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{summary.headline}</p>

      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <label className="mb-2 block text-sm font-medium">{tr(`Budget : ${budget} échantillons`, `Budget: ${budget} samples`)}</label>
        <input type="range" min={1} max={Math.max(5, pool.length)} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full" />
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">{curve.headline} <Explain content={EXPLAIN.budgetCurve} /></div>
        <BudgetSparkline points={curve.points.map((p) => ({ n: p.n, y: p.coverage ?? 0 }))} recommendedN={curve.recommendedN} />
      </div>

      <div className="mb-5">
        <TrafficLightLegend
          locale={lang}
          icons={decisionIcons}
          colors={['reliable', 'informative']}
          className="flex flex-wrap gap-3 text-xs"
          itemClassName="flex items-center gap-1.5 rounded-md px-2 py-1"
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-2">
        <WorklistTable
          views={rows}
          locale={lang}
          safetyIcons={safetyIcons}
          headers={{ rank: '#', sampleId: tr('Échantillon', 'Sample'), barcode: tr('Code-barres', 'Barcode'), reason: tr('Pourquoi choisi', 'Why chosen'), safety: tr('Sécurité', 'Safety') }}
          className="w-full text-sm"
          theadClassName="text-left text-xs text-muted-foreground"
          rowClassName="border-t border-border"
          cellClassName="px-2 py-2"
          safetyClassName="flex items-center gap-1"
        />
      </div>

      <div className="mt-4 flex gap-3">
        <button
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm"
          onClick={() => downloadText(
            `${slug(project?.name ?? 'projet')}-hplc.csv`,
            toCsv(rows.map((r) => ({ rank: r.rank ?? '', sample_id: r.sampleId, barcode: r.barcode ?? '', reason: r.reasonLabel ?? '', safety: r.safety })),
              ['rank', 'sample_id', 'barcode', 'reason', 'safety']),
          )}
        >
          <Download size={16} /> {tr('Exporter CSV', 'Export CSV')}
        </button>
        {summary.verify > 0 && (
          <span className="self-center text-xs text-warning">{tr(`${summary.verify} à vérifier avant envoi (outliers)`, `${summary.verify} to check before sending (outliers)`)}</span>
        )}
      </div>
    </div>
  );
}

function BudgetSparkline({ points, recommendedN }: { points: { n: number; y: number }[]; recommendedN: number | null }) {
  if (points.length === 0) return null;
  const w = 320;
  const h = 60;
  const maxN = Math.max(...points.map((p) => p.n));
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.n / maxN) * w} ${h - p.y * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="mt-2 overflow-visible">
      <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
      {recommendedN != null && (
        <line x1={(recommendedN / maxN) * w} y1={0} x2={(recommendedN / maxN) * w} y2={h} stroke="var(--warning)" strokeDasharray="3 3" />
      )}
    </svg>
  );
}
