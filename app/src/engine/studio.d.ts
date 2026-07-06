// (Obsolete) The WASM target no longer imports studio-lite's `@/`-aliased engine
// via `@studio`; it reuses the clean `nirs4all` package portable pipeline
// directly (see wasmEngine.ts). Kept as an empty module to avoid a dangling
// reference; safe to delete.
export {};
