import { useEffect, useRef, useState } from 'react';
import { DatasetPreviewCard } from 'nirs4all-ui/components';
import { LiveValidationCard, OwnerProposalList, type ValidationResult } from 'nirs4all-ui/datasetBuilder';
import 'nirs4all-ui/assets/datasetBuilder.css';
import 'nirs4all-ui/browser/styles.css';

import {
  confirmProposal, confirmTargetRows, emptyImport, errorMessage, invalidateImport, objectFields, readImportFiles, replaceBindings,
  previewRows, previewView, proposalViews, startImportWorker, undoProposal,
  type ImportWorkerRequest, type ImportWorkerResponse, type LabProjection, type MappingContext, type RetainedImport,
} from '@/lib/ioImport';

/** Shared byte-read queue from Setup; IO still owns all parsing and assembly. */
export function useDatasetImport(saved?: RetainedImport, onRecord?: (record: RetainedImport) => void) {
  const [record, setRecord] = useState<RetainedImport>(() => saved
    ? { ...saved, revision: saved.revision + 1, status: saved.files.length ? 'pending' : 'idle', assembled: null, validationSucceeded: false }
    : emptyImport());
  const current = useRef(record);
  const active = useRef(true);
  const epoch = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingReads = useRef(0);
  const notify = useRef(onRecord);
  notify.current = onRecord;
  const [readingFiles, setReadingFiles] = useState(false);
  const [fileReadFailed, setFileReadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; epoch.current++; }; }, []);

  function updateRecord(next: RetainedImport, expectedRevision = current.current.revision) {
    if (!active.current || expectedRevision !== current.current.revision) return;
    current.current = next;
    setRecord(next);
    notify.current?.(next);
  }
  function cancelReads() {
    epoch.current++;
    queue.current = Promise.resolve();
    pendingReads.current = 0;
    setReadingFiles(false);
  }
  function onFiles(files: File[]) {
    if (!files.length) return Promise.resolve();
    const request = epoch.current;
    pendingReads.current++;
    setReadingFiles(true); setError(''); setFileReadFailed(false);
    updateRecord(invalidateImport(current.current));
    queue.current = queue.current.then(async () => {
      if (!active.current || request !== epoch.current) return;
      try {
        const added = await readImportFiles(files);
        if (!active.current || request !== epoch.current) return;
        const previous = new Set(current.current.files.map((f) => f.name));
        const replaced = added.filter((f) => previous.has(f.name)).map((f) => f.name);
        setNotice(replaced.length ? `Replaced same-name bindings: ${replaced.join(', ')}. Decisions and row confirmation were cleared.` : 'Original file bytes retained for IO review.');
        updateRecord(replaceBindings(current.current, added));
      } catch (reason) {
        if (active.current && request === epoch.current) { setError(errorMessage(reason)); setFileReadFailed(true); }
      } finally {
        if (active.current && request === epoch.current) {
          pendingReads.current--;
          setReadingFiles(pendingReads.current > 0);
        }
      }
    });
    return queue.current;
  }
  function removeFile(name: string) {
    cancelReads(); setError(''); setFileReadFailed(false);
    updateRecord(replaceBindings(current.current, [], name));
  }
  function reset() {
    cancelReads(); setError(''); setNotice(''); setFileReadFailed(false);
    updateRecord({ ...emptyImport(), revision: current.current.revision + 1 });
  }
  function stop() { active.current = false; epoch.current++; }
  return { record, current, readingFiles, pendingReads, fileReadFailed, error, setError, notice,
    updateRecord, onFiles, removeFile, reset, stop };
}

export function ImportBindings({ record, onRemove }: { record: RetainedImport; onRemove: (name: string) => void }) {
  return <ul className="mt-2 space-y-1 text-xs" data-testid="io-input-bindings">
    {record.files.map((file) => <li key={file.bindingId}>
      {file.name} · {file.bytes.byteLength} original bytes
      <button type="button" className="ml-2 underline" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.name)}>Remove</button>
    </li>)}
  </ul>;
}

export function DatasetConfig({ record, onChange, readingFiles, projection }: {
  record: RetainedImport;
  readingFiles: boolean;
  projection: LabProjection;
  onChange: (record: RetainedImport, expectedRevision: number) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const activeRequest = useRef(0);
  const latest = useRef({ record, onChange });
  latest.current = { record, onChange };
  const [localError, setLocalError] = useState('');
  useEffect(() => () => { activeRequest.current++; worker.current?.terminate(); worker.current = null; }, []);

  useEffect(() => {
    const id = ++activeRequest.current;
    if (!record.files.length) { worker.current?.terminate(); worker.current = null; return; }
    if (readingFiles) return;
    const revision = record.revision;
    const fail = (message: string) => {
      if (activeRequest.current !== id || latest.current.record.revision !== revision) return;
      latest.current.onChange({ ...latest.current.record, stage: __QUALI_IO_IMPORT_STAGE__, status: 'refused', assembled: null,
        validationSucceeded: false, diagnostics: [{ phase: 'runtime', message }] }, revision);
    };
    try {
      worker.current ??= startImportWorker();
      worker.current.onmessage = (event: MessageEvent<ImportWorkerResponse>) => {
        if (event.data.id !== activeRequest.current || latest.current.record.revision !== revision) return;
        latest.current.onChange(event.data.record, revision);
      };
      worker.current.onerror = (event) => fail(event.message || 'The IO worker could not load.');
      const request: ImportWorkerRequest = { id, record };
      worker.current.postMessage(request);
    } catch (error) { fail(errorMessage(error)); }
    return () => { if (activeRequest.current === id) activeRequest.current++; };
    // Only a new input revision requests IO; a response does not re-run itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.revision, readingFiles]);

  const busy = readingFiles || record.status === 'pending';
  const view = previewView(record);
  const validation: ValidationResult = {
    status: record.diagnostics.length ? 'error' : record.status === 'ready' ? 'ok' : 'warning',
    checks: record.diagnostics.length
      ? record.diagnostics.map((d, i) => ({ id: String(i), level: 'error', label: d.phase, details: d.message }))
      : [{ id: 'owner', level: record.status === 'ready' ? 'ok' : 'warning', label: busy ? 'IO review in progress' : record.status === 'ready' ? 'IO validation and assembly succeeded' : 'Waiting for files' }],
  };

  function proposalAction(id: string, choice?: string) {
    const proposal = record.proposal?.proposals[Number(id)];
    if (!proposal) return;
    const candidate = choice === undefined ? null : objectFields(proposal.alternatives[Number(choice)]);
    if (choice !== undefined && (!candidate || !Object.hasOwn(candidate, 'value'))) return;
    onChange(confirmProposal(record, proposal, choice === undefined ? proposal.value : candidate!.value), record.revision);
  }

  return <section className="mt-3 space-y-3 rounded-lg border border-border p-3" data-testid="io-import-review" aria-busy={busy}>
    {busy && <p role="status">Reviewing the current files with IO…</p>}
    <details>
      <summary className="cursor-pointer text-sm font-medium">Review IO proposals</summary>
      <div className="n4ui-b-root mt-3">
        <OwnerProposalList proposals={proposalViews(record)} busy={busy}
          title="IO proposals" onConfirm={(id) => proposalAction(id)} onAlternative={proposalAction}
          onUndo={(kind, target) => onChange(undoProposal(record, kind, target), record.revision)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Owner scores rank proposals; they are not calibrated probabilities. Source-role choices replace inferred column roles. Edit column roles in the IO specification.</p>
    </details>
    <LiveValidationCard validation={validation} locale="en" title="IO validation and diagnostics" />
    {(record.reviewSpecJson || record.specEdited) && <details>
      <summary>Review IO specification and column roles</summary>
      <label className="block text-xs">IO specification JSON
        <textarea aria-label="IO specification JSON" data-testid="io-spec-json" className="input mt-1 min-h-48 w-full font-mono text-xs"
          value={record.reviewSpecJson} onChange={(e) => {
            onChange(invalidateImport({ ...record, reviewSpecJson: e.target.value, specEdited: true }), record.revision);
          }} />
      </label>
      <p className="text-xs">Only IO validates this specification. Unknown fields are retained. Editing invalidates the previous assembly and row confirmation.</p>
    </details>}
    {record.mapping && <TargetMapping key={`${record.mapping.targetBindingId}:${record.revision}`} context={record.mapping}
      record={record} busy={busy} onUndo={() => onChange(invalidateImport(record), record.revision)}
      onConfirm={async (rows) => {
        setLocalError('');
        try { onChange(await confirmTargetRows(record, rows), record.revision); }
        catch (error) { setLocalError(errorMessage(error)); }
      }} />}
    {localError && <p role="alert">{localError}</p>}
    {view && <div className="n4ui-b-root" data-testid="io-dataset-preview">
      <DatasetPreviewCard view={view}
        className="n4ui-b-card"
        headerClassName="n4ui-b-card-header"
        titleClassName="n4ui-b-card-title"
        descriptionClassName="n4ui-b-card-description"
        badgeListClassName="n4ui-b-card-badges"
        badgeClassName={(badge) => `n4ui-b-badge n4ui-b-tone-${badge.tone}`}
        statListClassName="n4ui-b-card-stats"
        statClassName={(stat) => `n4ui-b-stat n4ui-b-tone-${stat.tone}`}
        statLabelClassName="n4ui-b-stat-label"
        statValueClassName="n4ui-b-stat-value"
        statDetailClassName="n4ui-b-stat-detail" />
    </div>}
    {record.assembled !== null && <div className="overflow-auto" role="region" aria-label="Owner preview values, horizontally scrollable" tabIndex={0}>
      <table className="text-xs" data-testid="io-preview-values">
        <caption>First 20 rows per partition for display. The full owner record is retained without truncation. Row ordinals are not observation IDs.</caption>
        <thead><tr><th scope="col">Partition</th><th scope="col">Row</th><th scope="col">Owner values</th></tr></thead>
        <tbody>{previewRows(record.assembled).map((row) => <tr key={`${row.partition}:${row.row}`}>
          <td>{row.partition}</td><th scope="row">{row.row}</th><td>{row.values}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div data-testid="io-create-refusal" role="status" className="text-xs">
      {!projection.ok && <ul>{projection.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      {projection.ok && <p>{projection.samples.length} samples · {projection.spectra.samples.reduce((n, s) => n + s.reps.length, 0)} spectra · {projection.targetName === null ? 'no reference target supplied' : `target ${projection.targetName}`}. No observation identity is invented.</p>}
    </div>
  </section>;
}

function TargetMapping({ context, record, busy, onConfirm, onUndo }: {
  context: MappingContext; record: RetainedImport; busy: boolean;
  onConfirm: (rows: { row: number; sampleId: string }[]) => Promise<void>;
  onUndo: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => Array.from({ length: context.rowCount }, () => ''));
  const [confirming, setConfirming] = useState(false);
  const confirmed = record.targetConfirmation;
  return <section data-testid="io-target-mapping" aria-label="Explicit target row identities">
    <h2 className="text-sm font-semibold">Confirm target row identities</h2>
    <p className="text-xs">{context.targetName}: {context.rowCount} target rows. Select the declared {context.sampleIdColumn} for each row. Nothing is inferred from sample order.</p>
    <div className="overflow-auto" role="region" aria-label="Target row mapping, horizontally scrollable" tabIndex={0}><table className="text-xs">
      <caption>Target row positions from IO; sample choices from the declared IO metadata column, in owner row order.</caption>
      <thead><tr><th scope="col">Target row (zero based)</th><th scope="col">Sample ID</th></tr></thead>
      <tbody>{selected.map((value, row) => <tr key={row}><th scope="row">{row}</th><td>
        <select aria-label={`Sample ID for target row ${row}`} data-testid={`io-target-row-${row}`}
          disabled={busy || confirming || confirmed !== null} value={confirmed?.rows[row]?.sampleId ?? value}
          onChange={(e) => setSelected((current) => current.map((v, i) => i === row ? e.target.value : v))}>
          <option value="">Select a sample ID</option>
          {context.sampleIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </td></tr>)}</tbody>
    </table></div>
    {confirmed ? <button type="button" className="btn-outline" disabled={busy} onClick={onUndo}>Undo row confirmation</button>
      : <button type="button" className="btn-outline" data-testid="io-confirm-target-rows" disabled={busy || confirming || selected.some((v) => !v)}
        onClick={async () => { setConfirming(true); try { await onConfirm(selected.map((sampleId, row) => ({ row, sampleId }))); } finally { setConfirming(false); } }}>Confirm target row mapping</button>}
  </section>;
}
