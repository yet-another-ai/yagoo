# Contributing

## Toolchain

This repo mirrors the [heron](https://github.com/minori-live/heron) convention: **mise** owns tool versions and tasks.

```sh
mise install
mise run check
```

| Task | Purpose |
| --- | --- |
| `mise run install` | pnpm install (docs site) |
| `mise run docs` | VitePress docs dev server at `http://localhost:5173/yagoo/` |
| `mise run docs-build` | Build docs with base `/yagoo/` |
| `mise run pages:build` | Docs plus the engine shell, the GitHub Pages artifact |
| `mise run format` / `format-check` | Rustfmt |
| `mise run lint` | Clippy (`-D warnings`) |
| `mise run rust:test` | Cargo tests |
| `mise run check` | Format + Clippy + cargo check + docs build |
| `mise run python:sync` | uv sync for `python/` |

## CI policy

- GitHub Actions use **latest major** version tags (`@v5`, `@v2`, …). Do not pin patch digests; Renovate updates majors.
- **Never** put performance or timing benchmarks in CI.

## Design authority

English docs under `docs/` are the working design. They were restructured from the Chinese concept design; where that design and feasibility notes disagree, **the design wins**. Mark unverified claims as **unverified** — do not invent measurements.

## Scope of early PRs

Teaching-module PRs (groups, tempo, …) should cite the relevant `docs/modules/*` page. KataGo binaries are not required for CI — use fixture JSON in `yagoo-katago` tests. Local model download: `mise run katago:fetch-dev`.
