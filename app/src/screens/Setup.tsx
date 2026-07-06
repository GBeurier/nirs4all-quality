import { useState } from 'react';

import type { Project, Sample } from '@/domain/model';
import type { SpectraDataset } from '@/domain/spectra';
import { useTr } from '@/i18n';
import { newId, nowIso } from '@/lib/ids';
import { ingestCsv, parseReferenceCsv, parseSpectraCsv } from '@/lib/ingest';
import { useLab } from '@/store/store';

// Compact version of the §3 Écran 1 setup wizard. Collects the method identity
// (target/unit/matrix/instrument/reference/SOP) + the wet-chemistry budget, then
// creates the project. Spectra/reference import is wired to the engine later.
export function Setup({ onCancel, onCreated }: { onCancel: () => void; onCreated: (projectId: string) => void }) {
  const { dispatch } = useLab();
  const tr = useTr();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('%');
  const [matrix, setMatrix] = useState('');
  const [reference, setReference] = useState('HPLC');
  const [sop, setSop] = useState('SOP-v1');
  const [instrument, setInstrument] = useState('');
  const [budget, setBudget] = useState(15);
  const [spectraText, setSpectraText] = useState<string | null>(null);
  const [refText, setRefText] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string>('');
  const [importErr, setImportErr] = useState(false);

  async function onSpectraFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = parseSpectraCsv(text);
      setSpectraText(text);
      setImportErr(false);
      setImportMsg(tr(
        `${parsed.rows.length} spectres · ${parsed.axis.length} longueurs d'onde (${parsed.unit})`,
        `${parsed.rows.length} spectra · ${parsed.axis.length} wavelengths (${parsed.unit})`,
      ));
    } catch (e) {
      setSpectraText(null); setImportErr(true);
      setImportMsg(tr('CSV illisible : ', 'Unreadable CSV: ') + (e instanceof Error ? e.message : ''));
    }
  }
  async function onRefFile(file: File | undefined) {
    if (!file) return;
    setRefText(await file.text());
  }

  function create() {
    const id = newId('p');
    const project: Project = {
      id,
      name: name || `${target || 'Cible'} — ${matrix || 'matrice'}`,
      method: { target, unit, basis: 'dry', matrix, referenceMethod: reference, sopVersion: sop, taskType: 'regression' },
      instrumentId: instrument || null,
      hplcBudget: budget,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      activeModelVersionId: null,
    };
    let samples: Sample[] = [];
    let spectra: SpectraDataset | undefined;
    if (spectraText) {
      try {
        const ing = ingestCsv(id, parseSpectraCsv(spectraText), refText ? parseReferenceCsv(refText) : {});
        samples = ing.samples;
        spectra = ing.spectra;
      } catch (e) {
        setImportErr(true);
        setImportMsg(tr('Import échoué : ', 'Import failed: ') + (e instanceof Error ? e.message : ''));
        return;
      }
    }
    dispatch({ kind: 'create_project', project, samples, ...(spectra ? { spectra } : {}) });
    onCreated(id);
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 font-display text-2xl font-semibold">{tr('Nouveau projet', 'New project')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{tr('Décrivez la méthode analytique. Le reste (chargement des spectres, budget) se règle ensuite.', 'Describe the analytical method. The rest (loading spectra, budget) is set afterwards.')}</p>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
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
          <div className="mb-2 text-sm font-medium">{tr('Charger les spectres (optionnel)', 'Load spectra (optional)')}</div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{tr('Spectres (CSV)', 'Spectra (CSV)')}</span>
              <input type="file" accept=".csv,.txt" onChange={(e) => { void onSpectraFile(e.target.files?.[0]); }} className="block w-full text-xs" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">{tr('Références (CSV, optionnel)', 'References (CSV, optional)')}</span>
              <input type="file" accept=".csv,.txt" onChange={(e) => { void onRefFile(e.target.files?.[0]); }} className="block w-full text-xs" />
            </label>
          </div>
          {importMsg && <p className={`mt-2 text-xs ${importErr ? 'text-destructive' : 'text-success'}`}>{importMsg}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {tr('CSV : une ligne = un spectre, colonnes = longueurs d’onde. Optionnel : 1re colonne = identifiant, 1re ligne = axe. Références : sample_id,valeur.',
              'CSV: one row = one spectrum, columns = wavelengths. Optional: 1st column = id, 1st row = axis. References: sample_id,value.')}
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={create}>{tr('Créer le projet', 'Create project')}</button>
        <button className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onCancel}>{tr('Annuler', 'Cancel')}</button>
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
