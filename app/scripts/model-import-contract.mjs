// Exercise the production importer without loading a browser or fitting a model.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/modelIo.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { parseModelBundle } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
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
function check(bundle, accepted, name) {
  const result = parseModelBundle(JSON.stringify(bundle));
  assert.equal('model' in result, accepted, name);
  cases += 1;
}
check(own, true, 'own portable PLS');
const snv = structuredClone(own);
snv.model.state.result.preprocessing = [{ type: 'StandardNormalVariate', params: [] }];
check(snv, true, 'own SNV portable PLS');
const sg = structuredClone(own);
sg.model.state.result.preprocessing = [{ type: 'SavitzkyGolay', params: [3, 2, 1, 4, 0] }];
check(sg, true, 'own SG portable PLS');
const intercept = structuredClone(own);
intercept.model.state.result.model.intercept = [2];
check(intercept, true, 'finite intercept');
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
  ['fractional components', (b) => { b.model.state.result.model.n_components = 1.5; }],
  ['excess components', (b) => { b.model.state.result.model.n_components = 4; }],
];
for (const [name, mutate] of mutations) {
  const bundle = structuredClone(own);
  mutate(bundle);
  check(bundle, false, name);
}
for (const params of [[2, 1, 1, 4, 0], [3, 3, 1, 4, 0], [3, 2, 3, 4, 0], [3, 2, 1, 5, 0], [3, 2, 1, 4, Infinity]]) {
  const invalid = structuredClone(sg);
  invalid.model.state.result.preprocessing[0].params = params;
  check(invalid, false, 'invalid SG domain');
}
for (const mode of [0, 1, 2, 3, 4]) {
  const invalid = structuredClone(sg);
  invalid.model.state.result.preprocessing[0].params = [5, 2, 1, mode, 0];
  check(invalid, false, `SG window exceeds feature width in mode ${mode}`);
}
for (const backendId of ['js-pls', 'js-ridge']) {
  check({ ...own, model: { ...own.model, state: { backendId } } }, true, `existing ${backendId} route unchanged`);
}
assert.ok('error' in parseModelBundle('{'));
if (process.argv[2]) {
  const exported = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const imported = parseModelBundle(JSON.stringify(exported));
  assert.ok('model' in imported, 'real exported portable model reopens');
  assert.deepEqual(imported.model.model, exported.model, 'reopening preserves every fitted-state value');
  cases += 1;
}
console.log(`${cases + 1} importer contract cases passed.`);
