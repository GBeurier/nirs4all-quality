# Native integration example

Original synthetic spectra from the intrinsic conformance fixture, including two
observations per declared physical ID (without an independence or technical-repeat
claim). `content_hash` is SHA-256 of the exact UTF-8 `canonical-source.json` bytes,
including the terminal newline. `canonical-input.json` supplies the partitions,
identities and options used by the actual CLI. No target/test data are supplied.

`report.json`, `assessment.json` and the separate `findings.json` were produced by
the owner CLI, without recomputation in a consumer. The scalar envelope marker
is string `"1"`; the native report marker is integer `1`. Parameters and
denominators remain authoritative alongside the opaque `metric_context_id`.
Non-scalar native diagnostics remain lossless even when the scalar projection is
unavailable. Native and shared reports are evidence artifacts, not public cards.
