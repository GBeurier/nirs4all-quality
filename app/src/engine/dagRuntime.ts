type Dag = typeof import('dag-ml-wasm');
let loaded: Promise<Dag> | undefined;

/** Load the root-staged owner once; no substitute backend. */
export function loadDag(): Promise<Dag> {
  loaded ??= (async () => {
    const dag = await import('dag-ml-wasm');
    await dag.default();
    if (typeof dag.execute_single_holdout_bank_json !== 'function'
        || typeof dag.score_regression_prediction_block_with_profile_json !== 'function') {
      throw new Error('The staged DAG runtime lacks the final holdout/report API. Stage the coordinated owner artifact.');
    }
    return dag;
  })();
  return loaded;
}
