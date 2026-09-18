# NN — Package title

One paragraph: what is wrong or missing today, and what is true after this package lands.
Written for someone who was not in the brainstorm.

Branch: `build/NN-short-name`
Brainstormed: YYYY-MM-DD. Decisions locked by Perng.

---

## Decisions

What was chosen, and what was rejected, with the one-line reason. Verbatim from the brainstorm.
A builder does not re-open these.

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| | | | |

## Files

Exhaustive. `merge-fitness` refuses any file outside this list unless the PR body declares it.

| Path | Change |
|---|---|
| `apps/.../x.ts` | modify — what |
| `packages/db/prisma/schema.prisma` | add model `Foo` |
| `packages/db/prisma/migrations/<ts>_name/` | new |

## Invariants touched

Which of the CLAUDE.md architecture invariants this package comes near, and how it respects them.
"None" is a valid answer only after checking.

## Tasks

Dependency order. Each one is a single builder dispatch: 2–5 minutes, one verify step.

### T1 — Title
**Do:** exact instruction. Paths, names, types.
**Verify:** runnable command or observable outcome.

### T2 — Title
**Do:**
**Verify:**

## Verify (whole package)

- `pnpm typecheck` exit 0
- what real data the result is checked against, and where it lives
- what the dashboard / API shows before vs after, if user-visible

## Out of scope

Things raised in the brainstorm and deliberately deferred, so nobody "helpfully" does them here.

- 
