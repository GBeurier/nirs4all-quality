import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(resolve(root, '.assessment-test-'));
try {
  const outfile = resolve(temp, 'contract.mjs');
  await build({ entryPoints:[resolve(root,'tests/sharedAssessment.test.ts')], bundle:true, platform:'node', target:'node24', format:'esm', outfile });
  const result = spawnSync(process.execPath,['--test',outfile],{stdio:'inherit'});
  process.exitCode=result.status??1;
} finally { await rm(temp,{recursive:true,force:true}); }
