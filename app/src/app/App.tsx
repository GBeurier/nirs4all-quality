import { StepProgress, type StepProgressItem } from '@lab';
import { useState } from 'react';

import { deriveStatus, STAGE_TONE } from '@/lib/status';
import { useLang, useTr } from '@/i18n';
import { useLab, useProjectSpectra } from '@/store/store';
import { Projects } from '@/screens/Projects';
import { Setup } from '@/screens/Setup';
import { DatasetExplorer } from '@/screens/DatasetExplorer';
import { Health } from '@/screens/Health';
import { SelectHplc } from '@/screens/SelectHplc';
import { Calibrate } from '@/screens/Calibrate';
import { Predict } from '@/screens/Predict';
import { Maintenance } from '@/screens/Maintenance';

interface StepDef { id: string; fr: string; en: string; capFr: string; capEn: string }
const STEP_DEFS: StepDef[] = [
  { id: 'explore', fr: 'Explorer les données', en: 'Explore data', capFr: 'Préparer', capEn: 'Prepare' },
  { id: 'health', fr: 'Santé des données', en: 'Data health', capFr: 'Préparer', capEn: 'Prepare' },
  { id: 'select', fr: 'Choisir pour HPLC', en: 'Pick for HPLC', capFr: 'Préparer', capEn: 'Prepare' },
  { id: 'calibrate', fr: 'Calibrer', en: 'Calibrate', capFr: 'Calibrer', capEn: 'Calibrate' },
  { id: 'predict', fr: 'Prédire & décider', en: 'Predict & decide', capFr: 'Utiliser', capEn: 'Use' },
  { id: 'maintain', fr: 'Maintenance', en: 'Maintenance', capFr: 'Utiliser', capEn: 'Use' },
];

type View = { kind: 'projects' } | { kind: 'setup' } | { kind: 'workflow'; projectId: string; step: string };

export default function App() {
  const { state } = useLab();
  const { lang, setLang } = useLang();
  const tr = useTr();
  const [view, setView] = useState<View>({ kind: 'projects' });

  return (
    <div className="min-h-screen n4-app-bg text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-card/70 px-5 py-3 backdrop-blur">
        <button className="flex items-center gap-2" onClick={() => setView({ kind: 'projects' })}>
          <img src={`${import.meta.env.BASE_URL}brand/icon.svg`} alt="nirs4all" className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight text-foreground">
            quali<span className="text-[#4f46e5]">·</span>nirs<span className="text-[#e9362d]">4</span>all
          </span>
        </button>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tr('studio labo NIRS', 'NIRS lab studio')}</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            {(['fr', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-1 ${lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted-foreground">{state.user.name}</span>
        </div>
      </header>
      <div className="n4-spectrum-strip" />

      {view.kind === 'projects' && (
        <Projects
          onOpen={(projectId) => setView({ kind: 'workflow', projectId, step: 'explore' })}
          onNew={() => setView({ kind: 'setup' })}
        />
      )}

      {view.kind === 'setup' && (
        <Setup
          onCancel={() => setView({ kind: 'projects' })}
          onCreated={(projectId) => setView({ kind: 'workflow', projectId, step: 'explore' })}
        />
      )}

      {view.kind === 'workflow' && (
        <Workflow
          projectId={view.projectId}
          step={view.step}
          onStep={(step) => setView({ kind: 'workflow', projectId: view.projectId, step })}
          onExit={() => setView({ kind: 'projects' })}
        />
      )}
    </div>
  );
}

function Workflow({ projectId, step, onStep, onExit }: {
  projectId: string;
  step: string;
  onStep: (step: string) => void;
  onExit: () => void;
}) {
  const { state } = useLab();
  const { lang } = useLang();
  const tr = useTr();
  const project = state.projects.find((p) => p.id === projectId);
  const spectra = useProjectSpectra(projectId);
  const samples = state.samplesByProject[projectId] ?? [];
  const hasModel = !!state.modelByProject[projectId];
  if (!project) return <div className="p-6">{tr('Projet introuvable.', 'Project not found.')} <button className="text-primary underline" onClick={onExit}>{tr('Retour', 'Back')}</button></div>;

  const nRef = samples.filter((s) => s.reference?.value != null).length;
  const nPool = samples.filter((s) => !s.reference && s.status !== 'excluded').length;
  const status = deriveStatus({ nSamples: spectra?.samples.length ?? 0, nRef, nPool, hasModel });
  const tone = STAGE_TONE[status.tone];

  // the recommended next step is badged in the rail so the tech knows where to go
  const steps: StepProgressItem[] = STEP_DEFS.map((s) => ({
    id: s.id,
    label: tr(s.fr, s.en) + (s.id === status.recommendedStep && s.id !== step ? '  ›' : ''),
    caption: tr(s.capFr, s.capEn),
  }));

  return (
    <div className="grid grid-cols-[16rem_1fr] gap-0">
      <aside className="border-r border-border/60 bg-card/30 p-3">
        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{project.name}</div>
        {/* dataset status — where the tech is in the loop + what to do next */}
        <div className={`mb-3 rounded-lg border border-border p-2.5 ${tone.bg}`}>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
            <span className={`text-xs font-semibold ${tone.text}`}>{status.label[lang]}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{status.hint[lang]}</p>
          {status.recommendedStep !== step && (
            <button onClick={() => onStep(status.recommendedStep)}
              className="mt-1.5 text-[11px] font-medium text-primary underline hover:text-primary-hover">
              {tr('Aller à l’étape recommandée →', 'Go to the recommended step →')}
            </button>
          )}
        </div>
        <StepProgress
          steps={steps}
          activeId={step}
          allowUpcoming
          onSelect={(id) => onStep(id)}
          className="flex flex-col gap-0.5"
          stepClassName="group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          activeClassName="bg-primary/10 text-primary before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r-full before:bg-primary"
          markerClassName="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs"
          captionClassName="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground"
        />
        <button className="mt-4 px-2 text-xs text-muted-foreground transition hover:text-foreground" onClick={onExit}>{tr('← Tous les projets', '← All projects')}</button>
      </aside>
      <main className="p-6">
        {step === 'explore' && <DatasetExplorer projectId={projectId} />}
        {step === 'health' && <Health projectId={projectId} />}
        {step === 'select' && <SelectHplc projectId={projectId} />}
        {step === 'calibrate' && <Calibrate projectId={projectId} />}
        {step === 'predict' && <Predict projectId={projectId} />}
        {step === 'maintain' && <Maintenance projectId={projectId} />}
      </main>
    </div>
  );
}
