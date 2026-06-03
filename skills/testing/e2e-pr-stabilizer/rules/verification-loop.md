---
title: Phase 6 — Push, watch, re-verify with fresh telemetry
impact: HIGH
tags:
  - ci-loop
  - github-actions
  - re-verification
  - telemetry
---

# Phase 6 — Push, watch, re-verify with fresh telemetry

A fix is not proven by a passing test in isolation — it is proven by **fresh telemetry on a new CI run** showing the failure rate has dropped to zero.

This phase reuses the push-watch-verify mechanics of [`/ci-auto-fix`](../../../delivery/ci-auto-fix/SKILL.md) Steps 6–8, with one addition: the stabilizer **re-queries the Dash0 MCP after every CI conclusion** and compares against the Phase 1 baseline.

## Step 1 — Push

```bash
git push origin "<branch>"
```

If the PR is from a fork and the user lacks write access (see [`input-resolution.md`](./input-resolution.md)), skip the push and emit the report with `fix-uncommitted` status.

## Step 2 — Find and watch the new run

Allow GitHub Actions a few seconds to register the push, then list runs.
Do not `sleep` longer than necessary.

```bash
# 1. Find the new run triggered by this push.
gh run list --branch "<branch>" --limit 5 \
  --json databaseId,headSha,status,conclusion,createdAt,workflowName

# 2. Pick the most recent run whose headSha matches the new commit SHA.
NEW_RUN_ID=$(gh run list --branch "<branch>" --limit 5 \
  --json databaseId,headSha,status \
  --jq ".[] | select(.headSha == \"$(git rev-parse HEAD)\") | .databaseId" \
  | head -1)

# 3. Watch it to completion.
gh run watch "$NEW_RUN_ID" --exit-status
```

`--exit-status` makes `gh` exit non-zero on failure, which the skill must treat as "needs another iteration", not "abort".

## Step 3 — Pull fresh telemetry

Once the run concludes (pass or fail), wait briefly for spans to land in Dash0 — E2E spans typically appear within 60–120 s of run completion — then re-run the Phase 1 query with the **same canonical filter set**.

```text
mcp__dash0-dev__getSpans  filters=<canonical filter set>  timeRange=<since-push>
```

Aggregate by `test.name` using the same algorithm as Phase 1.

## Step 4 — Compare against baseline

For each test in the Phase 1 fix queue, compute the delta:

| Field | Baseline (Phase 1) | After (this iteration) | Verdict |
|-------|-------------------|------------------------|---------|
| `failure_rate` | e.g. 0.33 | e.g. 0.00 | **fixed** if 0; **improved** if dropped ≥ 50% but > 0; **unchanged** if within ±5 pp; **regressed** if higher. |
| `total_attempts` | | | Should typically drop — fewer retries means less flake. |
| `error_classes` | {A, B} | {} or {C} | A novel error class implies the fix moved the bug, not killed it. |

Treat the per-test verdict as the loop's decision input — not the overall CI conclusion, which can be red for unrelated reasons.

## Step 5 — Decide

| Combined verdict | Next action |
|------------------|-------------|
| All targeted tests `fixed` | Move to Phase 7 (report) — **done**. |
| Some targeted tests still failing, no novel errors | Iterate: go back to [`telemetry-driven-analysis.md`](./telemetry-driven-analysis.md) Phase 1 with the new run. |
| Novel error class appeared | Treat as a regression caused by the previous fix; revert that commit and iterate. |
| CI red for non-E2E reasons | Surface to the user; do not auto-fix unrelated jobs (that is `/ci-auto-fix`'s job). |
| Iteration count = 3 | Stop. Emit the report with `blocked` status and the residual evidence. |

## Step 6 — Iteration accounting

Track iteration state explicitly:

```text
iter 1:  tests_targeted=4   fixed=2   improved=1   unchanged=1   regressed=0
iter 2:  tests_targeted=2   fixed=2   improved=0   unchanged=0   regressed=0
```

Print the table at the end of every iteration so the report can include it verbatim.

## Hard guard: do not loop without evidence

The skill **must** re-query Dash0 between iterations.
A CI green without a fresh telemetry pull is **not** sufficient — Playwright's own `--retries` can mask a flake.
The span layer is what proves the fix.

## Failure mode handling

| Symptom | Cause | Response |
|---------|-------|----------|
| New run never appears | Push blocked or workflow not triggered | Print `gh run list` output and stop. |
| `gh run watch` errors | Network or auth | Retry once; on second failure stop and report. |
| Telemetry pull returns 0 spans for the new run | Span landing latency or attribute drift | Wait 60 s, retry once. If still empty, mark the iteration `evidence-stale` and report. |
| Same test failed identically twice | Fix did nothing | Revert the commit and re-enter Phase 4 with a stricter confidence threshold. |
