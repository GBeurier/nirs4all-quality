import init, * as io from '@quali/io-import-wasm';
import { errorMessage, runOwnerCycle, type ImportWorkerRequest, type ImportWorkerResponse } from './ioImport';

// Browser-target glue only. No idiomatic wrapper's Node default import.
let initialized: ReturnType<typeof init> | null = null;
self.onmessage = async (event: MessageEvent<ImportWorkerRequest>) => {
  const { id, record } = event.data;
  let result = record;
  try {
    initialized ??= init();
    await initialized;
    result = runOwnerCycle(io, record, __QUALI_IO_IMPORT_STAGE__);
  } catch (error) {
    result = {
      ...record, stage: __QUALI_IO_IMPORT_STAGE__, status: 'refused', assembled: null, validationSucceeded: false,
      diagnostics: [{ phase: 'runtime', message: errorMessage(error) }],
    };
  }
  const response: ImportWorkerResponse = { id, record: result };
  // Structured clone preserves bytes, typed arrays, NaNs and unknown owner fields.
  self.postMessage(response);
};
