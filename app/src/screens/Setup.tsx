import { useState } from 'react';

import type { Project, Sample } from '@/domain/model';
import type { SpectraDataset } from '@/domain/spectra';
import { useTr } from '@/i18n';
import { newId, nowIso } from '@/lib/ids';
import { readRawFiles, type AssembleResult, type RawFile } from '@/lib/dataset';
import { useLab } from '@/store/store';
import { DatasetConfig, type DatasetConfigMeta } from '@/ui/DatasetConfig';
import { Dropzone } from '@/ui/Dropzone';

// §3 Écran 1 — setup wizard. Collects the method identity (target/unit/matrix/…)
// + the wet-chemistry budget, then a REAL dataset: drop the spectra (X) and,
// optionally, a target (y) file + metadata, and configure column roles (id /
// replicate grouping / metadata / target) like studio / io before creating.
export function Setup({ onCancel, onCreated }: { onCancel: () => void; onCreated: (projectId: string) => void }) {
  const { dispatch } = useLab();
  const tr = useTr();
  const [id] = useState(() => newId('p'));
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('%');
  const [matrix, setMatrix] = useState('');
  const [reference, setReference] = useState('HPLC');
  const [sop, setSop] = useState('SOP-v1');
  const [instrument, setInstrument] = useState('');
  const [budget, setBudget] = useState(15);

  const [files, setFiles] = useState<RawFile[]>([]);
  const [assembled, setAssembled] = useState<AssembleResult | null>(null);
  const [dsMeta, setDsMeta] = useState<DatasetConfigMeta | null>(null);
  const [err, setErr] = useState('');

  async function onFiles(fs: File[]) {
    setErr('');
    try {
      const added = await readRawFiles(fs);
      // ACCUMULATE across drops (drop X, then y, then metadata separately), newest
      // wins on a name clash
      setFiles((prev) => {
        const byName = new Map(prev.map((f) => [f.name, f]));
        for (const f of added) byName.set(f.name, f);
        return [...byName.values()];
      });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  function create() {
    const project: Project = {
      id,
      name: name || `${target || dsMeta?.targetName || 'Cible'} — ${matrix || 'matrice'}`,
      method: { target: target || dsMeta?.targetName || '', unit, basis: 'dry', matrix, referenceMethod: reference, sopVersion: sop, taskType: 'regression' },
      instrumentId: instrument || null,
      hplcBudget: budget,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      activeModelVersionId: null,
    };
    const samples: Sample[] = assembled?.samples ?? [];
    const spectra: SpectraDataset | undefined = assembled?.spectra;
    dispatch({ kind: 'create_project', project, samples, ...(spectra ? { spectra } : {}) });
    onCreated(id);
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">{tr('Nouveau projet', 'New project')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{tr('Décrivez la méthode analytique, puis chargez et configurez votre jeu de données.', 'Describe the analytical method, then load and configure your dataset.')}</p>

      <div className="space-y-4 card p-5">
        <Field label={tr('Nom du projet', 'Project name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Protéines — farine de manioc" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={tr('Que mesurez-vous ?', 'What do you measure?')}><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Protéines" /></Field>
          <Field label={tr('Unité', 'Unit')}><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        </div>
        <Field label={tr('Matrice', 'Matrix')}><input className="input" value={matrix} onChange={(e) => setMatrix(e.target.value)} placeholder="farine de manioc" /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={tr('Méthode de référence', 'Reference method')}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label={tr('Version SOP', 'SOP version')}><input className="input" value={sop} onChange={(e) => setSop(e.target.value)} /></Field>
        </div>
        <Field label={tr('Instrument NIRS', 'NIRS instrument')}><input className="input" value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="FOSS-1" /></Field>
        <Field label={tr(`Budget chimie humide : ${budget} échantillons`, `Wet-chemistry budget: ${budget} samples`)}>
          <input type="range" min={0} max={60} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full" />
        </Field>

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-sm font-medium">{tr('Jeu de données', 'Dataset')}</div>
          <Dropzone
            onFiles={onFiles}
            multiple
            accept=".csv,.txt,.tsv"
            error={err || null}
            privacy
            title={tr('Déposez X (spectres) + y (cible) + métadonnées', 'Drop X (spectra) + y (target) + metadata')}
            hint={<>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — un CSV de spectres, ou X_train.csv + y_train.csv (+ metadata.csv)', ' — a spectra CSV, or X_train.csv + y_train.csv (+ metadata.csv)')}</>}
          />
          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f) => (
                <span key={f.name} className="n4-pill n4-pill--muted flex items-center gap-1">
                  {f.name}
                  <button className="text-muted-foreground hover:text-foreground" onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))} aria-label={tr('Retirer', 'Remove')}>×</button>
                </span>
              ))}
            </div>
          )}
          {files.length > 0 && <DatasetConfig files={files} projectId={id} onChange={(r, m) => { setAssembled(r); setDsMeta(m); }} />}
          <p className="mt-2 text-xs text-muted-foreground">
            {tr('Le fichier X : 1 ligne = 1 spectre, l’en-tête = longueurs d’onde. Colonnes descriptives (identifiant, cible, métadonnées) configurables ci-dessus. Les lignes partageant un identifiant deviennent des répétitions.',
              'The X file: 1 row = 1 spectrum, the header = wavelengths. Descriptive columns (id, target, metadata) are configurable above. Rows sharing an id become replicates.')}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" onClick={create}>{tr('Créer le projet', 'Create project')}</button>
        <button className="btn-outline" onClick={onCancel}>{tr('Annuler', 'Cancel')}</button>
        {assembled && dsMeta && (
          <span className="text-xs text-muted-foreground">
            {tr(`${dsMeta.samples} échantillons · ${dsMeta.withRef} avec cible`, `${dsMeta.samples} samples · ${dsMeta.withRef} with target`)}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
