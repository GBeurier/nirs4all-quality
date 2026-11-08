import { useMemo, useState } from 'react';

import type { Project } from '@/domain/model';
import { newId, nowIso } from '@/lib/ids';
import { projectForLab } from '@/lib/ioImport';
import { useLab } from '@/store/store';
import { DatasetConfig, ImportBindings, useDatasetImport } from '@/ui/DatasetConfig';
import { Dropzone } from '@/ui/Dropzone';

// Project creation uses the same retained IO review as routine imports.
export function Setup({ onCancel, onCreated }: { onCancel: () => void; onCreated: (projectId: string) => void }) {
  const { state, dispatch } = useLab();
  const [id] = useState(() => state.setupImportDraft?.projectId ?? newId('p'));
  const [name, setName] = useState(() => state.setupImportDraft?.name ?? '');
  const upload = useDatasetImport(state.setupImportDraft?.record, (next) => {
    dispatch({ kind: 'set_setup_import_draft', draft: { projectId: id, record: next, name } });
  });
  const { record, current, readingFiles, pendingReads, fileReadFailed, error, setError, notice, updateRecord, onFiles } = upload;
  const [analyte, setAnalyte] = useState('');
  const [unit, setUnit] = useState('%');
  const [matrix, setMatrix] = useState('');
  const [reference, setReference] = useState('HPLC');
  const [sop, setSop] = useState('SOP-v1');
  const [instrument, setInstrument] = useState('');
  const [budget, setBudget] = useState(15);
  const projection = useMemo(() => projectForLab(record, id), [record, id]);
  const emptyEligible = !record.files.length && !record.witness && !readingFiles && pendingReads.current === 0
    && !state.setupImportDraft?.record.files.length && record.status !== 'pending' && !fileReadFailed;

  function cancel() {
    upload.stop();
    dispatch({ kind: 'set_setup_import_draft', draft: null });
    onCancel();
  }

  function create() {
    if (readingFiles || pendingReads.current > 0 || fileReadFailed) return;
    // Recheck the current record at the actual lab/store boundary.
    const noInputs = !current.current.files.length && !current.current.witness
      && !state.setupImportDraft?.record.files.length && current.current.status !== 'pending';
    const projected = noInputs ? null : projectForLab(current.current, id);
    if (projected && !projected.ok) { setError(projected.reasons.join(' ')); return; }
    const targetName = projected?.targetName ?? analyte;
    const project: Project = {
      id, name: name || `${targetName || 'Analyte'} — ${matrix || 'matrix'}`,
      method: { target: targetName, unit, basis: 'dry', matrix, referenceMethod: reference, sopVersion: sop, taskType: 'regression' },
      instrumentId: instrument || null, hplcBudget: budget,
      createdAt: nowIso(), updatedAt: nowIso(), activeModelVersionId: null,
    };
    upload.stop();
    dispatch({ kind: 'create_project', project, samples: projected?.samples ?? [],
      ...(projected ? { spectra: projected.spectra, retainedImport: current.current } : {}) });
    onCreated(id);
  }

  return <div className="mx-auto max-w-2xl p-6" data-testid="quali-setup-import">
    <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">New project</h1>
    <p className="mb-6 text-sm text-muted-foreground">Describe the analytical method, then review the dataset with IO. Refused imports remain saved as a Setup draft.</p>
    <div className="space-y-4 card p-5">
      <Field label="Project name"><input className="input" value={name} onChange={(e) => {
        setName(e.target.value);
        dispatch({ kind: 'set_setup_import_draft', draft: { projectId: id, record: current.current, name: e.target.value } });
      }} placeholder="Protein — flour" /></Field>
      <Field label="What do you measure?"><input className="input" data-testid="io-analyte" value={analyte} onChange={(e) => setAnalyte(e.target.value)} placeholder="Protein" /></Field>
      {projection.ok && projection.targetName !== null && <p className="text-xs">Analytical target from IO: {projection.targetName}. The analyte description does not select data.</p>}
      <Field label="Unit"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      <Field label="Matrix"><input className="input" value={matrix} onChange={(e) => setMatrix(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Reference method"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="SOP version"><input className="input" value={sop} onChange={(e) => setSop(e.target.value)} /></Field>
      </div>
      <Field label="NIRS instrument"><input className="input" value={instrument} onChange={(e) => setInstrument(e.target.value)} /></Field>
      <Field label={`Wet-chemistry budget: ${budget} samples`}>
        <input type="range" min={0} max={60} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full" />
      </Field>
      <div className="border-t border-border pt-4">
        <div className="mb-2 text-sm font-medium">Dataset</div>
        <Dropzone onFiles={onFiles} multiple accept=".csv,.txt,.tsv" error={error || null} privacy
          title="Drop X (spectra), y (target) and metadata" hint="Drop files together or in successive batches. A same-name file replaces its previous binding." />
        {notice && <p className="mt-2 text-xs" role="status" data-testid="io-binding-notice">{notice}</p>}
        <ImportBindings record={record} onRemove={upload.removeFile} />
        {(record.files.length > 0 || readingFiles) && <DatasetConfig record={record} onChange={updateRecord} readingFiles={readingFiles} projection={projection} />}
      </div>
    </div>
    <div className="mt-5 flex items-center gap-3">
      <button type="button" className="btn-primary" data-testid="io-create-project" onClick={create}
        disabled={!emptyEligible && (readingFiles || fileReadFailed || !projection.ok)} title="Create the project">Create project</button>
      <button type="button" className="btn-outline" onClick={cancel}>Cancel</button>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
