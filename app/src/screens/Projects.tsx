import { countSampleStatuses } from '@lab';
import { Plus, RotateCcw } from 'lucide-react';

import { useTr } from '@/i18n';
import { clearState } from '@/lib/persist';
import { useLab } from '@/store/store';

export function Projects({ onOpen, onNew }: { onOpen: (projectId: string) => void; onNew: () => void }) {
  const { state } = useLab();
  const tr = useTr();
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{tr('Vos projets', 'Your projects')}</h1>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted"
            title={tr('Effacer les données locales et recharger la démo', 'Clear local data and reload the demo')}
            onClick={() => { void clearState().then(() => window.location.reload()); }}
          >
            <RotateCcw size={14} /> {tr('Réinitialiser', 'Reset')}
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            onClick={onNew}
          >
            <Plus size={16} /> {tr('Nouveau projet', 'New project')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.projects.map((p) => {
          const samples = state.samplesByProject[p.id] ?? [];
          const counts = countSampleStatuses(samples.map((s) => s.status));
          const waiting = counts.sent_hplc;
          const calibrated = counts.integrated;
          return (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:shadow-md"
            >
              <div className="mb-1 font-medium">{p.name}</div>
              <div className="mb-3 text-xs text-muted-foreground">
                {p.method.target} ({p.method.unit}) · {p.method.matrix}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-md bg-success/10 px-2 py-1 text-success">{tr(`${calibrated} en calibration`, `${calibrated} in calibration`)}</span>
                {waiting > 0 && (
                  <span className="rounded-md bg-warning/10 px-2 py-1 text-warning">{tr(`${waiting} en attente HPLC`, `${waiting} awaiting HPLC`)}</span>
                )}
                <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{tr('budget', 'budget')} {p.hplcBudget}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
