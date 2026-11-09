import { countSampleStatuses } from 'nirs4all-ui/lab';
import { FlaskConical, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useTr } from '@/i18n';
import { emptyImport, readImportFiles, replaceBindings } from '@/lib/ioImport';
import { newId } from '@/lib/ids';
import { clearState } from '@/lib/persist';
import { useLab, type LabState } from '@/store/store';
import { Dropzone } from '@/ui/Dropzone';

export async function quickStartDraft(files: File[], saved: LabState['setupImportDraft']) {
  const added = await readImportFiles(files);
  return {
    projectId: saved?.projectId ?? newId('p'),
    record: replaceBindings(saved?.record ?? emptyImport(), added),
    name: saved?.name ?? (files[0]?.name ?? 'project').replace(/\.[^.]+$/, ''),
  };
}

export function Projects({ onOpen, onNew }: { onOpen: (projectId: string) => void; onNew: () => void }) {
  const { state, dispatch } = useLab();
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function onDrop(files: File[]) {
    if (files.length === 0 || pending.current) return;
    pending.current = true;
    setBusy(true); setErr(null);
    try {
      const draft = await quickStartDraft(files, state.setupImportDraft);
      if (!active.current) return;
      dispatch({ kind: 'set_setup_import_draft', draft });
      onNew();
    } catch (e) {
      if (active.current) setErr('Unreadable input: ' + (e instanceof Error ? e.message : ''));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{tr('Vos projets', 'Your projects')}</h1>
        <div className="flex items-center gap-2">
          <button
            className="btn-outline"
            title={tr('Effacer les données locales et recharger la démo', 'Clear local data and reload the demo')}
            onClick={() => { void clearState().then(() => window.location.reload()); }}
          >
            <RotateCcw size={14} /> {tr('Réinitialiser', 'Reset')}
          </button>
          <button className="btn-primary" onClick={onNew} disabled={busy}>
            <Plus size={16} /> {tr('Nouveau projet', 'New project')}
          </button>
        </div>
      </div>

      {/* drag-and-drop quick-start — same interaction as studio / web / io.nirs4all.org */}
      <div className="mb-6">
        <Dropzone
          onFiles={onDrop}
          busy={busy}
          error={err}
          compact
          multiple
          privacy
          title={tr('Déposez X (+ y) pour démarrer un projet', 'Drop X (+ y) to start a project')}
          hint={<>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — spectres, ou X_train.csv + y_train.csv', ' — spectra, or X_train.csv + y_train.csv')}</>}
        />
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
              className="card card-hover p-4 text-left"
            >
              <div className="mb-3 flex items-start gap-3">
                <span className="icon-tile h-10 w-10 shrink-0"><FlaskConical size={20} /></span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.method.target || tr('méthode à définir', 'method to define')}{p.method.unit ? ` (${p.method.unit})` : ''}{p.method.matrix ? ` · ${p.method.matrix}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="n4-pill n4-pill--green">{tr(`${calibrated} en calibration`, `${calibrated} in calibration`)}</span>
                {waiting > 0 && (
                  <span className="n4-pill n4-pill--amber">{tr(`${waiting} en attente HPLC`, `${waiting} awaiting HPLC`)}</span>
                )}
                <span className="n4-pill n4-pill--muted">{tr('budget', 'budget')} {p.hplcBudget}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
