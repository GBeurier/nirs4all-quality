# Repository Guidelines

Quali is the guided lab-decision product over owner libraries and shared UI. Read `README.md` and `DESIGN.md`; follow the workspace instructions in `../AGENTS.md` when present. Numerics, parsing, data assembly and execution stay in their owners (Methods, IO, DAG-ML, Formats); never duplicate them here.

## Navigation

For indexed code, use CodeGraph first with this checkout's own `.codegraph/` (exact `projectPath`, or its CLI here). Never auto-index or substitute an ancestor or workspace-root index; the workspace index is only for intentional cross-repository tracing of declared included repositories, never Domains. Docs and configs may be read directly. Source, tests and builds are final authority.

## Language and workspace policy

All project content is English (UI text, errors, docs, comments, tests, reports, commits, PRs); converse with the maintainer in French; preserve identifiers, quotations and provenance records. Never commit credentials. Workspace `../AGENTS.md`, when present, adds shared policy on Git identity and release authority. Product frontends, shared UI, browser adapters, pins and generated assets change only in an explicit joint maintainer batch.
