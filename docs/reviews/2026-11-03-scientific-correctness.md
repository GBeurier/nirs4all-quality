# Quali scientific-correctness review

Scope: the first ecosystem consolidation batch, limited to scientific correctness
in Quali. Review requested by the maintainer before any version bump or publication.

Reviewer: `claude-opus-5-5`, effort `high`, Claude Code CLI `2.1.316`.
The first pass completed in 560.593 seconds over 35 turns, with no permission
denials. The reviewer inspected the uncommitted implementation and ran a clean
install copy of the targeted test suites. No review edits were made to source.

## Corrections after the first pass

1. Routine decisions now retain evaluation scope and cannot qualify selection,
   training or unknown scores as reliable. Bands are labelled heuristic and their
   uncalibrated coverage is explicit. Browser coverage exercises this screen.
2. Quadratic detrending was removed from the shipped catalog. JS screens report
   per-candidate failures and continue with supported candidates. Complete pipeline
   failures propagate to a visible calibration alert, including an unavailable
   engine. Tests exercise every shipped preset with a failing WASM engine.
3. Candidate issues distinguish backend refusals from runtime failures. They are
   shown in result details and included in model export and leaderboard provenance.
   Pipeline descriptions report the number of candidates actually scored.
4. Catalog Savitzky–Golay steps explicitly select nearest edge padding on both
   backends. Catalog-versus-validator regression coverage checks shipped steps.
5. The demonstration engine refuses calibration and prediction; an unavailable
   WASM module cannot silently produce demonstration scores.

The reviewer correctly identified stale local dependencies: the first local
build/smoke used installed Core 0.3.27 and UI 0.1.14 despite newer lockfile pins.
After `npm ci`, `npm ls` confirms Core 0.4.5 and UI 0.1.15. Validation was repeated
against those installed pins. Core 0.4.5 emits evaluation metadata; conservative
adapter defaults apply only to older runtimes without it.

## Follow-up verdict and final disposition

The same Opus 5.5 CLI session completed a targeted second pass in 312.778 seconds
and 13 turns, with no permission denials. Verdict: **No release blockers remain**.
The reviewer confirmed all five original findings fixed and independently reran
clean-install type checking, 16 scientific tests and 39 importer cases. The build
and browser checks below were performed by the implementing agent in the actual
workspace; the reviewer's temporary copy lacked the sibling staged WASM assets.

The follow-up raised one additional low-priority issue: imported files could
self-declare an independent test and regain routine qualification. This was then
closed by preserving the evaluation object with `evaluationDeclaredOnly: true`,
keeping imported claims unqualified, showing their unverified origin, and adding
both a regression test and a browser import case. The decision guard now chooses
shared caution display tokens directly rather than manufacturing a domain score.
This last small correction was validated locally after the second review.

The added real-browser import case also exposed an existing compatibility gap
with the now-correctly-installed Core 0.4.5: it serializes baseline PLS `params: []`
and stateless SNV/SG `state: []`. The importer now accepts precisely these empty
vectors while still refusing nonempty parameters, learned state, unknown fields
and unsupported preprocessing. Regression cases retain both older and current
producer shapes, and the real exported model is checked without altering its
fitted values.

No independent outer evaluation, native-engine migration, version bump or
publication is claimed by this batch. The sibling WASM staging dependency remains
an existing build constraint; release provenance must record that staged state.

## Final local validation

Validated with Node 24.16.0 after `npm ci`; installed package pins were confirmed
as `nirs4all@0.4.5` and `nirs4all-ui@0.1.15`.

- `npm run typecheck`: passed.
- `npm run test:science`: 17 tests passed, zero failures and zero skips.
- `npm run test:model-import /tmp/quali-final-model.json`: 45 cases passed,
  including reopening the freshly downloaded WASM model without changing its
  fitted values. The default suite has 44 cases; the real export adds one.
- `npm run build`: passed using the workspace's existing staged WASM assets.
- `npm run smoke` against preview port 4399: passed in headless Chromium using
  real Core/Methods WASM. Checks cover selection score labels, downloaded model
  evaluation metadata, unqualified routine decisions, a hand-declared imported
  independent-test claim, and a visible failure when the engine chunk is blocked.
- `git diff --check`: passed.

Existing untracked `AGENTS.md` and `codegraph.json` were left untouched. Changes
remain uncommitted for review; no release, push or publication was performed.

## Original independent report

# Review: Quali scientific-correctness batch (uncommitted)

## Verdict

**Not ready to release yet.** Fixes 1, 3, 4 and 5 are implemented correctly, and their tests would catch the old defects. The UI work for fix 2 is complete in Calibrate, but the Predict screen still gives routine predictions a "reliable / safe" verdict based on selection scores. There is also one new regression where a shipped pipeline silently disappears from the leaderboard. Neither issue needs a large change. I modified no files; my temporary install copy and probe were deleted.

## Findings, by severity

**1. High, release blocker. Predict still qualifies routine use from the selection score.** The issue existed before this patch, but it defeats fix 2.
- **Flow:**
  - `screens/Predict.tsx:140` passes the selection RMSE as `rmsep`.
  - `lib/reliability.ts:88` turns it into the "± x" prediction interval (displayed via line 105).
  - `buildDecisionView` (from nirs4all-ui) then returns 🟢 "reliable — reasonable interval" when the domain and interval-width checks pass.
  - `ui/explanations.ts:350/358` tells users "A green dot across all three columns is safe".
- **Auto-build makes it worse:** `Predict.tsx:107-124` builds `fast-aom-pls` automatically and goes straight to routine verdicts, with no user review of the selection.
- **Result:** the screen says "RMSE · Selection validation" in its header line, but still releases green "safe" predictions. This contradicts the new Calibrate card ("Independent validation is required before qualifying routine use").
- **Suggested fix:** when `evaluation?.independent_test !== true`:
  - label the interval as a heuristic derived from selection RMSE;
  - cap the verdict below "reliable" (or show an "unqualified" state);
  - reword the takeaway texts.
- Add a render/smoke assertion that no "reliable"/"safe" verdict appears for a selection-only model.

**2. Medium, introduced regression. A failed variant is silently dropped from the leaderboard.**
- **Flow:**
  - `engine/variants.ts:80` ships `detrend(2)` in `AOM_PLS_SLOW`. The WASM adapter refuses all Detrend steps, and the JS fallback accepts only degree 1.
  - If every WASM candidate fails (`variants.ts:170`), `runPlsScreenSteps` throws on the first invalid chain (`jsEngine.ts:76`).
  - `runVariant` catches it, only logs a console warning, and returns `null` (`variants.ts:192-193`).
  - `Calibrate.tsx:89` skips the variant without telling the user. If every selected variant fails, nothing renders at all (`Calibrate.tsx:145`).
- **Reproduced:** with a failing WASM stub, `slow-aom-pls` returns `null`, while `fast-aom-pls` falls back correctly.
- **Before the patch** this chain ran as degree-1 detrend under a wrong label. Now the whole pipeline vanishes instead, so the user still isn't told.
- **Suggested fix:**
  - Remove `detrend²` from the catalog (or implement it).
  - Make the JS screen refuse per candidate, recording `refusedCandidates`, instead of aborting the whole bank.
  - Show variant-level failures and their reasons in Calibrate.
  - Add a test that checks every shipped `CALIB_VARIANTS` step against both backend validators. That test would have caught this.

**3. Low. Refusal reporting is incomplete.**
- In the fallback route, `refusedCandidates` contains WASM *runtime failures* for candidates the JS fallback then actually scored. Yet `TrainingResults.tsx:75` says "N candidates refused by the WASM backend".
- `refusedCandidates` is not in the model export. On the normal WASM route, `slow-aom-pls` screens 14 of 19 candidates (MSC, detrend¹, detrend², MSC+d1, detrend¹+d1 are refused). The variant description still advertises "SNV/MSC/detrend".
- **Suggested fix:** separate `refused` from `failed`, include both in the export, and adjust the description.

**4. Low. Savitzky–Golay edge handling depends on the backend.**
- `sg()` in `variants.ts:35` doesn't set `mode`.
- Core 0.4.5 defaults to `interp`. The JS validator (`preprocessing.ts:39`) treats a missing mode as `nearest`, which is what the JS kernel does.
- So the same labelled candidate runs a different transform depending on the route.
- **Suggested fix:** set `mode: 'nearest'` explicitly in the catalog (Core supports it) so both routes run the same transform.

**5. Low, existed before.** If `import('./wasmEngine.js')` fails, `createEngine` (`engine/index.ts`) falls back to `StubEngine`.
- The stub ignores all preprocessing steps.
- It scores on the training rows (resubstitution), because `trainingData.ts` marks every row as `train`.
- It reports no evaluation, so the UI shows "Evaluation scope unavailable" instead of "Training (resubstitution)".
- **Suggested fix:** refuse calibration on the stub, or emit `scope: 'training'` and reject non-empty steps.

## Verified correct
- **MSC fallback:** the reference is fitted on training rows only and replayed on validation rows. The deployment refit captures its own reference. A missing reference is refused at prediction time. After JSON export/import the reference is restored by `modelIo`.
- **WASM path:** before calling Core it refuses MSC, Detrend, unknown steps, SNV parameters, non-PLS models and extra PLS parameters. Core 0.4.5 applies all passed SG parameters (window_length, polyorder, deriv, mode, cval; it rejects delta≠1).
- **Small and grouped data:** datasets under 8 samples, overlapping splits, and raw replicates (via `groupIds`) are refused at every entry point.
- **Evaluation metadata:** the adapter's conservative default is right for 0.4.5, and the sibling Core emits the same DTO shape. Evaluation is carried through the store, CSV, export and import. The importer rejects inconsistent scope/flag pairs.
- **Tests:** they target the actual old defects. The MSC fixture proves the leaked path gives different results, the step-refusal test asserts Core is never called, and the resubstitution case is covered.

## Validation gaps
- **This checkout's `node_modules` is stale.** It has `nirs4all@0.3.27` and `nirs4all-ui@0.1.14`, but the lockfile pins 0.4.5 and 0.1.15 (`npm ls` reports them as invalid). If the reported typecheck, build and Chromium smoke ran here, they did not test the pinned Core or UI.
  - In a clean `npm ci` copy I re-ran: typecheck passed, `test:science` passed 10/10 with no skips, and `test:model-import` passed 39 cases.
  - I did **not** re-run the build or the browser smoke against 0.4.5. Run `npm ci` and both again before any release.
- No test covers the Predict-screen verdicts, catalog-versus-validator consistency, or how refused/failed variants are shown. The Calibrate leaderboard and report card are covered only by the smoke test.

## Independent follow-up report

# Follow-up verification: Quali scientific-correctness batch

## Verdict

**No release blockers remain.** All five findings are fixed in the current files, and I found no regression introduced by the fixes. I edited nothing, and both temporary copies are deleted.

## Original findings

**1. Predict screen qualifying routine use: fixed (this was the blocker).**
- `buildQualifiedDecisionView` (`lib/reliability.ts:39-51`) checks the model's evaluation. Unless it is `independent_test` with `independent_test: true`, a green verdict becomes "Unqualified prediction".
  - Its colour is downgraded to caution: with the default threshold `adWarn = 1`, the substitute score of 1.1 lands in caution.
  - Confidence is set to low and the action reads "Independent validation is required".
- `Predict.tsx` uses this function for every card, the breakdown bar and the legend, and hides the "reliable" legend entry.
- The batch summary text, the "Heuristic band" column, the coverage disclaimer and the CSV export (`evaluation_scope`, `independent_test`, `interval_basis`) are all consistent with this.
- `DecisionCard` in Predict is the only consumer of decision views in the app, so no other path can show a green verdict.
- The browser smoke test checks the actual Predict page text.

**2. Variant silently dropped: fixed.**
- `detrend²` is gone from the shipped bank.
- `runPlsScreenSteps` now catches errors per candidate and throws one combined reason only if nothing could be scored.
- `runVariant` re-throws errors instead of returning `null`. Calibrate shows them in a `role="alert"` box and also records them in the export (`failedPipelines`).
- Dataset refusals (too few samples, grouped replicates) still stop the whole run, because `splitIdx` runs outside the per-candidate catch.

**3. Refusal reporting: fixed.**
- `candidateIssue` marks an issue `refused` only for the new `PreprocessingRefusal` error type, and `failed` otherwise.
- Candidate issues appear in the training results, in the export and in each leaderboard row.
- The preprocessing description now reports the number of candidates actually scored.

**4. Savitzky–Golay edge mode: fixed.** The `sg()` helper always sets `mode: 'nearest'`. Core 0.4.5 maps that value, and the JS validator accepts it. A test checks every shipped PLS step against both backends.

**5. Stub fallback: fixed.**
- `StubEngine` now refuses both calibration and prediction.
- `createEngine` throws "WASM engine unavailable…", which Calibrate's outer catch displays. In Predict, `runVariant` now throws instead of returning `null`, and the existing `.catch` displays the error.

## Remaining actionable issue (low, not blocking)

`lib/modelIo.ts` `isEvaluation` trusts an imported bundle that claims `scope: 'independent_test', independent_test: true`. Such a model gets green verdicts back in Predict, based on a claim nobody can verify. Quali never produces that value itself, so this needs a hand-edited or external file. If you want it closed, mark evaluation scopes from imported files as declared-only, or keep them unqualified.

## Validation

- **Re-run in a clean `npm ci` copy (nirs4all@0.4.5, nirs4all-ui@0.1.15):**
  - typecheck passed;
  - `test:science`: 16/16 passed, none skipped;
  - `test:model-import`: 39 cases passed.
- The test list covers the new behaviour: the catalog-versus-validator check, every shipped variant against a failing WASM engine (including slow-aom-pls), visible failures, stub refusal, and the unqualified decision views.

**Gap:** I did not reproduce the build or the Chromium smoke test.
- The Vite config pulls staged WASM from `../../nirs4all-web/web-app/src/engine/wasm`, so a build from a copy outside the workspace cannot find it.
- I didn't build in the checkout because that writes `dist/`.
- For those two checks I am relying on your run after reinstalling, and on reading the smoke assertions (`wasm-smoke.mjs:69-84`).
- Since the release build depends on what is staged in the sibling `nirs4all-web` checkout, record that staged state with the release.
