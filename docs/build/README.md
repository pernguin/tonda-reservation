# Build packages

| # | Package | Status |
|---|---------|--------|
| 01 | [Ops tweaks port (from Round package 01)](01-ops-tweaks-port.md) | in review |

## Rules for every package
- Branch per package: `build/NN-short-name`.
- The harness verify command must pass before you say it is done.
- Do not touch files the brief does not name. If you believe you must, say so first.
- If the brief is wrong about the code, stop and report it. Do not work around it.
- Read `CLAUDE.md` at the repo root first — it holds the architecture invariants.
