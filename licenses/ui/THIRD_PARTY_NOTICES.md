# Third-Party Notices — nirs4all-ui

`nirs4all-ui` is distributed under `CeCILL-2.1 OR AGPL-3.0-or-later` (plus an optional
commercial license; see [`LICENSING.md`](LICENSING.md)). nirs4all-ui does **not** vendor the
components below — they are pulled from their official distributions — but their licenses are
acknowledged here as a courtesy and for compliance. Licenses are reported on a best-effort
basis; the authoritative text always ships with each upstream project.

It is a shared React component and view-model package built on the npm/Node ecosystem.
Its direct dependencies are overwhelmingly **MIT**-licensed, with **Apache-2.0** used by
the TypeScript toolchain. Principal dependencies:

| Component | License (SPDX) | Upstream |
|---|---|---|
| React, React DOM | MIT | https://github.com/facebook/react |
| Vite, Vitest | MIT | https://github.com/vitejs/vite |
| `@types/react`, `@types/react-dom` | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript |

For the exhaustive, version-pinned dependency tree and its licenses, run:

```text
npx license-checker --summary
```

License-family texts are bundled under [`LICENSES/`](LICENSES/): MIT, Apache-2.0.
