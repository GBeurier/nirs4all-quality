import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ServerClient, ServerError, type Principal, type WorkspaceRecord } from '@nirs4all/server-client';
import { useLab } from '@/store/store';
import {
  exportProjectWorkspace, importProjectWorkspace, exportProjectModel, importProjectModel, projectWorkspaceRecord,
  restoreProjectWorkspace, selectProjectWorkspace, workspaceArtifact,
} from '@/lib/serverWorkspace';

/** Credentials and the authenticated principal live only in this mounted panel. */
export function ServerWorkspacePanel({ onOpened }: { onOpened: (projectId: string) => void }) {
  const { state, dispatch, hydrated } = useLab();
  const latestState = useRef(state); latestState.current = state;
  const client = useRef<ServerClient | null>(null);
  const generation = useRef(0);
  const tokenInput = useRef<HTMLInputElement>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [projectId, setProjectId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [includeData, setIncludeData] = useState(false);
  const [includeModel, setIncludeModel] = useState(false);
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState<WorkspaceRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [binding, setBinding] = useState<{ workspaceId: string; projectId: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Local work stays in this browser until you explicitly save.');
  const selectedId = projectId || state.projects[0]?.id || '';

  useEffect(() => () => { generation.current += 1; client.current?.disconnect(); client.current = null; }, []);

  function disconnect() {
    generation.current += 1;
    client.current?.disconnect(); client.current = null;
    if (tokenInput.current) tokenInput.current.value = '';
    setPrincipal(null); setItems([]); setCursor(null); setBinding(null); setBusy(false); setConsent(false); setIncludeModel(false);
    setStatus('Disconnected. Local work is preserved.');
  }
  function current(epoch: number, active: ServerClient): boolean {
    return generation.current === epoch && client.current === active;
  }
  function failure(error: unknown) {
    // Never show raw transport exceptions or response bodies.
    if (error instanceof ServerError) {
      setStatus(error.status === 409
        ? 'Revision conflict. Local work is preserved. Open the server revision explicitly or choose a new workspace ID to save a copy.'
        : `Server request failed (${error.code}). Local work is preserved.`);
    } else setStatus('Workspace could not be transferred or admitted. Local work is preserved.');
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const base = (form.elements.namedItem('baseUrl') as HTMLInputElement).value;
    const token = tokenInput.current?.value ?? '';
    if (tokenInput.current) tokenInput.current.value = '';
    disconnect();
    const epoch = generation.current;
    // Opaque origins cannot participate in the server's explicit CORS policy.
    if (location.origin === 'null') { setStatus('Server connection requires an HTTP(S) browser origin. Local offline work remains available.'); return; }
    let active: ServerClient;
    try { active = new ServerClient(base, { token, timeoutMs: 60 * 60 * 1000 }); }
    catch { setStatus('Enter an admissible HTTPS server URL and project token.'); return; }
    client.current = active; setBusy(true); setStatus('Verifying server project…');
    try {
      const verified = await active.principal();
      if (!current(epoch, active)) return;
      setPrincipal(verified);
      setStatus('Connected. Refresh the workspace list or explicitly save the selected project.');
    } catch (error) {
      if (current(epoch, active)) { failure(error); active.disconnect(); client.current = null; }
    } finally { if (generation.current === epoch) setBusy(false); }
  }
  async function refresh(more = false) {
    const active = client.current, epoch = generation.current;
    if (!active || !principal) return;
    setBusy(true);
    try {
      const page = await active.listWorkspaces(more && cursor ? { cursor } : {});
      if (!current(epoch, active)) return;
      setItems(previous => more ? [...previous, ...page.items] : page.items);
      setCursor(page.next_cursor); setStatus('Workspace list refreshed for the verified server project.');
    } catch (error) { if (current(epoch, active)) failure(error); }
    finally { if (current(epoch, active)) setBusy(false); }
  }
  async function save() {
    const active = client.current, epoch = generation.current;
    if (!active || !principal) return;
    if (!hydrated) { setStatus('Wait for local workspace loading to finish before saving.'); return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId) || !workspaceName.trim()) {
      setStatus('Enter a workspace ID (letters, digits, underscore or hyphen) and name.'); return;
    }
    if (includeData && !consent) { setStatus('Explicit consent is required to upload dataset arrays, retained source files and any selected fitted model.'); return; }
    const localState = latestState.current;
    let snapshot;
    try { snapshot = selectProjectWorkspace(localState, selectedId, includeData); }
    catch { setStatus('Select an available local project before saving. No upload started.'); return; }
    setBusy(true); setStatus('Preparing the selected project archive…');
    try {
      if (includeData && includeModel) {
        try { snapshot.modelArchive = await exportProjectModel(localState, selectedId); }
        catch {
          if (current(epoch, active)) setStatus('The selected model has no supported exact owner export or retained provenance. Model inclusion was refused before upload. You may explicitly save data/settings without the model.');
          return;
        }
        if (!current(epoch, active)) return;
        snapshot.modelDisposition = 'included';
      }
      const archive = await exportProjectWorkspace(snapshot);
      if (!current(epoch, active)) return;
      const artifact = await active.upload(archive, { filename: 'quali-workspace.n4a' });
      if (!current(epoch, active)) return;
      const expectedRevision = binding?.workspaceId === workspaceId && binding.projectId === selectedId ? binding.revision : 0;
      const saved = await active.saveWorkspace(workspaceId, projectWorkspaceRecord(workspaceName.trim(), artifact.sha256), { expectedRevision });
      if (!current(epoch, active)) return;
      setBinding({ workspaceId: saved.workspace_id, revision: saved.revision, projectId: selectedId });
      setItems(previous => [saved, ...previous.filter(item => item.workspace_id !== saved.workspace_id)]);
      setStatus(`Saved workspace ${saved.workspace_id}, revision ${saved.revision}.`);
    } catch (error) { if (current(epoch, active)) failure(error); }
    finally { if (current(epoch, active)) setBusy(false); }
  }
  async function open(workspace: WorkspaceRecord) {
    const active = client.current, epoch = generation.current;
    if (!active || !principal) return;
    if (!hydrated) { setStatus('Wait for local workspace loading to finish before opening a server project.'); return; }
    setBusy(true); setStatus('Reading and validating the server workspace…');
    try {
      const record = await active.getWorkspace(workspace.workspace_id);
      if (!current(epoch, active)) return;
      const expectedSha = workspaceArtifact(record.snapshot);
      const archive = await active.downloadArtifact(expectedSha);
      if (!current(epoch, active)) return;
      const snapshot = await importProjectWorkspace(archive, expectedSha);
      if (!current(epoch, active)) return;
      const importedModel = await importProjectModel(snapshot);
      if (!current(epoch, active)) return;
      const existing = latestState.current.projects.some(project => project.id === snapshot.project.id);
      const message = snapshot.mode === 'settings'
        ? `Open settings for “${snapshot.project.name}”? ${existing ? 'Replace this local project’s settings; changed crop or repetition mode invalidates its active model.' : 'Create a local project without dataset rows.'}`
        : `Open “${snapshot.project.name}”? ${existing ? 'Replace this local project’s data and settings and clear its ephemeral model/calibration.' : 'Add this project to the local workspace.'}`;
      const modelMessage = importedModel
        ? ' Activate the included owner model for this project? Its imported evaluation remains declared-only and does not verify scientific qualification.'
        : ' This snapshot contains no fitted model; local ephemeral calibration is not restored.';
      const persistenceMessage = snapshot.mode === 'project'
        ? ' This project’s data and retained source files will be saved to this browser’s IndexedDB and remain after the page closes. Opening confirms your consent to this local storage. Fitted model/calibration handles and the model archive remain in memory only.'
        : ' These settings will be saved in this browser and remain after the page closes.';
      if (!window.confirm(`${message}${modelMessage}${persistenceMessage} Other local projects and existing audit history are preserved. Imported metadata does not verify scientific qualification.`)) {
        if (current(epoch, active)) setStatus('Opening cancelled. Local work is preserved.'); return;
      }
      if (!current(epoch, active)) return;
      // Check before dispatch so audit conflicts never enter the reducer render path.
      restoreProjectWorkspace(latestState.current, snapshot, importedModel);
      dispatch({ kind: 'restore_server_project', snapshot, ...(importedModel ? { importedModel } : {}) });
      setProjectId(snapshot.project.id); setWorkspaceId(record.workspace_id); setWorkspaceName(record.snapshot.name);
      setBinding({ workspaceId: record.workspace_id, revision: record.revision, projectId: snapshot.project.id });
      setConsent(false); setIncludeData(snapshot.mode === 'project');
      setIncludeModel(!!importedModel);
      setStatus(`Opened workspace ${record.workspace_id}, revision ${record.revision}. Imported metadata remains declared provenance.`);
      onOpened(snapshot.project.id);
    } catch (error) { if (current(epoch, active)) failure(error); }
    finally { if (current(epoch, active)) setBusy(false); }
  }
  const canWrite = !!principal?.services.includes('server') && !!principal.rights.includes('server.add');
  const selectedSpectra = state.spectraByProject[selectedId];
  return (
    <details data-testid="quali-server-panel" className="border-b border-border bg-card px-5 py-3">
      <summary className="cursor-pointer text-sm font-medium">Optional server workspace</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p>Save one selected local project to a private server project. Server storage does not run or qualify scientific models. Local project data and retained source files are stored in this browser’s IndexedDB and remain after the page closes.</p>
        <p data-testid="server-local-summary" data-project-id={selectedId}
          data-first-sample-id={state.samplesByProject[selectedId]?.[0]?.id ?? ''}
          data-sample-count={state.samplesByProject[selectedId]?.length ?? 0}
          data-spectrum-count={selectedSpectra?.samples.reduce((count, sample) => count + sample.reps.length, 0) ?? 0}>
          Selected local project: {state.projects.find(project => project.id === selectedId)?.name ?? 'none'} · {state.samplesByProject[selectedId]?.length ?? 0} samples · {selectedSpectra?.samples.reduce((count, sample) => count + sample.reps.length, 0) ?? 0} spectra · First sample: {state.samplesByProject[selectedId]?.[0]?.id ?? 'none'}
        </p>
        <form onSubmit={event => { void connect(event); }} className="flex flex-wrap items-end gap-3" autoComplete="off">
          <label>Server URL <input data-testid="server-base-url" name="baseUrl" type="url" placeholder="https://server.example.org" required className="rounded border border-border bg-background px-2 py-1" /></label>
          <label>Project token <input data-testid="server-token" ref={tokenInput} name="projectToken" type="password" autoComplete="off" required className="rounded border border-border bg-background px-2 py-1" /></label>
          <button data-testid="server-connect" type="submit" disabled={busy} className="rounded border border-border px-3 py-1">Connect</button>
          <button data-testid="server-disconnect" type="button" onClick={disconnect} className="rounded border border-border px-3 py-1">Disconnect / cancel</button>
        </form>
        {principal && <>
          <p data-testid="server-principal">Verified project: <strong>{principal.project_id}</strong> · Principal: {principal.principal_id} · Services: {principal.services.join(', ')} · Rights: {principal.rights.join(', ')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label>Local project <select data-testid="server-project-select" value={selectedId} disabled={busy} onChange={event => { setProjectId(event.target.value); setConsent(false); setIncludeModel(false); }} className="rounded border border-border bg-background px-2 py-1">
              {state.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select></label>
            <label>Workspace ID <input data-testid="server-workspace-id" value={workspaceId} disabled={busy} onChange={event => setWorkspaceId(event.target.value)} className="rounded border border-border bg-background px-2 py-1" /></label>
            <label>Workspace name <input data-testid="server-workspace-name" value={workspaceName} disabled={busy} onChange={event => setWorkspaceName(event.target.value)} className="rounded border border-border bg-background px-2 py-1" /></label>
          </div>
          <label className="block"><input data-testid="server-include-data" type="checkbox" checked={includeData} disabled={busy} onChange={event => { setIncludeData(event.target.checked); setIncludeModel(false); setConsent(false); }} /> Include this project’s samples, spectra, audit and retained IO imports/source files</label>
          <p>{includeData ? 'Transfers exact dataset arrays, sample/repetition identities, split declarations and original retained source bytes. Calibration handles are ephemeral.' : 'Settings only: project description, crop, preprocessing preview and repetition mode. No dataset arrays, source files, audit, split identities or fitted model.'}</p>
          {includeData && <>
            <label className="block"><input data-testid="server-include-model" type="checkbox" checked={includeModel} disabled={busy || !state.modelByProject[selectedId]} onChange={event => { setIncludeModel(event.target.checked); setConsent(false); }} /> Include the active fitted model through its existing owner export</label>
            <p>{includeModel ? 'Transfers the exact supported PLS/Ridge owner container, fitted weights, training IDs, graph, parameters and reports. These reviewed owner states contain no training rows. No retraining or new evaluation is performed.' : 'Save data/settings without a fitted model. Your current local model is preserved; opening this snapshot will not restore it.'}</p>
            <label className="block"><input data-testid="server-upload-consent" type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> I consent to uploading this selected project’s dataset, retained source files and, when selected above, fitted model to the verified server project.</label>
          </>}
          <div className="flex flex-wrap gap-3">
            <button data-testid="server-save" type="button" disabled={busy || !hydrated || !selectedId || !canWrite || includeData && !consent} onClick={() => { void save(); }} className="rounded border border-border px-3 py-1">Save workspace</button>
            <button data-testid="server-refresh" type="button" disabled={busy} onClick={() => { void refresh(); }} className="rounded border border-border px-3 py-1">Refresh workspaces</button>
          </div>
          {!canWrite && <p>The verified token does not grant server write access.</p>}
          <ul data-testid="server-workspace-list" className="space-y-2">
            {items.filter(item => item.snapshot.metadata.app === 'quali').map(item => <li key={item.workspace_id} data-workspace-id={item.workspace_id} className="flex flex-wrap items-center gap-3">
              <span>{item.snapshot.name} · {item.workspace_id} · revision {item.revision}</span>
              <button type="button" disabled={busy || !hydrated} onClick={() => { void open(item); }} className="rounded border border-border px-3 py-1">Open</button>
            </li>)}
          </ul>
          {cursor && <button type="button" disabled={busy} onClick={() => { void refresh(true); }} className="rounded border border-border px-3 py-1">More workspaces</button>}
        </>}
        <p data-testid="server-status" role="status" aria-live="polite">{status}</p>
      </div>
    </details>
  );
}
