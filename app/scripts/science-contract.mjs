import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { methodsRoot, qualifiedMethodsStage } from './methods-stage.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(resolve(root, '.science-test-'));
try {
  console.log('Qualified Methods:', JSON.stringify(await qualifiedMethodsStage()));
  const outfile = resolve(temp, 'contract.mjs');
  await build({ entryPoints: [resolve(root, 'tests/science.test.ts')], bundle: true, platform: 'node', target: 'node24', format: 'esm', outfile,
    alias: { '@': resolve(root, 'src') },
    plugins: [{ name: 'native-methods', setup(build) { build.onResolve({ filter: /^@nirs4all\/methods$/ }, () => ({ path: resolve(methodsRoot, 'index.js'), external: true })); } }],
  });
  const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }
