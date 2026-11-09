// Add reference (y) values to an existing project: the user picks the sample-ID column and the
// numeric value column explicitly; IO parses the file; the preview is confirmed before anything is applied.
import { useEffect, useRef, useState } from 'react';

import type { Sample } from '@/domain/model';
import { sha256 } from '@/lib/ioImport';
import {
  describeReferenceFile, guardMatches, previewReference,
  type ReferenceDescription, type ReferenceFile, type ReferenceOptions, type ReferenceOwner, type ReferencePreview,
} from '@/lib/referenceImport';
import { useLab } from '@/store/store';

let ownerLoad: Promise<ReferenceOwner> | null = null;
/** The same browser IO glue as the Setup worker, called on the main thread (no worker is added for this table). */
function loadOwner(): Promise<ReferenceOwner> {
  ownerLoad ??= (async () => {
    const owner = await import('@quali/io-import-wasm');
    await owner.default();
    return owner as unknown as ReferenceOwner;
  })().catch((error) => { ownerLoad = null; throw error; });
  return ownerLoad;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const NO_OPTIONS: ReferenceOptions = { hasHeader: null, delimiter: null };

export function ReferenceImport({ projectId, samples, onClose, onDone }: {
  projectId: string; samples: Sample[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const { dispatch } = useLab();
  const revision = useRef(0);
  const alive = useRef(true);
  const latest = useRef({ projectId, samples });
  latest.current = { projectId, samples };
  const [file, setFile] = useState<ReferenceFile | null>(null);
  const [options, setOptions] = useState<ReferenceOptions>(NO_OPTIONS);
  const [description, setDescription] = useState<ReferenceDescription | null>(null);
  const [idColumn, setIdColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');
  const [preview, setPreview] = useState<{ revision: number; result: ReferencePreview } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The parent keys this component by project: unmounting retires any pending file/owner work.
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);

  /** Any source, option or column edit retires the previous preview immediately. */
  function invalidate() { revision.current++; setPreview(null); setError(''); }

  async function describe(next: ReferenceFile, nextOptions: ReferenceOptions) {
    const rev = ++revision.current;
    setPreview(null); setError(''); setBusy(true);
    try {
      const owner = await loadOwner();
      if (!alive.current || rev !== revision.current) return;
      setDescription(describeReferenceFile(owner, next, nextOptions));
    } catch (reason) {
      if (alive.current && rev === revision.current) { setDescription(null); setError(errorText(reason)); }
    } finally { if (alive.current && rev === revision.current) setBusy(false); }
  }

  async function onFile(selected: File | undefined) {
    if (!selected) return;
    const rev = ++revision.current;
    setPreview(null); setError(''); setDescription(null); setFile(null); setOptions(NO_OPTIONS); setIdColumn(''); setValueColumn('');
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const hash = await sha256(bytes);
      if (!alive.current || rev !== revision.current) return;
      const next = { name: selected.name, bytes, sha256: hash };
      setFile(next);
      await describe(next, NO_OPTIONS);
    } catch (reason) { if (alive.current && rev === revision.current) setError(errorText(reason)); }
  }

  function changeOptions(next: ReferenceOptions) {
    if (!file) return;
    setOptions(next); setIdColumn(''); setValueColumn('');
    void describe(file, next);
  }

  async function runPreview() {
    if (!file || !description) return;
    const rev = revision.current;
    try {
      const owner = await loadOwner();
      if (!alive.current || rev !== revision.current) return;
      const result = previewReference(owner, file, options, idColumn, valueColumn, latest.current.samples);
      setPreview({ revision: rev, result });
    } catch (reason) { if (alive.current && rev === revision.current) setError(errorText(reason)); }
  }

  function confirm() {
    if (!preview || !preview.result.ok) return;
    const { delta } = preview.result;
    if (!alive.current || preview.revision !== revision.current || latest.current.projectId !== projectId) return;
    if (!guardMatches(latest.current.samples, delta.expected)) {
      setPreview(null);
      setError('The sample list or the references changed: run the preview again.');
      return;
    }
    dispatch({ kind: 'apply_reference_delta', projectId, delta });
    const { counts } = delta;
    onDone(`${counts.set} reference(s) added, ${counts.changed} changed — existing models are invalidated. ${counts.unknownIds} unknown id(s) not applied.`);
    onClose();
  }

  const columns = description?.table.columns ?? [];
  const optionsReady = description !== null && !description.needsHeader && description.delimiterCandidates === null && description.table.readable;
  const result = preview?.result;

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-4 text-sm" aria-label="Add reference values y">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-medium">Add reference values y</h2>
        <button type="button" className="ml-auto rounded-md border border-border px-2 py-1 text-xs" onClick={onClose}>Cancel</button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        The file needs a sample-ID column (identical to the project ids) and a numeric value column. Empty or invalid values keep the existing reference; unknown ids are not applied.
      </p>
      <input type="file" accept=".csv,.txt,.tsv" aria-label="Reference file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {file && <p className="mt-1 text-xs text-muted-foreground">{file.name} · {file.bytes.byteLength} bytes · SHA-256 {file.sha256.slice(0, 12)}…</p>}
      {busy && <p role="status" className="mt-2 text-xs">Reading with IO…</p>}
      {description && !description.table.readable && <p role="alert" className="mt-2 text-xs text-destructive">{description.table.refusal ?? 'Unreadable file.'}</p>}

      {description?.needsHeader && (
        <fieldset className="mt-3 text-xs">
          <legend className="font-medium">Is the first row a header?</legend>
          <label className="mr-3"><input type="radio" name="ref-header" onChange={() => changeOptions({ ...options, hasHeader: true })} /> Yes</label>
          <label><input type="radio" name="ref-header" onChange={() => changeOptions({ ...options, hasHeader: false })} /> No</label>
        </fieldset>
      )}
      {description?.delimiterCandidates && (
        <fieldset className="mt-3 text-xs">
          <legend className="font-medium">Delimiter</legend>
          {description.delimiterCandidates.map((candidate) => (
            <label key={candidate} className="mr-3"><input type="radio" name="ref-delimiter" onChange={() => changeOptions({ ...options, delimiter: candidate })} /> {JSON.stringify(candidate)}</label>
          ))}
        </fieldset>
      )}

      {optionsReady && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="overflow-auto" role="region" aria-label="File columns, scrollable" tabIndex={0}>
            <table>
              <caption className="text-left">Columns described by IO (none is preselected)</caption>
              <thead><tr><th scope="col">Column</th><th scope="col">Type</th><th scope="col">Unique</th><th scope="col">Preview</th></tr></thead>
              <tbody>{columns.map((column) => (
                <tr key={column.name}><th scope="row">{column.name}</th><td>{column.dtype}</td><td>{column.is_unique ? 'yes' : 'no'}</td><td>{column.preview ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <label className="block">Sample-ID column
            <select value={idColumn} onChange={(e) => { setIdColumn(e.target.value); invalidate(); }}>
              <option value="">Choose…</option>
              {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </label>
          <label className="block">Reference value column
            <select value={valueColumn} onChange={(e) => { setValueColumn(e.target.value); invalidate(); }}>
              <option value="">Choose…</option>
              {columns.filter((column) => column.dtype === 'numeric').map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </label>
          <button type="button" className="rounded-md border border-border px-2 py-1" disabled={!idColumn || !valueColumn || busy} onClick={() => void runPreview()}>
            Preview
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {result && !result.ok && <p role="alert" className="mt-2 text-xs text-destructive">{result.reason}</p>}
      {result && result.ok && (
        <div className="mt-3 text-xs" data-testid="reference-preview">
          <p role="status">
            Preview: {result.delta.counts.set} set · {result.delta.counts.changed} changed · {result.delta.counts.unchanged} unchanged · {result.delta.counts.invalidKept} invalid — existing kept · {result.delta.counts.unknownIds} unknown id(s) · {result.delta.counts.absentFromFile} sample(s) not in the file
          </p>
          {result.delta.updates.length > 0 && (
            <div className="mt-2 max-h-48 overflow-auto" role="region" aria-label="Changed values, scrollable" tabIndex={0}>
              <table>
                <caption className="text-left">References set or changed</caption>
                <thead><tr><th scope="col">Sample</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                <tbody>{result.delta.updates.map((update) => (
                  <tr key={update.id}><th scope="row">{update.id}</th><td>{update.previous === null ? '—' : update.previous}</td><td>{update.value}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {result.delta.unknownIds.length > 0 && <p className="mt-2">Unknown ids (not applied): {result.delta.unknownIds.join(', ')}</p>}
          <button type="button" className="mt-2 rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
            disabled={result.delta.updates.length === 0} onClick={confirm}>
            Confirm and apply
          </button>
          {result.delta.updates.length === 0 && <span className="ml-2">No reference change.</span>}
        </div>
      )}
    </section>
  );
}
