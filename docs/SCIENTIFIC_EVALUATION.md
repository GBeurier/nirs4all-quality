# Calibration evaluation contract

Quali's current calibration screen uses a Kennard–Stone hold-out to select
preprocessing chains and the model parameter (PLS components or Ridge alpha)
within each profile. Its scores are **selection validation** scores, not an independent estimate of prediction error. An independent outer
evaluation is not implemented in this profile. Selecting a deployment model
does not qualify routine use.

`RunResult.evaluation` accompanies scores through profile results, the active
model, the Quali host `.n4a` export/import and prediction display. Prediction CSV
exports include `evaluation_scope` and `independent_test`. Current owner runs set
`scope: selection_validation` and `independent_test: false` explicitly. The owner
regression report and `RunResult.population` retain the selected variant, fold,
metric profile and separate training/validation sample identities. Older saved
results without metadata display an unavailable scope; their scores imply no
independent test.

DAG-ML owns each ordered bank's generation, execution, native regression scoring
and sole selection decision through `execute_single_holdout_bank_json`. Its
Methods controller calls numerical roles for preprocessing and fitting. Quali
consumes the owner's ranking within each profile. Completed profiles appear in
catalog order with their own populations; the operator explicitly chooses one
to activate. Launching calibration does not automatically deploy a profile or
rank profiles against each other.

Calibration requires at least eight labelled rows with finite spectra and
targets. Splits must have at least two disjoint rows on each side. Tiny datasets
and upstream resubstitution are refused. Original sample identities are retained
for raw replicates. Repeated samples are refused because the current profile has
no group-aware splitter; use one mean spectrum per sample instead.

PLS banks support parameter-free SNV and Savitzky–Golay under the admitted
WASM parameter contract. Unsupported operations and parameters, including MSC
and detrending in the extended PLS catalog, are refused before owner execution.
Ridge banks lower identity, SNV, shrinking first/second differences and linear
index detrending to Methods roles, with positive finite alpha candidates.
The historical `js_ridge_screen` token is bank data; execution uses DAG/Methods.
Candidate refusals and runtime failures retain their backend and are exported
with the model. Individual chain failures remain visible without discarding
other completed chains; complete profile failures appear in calibration.
There is no production JS fallback. Historical Core-JS/JS implementations are
test-only references, and the demonstration engine refuses calibration and
prediction.

The two deployment scopes are explicit:

- PLS uses Methods' KS fractional split (`test_size: 0.25`). Its selected REFIT
  package fits only the KS training rows, in the selected training order. The
  adapter requires its validation replay to match the selected FIT_CV values
  exactly; it does not refit PLS on all labelled rows.
- Ridge uses Methods' counted KS role with
  `n_train = max(2, round(0.75 * n))`. Selection gathers training rows in
  materialized row order. The selected pipeline is then fitted on all labelled
  rows, also in materialized row order, for deployment. Reported performance
  remains the bank holdout's selection validation; deployment resubstitution
  is not reported as validation.

These profiles can have different holdout memberships and counts. Neither scope
provides an independent outer test. Preprocessing and model fitting during bank
execution use the training scope supplied by DAG; prediction replays fitted
owner state without fitting.

Routine predictions carry the same evaluation context. Without independent
evaluation they cannot receive a green reliable verdict. Their displayed bands
are heuristics derived from score RMSE and spectral distance, not calibrated
prediction intervals. Clear domain alerts alone do not qualify routine use.
Imported evaluation claims are preserved with `evaluationDeclaredOnly: true`;
an imported declaration of an independent test cannot itself qualify routine use.

Model files use Core V1 storage for the Quali host profile: artifact owner
`nirs4all.quali-host`, feature `nirs4all-quali-host@1`, schema
`nirs4all.quali-host.bundle` version 1, member `host/bundle.json` and
`host.predict` entrypoint operation. Core handles the container and inventory;
Quali admits the finite host profile and DAG validates its owner REFIT package.
The exact `packageJson` string, selected profile, population, reports, evaluation
and failure provenance survive storage. This storage profile does not imply
native Core execution of arbitrary readable containers.

Legacy raw JSON, Core-JS portable PLS and JS PLS/Ridge states are refused and
require recalibration; their originals remain unchanged. Production prediction
accepts `dag-ml-methods-pls` and `dag-ml-methods-ridge` and uses DAG replay with the
Methods controller. Known references are scored by the native DAG report API
using explicit sample identities; absent references remain unscored.

Run from `app/` with Node 24, installed dependencies and the current owner
snapshot already supplied. Methods must be `>=1.3.15 <2` with ABI `>=2.22 <3`.
The following commands are verification entrypoints, not recorded passing results:

```sh
export NIRS4ALL_WASM_ROOT="$PWD/vendor/owners-current/wasm"
export NIRS4ALL_IO_WASM_ROOT="$NIRS4ALL_WASM_ROOT/io"
unset NIRS4ALL_METHODS_WASM_ROOT
export QUALI_MODEL_FIXTURE=/absolute/path/already-produced-qualified-model.n4a
npm run typecheck
npm run test:science
QUALI_MODEL_FIXTURE="$QUALI_MODEL_FIXTURE" npm run test:model-import
npm run build
npm run preview -- --host 127.0.0.1 --port 4399 --strictPort
# In a second terminal, with the same stage and existing fixture environment:
SMOKE_MODEL="$QUALI_MODEL_FIXTURE" SMOKE_URL=http://localhost:4399/ npm run smoke
```

`test:science` includes the named pre-migration regressions under
`src/engine/testing/oracle/`; their mocked Core DTO and MSC training-only fixtures
qualify that historical reference, not a production fallback. Current production
parity gates are `scripts/scientific-migration-parity.test.mjs` (PLS, requiring the
explicit frozen Core/Methods oracle roots) and `scripts/ridge-owner-parity.test.mjs`
(Ridge). Their deterministic fixtures exercise actual staged owner banks, REFIT
and replay; runtime qualification must record the exact artifacts and outcomes.

The importer gate uses an already-produced `QUALI_MODEL_FIXTURE` (or its first
argument) for its positive owner-container round trip; without one it reports
that case as skipped. The browser smoke requires `SMOKE_MODEL` from an existing
qualified Quali owner container. It uses real Core storage to repackage the host
payload, preserves the exact DAG package string and replays it in the browser,
checking selection labels, heuristic uncertainty, declared-only evaluation and
legacy/unavailable-runtime refusals. It never requests calibration or creates
its own training fixture. Optional `SMOKE_EXPORT` exclusively creates a new
container path distinct from `SMOKE_MODEL`; the source container stays unchanged.
