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
| Reuse of `nirs4all-ui/lab` (decision contract, cards, worklist…) | ✅ via `@lab` alias |
| Real dataset ingestion (upload → `nirs4all-io` WASM) | ⏳ next — Calibrate currently uses demo spectra |
| Native kernels (D-optimal, conformal, GMM, PDS) | ⏳ next — see DESIGN §8.3 |

## Architecture (thin shell)

```
UI (screens)  ──►  @lab (nirs4all-ui/lab)      decision contract + lab view-models + components
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

## Integration hand-off (needs coordination)

### `nirs4all-ui/lab` subpath export
The reusable `lab` domain lives at `nirs4all-ui/src/lab/**` (new, self-contained, tested). Its **package export was deliberately not wired** to avoid colliding with the Codex agent editing `nirs4all-ui`. To publish it, add (in `nirs4all-ui`):

```ts
// src/index.ts
export * as lab from "./lab/index.js";
```
```jsonc
// package.json "exports"
"./lab": { "types": "./dist/lab/index.d.ts", "import": "./dist/lab/index.js" },
```
then `npm run build` in `nirs4all-ui`. After that, replace the `@lab` alias here (one line in `tsconfig.json` + `vite.config.ts`) with the `nirs4all-ui/lab` specifier. Until then, the app consumes the lab **source** through the `@lab` alias, which works for dev/build.

## Layout

```
src/
  domain/      lab data model (model.ts) + SampleStatus mirror
  engine/      port.ts (contract) · stubEngine · wasmEngine (deferred) · pythonEngine · index (factory)
  store/       React context/reducer over the domain + demo seed
  screens/     Projects · Setup · Health · SelectHplc · Calibrate · Predict · Maintenance
  app/         App shell + workflow rail
  ui/          host-provided icons for the @lab components
  styles/      theme (mirrors the nirs4all teal palette) + tailwind v4
```
