import { useEffect, useMemo, useRef, useState } from 'react';

import type { Project } from '@/domain/model';
import { newId, nowIso } from '@/lib/ids';
import { emptyImport, errorMessage, invalidateImport, projectForLab, readImportFiles, replaceBindings, type RetainedImport } from '@/lib/ioImport';
import { useLab } from '@/store/store';
import { DatasetConfig } from '@/ui/DatasetConfig';
import { Dropzone } from '@/ui/Dropzone';

// Setup import/preview only. Other product ingestion routes retain their legacy adapter.
export function Setup({ onCancel, onCreated }: { onCancel: () => void; onCreated: (projectId: string) => void }) {
  const { state, dispatch } = useLab();
  const [id] = useState(() => state.setupImportDraft?.projectId ?? newId('p'));
  const [record, setRecord] = useState<RetainedImport>(() => {
    const saved = state.setupImportDraft?.record;
    // A restored result must undergo a fresh owner cycle before later Create eligibility.
    return saved ? { ...saved, revision: saved.revision + 1, status: saved.files.length ? 'pending' : 'idle', assembled: null, validationSucceeded: false } : emptyImport();
  });
  const current = useRef(record);
  current.current = record;
  const active = useRef(true);
  const fileRequest = useRef(0);
  const fileQueue = useRef(Promise.resolve());
  const pendingReads = useRef(0);
  const [readingFiles, setReadingFiles] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; fileRequest.current++; }; }, []);
  const [name, setName] = useState('');
  const [analyte, setAnalyte] = useState('');
  const [unit, setUnit] = useState('%');
  const [matrix, setMatrix] = useState('');
  const [reference, setReference] = useState('HPLC');
  const [sop, setSop] = useState('SOP-v1');
  const [instrument, setInstrument] = useState('');
  const [budget, setBudget] = useState(15);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fileReadFailed, setFileReadFailed] = useState(false);
  const projection = useMemo(() => projectForLab(record, id), [record, id]);
  const emptyEligible = !record.files.length && !record.witness && !readingFiles && pendingReads.current === 0
    && !state.setupImportDraft?.record.files.length && record.status !== 'pending' && !fileReadFailed;

  function updateRecord(next: RetainedImport, expectedRevision = current.current.revision) {
    if (!active.current || expectedRevision !== current.current.revision) return;
    current.current = next;
    setRecord(next);
    dispatch({ kind: 'set_setup_import_draft', draft: { projectId: id, record: next } });
  }

  function onFiles(files: File[]) {
    const request = fileRequest.current;
    pendingReads.current++;
    setReadingFiles(true);
    setError('');
    setFileReadFailed(false);
    // File reads/hash completion can race an existing IO result: invalidate first.
    updateRecord(invalidateImport(current.current));
    // Apply batches in drop order so distinct concurrent drops accumulate and
    // the latest same-name drop wins, independently of file read completion.
    fileQueue.current = fileQueue.current.then(async () => {
      try {
        const added = await readImportFiles(files);
        if (!active.current || request !== fileRequest.current) return;
        const previousNames = new Set(current.current.files.map((f) => f.name));
        const replaced = added.filter((f) => previousNames.has(f.name)).map((f) => f.name);
        setNotice(replaced.length ? `Replaced same-name bindings: ${replaced.join(', ')}. Decisions and row confirmation were cleared.` : 'Original file bytes retained for IO review.');
        updateRecord(replaceBindings(current.current, added));
      } catch (reason) { if (active.current && request === fileRequest.current) { setError(errorMessage(reason)); setFileReadFailed(true); } }
      finally {
        pendingReads.current--;
        if (active.current) setReadingFiles(pendingReads.current > 0);
      }
    });
    return fileQueue.current;
  }

  function cancel() {
    active.current = false;
    fileRequest.current++;
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
    active.current = false;
    fileRequest.current++;
    dispatch({ kind: 'create_project', project, samples: projected?.samples ?? [],
      ...(projected ? { spectra: projected.spectra, retainedImport: current.current } : {}) });
    onCreated(id);
  }

  return <div className="mx-auto max-w-2xl p-6" data-testid="quali-setup-import">
    <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">New project</h1>
    <p className="mb-6 text-sm text-muted-foreground">Describe the analytical method, then review the dataset with IO. Refused imports remain saved as a Setup draft.</p>
    <div className="space-y-4 card p-5">
      <Field label="Project name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Protein — flour" /></Field>
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
        <ul className="mt-2 space-y-1 text-xs" data-testid="io-input-bindings">
          {record.files.map((file) => <li key={file.bindingId}>
            {file.name} · {file.bytes.byteLength} original bytes
            <button type="button" className="ml-2 underline" aria-label={`Remove ${file.name}`}
              onClick={() => { fileRequest.current++; updateRecord(replaceBindings(current.current, [], file.name)); }}>Remove</button>
          </li>)}
        </ul>
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
