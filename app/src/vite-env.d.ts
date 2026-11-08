/// <reference types="vite/client" />

declare const __QUALI_IO_IMPORT_STAGE__: import('./lib/ioImport').ImportStage;

// Dedicated browser-glue boundary; owner declarations stay in IO.
declare module '@quali/io-import-wasm' {
  export default function init(): Promise<unknown>;
  export const version: import('./lib/ioImport').ImportOwner['version'];
  export const proposeDataset: import('./lib/ioImport').ImportOwner['proposeDataset'];
  export const validate: import('./lib/ioImport').ImportOwner['validate'];
  export const assembleDataset: import('./lib/ioImport').ImportOwner['assembleDataset'];
}

declare module '@quali/io-import-numeric' {
  export const numericCoordinates: typeof import('../../../nirs4all-io/bindings/wasm/numeric-wire')['numericCoordinates'];
}
