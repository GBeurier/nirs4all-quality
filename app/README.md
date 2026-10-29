# quali-nirs4all — app

A guided, WASM-first "mini studio" for NIRS analysis labs, implementing the design in [`../DESIGN.md`](../DESIGN.md). Lab-technician–facing: sample triage, HPLC-selection, calibration, and prediction reliability — all behind a pedagogical, "pré-mâché" workflow.

## Status

**Typechecks + builds + WASM click-through smoke all green.** Serves all 7 screens, and the **WASM target really executes** — the Calibrate screen loads libn4m in the browser and runs a real PLS (verified end-to-end by `npm run smoke`, engine label `nirs4all-core-wasm`).

| Area | State |
|---|---|
| Lab data model (`src/domain/`) — §1bis | ✅ complete, strict-typed |
| Engine port + stub + Python client (`src/engine/`) | ✅ complete |
| **WASM target — real libn4m via the `nirs4all` portable pipeline** | ✅ **working** (bundles `n4m.wasm`; smoke passes) |
| App shell + workflow rail + 7 screens | ✅ building + serving |
| Reuse of `nirs4all-ui/lab` (decision contract, cards, worklist…) | ✅ via package export |
| Real dataset ingestion (upload → `nirs4all-io` WASM) | ⏳ next — Calibrate currently uses demo spectra |
| Native kernels (D-optimal, conformal, GMM, PDS) | ⏳ next — see DESIGN §8.3 |

## Architecture (thin shell)

```
UI (screens)  ──►  nirs4all-ui/lab             decision contract + lab view-models + components
   │
   ├──►  src/domain/*        lab data model (project/lot/sample/reference/status/audit) — §1bis
   └──►  src/engine/*        the LabEngine PORT (hexagonal seam)
                              ├─ wasmEngine    REAL libn4m PLS via the `nirs4all` portable pipeline (default)
                              ├─ stubEngine    deterministic null model (fallback / offline)
                              └─ pythonEngine  REST client over the nirs4all runtime  [anticipated]
```

*No numerics in this app.* All ML lives behind the port. The WASM target reuses the **`nirs4all` package's `runPortablePipeline` / `predictPortablePipeline`** (libn4m compiled to WASM), resolved through the same peer-package aliases studio-lite uses (`@nirs4all/methods-wasm` → the staged `n4m.wasm`). The Python target is a future backend implementing the same two-method contract.

## Commands

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"   # node is not on the default PATH here
npm install
npm run typecheck   # tsc --noEmit — green
npm run build       # vite build → dist/ (bundles n4m.wasm etc.) — green
npm run dev         # dev server
# WASM click-through smoke (needs Chrome): builds a model, asserts libn4m ran
npm run build && (npm run preview -- --port 4399 --strictPort & sleep 4 && npm run smoke)
```

## How the WASM target works (the reuse path)

The naive approach — importing studio-lite's `src/engine` by source — **fails**, because studio-lite's engine imports its own modules through *its* `@/` alias (→ its `src`), which collides with this app's `@/`. Instead, this app reuses the **clean, package-exported** surface of `nirs4all`:

- `package.json` depends on `nirs4all` (studio-lite's vendored aggregate).
- `vite.config.ts` aliases the optional peer WASM packages (`@nirs4all/methods-wasm`, `dag-ml-wasm`, …) to studio-lite's staged `src/engine/wasm/*` — exactly as studio-lite does.
- `wasmEngine.ts` lowers the app's `PipelineDSL` to a portable class-path source (`nirs4all.operators.transforms.StandardNormalVariate`, `sklearn.cross_decomposition.PLSRegression`, `nirs4all.operators.splitters.KennardStoneSplitter`) and calls `runPortablePipeline`.

**Scope of the portable path:** regression + PLS with SNV / Savitzky-Golay and a Kennard-Stone split (the design's MVP calibration). Broader coverage (CV/OOF, D-optimal, conformal) plugs in behind the same `LabEngine` port when the dag-ml scheduler path is wired (or the runtime is extracted to a shared package).

## Integration contract

The reusable `lab` domain is consumed through the public `nirs4all-ui/lab`
subpath export. The shared theme is imported through
`nirs4all-ui/assets/theme.css`, so this app no longer depends on
`nirs4all-ui/src/**` source aliases.

## Layout

```
src/
  domain/      lab data model (model.ts) + SampleStatus mirror
  engine/      port.ts (contract) · stubEngine · wasmEngine (deferred) · pythonEngine · index (factory)
  store/       React context/reducer over the domain + demo seed
  screens/     Projects · Setup · Health · SelectHplc · Calibrate · Predict · Maintenance
  app/         App shell + workflow rail
  ui/          host-provided icons for the nirs4all-ui/lab components
  styles/      theme (mirrors the nirs4all teal palette) + tailwind v4
```

## Scientific diagnostics and assessment reports

PCA plots and applicability references use the public libn4m `FlexiblePCA`
fit/transform API. A calibration reference is fitted only on referenced training
samples; routine or candidate rows are projected without refitting the reference.
The cold-start HPLC view explicitly uses the pool as its descriptive reference.
Hotelling T² and Q values and alpha=0.05 control limits come from the native
`HotellingT2` and `QResiduals` procedures. Unsupported populations are displayed
as unavailable, never as a clean diagnostic. Quality requires the fixed owner Methods **1.3.9 or later within major 1**,
with **ABI 2.20 or later within major 2**. Build admission and browser startup
query the loaded WASM version/ABI; the old 1.3.4 staging is refused. The
`methods-cohort.json` build receipt identifies the actual WASM/loader hashes.

Routine spectra are aligned with the native `Resampler` on physical wavelength
coordinates. Units must be explicit (`nm`, `um`/`µm`, `cm-1`), axes strictly
monotonic, and the source must cover the calibration range. Missing observations,
unknown/index units, duplicates and extrapolation are refused. The interpolation
coordinate is wavelength in nm after unit conversion.

Prediction bands are explicitly `heuristic_uncertainty_band`, with
`status=not_calibrated`, no nominal coverage, and the stated RMSEP/distance rule.
Missing RMSEP gives an unavailable band. These bands do not populate the shared
UI's calibrated conformal interval field and do not authorize a green release.
Y-reference density is descriptive, not conformal calibration.

Health and Predict optionally import an existing Preflight `QualificationReport`
with `schema_version: 1`, or an explicitly selected Domains report conforming to
that same contract. This display mode bypasses local scientific recomputation;
it preserves the original report, engine/protocol provenance, metric identity
(source/target/view/population/context/protocol), availability, evidence and
limitations. Imported data is not silently applied to a fitted model: users must
check its source and population identities. Additional versioned report fields
are preserved. The adapter has no runtime dependency on unpublished packages.

Local verification (Node 24):

```bash
npm ci
# Optional for isolated worktrees: point to the existing staged WASM directory.
export NIRS4ALL_WASM_ROOT=/absolute/path/nirs4all-web/web-app/src/engine/wasm
# Optional local owner build (not a published cohort):
# export NIRS4ALL_METHODS_WASM_ROOT=/absolute/path/nirs4all-methods/bindings/js/dist
npm run typecheck
npm run test:science
npm run test:model-import
npm run build
# Serve dist/ locally, then run both real-browser checks:
SMOKE_URL=http://localhost:4499 npm run smoke
SMOKE_URL=http://localhost:4499 node scripts/science-browser.mjs
```

## Methods delivery floor

The optional npm peer range records `@nirs4all/methods >=1.3.9 <2` in the
manifest and lock. Optional resolution permits the existing explicit staging
delivery; it does not waive the runtime requirement. Vite and scientific tests
check the actual staged WASM rather than an npm package label. Both Methods
aliases resolve to the same verified artifact.

Methods1.3.9 is currently an unpublished local candidate. For local
qualification, set `NIRS4ALL_WASM_ROOT` to the complete compatible WASM stage
and `NIRS4ALL_METHODS_WASM_ROOT` to that candidate's `bindings/js/dist`. The
owner candidate must be published and staged before a public Quality build
can satisfy this delivery floor. Local builds mark publication as unclaimed.

`npm run test:methods-cohort` checks admission of compatible versions and
refusal of the old ABI, missing identities and unqualified major versions.
The 19 real-WASM scientific tests require wide T²/Q availability in every
qualified run.
