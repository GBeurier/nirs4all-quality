// Verify Root's explicit stage without installing/copying assets or running WASM.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The current receipts live beside Quali's private owner snapshot. Historical rollout
// stages and receipts remain unchanged as provenance, outside current admission.
const stageManifest = resolve(app, 'vendor/owners-current/IO_STAGE.json');
const companionDelivery = resolve(app, 'vendor/owners-current/IO_COMPANION.json');

// Exact local-unpublished IO0.3.2 browser build from source 6c1a256.
const EXPECTED_LOADER = '7dd87d55807f43b163cd017a48751cd56273b044bc731be137f1c9256dbee5f7';
const EXPECTED_WASM = '9bd041658f0cdb87042926e0ae608af6fc318568bc01d9c594ae33fd0d5f1012';
const EXPECTED_TYPES = '6d6f5a8c0f445e740c15f81e0c00298bfaa9915eba05a1a53b4a1b2bc35c91f5';
// Historical IO0.3 witnesses are refused, including the prior Setup stage (1e55dbf1...).
// That stage remains provenance only and is not reproducible through this current script.
const SUPERSEDED_WASM = [
  'b955facd114c3a6c7b7f991ade1fe5007bbfcd7d21adb5e71fa9376a32a432b6',
  '81915706a69ff10139434de9f0e4b02601f1bc58861bff2e71925bf45df7e347',
  '6808a164d291cd76219ffc5db7f0f74d4e1471e7de89c5358f68cf77dd74bbce',
  '1e55dbf1d42462e258804804178a45d57b0343d3e1c5586356766a80964422a3',
];

export function ioImportRoot() {
  const root = process.env.NIRS4ALL_IO_WASM_ROOT;
  if (!root) throw new Error('Setup IO import requires an explicit NIRS4ALL_IO_WASM_ROOT; Root owns the qualified stage.');
  return resolve(root);
}

async function verify(root, name, expected) {
  const bytes = await readFile(resolve(root, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!expected || sha256 !== expected) throw new Error(`IO import stage hash mismatch: ${name}`);
  return sha256;
}

/** Hash verification is not browser or scientific qualification. */
export async function qualifiedIOImportStage() {
  const root = ioImportRoot();
  const browserReceipt = process.env.NIRS4ALL_IO_BROWSER_RECEIPT || stageManifest;
  const companionReceipt = process.env.NIRS4ALL_IO_COMPANION_RECEIPT || companionDelivery;
  const browser = JSON.parse(await readFile(browserReceipt, 'utf8'));
  const companion = JSON.parse(await readFile(companionReceipt, 'utf8'));
  const browserHash = (path) => browser.files?.find((f) => f.path === path)?.sha256;
  const companionHash = (name) => companion.source_changes?.find((f) => f.path === `bindings/wasm/${name}`)?.sha256_after;
  if (SUPERSEDED_WASM.includes(browserHash('nirs4all_io_wasm_bg.wasm'))) {
    throw new Error('IO stage manifest names a superseded IO0.3 artifact (b955facd..., 81915706..., 6808a164... or 1e55dbf1...); stage the current cohort.');
  }
  if (browserHash('nirs4all_io_wasm.js') !== EXPECTED_LOADER
      || browserHash('nirs4all_io_wasm_bg.wasm') !== EXPECTED_WASM) {
    throw new Error('IO stage manifest differs from the pinned IO0.3.2 browser build; review the cohort before changing it.');
  }
  const loader_sha256 = await verify(root, 'nirs4all_io_wasm.js', browserHash('nirs4all_io_wasm.js'));
  const wasm_sha256 = await verify(root, 'nirs4all_io_wasm_bg.wasm', browserHash('nirs4all_io_wasm_bg.wasm'));
  // Pin the separately delivered owner companion; do not trust a stage label.
  const expectedCompanion = '82e35e14f51aa49f6ad2da382e26d080e7b4ec84b257b6cf77da52b5410d618b';
  const expectedDeclaration = '48a26a8d6754a59e3d074c3c52351970e3f5725f3991899913bf61810229c0b0';
  if (companionHash('numeric-wire.mjs') !== expectedCompanion || companionHash('numeric-wire.d.ts') !== expectedDeclaration) {
    throw new Error('IO companion delivery differs from the pinned handoff; review its API and hashes first.');
  }
  const companion_sha256 = await verify(root, 'numeric-wire.mjs', expectedCompanion);
  const companion_declaration_sha256 = await verify(root, 'numeric-wire.d.ts', expectedDeclaration);
  const expectedPublicDataset = 'ab29fc57e4e78e3c6b49bd3aae026d3f310750c974803b7fa00a44906f621981';
  const expectedPublicDatasetDeclaration = 'c5f53b89e2ceb21bc9aafe0d6ed8bd2f037eda58f1a36997ca895ec638c181a8';
  if (companionHash('public-dataset.mjs') !== expectedPublicDataset
      || companionHash('public-dataset.d.ts') !== expectedPublicDatasetDeclaration) {
    throw new Error('IO public dataset companion differs from the pinned owner delivery.');
  }
  await verify(root, 'public-dataset.mjs', expectedPublicDataset);
  await verify(root, 'public-dataset.d.ts', expectedPublicDatasetDeclaration);
  if (browserHash('types/nirs4all-io.d.ts') !== EXPECTED_TYPES) {
    throw new Error('IO stage manifest differs from the pinned public types.');
  }
  const public_types_sha256 = await verify(root, 'types/nirs4all-io.d.ts', EXPECTED_TYPES);
  return {
    schema_version: 1,
    status: 'HASH_VERIFIED_BROWSER_RUNTIME_UNQUALIFIED',
    owner: 'nirs4all-io',
    browser_receipt: browserReceipt,
    companion_receipt: companionReceipt,
    types_receipt: browserReceipt,
    loader_sha256, wasm_sha256, companion_sha256, companion_declaration_sha256, public_types_sha256,
    publication_claimed: false,
  };
}
