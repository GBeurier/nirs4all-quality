# Calibration evaluation contract

Quali's current calibration screen uses a Kennard–Stone hold-out to select
components, preprocessing and pipelines. Its scores are **selection validation**
scores, not an independent estimate of prediction error. An independent outer
evaluation is not implemented in this profile. Selecting a deployment model
does not qualify routine use.

`RunResult.evaluation` accompanies scores through the leaderboard, active model,
model JSON export/import and prediction display. Prediction CSV exports include
`evaluation_scope` and `independent_test`. Core's evaluation object is retained
when present, as in the pinned npm Core 0.4.6 runner. If an older runtime omits
the object, the adapter assigns `selection_validation` with `independent_test:
false`. Older saved models
without metadata display an unavailable evaluation scope; no independent test is
inferred from their scores.

Calibration requires at least eight labelled rows with finite spectra and
targets. Splits must have at least two disjoint rows on each side. Tiny datasets
and upstream resubstitution are refused. Original sample identities are retained
for raw replicates. Repeated samples are refused because the current profile has
no group-aware splitter; use one mean spectrum per sample instead.

The WASM adapter supports SNV without parameters and Savitzky–Golay, and refuses
unsupported operations and parameters before calling Core. Refused screen
candidates remain visible in result details. The JS PLS fallback supports SNV,
MSC, linear detrending and Savitzky–Golay with nearest edge padding. It refuses
unknown operations, quadratic detrending, unsupported parameters, multiple MSC
steps and calibration with the preview-only StandardScaler. The engine label
identifies JS fallback results separately from Core WASM results. Catalog SG
steps set `mode: nearest` explicitly for both backends. Unsupported quadratic
detrending is absent from the catalog. Candidate refusals and runtime failures
are recorded with their backend and exported with the model; individual failures
do not abort the rest of a screen. Complete pipeline failures are shown in the
calibration screen. The demonstration engine refuses calibration and prediction.

Routine predictions carry the same evaluation context. Without independent
evaluation they cannot receive a green reliable verdict. Their displayed bands
are heuristics derived from score RMSE and spectral distance, not calibrated
prediction intervals. Clear domain alerts alone do not qualify routine use.
Imported evaluation claims are preserved with `evaluationDeclaredOnly: true`;
an imported declaration of an independent test cannot itself qualify routine use.
The importer supports both the older baseline PLS shape and Core 0.4.5's explicit
empty PLS parameter and stateless SNV/SG state vectors. Nonempty unsupported
parameters or learned state remain refused.

In the fallback, MSC fits its reference on training rows only. Validation and
prediction replay fitted references. The deployment model is fitted separately
on all calibration rows and captures its own reference; this refit does not
change selection scores. Prediction with missing MSC state is refused.

Run from `app/` with a supported Node version:

```sh
npm run typecheck
npm run test:science
npm run test:model-import
npm run build
npm run preview -- --host 127.0.0.1 --port 4399 --strictPort
# In a second terminal:
npm run smoke
```

Scientific regression fixtures are synthetic and deterministic. They exercise
production TypeScript and replace only the external Core call to test its DTO
boundary. The MSC fixture distinguishes training-only fitting from the former
transform-before-split behavior. The browser smoke executes the installed Core
and staged Methods WASM, checks score labels and downloads a real model export
to verify evaluation metadata.
