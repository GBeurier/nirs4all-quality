# quali-nirs4all — app

A guided, WASM-first "mini studio" for NIRS analysis labs, implementing the design in [`../DESIGN.md`](../DESIGN.md). Lab-technician–facing: sample triage, HPLC-selection, calibration, and prediction reliability — all behind a pedagogical, "pré-mâché" workflow.

## Status

The current source routes PLS and Ridge calibration and prediction through
**DAG-ML + Methods WASM**, with Core providing `.n4a` storage. Completed profiles
retain selection-validation scores and their populations; the operator explicitly
chooses a profile to activate. `npm run smoke` replays an already-produced owner
model; it does not train. Qualification results must identify the exact staged
artifacts and checks executed.

| Area | State |
|---|---|
| Lab data model (`src/domain/`) — §1bis | ✅ complete, strict-typed |
| Engine port + stub + Python client (`src/engine/`) | WASM default; stub refuses scientific execution; Python client anticipates a separate service |
| **WASM target — DAG-ML scheduling + Methods numerical roles** | PLS and Ridge banks, selected REFIT packages and prediction replay |
| App shell + workflow rail + 7 screens | ✅ building + serving |
| Reuse of `nirs4all-ui/lab` (decision contract, cards, worklist…) | ✅ via package export |
| Real dataset ingestion (upload → `nirs4all-io` WASM) | Setup uses the explicitly staged IO import/review path; calibration uses labelled project spectra |
| Native kernels (D-optimal, conformal, GMM, PDS) | ⏳ next — see DESIGN §8.3 |

## Architecture (thin shell)

```
UI (screens)  ──►  nirs4all-ui/lab             decision contract + lab view-models + components
   │
   ├──►  src/domain/*        lab data model (project/lot/sample/reference/status/audit) — §1bis
   └──►  src/engine/*        the LabEngine PORT (hexagonal seam)
                              ├─ wasmEngine    DAG-ML + Methods PLS/Ridge banks and replay (default)
                              ├─ stubEngine    diagnostic target; calibration and prediction are refused
                              └─ pythonEngine  REST client over the nirs4all runtime  [anticipated]
```

`wasmEngine.ts` delegates production execution to `dagEngine.ts`. DAG-ML owns
candidate generation, holdout execution, scoring and selection; its Methods
controller calls native numerical roles. Prediction replays the selected owner
package. Run labels are `dag-ml-methods-pls` and `dag-ml-methods-ridge`.
Historical Core-JS and JS models require recalibration; their reference
implementations remain test-only. Core's `nirs4all` package supplies storage.
See [the evaluation contract](../docs/SCIENTIFIC_EVALUATION.md). The Python client
anticipates a separately supplied service behind the engine port.

## Commands

From `app/`, with Node 24 and dependencies already available, select the current
private owner snapshot explicitly. Setup also requires its separate IO path:

```bash
export NIRS4ALL_WASM_ROOT="$PWD/vendor/owners-current/wasm"
export NIRS4ALL_IO_WASM_ROOT="$NIRS4ALL_WASM_ROOT/io"
unset NIRS4ALL_METHODS_WASM_ROOT   # use Methods from the same stage
npm run typecheck
npm run build       # vite build → dist/
npm run dev
```

For the existing fixture checks, serve the already-built `dist/` in one terminal:

```bash
npm run preview -- --host 127.0.0.1 --port 4399 --strictPort
```

In a second terminal, from `app/`, reuse the same stage environment and supply an
already-produced qualified Quali owner container from the pooled owner gates:

```bash
export QUALI_MODEL_FIXTURE=/absolute/path/already-produced-qualified-model.n4a
QUALI_MODEL_FIXTURE="$QUALI_MODEL_FIXTURE" npm run test:model-import
SMOKE_MODEL="$QUALI_MODEL_FIXTURE" SMOKE_URL=http://localhost:4399/ npm run smoke
```

The importer accepts the fixture as its first argument or `QUALI_MODEL_FIXTURE`;
without either it explicitly skips the positive existing-container round trip.
The browser smoke requires `SMOKE_MODEL`, uses Chrome (`CHROME` overrides
`/usr/bin/google-chrome`), and performs storage/replay checks without fitting.
Optional `SMOKE_EXPORT` must name a new output file distinct from `SMOKE_MODEL`.
Neither command produces its own training fixture.

## How the WASM target works (the reuse path)

- `package.json` consumes Core through `file:vendor/owners-current/core` for
  `openN4aContainer` / `writeN4aContainer`; this is the current owner snapshot.
- `vite.config.ts` resolves staged DAG-ML, its Methods controller, DMD and the
  other owner modules through `NIRS4ALL_WASM_ROOT`. Both Methods aliases resolve
  to the same admitted artifact. Without an explicit root, the existing default
  is the active `nirs4all-web/web-app/src/engine/wasm` stage.
- `ownerRecipes.ts` and `ownerRidgeBanks.ts` lower finite ordered banks to Methods
  roles. DAG's `execute_single_holdout_bank_json` expands each bank, produces
  native regression reports and makes its sole selection decision. The host
  displays that ranking within the profile; completed profiles remain in catalog
  order and are activated manually, without an inter-profile score ranking.
- PLS exports a selected REFIT package fitted on KS training rows. Ridge exports
  its selected REFIT package fitted on all labelled rows. Both retain the bank's
  selection-validation scores; deployment refitting supplies no independent test.
- `.n4a` exports use Core V1 storage for the Quali host profile
  `nirs4all.quali-host.bundle` version 1 in `host/bundle.json`, preserving the exact
  DAG `packageJson` string and owner reports. Quali admits that profile before
  DAG/Methods replay; generic container readability does not grant execution.

This calibration profile supports regression with a single KS selection holdout,
not independent outer evaluation or CV/OOF qualification. Unsupported candidates
and runtime failures remain explicit; missing owner capabilities do not select a
JS substitute.

## Integration contract

The reusable `lab` domain is consumed through the public `nirs4all-ui/lab`
subpath export. The shared theme is imported through
`nirs4all-ui/assets/theme.css`, so this app no longer depends on
`nirs4all-ui/src/**` source aliases.

## Layout

```
src/
  domain/      lab data model (model.ts) + SampleStatus mirror
  engine/      port.ts · wasmEngine/dagEngine · owner banks/reports/replay · stubEngine · pythonEngine · index
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
as unavailable, never as a clean diagnostic. Quality requires the fixed owner Methods **1.3.15 or later within major 1**,
with **ABI 2.22 or later within major 2**. Build admission and the first Methods load
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

Health and Predict import the owner's actual Preflight Assessment string-schema `"1"`
and separate projected Findings JSON, alongside legacy integer-schema1 native reports.
The native Domains canonical.v0.2/v0.3 Report has its own adapter: its task/fit hashes,
train/evaluation observations and content version retain their original meanings.
There is no Domains numerical engine in this application. See
[the wire and comparison contract](../docs/SHARED_ASSESSMENT.md).

Imports retain raw reports, native parameters/denominators, availability and evidence.
An independent expected context manifest can bind a Preflight Assessment to declared
data/source/populations. Reports remain external until that check; this check does
not authenticate a producer or authorize a model reliability verdict. Comparisons
require identical contexts, reference/evaluation populations and metric parameters.
Missing references, unavailable values and unresolved evidence remain explicit N/A.

Local verification commands (Node 24; record outcomes for the exact stage):

```bash
# After selecting the stage and existing model fixture as above:
npm run typecheck
npm run test:assessment
npm run test:methods-cohort
npm run test:science
QUALI_MODEL_FIXTURE="$QUALI_MODEL_FIXTURE" npm run test:model-import
npm run build
# Against the already-served dist/:
SMOKE_MODEL="$QUALI_MODEL_FIXTURE" SMOKE_URL=http://localhost:4399/ npm run smoke
SMOKE_URL=http://localhost:4399/ npm run test:assessment-browser
```

`test:science` retains the named historical regressions; it is not the current
owner migration/parity gate. `scripts/science-browser.mjs` still assumes the old
engine label and automatic model activation and is not the current replay smoke.

## Optional private server workspaces

The **Optional server workspace** panel connects only after an explicit operator
action. Enter an HTTPS server URL (loopback HTTP is admitted for qualification)
and a project token. The token field clears immediately; the client and verified
principal stay in memory only. The panel displays the server-verified project,
principal, services and rights. Disconnect aborts requests and fences late
callbacks. Opaque `file://` origins retain local functionality and refuse server
connection; an HTTP(S) origin must be explicitly admitted by the server's CORS
configuration.

Choose one local project, workspace ID and name. By default, **Save workspace**
uploads only its description, crop, preprocessing preview and repetition mode.
It excludes dataset arrays, original sources, split identities, audit and fitted
state. The optional data checkbox includes the exact selected project's samples,
spectra, immutable audit history, retained IO owner objects and source files.
An explicit consent checkbox is required before any such upload. Other projects,
the user account, the setup draft and calibration handles are excluded.

An active model may be explicitly excluded while saving project data; saving
does not change that local model. Alternatively, **Include the active fitted
model** uses the existing qualified `modelIo` export/import route. Supported
PLS/Ridge states contain no training rows, but the transfer includes fitted
weights, training identities, graph, parameters and owner reports. The complete
current calibration export payload is shared with the local model download;
imported models retain their original container Blob and source bundle for exact
resave. Unsupported/missing model export provenance refuses before upload. No
training, selection or evaluation is performed during workspace storage.

Core writes a V1 `.n4a` attachment with owner/content type
`nirs4all.quali.workspace`, version 1, feature `nirs4all-quali-workspace@1` and
`workspace/state.json`. The shared browser-state codec preserves typed-array
bytes, nonfinite values, negative zero, masks, File/Blob metadata and retained
owner provenance; no host ZIP parser or numerical/data-assembly substitute is
used. An optional model remains its exact existing owner `.n4a` Blob inside the
attachment. The server workspace JSON contains only app/schema metadata and the
archive reference. This host storage profile makes no cross-host execution or
scientific qualification claim.

Refresh lists the verified server project's workspaces. **Open** reads the latest
revision, validates Core inventory and host profile, admits any included model
through its existing owner route, then asks before adding/replacing the target
local project and activating that included model. The Core container SHA-256 is
compared to the selected server artifact reference before reading host members.
The opening confirmation explicitly discloses that project data and retained
source files enter local IndexedDB and remain after the page closes, and asks
consent before applying them. Model/calibration handles and the retained model
archive stay in memory only and are excluded from local persistence. Other projects and prior
immutable audit records remain intact; conflicting audit identities refuse the
operation. Imported evaluation remains declared-only. Settings imports preserve
existing dataset/source provenance, while changed model inputs invalidate the
ephemeral predictor as local controls do. Data imports clear ephemeral
calibration and restore a model only when explicitly included and confirmed.
Revision compare-and-swap conflicts preserve local work and require explicit
open/reload or a new workspace ID; no silent overwrite occurs.

The coordinated source batch uses private browser-client candidate
`@nirs4all/server-client@0.1.0-local.20261113.2` from
`vendor/npm/nirs4all-server-client-0.1.0-local.20261113.2.tgz`, with identical
tarball bytes staged in Web and Quali. This is a local delivery, not a registry
release. Core remains the pinned `file:vendor/owners-current/core` dependency;
the WASM owners are the explicitly selected `vendor/owners-current/wasm` cohort.
Use `npm ci` with the checked-in lockfile; preserve the exact local owner and client pins.

```bash
npm ci
# Add --offline only when all locked packages are already cached.
```

The tracked .npmrc (install-links=true) copies the staged local file dependencies.
Runtime admission remains in force: the build and first Methods load inspect the
actual version/ABI, and owner operations refuse unsupported profiles. Do not
replace the pinned cohort with unrelated packages based only on matching labels.

After installing this staged candidate, run `npm run test:server-workspace`, the existing
model-import gate with an already-produced `QUALI_MODEL_FIXTURE`, typecheck and
the affected served/offline builds. The workspace test uses real Core storage
with synthetic host data (not an IO qualification claim). Real-server browser
qualification must also compare restored IDs, binary data and provenance in a
fresh browser context, exercise consent/conflicts/wrong projects/disconnect, and
check that no token enters browser persistence or artifacts. No command in this
paragraph is a recorded passing check.

## Methods delivery floor

The optional npm peer range records `@nirs4all/methods >=1.3.15 <2` in the
manifest and lock. Optional resolution permits explicit staging delivery; it
does not waive runtime admission. Builds and the first Methods load check the actual
WASM version and ABI (`>=2.22 <3`), rather than an npm label. Both Methods aliases
resolve to the same verified artifact.

The current private snapshot is recorded in `vendor/owners-current/DELIVERY.json`:
Core 0.5.0, Methods 1.3.15, DAG 0.4.0, DMD 0.2.16, Formats 0.2.14, IO 0.3.0 and
Datasets 0.3.18 are its package metadata. That receipt describes staged bytes and
explicitly claims neither publication nor runtime qualification. Package versions
alone do not identify a qualified cohort; retain the receipt and exact hashes.
`IO_STAGE.json` and `IO_COMPANION.json` accompany the separate Setup admission.
Use the explicit snapshot paths above; the historical owner cohort is provenance.

An optional `NIRS4ALL_METHODS_WASM_ROOT` selects a separately supplied Methods
SDK, and the Methods receipt labels that delivery `local_source_override`. Leave
it unset to use the snapshot's staged Methods. `methods-cohort.json` records the
measured runtime version, ABI and WASM/loader hashes with
`publication_claimed: false`; a build receipt does not certify browser or scientific qualification.

`npm run test:methods-cohort` checks admission of compatible versions and
refusal of the old ABI, missing identities and unqualified major versions.
The 19 real-WASM scientific tests require wide T²/Q availability in every
qualified run.

Client source and distributed license texts: [public/legal/server-client/NOTICE.md](public/legal/server-client/NOTICE.md).
