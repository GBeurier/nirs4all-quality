// Real Core storage + shared codec; no fitting, IO assembly, network or container stub.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const storage = await import(pathToFileURL(resolve(root, 'vendor/owners-current/core/src/n4a.js')));
globalThis.__qualiWorkspaceStorage = storage;
const modelFixture = process.env.QUALI_MODEL_FIXTURE;
let dagFile, methodsRoot, wasmRoot;
if (modelFixture) {
  ({ methodsRoot, wasmRoot } = await import('./methods-stage.mjs'));
  dagFile = resolve(wasmRoot, 'dagml/dag_ml_wasm.js');
  const dag = await import(pathToFileURL(dagFile));
  dag.initSync({ module: await readFile(resolve(wasmRoot, 'dagml/dag_ml_wasm_bg.wasm')) });
  globalThis.__qualiWorkspaceDag = dag;
  for (const [name, directory, prefix] of [
    ['__qualiWorkspaceDmd', 'dagml-data', 'dag_ml_data_wasm'],
    ['__qualiWorkspaceDatasets', 'datasets', 'nirs4all_datasets_wasm'],
  ]) {
    const owner = await import(pathToFileURL(resolve(wasmRoot, directory, `${prefix}.js`)));
    owner.initSync({ module: await readFile(resolve(wasmRoot, directory, `${prefix}_bg.wasm`)) });
    globalThis[name] = owner;
  }
}
let server;
try {
  server = await createServer({ configFile: false, root, server: { middlewareMode: true },
    resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{ name: 'real-workspace-storage', enforce: 'pre', resolveId(id) {
      if (id === 'nirs4all') return '\0real-workspace-storage';
      if (modelFixture && (id === 'dag-ml-wasm' || id === dagFile)) return '\0real-workspace-dag';
      if (modelFixture && id === 'dag-ml-data-wasm') return '\0real-workspace-dmd';
      if (modelFixture && id === '@nirs4all/datasets-wasm') return '\0real-workspace-datasets';
      if (modelFixture && id === '@nirs4all/methods') return { id: resolve(methodsRoot, 'index.js'), external: true };
      if (modelFixture && id === 'dag-ml-wasm/n4m-controller') return { id: resolve(wasmRoot, 'dagml/n4m_controller.mjs'), external: true };
    }, load(id) {
      const owner = id === '\0real-workspace-storage' ? storage
        : id === '\0real-workspace-dag' ? globalThis.__qualiWorkspaceDag
          : id === '\0real-workspace-dmd' ? globalThis.__qualiWorkspaceDmd
            : id === '\0real-workspace-datasets' ? globalThis.__qualiWorkspaceDatasets : undefined;
      if (!owner) return;
      const variable = id === '\0real-workspace-storage' ? '__qualiWorkspaceStorage'
        : id === '\0real-workspace-dag' ? '__qualiWorkspaceDag'
          : id === '\0real-workspace-dmd' ? '__qualiWorkspaceDmd' : '__qualiWorkspaceDatasets';
      return `const owner = globalThis.${variable};\n` + Object.keys(owner)
        .map(name => name === 'default' ? 'export default owner.default;' : `export const ${name} = owner[${JSON.stringify(name)}];`).join('\n');
    } }],
  });
  const api = await server.ssrLoadModule('/src/lib/serverWorkspace.ts');
  const { makeDemoState } = await server.ssrLoadModule('/src/store/demo.ts');
  const state = makeDemoState(), id = state.projects[0].id;
  state.projects[0].cpt = { retainedDeclaration: 'opaque host provenance', sampleIds: ['S001', 'S002'] };
  const originalValues = state.spectraByProject[id].samples[0].reps[0].values;
  originalValues[0] = NaN; originalValues[1] = -0;
  const sourceFile = new File([Uint8Array.of(0, 255, 1, 128)], 'retained-input.bin', { type: 'application/octet-stream', lastModified: 17 });
  state.importsByProject[id] = {
    importedAt: '2026-11-13T00:00:00Z', revision: 1, status: 'ready',
    files: [{ bindingId: 'input', bytesSha256: 'a'.repeat(64), name: sourceFile.name, file: sourceFile,
      bytes: Uint8Array.of(0, 255, 1, 128) }],
    reviewSpecJson: '{"sources":[]}', specEdited: true, specJson: '{"sources":[]}',
    proposal: null, confirmed: [], diagnostics: [], attempts: [], validationSucceeded: true,
    assembled: { sourceId: 'retained-owner-object', values: new Float32Array([NaN, -0, 1.25]),
      validity: Uint8Array.of(0, 1, 1), observation_ids: ['obs-1', 'obs-2', 'obs-3'],
      group_ids: ['group-a', 'group-a', 'group-b'], exactCounter: 9007199254740993n },
    mapping: null, targetConfirmation: null, witness: null, ioVersion: 'fixture-only', stage: null,
  };
  const audit = { id: 'audit-1', projectId: id, action: 'samples_imported', userId: 'u_fixture',
    role: 'method_owner', at: '2026-11-13T00:00:00Z', detail: { source: 'synthetic storage fixture, not IO qualification', exact: 9007199254740993n, missing: NaN, zero: -0 } };
  state.audit = [audit];
  Object.freeze(state.projects[0]); Object.freeze(state.importsByProject[id].assembled);
  const snapshot = api.selectProjectWorkspace(state, id, true);
  const blob = await api.exportProjectWorkspace(snapshot);
  const digestView = await storage.openN4aContainer(blob);
  let workspaceSha;
  try { workspaceSha = digestView.view().readability.container_sha256; }
  finally { digestView.close(); }
  const reopened = await api.importProjectWorkspace(blob, workspaceSha);
  await assert.rejects(() => api.importProjectWorkspace(blob, 'f'.repeat(64)), /server artifact reference/);
  const panelSource = await readFile(resolve(root, 'src/components/server/ServerWorkspacePanel.tsx'), 'utf8');
  assert.ok(panelSource.includes('retained source files will be saved to this browser’s IndexedDB and remain after the page closes'),
    'Opening must explicitly disclose lasting local storage of private server data before dispatch');
  assert.ok(panelSource.indexOf('window.confirm(') < panelSource.indexOf("dispatch({ kind: 'restore_server_project'"));
  assert.deepEqual(reopened.project, snapshot.project);
  assert.deepEqual(reopened.samples, snapshot.samples);
  assert.deepEqual(reopened.spectra, snapshot.spectra);
  assert.deepEqual(reopened.audit, snapshot.audit);
  assert.deepEqual(reopened.retainedImport.assembled, snapshot.retainedImport.assembled);
  assert.deepEqual(reopened.retainedImport.files[0].bytes, Uint8Array.of(0, 255, 1, 128));
  const reopenedFile = reopened.retainedImport.files[0].file;
  assert.ok(reopenedFile instanceof File);
  assert.equal(reopenedFile.name, sourceFile.name); assert.equal(reopenedFile.type, sourceFile.type);
  assert.equal(reopenedFile.lastModified, sourceFile.lastModified);
  assert.deepEqual(new Uint8Array(await reopenedFile.arrayBuffer()), new Uint8Array(await sourceFile.arrayBuffer()));
  assert.ok(Number.isNaN(reopened.spectra.samples[0].reps[0].values[0]));
  assert.ok(Object.is(reopened.spectra.samples[0].reps[0].values[1], -0));
  assert.deepEqual(new Uint8Array(reopened.spectra.samples[0].reps[0].values.buffer), new Uint8Array(originalValues.buffer));

  // A selected-project archive contains no other local project or current user.
  const other = { ...state.projects[0], id: 'other-project', name: 'Unrelated private project' };
  state.projects.push(other); state.samplesByProject[other.id] = [{ private: 'other project sentinel' }];
  state.audit.push({ ...audit, id: 'other-audit', projectId: other.id });
  assert.equal(api.selectProjectWorkspace(state, id, true).audit.length, 1);
  const restored = api.restoreProjectWorkspace(state, reopened);
  assert.strictEqual(restored.projects[1], other); assert.strictEqual(restored.user, state.user);
  assert.strictEqual(restored.samplesByProject[other.id], state.samplesByProject[other.id]);
  assert.deepEqual(restored.audit, state.audit); // duplicate immutable entries are not appended
  assert.deepEqual(restored.importsByProject[id].assembled, reopened.retainedImport.assembled);
  assert.strictEqual(state.projects[0], snapshot.project); // frozen source was never changed
  const conflicting = { ...reopened, audit: [{ ...audit, detail: { source: 'conflicting history' } }] };
  assert.throws(() => api.restoreProjectWorkspace(state, conflicting), /Conflicting immutable audit/);
  assert.deepEqual(state.audit[0], audit);

  const settings = api.selectProjectWorkspace(state, id, false);
  assert.deepEqual(Object.keys(settings).sort(), ['schema', 'schema_version', 'mode', 'project', 'crop', 'previewPp', 'repMode', 'modelDisposition'].sort());
  assert.equal(settings.project.cpt, undefined);
  const settingsArchive = await api.exportProjectWorkspace(settings);
  const settingsRead = await api.importProjectWorkspace(settingsArchive);
  const settingsRestored = api.restoreProjectWorkspace(state, settingsRead);
  assert.strictEqual(settingsRestored.spectraByProject[id], state.spectraByProject[id]);
  assert.strictEqual(settingsRestored.importsByProject[id], state.importsByProject[id]);
  assert.strictEqual(settingsRestored.projects[0].cpt, state.projects[0].cpt);
  state.modelByProject[id] = { model: { opaque: true } };
  assert.equal(api.selectProjectWorkspace(state, id, true).modelDisposition, 'excluded');
  await assert.rejects(() => api.exportProjectModel(state, id), /no exact completed export provenance/,
    'Opaque local state cannot become a server model without its completed owner result');
  assert.ok(state.modelByProject[id], 'saving without model does not clear local fitted state');
  assert.equal(api.selectProjectWorkspace(state, id, false).mode, 'settings');
  const changed = api.restoreProjectWorkspace(state, { ...settingsRead, crop: { from: 1100, to: 2400 } });
  assert.equal(changed.modelByProject[id], undefined);
  assert.ok(state.modelByProject[id], 'source state remains untouched');

  for (const bad of [
    { ...reopened, schema_version: 2 },
    { ...reopened, samples: [{ ...reopened.samples[0], projectId: 'wrong-project' }] },
    { ...reopened, audit: [{ ...audit, projectId: 'wrong-project' }] },
    { ...settingsRead, project: { ...settingsRead.project, cpt: { privateRows: ['S001'] } } },
    { ...reopened, model: { opaque: true } },
  ]) assert.throws(() => api.admitProjectWorkspace(bad));
  await assert.rejects(() => api.importProjectWorkspace(new Blob([new TextEncoder().encode('{}')])));
  // A physically valid foreign attachment refuses at the host admission boundary.
  const opened = await storage.openN4aContainer(blob);
  let manifest, members;
  try {
    manifest = structuredClone(opened.view().readability.manifest);
    members = await Promise.all(manifest.members.map(async member => ({ path: member.path, bytes: await opened.readMember(member.path) })));
  } finally { opened.close(); }
  manifest.artifacts[0].content_type.version = 2;
  const foreign = await storage.writeN4aContainer(manifest, members);
  await assert.rejects(() => api.importProjectWorkspace(foreign.archiveBytes), /supported Quali workspace/);
  const sha = 'b'.repeat(64), record = api.projectWorkspaceRecord('storage fixture', sha);
  assert.equal(api.workspaceArtifact(record), sha);
  assert.deepEqual(Object.keys(record.metadata).sort(), ['app', 'schema_version', 'workspace_artifact'].sort());
  assert.throws(() => api.workspaceArtifact({ ...record, artifacts: ['c'.repeat(64)] }));
  if (modelFixture) {
    // Existing owner archive only: no synthetic calibration result and no fitting.
    const modelBlob = new Blob([await readFile(modelFixture)]);
    const { importModelContainer } = await server.ssrLoadModule('/src/lib/modelIo.ts');
    const imported = await importModelContainer(modelBlob);
    assert.ok('model' in imported, `Existing owner model fixture refused: ${imported.error ?? ''}`);
    const nFeatures = imported.model.nFeatures;
    const withModel = { ...reopened, modelDisposition: 'included', modelArchive: modelBlob,
      project: { ...reopened.project, method: { ...reopened.project.method, target: imported.model.model.state.targetName } },
      spectra: { ...reopened.spectra, axis: Array.from({ length: nFeatures }, (_, i) => 1000 + i),
        samples: reopened.spectra.samples.map(sample => ({ ...sample,
          reps: sample.reps.map(rep => ({ ...rep, values: new Float64Array(nFeatures) })) })) } };
    const transported = await api.importProjectWorkspace(await api.exportProjectWorkspace(withModel));
    const admitted = await api.importProjectModel(transported);
    assert.equal(admitted.evaluationDeclaredOnly, true);
    assert.equal(admitted.model.state.packageJson, imported.model.model.state.packageJson);
    assert.deepEqual(new Uint8Array(await transported.modelArchive.arrayBuffer()), new Uint8Array(await modelBlob.arrayBuffer()));
    const { predictDagModel } = await server.ssrLoadModule('/src/engine/dagEngine.ts');
    const predictX = Float64Array.from({ length: 3 * nFeatures }, (_, index) =>
      1 + index / (3 * nFeatures) + Math.sin(index * 0.2));
    const context = { sampleIds: ['workspace-predict-a', 'workspace-predict-b', 'workspace-predict-c'] };
    const beforePredict = await predictDagModel(imported.model.model, predictX, 3, nFeatures, context);
    const afterPredict = await predictDagModel(admitted.model, predictX, 3, nFeatures, context);
    assert.deepEqual(new Uint8Array(afterPredict.values.buffer), new Uint8Array(beforePredict.values.buffer),
      'Actual DAG/Methods prediction remains byte-identical after workspace transport');
    const active = api.restoreProjectWorkspace(state, transported, admitted);
    assert.equal(active.calibByProject[id], undefined, 'No fabricated calibration leaderboard');
    const resave = await api.exportProjectModel(active, id);
    assert.strictEqual(resave, transported.modelArchive, 'Reuse exact imported archive, without fitting or rebuilding a leaderboard');
    assert.equal(active.modelByProject[id].evaluationDeclaredOnly, true);
    assert.strictEqual(active.modelByProject[id].archiveBlob, transported.modelArchive);
    assert.ok(!Object.hasOwn(active, 'modelArchive'), 'The model archive exists only in the ephemeral model map');
    const storeSource = await readFile(resolve(root, 'src/store/store.tsx'), 'utf8');
    assert.ok(storeSource.includes('saveState({ ...state, modelByProject: {}, calibByProject: {} })'));
    assert.ok(storeSource.includes('saveState({ ...latest.current, modelByProject: {}, calibByProject: {} })'));
    const modelAgain = await importModelContainer(resave);
    assert.ok('model' in modelAgain);
    const resavePredict = await predictDagModel(modelAgain.model.model, predictX, 3, nFeatures, context);
    assert.deepEqual(new Uint8Array(resavePredict.values.buffer), new Uint8Array(beforePredict.values.buffer),
      'Actual native prediction remains byte-identical after exact archive resave');
    await assert.rejects(() => api.importProjectModel({ ...transported,
      project: { ...transported.project, method: { ...transported.project.method, target: 'wrong target' } } }), /target or feature count/);
  } else console.log('SKIP included-model replay/storage: provide an already-produced QUALI_MODEL_FIXTURE; this gate never trains.');
  console.log('Quali server workspace: real Core storage, exact binary/provenance, project isolation, settings privacy and refusal checks passed.');
} finally {
  try { await server?.close(); }
  finally {
    delete globalThis.__qualiWorkspaceStorage; delete globalThis.__qualiWorkspaceDag;
    delete globalThis.__qualiWorkspaceDmd; delete globalThis.__qualiWorkspaceDatasets;
  }
}
