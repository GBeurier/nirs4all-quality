/// <reference types="vite/client" />

// The `lab` domain is consumed through the `@lab` alias — resolved by the
// tsconfig `paths` mapping (for tsc) and the vite `resolve.alias` (for bundling),
// both pointing at nirs4all-ui/src/lab. Once the `nirs4all-ui/lab` subpath export
// is wired, replace the `@lab` specifier with `nirs4all-ui/lab` everywhere.
