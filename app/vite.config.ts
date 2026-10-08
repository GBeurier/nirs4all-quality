import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

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
//                    engine falls back to the stub (the app still fully renders).
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const staged = (p: string) => abs(`../../nirs4all-web/web-app/src/engine/wasm/${p}`);

export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    resolve: {
      alias: [
        { find: '@', replacement: abs('./src') },
        { find: '@nirs4all/methods', replacement: staged('methods/index.js') },
        { find: '@nirs4all/methods-wasm', replacement: staged('methods/index.js') },
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
