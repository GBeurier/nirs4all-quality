import { summarizeWorklist, WorklistTable, type WorklistItemInput } from '@lab';

import { downloadText, toCsv } from '@/lib/export';
import { useLang, useTr } from '@/i18n';
import { safetyIcons } from '@/ui/icons';
import { resolveSafety } from '@lab';

// §3 Écran 6 — maintenance planner. Proposes a periodic control/update batch to
// keep the model robust (drift monitoring + enrichment). Wired to demo data.
export function Maintenance({ projectId }: { projectId: string }) {
  void projectId;
  const tr = useTr();
  const { lang } = useLang();
  const batch: WorklistItemInput[] = [
    { sampleId: 'C-01', reasonText: 'Standard répété', safety: 'safe', rank: 1 },
    { sampleId: 'C-02', reasonText: 'Nouveau site', safety: 'safe', rank: 2 },
    { sampleId: 'C-03', reasonText: 'Incertitude élevée', decisionColor: 'caution', rank: 3 },
    { sampleId: 'C-04', reasonText: 'Zone Y peu couverte', reason: 'fills_gap', rank: 4 },
    { sampleId: 'C-05', reasonText: 'Profil rare', strongOutlier: true, rank: 5 },
  ];
  const summary = summarizeWorklist(batch, 'remeasure', lang);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 font-display text-2xl font-semibold">Maintenance</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {tr("Suivi de la dérive + proposition d'un lot de contrôle ce trimestre.", 'Drift monitoring + a suggested control batch this quarter.')} {summary.headline}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={tr('Prédictions (30j)', 'Predictions (30d)')} value="1 284" />
        <Stat label={tr('Part 🔴 hors-domaine', '🔴 out-of-domain share')} value="4 %" />
        <Stat label={tr('Dérive', 'Drift')} value={tr('stable', 'stable')} />
      </div>

      <div className="mt-5 rounded-xl border border-border bg-card p-2">
        <div className="flex items-center justify-between px-2 py-2 text-sm font-medium">
          {tr('Lot de contrôle recommandé', 'Recommended control batch')}
          <button
            className="rounded-md border border-border px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-muted"
            onClick={() => downloadText('controle.csv', toCsv(
              batch.map((b, i) => ({ rank: b.rank ?? i + 1, sample_id: b.sampleId, reason: b.reasonText ?? '', safety: resolveSafety(b) })),
              ['rank', 'sample_id', 'reason', 'safety']))}
          >
            {tr('Exporter CSV', 'Export CSV')}
          </button>
        </div>
        <WorklistTable
          items={batch}
          locale={lang}
          safetyIcons={safetyIcons}
          headers={{ rank: '#', sampleId: tr('Échantillon', 'Sample'), reason: tr('Raison', 'Reason'), safety: tr('Sécurité', 'Safety') }}
          className="w-full text-sm"
          theadClassName="text-left text-xs text-muted-foreground"
          rowClassName="border-t border-border"
          cellClassName="px-2 py-2"
          safetyClassName="flex items-center gap-1"
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
