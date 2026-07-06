import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// quali-nirs4all — thin-shell WASM app.
//
// The WASM target reuses the `nirs4all` package's portable pipeline (libn4m).
// That package resolves its numeric engines through OPTIONAL peer packages
// (`@nirs4all/methods-wasm`, `dag-ml-wasm`, …); we alias those to studio-lite's
// staged WASM builds — exactly as studio-lite does — so no WASM is re-staged here.
//
// Two build modes:
//   default        → served static site (lazy WASM)          → dist/
//   `singlefile`   → one self-contained HTML (JS+CSS+WASM inlined, base64) → dist-single/
//                    Portable/offline; under file:// the WASM may not run, so the
//                    engine falls back to the stub (the app still fully renders).
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const staged = (p: string) => abs(`../../nirs4all-web/studio-lite/src/engine/wasm/${p}`);

export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  return {
    base: './',
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    resolve: {
      alias: {
        '@': abs('./src'),
        '@lab': abs('../../nirs4all-ui/src/lab/index.ts'),
        '@nirs4all/methods-wasm': staged('methods/index.js'),
        '@nirs4all/formats-wasm': staged('formats/nirs4all_formats_wasm.js'),
        '@nirs4all/io-wasm': staged('io/nirs4all_io_wasm.js'),
        '@nirs4all/datasets-wasm': staged('datasets/nirs4all_datasets_wasm.js'),
        'nirs4all-formats-wasm': staged('formats/nirs4all_formats_wasm.js'),
        'nirs4all-io-wasm': staged('io/nirs4all_io_wasm.js'),
        'dag-ml-wasm': staged('dagml/dag_ml_wasm.js'),
        'dag-ml-data-wasm': staged('dagml-data/dag_ml_data_wasm.js'),
      },
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
