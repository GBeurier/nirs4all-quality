import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertMethodsRuntime, METHODS_MINIMUM_VERSION } from '../src/engine/methodsCohort.ts';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const wasmRoot = process.env.NIRS4ALL_WASM_ROOT || resolve(app, '../../nirs4all-web/web-app/src/engine/wasm');
export const methodsRoot = process.env.NIRS4ALL_METHODS_WASM_ROOT || resolve(wasmRoot, 'methods');

/** Check the actual loaded binary, rather than trusting a package label or cache path. */
export async function qualifiedMethodsStage() {
  const methods = await import(pathToFileURL(resolve(methodsRoot, 'index.js')).href);
  await methods.loadModule();
  const version = methods.version();
  const abi = [...methods.abiVersion()];
  assertMethodsRuntime(version, abi);
  const sha256 = async name => createHash('sha256').update(await readFile(resolve(methodsRoot, name))).digest('hex');
  return {
    schema_version: 1,
    package: '@nirs4all/methods',
    minimum_version: METHODS_MINIMUM_VERSION,
    runtime_version: version,
    abi,
    delivery: process.env.NIRS4ALL_METHODS_WASM_ROOT ? 'local_source_override' : 'staged_artifact',
    wasm_sha256: await sha256('n4m.wasm'),
    loader_sha256: await sha256('n4m.js'),
    publication_claimed: false,
  };
}
