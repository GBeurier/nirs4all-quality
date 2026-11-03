# Quality 0.0.6 integration review

Reviewer: `claude-opus-5-5`, high effort, Claude Code CLI 2.1.316.

The first implementation was based on local main 6d68810 (Quality 0.0.3).
Before release, origin/main 5c0102a was fetched and merged so that the already
published 0.0.4/0.0.5 native diagnostics, physical-axis alignment and shared
Preflight/Domains report support remain present. The reviewed scientific batch
was preserved as commit 3cdaf85 before integration.

Opus found no scientific integration regression. Its staging blocker was addressed
by adding all three remaining resolution files and verifying `git diff` was empty
before committing merge c3ab7c4. The three low-priority comments were addressed:
active documentation names the retained Core 0.4.6 pin, merged explanation
newlines were restored, and routine CSV includes the verdict label and required
action alongside the existing uncertainty/provenance/evaluation columns.

The native scientific suite remains part of `test:science`; it now runs together
with the 17 calibration regression tests. The calibration suite initializes the
same qualified Methods/PCA artifact used by the application. A true independent
score still cannot authorize a green release from an uncalibrated heuristic band.

The release uses isolated runtime inputs. Methods 1.3.10, DAG 0.3.43 and Data
0.2.14 public tarballs are checked against their published integrity and SHA-256.
Formats 0.2.13, IO 0.2.11 and Datasets 0.3.14 use browser builds of their exact
published source tags, with the owner IO staging/legal/SBOM procedure. These web
rebuilds are identified separately from downloaded npm artifact bytes.

## Original review

# Integration review: scientific-correctness batch merged with Quality 0.0.5

## Verdict

**No scientific integration regression found. There is one process blocker: part of the merge resolution is still unstaged.** I did not edit, install, build or commit anything.

## Blocker: stage the full resolution before committing the merge

`git diff` (working tree against the index) shows three files whose resolution is not in the index yet:

- **`app/scripts/scientific-contract.test.mjs`** (13 lines). Only the working-tree copy has the qualified-Methods staging, the `@nirs4all/methods` resolution, the `initializeDiagnostics()` call, and the assertion that "an independent score alone cannot calibrate heuristic coverage".
- **`app/src/screens/Predict.tsx`**. Only the working-tree copy has the reworded heuristic-band note ("Bands use score RMSE…").
- **`app/scripts/science-browser.mjs`**. Only the working-tree copy has the matching assertion updates ("Bands use score RMSE", `Heuristic.*not calibrated`).

The gate results you report (17 calibration tests, browser checks) were run on the working tree. If you commit the merge from the index alone, it will contain test code that was never run that way and will lack the native initialization. **Run `git add` on these three files, then confirm `git diff` is empty before committing.**

## What I checked and found preserved

**0.0.5 features:**
- These files are identical to `origin/main`:
  - `pca.ts`, `drift.ts`, `nativeDiagnostics.ts`
  - Health, Maintenance, `SharedAssessmentPanel`
  - `science-contract.mjs`, `package-lock.json`
- In `package.json` only the scripts changed. Core 0.4.6, UI 0.1.15, Vite and the Methods admission guard are unchanged.
- In `reliability.ts` the only changes are the new guard and the `rmsep` → `scoreRmse` rename.
  - A missing score still gives `NaN`, so the band shows as "unavailable / not_calibrated". A zero score is kept as zero.
  - The `uncertainty` object (`not_calibrated`, `nominalCoverage: null`) is unchanged.
  - `tests/science.test.ts` was only renamed accordingly.
- Predict keeps `SharedAssessmentPanel`, assessment import, and every 0.0.5 CSV column (`uncertainty_*`, `nominal_coverage`, `reference_yDensity`). It adds `evaluation_scope`, `independent_test`, `interval_basis` and `evaluation_declared_only`.

**Unqualified scores cannot authorize routine release:**
- `buildQualifiedDecisionView` (`reliability.ts:40-55`) caps selection, training, unknown and import-declared scores at caution, labelled "unqualified". It forwards a genuinely independent score to 0.0.5's `buildReliabilityView`, which never returns green (`reliability.ts:135-140`).
- In Predict, every card, the bar and the legend use this function. `DecisionCard` there is the only consumer of decision views in the app.
- Imported models always get `evaluationDeclaredOnly: true` (`modelIo.ts:117`).
- The text "All predictions are reliable" cannot appear, because no prediction can be green.

**Failed variants and candidate issues:** the merge did not touch `variants.ts`, `jsEngine.ts` or Calibrate, so failures and candidate issues still appear on screen and in the export.

**Isolation tests stay valid:** 0.0.5's native migration covers PCA, drift and diagnostics. Calibration preprocessing (MSC, SG, the JS fallback) is unchanged from 3cdaf85. So the MSC isolation, refusal and minimum-sample tests still exercise production code, with only the Core call replaced.

## Low, non-blocking
1. **Stale Core version in the docs.** `docs/SCIENTIFIC_EVALUATION.md:12` and `:43` say "pinned npm Core 0.4.5", but the pin is now 0.4.6. I checked the installed 0.4.6 and it still emits `independent_test: false` (`execution.js:272`). Update the wording.
2. **Lost merge newlines.** `app/src/ui/explanations.ts` has `},  maintenanceModelSpace: {`, `},  predictionHistogram: {` and `},} satisfies …`. This is cosmetic, but fix it before committing.
3. **Unclear CSV verdict column.** In the routine CSV (`Predict.tsx:186`), the `reliability` column holds `p.view.color`. A guarded row exports as `caution`, without its "unqualified" label or required action; only the evaluation columns tell it apart. Consider also exporting `p.view.label` or `p.view.action`.

I found no other release-blocking integration regression. The build and browser smoke are still to be run against the restored release inputs, as you planned.
