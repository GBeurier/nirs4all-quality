// Actual production file boundary through real Core V1; no fit or container stub.
// Historical coefficient fixtures below are retained as explicit clean-V1 refusals.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { methodsRoot, wasmRoot } from './methods-stage.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const storageFile = resolve(root, 'vendor/owners-current/core/src/n4a.js');
const dagFile = resolve(wasmRoot, 'dagml/dag_ml_wasm.js');
const storage = await import(pathToFileURL(storageFile));
const dag = await import(pathToFileURL(dagFile));
dag.initSync({ module: await readFile(resolve(wasmRoot, 'dagml/dag_ml_wasm_bg.wasm')) });

// Test-only references to actual initialized native namespaces, as in the
// scientific/Ridge harnesses. Forward the real default and every named export.
const NATIVE_OWNER_PREFIX = '\0quali-native-owner:';
const nativeOwnerFiles = new Map([[dagFile, 'dag'], [storageFile, 'storage']]);
globalThis.__qualiModelImportNativeOwners = { dag, storage };
const nativeOwnerId = file => NATIVE_OWNER_PREFIX + nativeOwnerFiles.get(file);
function nativeOwnerSource(id) {
  if (!id.startsWith(NATIVE_OWNER_PREFIX)) return;
  const key = id.slice(NATIVE_OWNER_PREFIX.length);
  const owner = globalThis.__qualiModelImportNativeOwners[key];
  if (!owner) return;
  return `const owner = globalThis.__qualiModelImportNativeOwners[${JSON.stringify(key)}];\n`
    + Object.keys(owner).map(name => name === 'default'
      ? 'export default owner.default;'
      : `export const ${name} = owner[${JSON.stringify(name)}];`).join('\n');
}
let server;
try {
server = await createServer({ configFile: false, root, server: { middlewareMode: true },
  resolve: { alias: { '@': resolve(root, 'src') } }, optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'real-container-owners', enforce: 'pre', resolveId(id) {
    if (id === 'nirs4all' || id === storageFile) return nativeOwnerId(storageFile);
    if (id === 'dag-ml-wasm' || id === dagFile) return nativeOwnerId(dagFile);
    if (id === '@nirs4all/methods') return { id: resolve(methodsRoot, 'index.js'), external: true };
    if (id === 'dag-ml-wasm/n4m-controller') return { id: resolve(wasmRoot, 'dagml/n4m_controller.mjs'), external: true };
  }, load: nativeOwnerSource }],
});
const { importModelContainer, exportModelContainer, QUALI_HOST, qualiHostManifest } = await server.ssrLoadModule('/src/lib/modelIo.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const own = {
  format: 'quali-nirs4all/n4a', version: 1, nFeatures: 3,
  model: { taskType: 'regression', nFeatures: 3, state: {
    backendId: 'nirs4all-core-wasm', result: {
      preprocessing: [], model: {
        type: 'PLSRegression', n_components: 1, n_features: 3, n_targets: 1,
        coefficients: [1, 2, 3], xMean: [0, 0, 0], yMean: [2], intercept: null,
      },
    },
  } },
};
let cases = 0;
async function check(bundle, accepted, name) {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle)), before = digest(bytes);
  const result = await importModelContainer(new Blob([bytes]));
  assert.equal(digest(bytes), before, 'legacy input bytes remain unchanged');
  assert.equal('model' in result, accepted, name);
  cases += 1;
}
await check(own, false, 'own portable PLS');
const currentCore = structuredClone(own);
currentCore.model.state.result.model.params = [];
await check(currentCore, false, 'Core 0.4.5 explicit empty PLS parameters');
const snv = structuredClone(own);
snv.model.state.result.preprocessing = [{ type: 'StandardNormalVariate', params: [] }];
await check(snv, false, 'own SNV portable PLS');
const currentSnv = structuredClone(snv);
currentSnv.model.state.result.preprocessing[0].state = [];
await check(currentSnv, false, 'Core 0.4.5 empty SNV state');
const sg = structuredClone(own);
sg.model.state.result.preprocessing = [{ type: 'SavitzkyGolay', params: [3, 2, 1, 4, 0] }];
await check(sg, false, 'own SG portable PLS');
const currentSg = structuredClone(sg);
currentSg.model.state.result.preprocessing[0].state = [];
await check(currentSg, false, 'Core 0.4.5 empty SG state');
const learnedSg = structuredClone(currentSg);
learnedSg.model.state.result.preprocessing[0].state = [1];
await check(learnedSg, false, 'unsupported learned SG state');
const intercept = structuredClone(own);
intercept.model.state.result.model.intercept = [2];
await check(intercept, false, 'finite intercept');
const mutations = [
  ['foreign format', (b) => { b.format = 'nirs4all-core/n4a'; }],
  ['version two', (b) => { b.version = 2; }],
  ['version string', (b) => { b.version = '1'; }],
  ['version boolean', (b) => { b.version = true; }],
  ['classification', (b) => { b.model.taskType = 'classification'; }],
  ['feature identity', (b) => { b.nFeatures = 4; }],
  ['typed feature identity', (b) => { b.model.nFeatures = '3'; }],
  ['opaque native state', (b) => { b.model.state = { backendId: 'nirs4all-core-wasm', blob: 'native' }; }],
  ['foreign native state', (b) => { b.model.state.blob = 'native'; }],
  ['foreign learned state', (b) => { b.model.state.result.preprocessing = [{ type: 'StandardNormalVariate', params: [], state: [1] }]; }],
  ['foreign preprocessing', (b) => { b.model.state.result.preprocessing = [{ type: 'MSC', params: [] }]; }],
  ['wrong targets', (b) => { b.model.state.result.model.n_targets = 2; }],
  ['wrong model width', (b) => { b.model.state.result.model.n_features = 4; }],
  ['truncated coefficients', (b) => { b.model.state.result.model.coefficients.pop(); }],
  ['nonfinite coefficient', (b) => { b.model.state.result.model.coefficients[1] = Infinity; }],
  ['boolean coefficient', (b) => { b.model.state.result.model.coefficients[1] = true; }],
  ['nonfinite mean', (b) => { b.model.state.result.model.xMean[0] = NaN; }],
  ['wrong target mean', (b) => { b.model.state.result.model.yMean = []; }],
  ['wrong intercept', (b) => { b.model.state.result.model.intercept = [0, 1]; }],
  ['wrong model kind', (b) => { b.model.state.result.model.type = 'Ridge'; }],
  ['unsupported PLS parameters', (b) => { b.model.state.result.model.params = [1]; }],
  ['fractional components', (b) => { b.model.state.result.model.n_components = 1.5; }],
  ['excess components', (b) => { b.model.state.result.model.n_components = 4; }],
];
for (const [name, mutate] of mutations) {
  const bundle = structuredClone(own);
  mutate(bundle);
  await check(bundle, false, name);
}
for (const params of [[2, 1, 1, 4, 0], [3, 3, 1, 4, 0], [3, 2, 3, 4, 0], [3, 2, 1, 5, 0], [3, 2, 1, 4, Infinity]]) {
  const invalid = structuredClone(sg);
  invalid.model.state.result.preprocessing[0].params = params;
  await check(invalid, false, 'invalid SG domain');
}
for (const mode of [0, 1, 2, 3, 4]) {
  const invalid = structuredClone(sg);
  invalid.model.state.result.preprocessing[0].params = [5, 2, 1, mode, 0];
  await check(invalid, false, `SG window exceeds feature width in mode ${mode}`);
}
for (const backendId of ['js-pls', 'js-ridge']) {
  await check({ ...own, model: { ...own.model, state: { backendId } } }, false, `saved ${backendId} requires recalibration`);
}
assert.ok('error' in await importModelContainer(Uint8Array.of(123)));
// These physically valid Core containers exercise host declaration refusal.
for (const alter of [
  manifest => ({ ...manifest, entrypoints: manifest.entrypoints.map(entry => ({ ...entry, operation: 'other.predict' })) }),
  manifest => ({ ...manifest, artifacts: manifest.artifacts.map(artifact => ({ ...artifact, owner: 'other.host', identity: { ...artifact.identity, owner: 'other.host' } })) }),
]) {
  const payload = new TextEncoder().encode(JSON.stringify({ schema: QUALI_HOST.schema, schema_version: 1 }));
  const { archiveBytes } = await storage.writeN4aContainer(alter(qualiHostManifest(digest(payload))), [{ path: QUALI_HOST.path, bytes: payload }]);
  assert.ok('error' in await importModelContainer(archiveBytes));
  cases++;
}
const fixture = process.argv[2] ?? process.env.QUALI_MODEL_FIXTURE;
if (fixture) {
  // Root supplies an already-produced owner container. Loading/repackaging never fits.
  const bytes = new Uint8Array(await readFile(fixture)), before = digest(bytes);
  const opened = await storage.openN4aContainer(bytes);
  let original;
  try { original = JSON.parse(new TextDecoder().decode(await opened.readMember(QUALI_HOST.path))); }
  finally { opened.close(); }
  const imported = await importModelContainer(new Blob([bytes]));
  assert.ok('model' in imported, `real exported owner model reopens: ${imported.error ?? ''}`);
  assert.deepEqual(imported.model.model, original.model, 'reopening preserves every fitted-state value');
  assert.equal(imported.model.model.state.packageJson, original.model.state.packageJson, 'exact owner string');
  assert.deepEqual(imported.model.sourceBundle, original, 'all metadata and reports retained');
  assert.equal(imported.model.evaluationDeclaredOnly, true);
  const roundTrip = await importModelContainer(await exportModelContainer(imported.model.sourceBundle));
  assert.equal(roundTrip.model.model.state.packageJson, original.model.state.packageJson);
  assert.equal(digest(bytes), before);
  cases++;
} else console.log('SKIP existing-owner-container round trip: Root must provide QUALI_MODEL_FIXTURE; no fit is created by this gate.');
console.log(`${cases + 1} clean-V1 file-boundary cases passed.`);
} finally {
  try { await server?.close(); }
  finally { delete globalThis.__qualiModelImportNativeOwners; }
}
