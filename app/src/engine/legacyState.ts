/** Clean V1 refuses retired execution states without changing their originals. */
export function refuseLegacyState(backend: unknown): void {
  const kind = backend === 'nirs4all-core-wasm' ? 'Core-JS portable PLS'
    : backend === 'js-pls' ? 'JS PLS' : backend === 'js-ridge' ? 'JS Ridge' : null;
  if (kind) throw new Error(`Legacy ${kind} state: this version cannot replay it. Recalibrate; your original file is unchanged.`);
}
