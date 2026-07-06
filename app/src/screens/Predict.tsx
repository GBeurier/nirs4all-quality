import { DecisionCard, type DecisionInput } from '@lab';

import { useLang, useTr } from '@/i18n';
import { decisionIcons } from '@/ui/icons';
import { Explain } from '@/ui/Explain';
import { EXPLAIN } from '@/ui/explanations';

// §3 Écran 5 — predict & decide. Each prediction is a reliability CARD driven by
// the §4bis decision contract: colour + reason + authorized action + confidence
// + a detail hook. Inputs here are illustrative; in production they come from the
// engine's applicability-domain + conformal interval.
const DEMO: { sampleId: string; predicted: number; interval: string; input: DecisionInput }[] = [
  { sampleId: 'N-1042', predicted: 7.8, interval: '± 0.31', input: { applicabilityScore: 0.3, localDensity: 0.7, intervalWidth: 0.31 } },
  { sampleId: 'N-1043', predicted: 9.2, interval: '± 0.9', input: { applicabilityScore: 1.4, intervalWidth: 0.9 } },
  { sampleId: 'N-1044', predicted: 12.5, interval: '± 2.4', input: { applicabilityScore: 2.6, intervalWidth: 2.4, extrapolation: true } },
  { sampleId: 'N-1045', predicted: 6.1, interval: '± 0.4', input: { applicabilityScore: 0.4, localDensity: 0.05 } },
];

export function Predict({ projectId }: { projectId: string }) {
  void projectId;
  const tr = useTr();
  const { lang } = useLang();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold">{tr('Prédire & décider', 'Predict & decide')}</h1>
        <Explain content={EXPLAIN.reliability} />
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {tr('Glissez de nouveaux spectres. Chaque prédiction reçoit un feu tricolore et une action autorisée.', 'Drop in new spectra. Each prediction gets a traffic light and an authorized action.')}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DEMO.map((d) => (
          <DecisionCard
            key={d.sampleId}
            locale={lang}
            sampleId={d.sampleId}
            predicted={d.predicted}
            interval={d.interval}
            unit="%"
            input={d.input}
            icons={decisionIcons}
            className="rounded-xl border border-border p-4"
            headerClassName="mb-2 flex items-center gap-2"
            iconClassName="flex"
            labelClassName="font-medium"
            confidenceClassName="ml-auto text-[11px] uppercase text-muted-foreground"
            valueClassName="text-2xl font-bold"
            intervalClassName="ml-2 text-sm text-muted-foreground"
            reasonClassName="mt-2 text-sm"
            actionClassName="mt-1 text-xs text-muted-foreground"
            detailClassName="mt-2 inline-block text-xs text-primary underline"
          />
        ))}
      </div>
    </div>
  );
}
