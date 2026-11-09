import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { methodsRoot, qualifiedMethodsStage } from './scripts/methods-stage.mjs';
import { ioImportRoot, qualifiedIOImportStage } from './scripts/io-stage.mjs';

// quali-nirs4all — thin-shell WASM app.
//
// The WASM target reuses the `nirs4all` package's portable pipeline (libn4m).
// That package resolves its numeric engines through OPTIONAL peer packages
// (`@nirs4all/methods`, `dag-ml-wasm`, …); we alias those to nirs4all-web's
// current staged WASM builds, so no WASM is re-staged here.
//
// Two build modes:
//   default        → served static site (lazy WASM)          → dist/
//   `singlefile`   → one self-contained HTML (JS+CSS+WASM inlined, base64) → dist-single/
//                    Portable/offline; under file:// the WASM may not run, so the
//                    scientific execution is refused if the runtime cannot load.
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const staged = (p: string) => process.env.NIRS4ALL_WASM_ROOT ? resolve(process.env.NIRS4ALL_WASM_ROOT, p) : abs(`../../nirs4all-web/web-app/src/engine/wasm/${p}`);

export default defineConfig(async ({ mode }) => {
  const single = mode === 'singlefile';
  const methodsCohort = await qualifiedMethodsStage();
  const ioStage = await qualifiedIOImportStage();
  const importRoot = ioImportRoot();
  return {
    base: './',
    define: { __QUALI_IO_IMPORT_STAGE__: JSON.stringify(ioStage) },
    plugins: [react(), tailwindcss(), {
      name: 'qualified-methods-cohort',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'methods-cohort.json', source: JSON.stringify(methodsCohort, null, 2) }); },
    }, {
      name: 'io-import-stage',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'io-import-stage.json', source: JSON.stringify(ioStage, null, 2) }); },
    }, ...(single ? [viteSingleFile()] : [])],
    resolve: {
      alias: [
        { find: '@', replacement: abs('./src') },
        { find: /^@quali\/io-import-wasm$/, replacement: resolve(importRoot, 'nirs4all_io_wasm.js') },
        { find: /^@quali\/io-import-numeric$/, replacement: resolve(importRoot, 'numeric-wire.mjs') },
        { find: '@nirs4all/methods', replacement: resolve(methodsRoot, 'index.js') },
        { find: '@nirs4all/methods-wasm', replacement: resolve(methodsRoot, 'index.js') },
        { find: '@nirs4all/formats-wasm', replacement: staged('formats/nirs4all_formats_wasm.js') },
        { find: /^@nirs4all\/io-wasm$/, replacement: staged('io/nirs4all_io_wasm.js') },
        { find: /^@nirs4all\/io-wasm\/public-dataset$/, replacement: staged('io/public-dataset.mjs') },
        { find: '@nirs4all/datasets-wasm', replacement: staged('datasets/nirs4all_datasets_wasm.js') },
        { find: 'nirs4all-formats-wasm', replacement: staged('formats/nirs4all_formats_wasm.js') },
        { find: 'nirs4all-io-wasm', replacement: staged('io/nirs4all_io_wasm.js') },
        { find: /^dag-ml-wasm$/, replacement: staged('dagml/dag_ml_wasm.js') },
        { find: /^dag-ml-wasm\/n4m-optimizer$/, replacement: staged('dagml/n4m_hpo_optimizer.mjs') },
        { find: /^dag-ml-wasm\/n4m-controller$/, replacement: staged('dagml/n4m_controller.mjs') },
        { find: /^dag-ml-wasm\/n4m-estimator-controller$/, replacement: staged('dagml/n4m_estimator_controller.mjs') },
        { find: /^dag-ml-wasm\/multimodal_dataset_replay\.mjs$/, replacement: staged('dagml/multimodal_dataset_replay.mjs') },
        { find: 'dag-ml-data-wasm', replacement: staged('dagml-data/dag_ml_data_wasm.js') },
      ],
    },
    worker: { format: 'es' },
    assetsInclude: ['**/*.wasm'],
    ssr: { noExternal: ['nirs4all'] },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 8192,
      outDir: single ? 'dist-single' : 'dist',
    },
  };
});
