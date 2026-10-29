# Shared scientific reports

Quality is a consumer of owner-produced scientific evidence. It imports JSON and
compares existing values; no Preflight or Domains scientific kernel is recreated.

| Native profile | Version discriminator | Provenance and context |
| --- | --- | --- |
| Legacy Preflight QualificationReport | integer `schema_version: 1` | Full native report and availability; legacy producer is declared by importer. No qualified data-context comparison. |
| Preflight Assessment | string `schema_version: "1"` | Declared producer, dataset/content hash, source, population, context, scope, target/split and explicit fit/evaluation populations. Separate producer-projected Findings array. |
| Compatibility spelling for Assessment | string `schema_version: "1.0"` | Same explicitly checked profile; the current owner emits `"1"`. |
| Native Domains Report | integer1 and `domains.canonical.v0.2` or `.v0.3` | Original dataset/content version/source/target/split, task/fit hashes and train/evaluation observation identities. It is not a renamed Preflight Assessment. |

An optional independent expected-context manifest must match the complete
Assessment context. Without it, the report is explicitly external. Neither an
import nor a context match authenticates its producer or grants a project/model
reliability verdict. Intrinsic contexts cannot claim a split or fitted reference;
task contexts require distinct fit/evaluation populations and a split. Preflight
intrinsic reports cannot be relabelled as task-scoped reports.

Every metric retains its protocol, view, population, exact native parameters and
denominators. These are part of its identity: two `domain_shift.design` factors
such as instrument and campaign remain separate, including in comparisons and
finding evidence. The producer's optional `metric_context_id` is preserved as an
opaque SHA256 identifier. It never replaces the native parameter/denominator
checks. A missing qualified identity cannot fall back to another native context.
Older evidence without this field retains all matching parameter contexts and
states ambiguity rather than selecting a scalar.

Unavailable values remain N/A with the producer's native status and reason.
Available zero stays zero. Non-scalar native values remain in the raw report
when the Assessment scalar projection is unavailable. Confidence status, evidence
coverage and signal strength remain separate; a historical qualitative confidence
label is never promoted to a probability, predictive coverage or validation.

Comparisons require identical dataset/source/population/context, protocol,
fit/evaluation identities, metric parameters, units and denominators. Native
Domains comparisons additionally require its explicit frozen training reference,
disjoint evaluation identities and matching task/policy/representation identity.
Its content version, sanitized-task hash and fitted-X hash retain distinct meanings;
none is invented or relabelled as an Assessment source-content hash. Missing
reference evidence makes a qualified comparison unavailable while preserving the
remaining reported observations. The UI provides accessible tables and the
complete original report; imported reports bypass local diagnostic computation.

Conformance fixtures under `app/tests/fixtures/assessment` include the actual
Preflight0.1.1 CLI output (95 native metrics), a real two-factor collision and
separate Findings output with native evidence identities. Exact source/byte
provenance is recorded beside them. Two unmodified public Domains owner examples
retain their historical Methods1.3.6/ABI2.19 provenance; they are transport witnesses,
not a claim of recomputation with the current Methods release.

Run `npm run test:assessment`, then serve the built application and run
`SMOKE_URL=http://localhost:4500 npm run test:assessment-browser`. The latter
executes actual browser imports, matching/refused contexts, N/A display, distinct
factor identities, native Domains reference checks and lossless raw JSON display.
