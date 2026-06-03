---
name: e2e-pr-stabilizer
description: >
  Stabilizes or optimizes Playwright E2E tests on a pull request by combining
  Dash0 CI telemetry spans, Playwright trace artifacts, and a push-watch-verify
  CI loop.
  Two modes: `stabilize` (default) heals flaky / failing tests autonomously
  via the playwright-test-healer methodology and re-verifies via fresh
  telemetry up to 3 iterations; `optimize` is report-only and ranks
  slow-action wins by measured ms saved (no commits).
  Pulls every signal first — spans from the dash0-dev (or dash0-prod) MCP
  server filtered by `git.pull_request_link`, plus the `trace.zip` artifacts
  from the GitHub Actions run.
  Refuses `.skip`, `.fixme`, `waitForTimeout`, or any other check-weakening
  edit.
  Use when a PR has flaky or failing E2E tests, when CI has retried multiple
  times, or when you want to find slow tests worth tightening.
  Triggers on "stabilize this PR", "fix flaky e2e", "heal playwright on PR",
  "ui-e2e is failing", "self-heal e2e", "optimize e2e", "/e2e-pr-stabilizer".
disable-model-invocation: true
license: MIT
argument-hint: '[stabilize|optimize] [pr-url|pr-number]'
allowed-tools: Bash(gh *) Bash(git *) Bash(node *) Bash(jq *) Read Edit Write Grep Glob
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - playwright
    - e2e
    - flake-detection
    - ci
    - github-actions
    - telemetry
    - dash0-mcp
    - trace-analysis
    - self-healing
    - pull-request
---

# E2E PR Stabilizer

Stabilize the Playwright E2E suite for a single pull request using **evidence, not assumptions**.
Spans, traces, and the CI log are the source of truth.
This skill never proposes a fix without a measurement to point at.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in [`rules/*.md`](./rules) and [`templates/*.md`](./templates).
> Each phase loads only what it needs.

---

## What this skill combines

| Source | Role |
|--------|------|
| [`playwright-test-healer`](../../../agents/playwright-test-healer.md) agent | Test-debugging methodology — how to fix a Playwright test correctly. |
| [`/playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md) | Per-run `trace.zip` extraction, hotspot ranking, confidence-gated RCA. |
| [`/ci-auto-fix`](../../delivery/ci-auto-fix/SKILL.md) | The push → wait → verify loop and the "do not weaken checks" guard rails. |
| Dash0 MCP server (`dash0-dev` or `dash0-prod`) | Cross-run telemetry — failure recurrence, retry counts, span-level evidence. |
| GitHub Actions artifacts (via `gh`) | The trace files themselves. |

This skill is the orchestrator over those five.
It does not duplicate their content — each phase delegates.

---

## Modes

| Mode | Default | Entry rule (what enters the fix queue) | Phase 5 (edits) | Phase 6 (push + verify) | Phase 7 output |
|------|---------|----------------------------------------|-----------------|-------------------------|----------------|
| `stabilize` | **yes** | `failure_rate ≥ 0.10` over ≥ 5 attempts, or `flake_count ≥ 2`. | Applied autonomously. | Up to 3 iterations against fresh telemetry. | Stabilization report with before / after numbers. |
| `optimize` | | Top-N slowest tests by total time, or actions with `dur > 5×median`. | **Skipped.** | **Skipped.** | Recommendations-only report — humans apply the wins. |

`stabilize` is the default because optimization edits (tightening timeouts, removing waits) carry flake risk that warrants human judgment.
`optimize` runs Phases 1–4 only and emits a ranked recommendations report.

## Input

`$ARGUMENTS` is parsed as `[mode] [pr-ref]` in any order:

- `optimize` (literal token) selects optimize mode; anything else is treated as `pr-ref`.
- `pr-ref` is a PR URL (`https://github.com/dash0hq/dash0/pull/13319`) or PR number (`13319`).
- If `pr-ref` is missing, auto-detect the open PR for the current branch (same path as [`/ci-auto-fix`](../../delivery/ci-auto-fix/SKILL.md) Step 0).
- If `mode` is missing, default to `stabilize`.

Resolve mode + PR before doing anything else.
See [`rules/input-resolution.md`](./rules/input-resolution.md).

---

## Workflow

Seven phases.
Do not skip a gate.
Phases 5 and 6 are skipped in `optimize` mode (the `Modes` column says so explicitly).

| Phase | Name | Modes | Rule file | Gate |
|-------|------|-------|-----------|------|
| 0 | Resolve target | both | [`rules/input-resolution.md`](./rules/input-resolution.md) | Mode + PR URL + branch + head SHA + owner / repo printed. |
| 1 | Pull telemetry | both | [`rules/telemetry-driven-analysis.md`](./rules/telemetry-driven-analysis.md) | Dash0 spans for this PR fetched and grouped by test name; failure recurrence + retry counts measured (stabilize) **or** action `dur` distribution measured (optimize). |
| 2 | Pull trace artifacts | both | [`rules/telemetry-driven-analysis.md`](./rules/telemetry-driven-analysis.md) | `trace.zip` for each queued test downloaded via `gh run download`. |
| 3 | Correlate spans ↔ traces | both | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md) | Each queued test has a span-side signature **and** a trace-side hotspot. |
| 4 | Confidence-gated RCA | both | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md) | `Skill('confidence', 'analysis')` ≥ 90% for every candidate; otherwise dig deeper or hand back to the user. |
| 5 | Apply minimal fixes | **stabilize only** | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md), [`rules/guard-rails.md`](./rules/guard-rails.md) | Edits are tied to a measured cause; no `.skip`, `.fixme`, or `waitForTimeout` patches; no weakened checks. |
| 6 | Push + watch + re-verify | **stabilize only** | [`rules/verification-loop.md`](./rules/verification-loop.md) | New run watched to conclusion; new telemetry pulled and compared against the pre-fix baseline. |
| 7 | Report | both | [`templates/stabilization-report.md`](./templates/stabilization-report.md) | Stabilize: report with before / after numbers + fixes applied + residual risk. Optimize: recommendations-only report ranked by measured wall-clock impact. |

Maximum **3** outer iterations (Phase 1 → 6) in `stabilize` mode.
`optimize` runs the analysis once and stops at the report — no iteration.

---

## Required reading by phase

Load on demand.
Do not preload.

| Phase | Files |
|-------|-------|
| 0 | [`rules/input-resolution.md`](./rules/input-resolution.md) |
| 1–3 | [`rules/telemetry-driven-analysis.md`](./rules/telemetry-driven-analysis.md), [`references/dash0-mcp-filters.md`](./references/dash0-mcp-filters.md) |
| 3–5 | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md), [`rules/guard-rails.md`](./rules/guard-rails.md) |
| 6 | [`rules/verification-loop.md`](./rules/verification-loop.md) |
| 7 | [`templates/stabilization-report.md`](./templates/stabilization-report.md) |

For trace mechanics (zip → JSONL → action timeline), defer to [`/playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md).
Do **not** re-implement.

---

## Core principles

1. **Data first, hypothesis second.**
   Every fix is anchored to (a) a span with a measured failure rate, or (b) a trace action with a measured `dur`.
   "I think this is flaky" is not a finding.
2. **Two evidence layers, not one.**
   Spans tell you *which tests fail and how often across runs*.
   Traces tell you *why one specific run failed*.
   A fix is only credible when both layers agree.
3. **Confidence-gated RCA.**
   Before editing anything, call `Skill('confidence', 'analysis')`.
   Below 90%, iterate.
   Below 70%, surface the gap to the user instead of guessing.
4. **Never weaken the suite.**
   No `.skip`, `.fixme`, `waitForTimeout`, `continue-on-error`, `--no-verify`, or removed assertions.
   The full list lives in [`rules/guard-rails.md`](./rules/guard-rails.md).
5. **Test-side fix unless the trace proves otherwise.**
   Most flakes are selector, timing, or state-management bugs in tests.
   If the trace evidence points to product code, surface it to the user as a separate recommendation — do not silently mutate app code.
6. **Bounded iteration.**
   Maximum 3 push-verify loops.
   After that, the stabilizer is no longer the right tool — escalate.
7. **One PR at a time.**
   Cross-PR refactors belong in a different skill.

---

## Anti-patterns

One-liners; the full list lives in [`rules/guard-rails.md`](./rules/guard-rails.md).

- Patching `waitForTimeout(1500)` to mask a race instead of fixing the wait condition.
- Marking a test `.fixme()` because it is "flaky" without a measured cause.
- Pushing a fix without re-pulling telemetry to confirm impact.
- Treating a single failed run as evidence — flakes are statistical, so fetch the span history.
- Re-running CI hoping for a green without applying a code change.
- Editing product code based on speculation when the trace points at a selector or test-state issue.

---

## Quickstart

```text
/e2e-pr-stabilizer                                                       # stabilize, auto-detect PR
/e2e-pr-stabilizer 13319                                                 # stabilize PR 13319
/e2e-pr-stabilizer https://github.com/dash0hq/dash0/pull/13319           # stabilize via URL
/e2e-pr-stabilizer optimize                                              # optimize, auto-detect PR
/e2e-pr-stabilizer optimize 13319                                        # optimize PR 13319
```

Once invoked, the skill drives end-to-end:

1. Resolves the mode and the PR.
2. Queries the Dash0 MCP for E2E spans filtered to this PR (`git.pull_request_link`).
3. Downloads `trace.zip` artifacts for the queued tests.
4. Correlates and produces a confidence-gated finding set.
5. **stabilize:** applies fixes, commits, pushes, and watches CI.
6. **stabilize:** re-verifies with fresh telemetry, iterating up to 3 times.
7. Emits the report — stabilization (before / after) or optimization (recommendations).

---

## Definition of Done

### Both modes

- [ ] Mode (`stabilize` | `optimize`) and PR target resolved and printed.
- [ ] Telemetry pulled from the Dash0 MCP using the documented filter set, grouped by test name.
- [ ] `trace.zip` for every queued test downloaded and analysed via [`/playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md).
- [ ] Each candidate has a span-side signature, a trace-side hotspot, and `Skill('confidence', 'analysis')` ≥ 90%.
- [ ] Report written using the template, with the mode stated and findings ranked by measured impact.

### `stabilize` only

- [ ] Fixes pushed; CI re-run watched to conclusion.
- [ ] Fresh telemetry pulled and compared to baseline — failures eliminated, retry counts reduced.
- [ ] No `.skip`, `.fixme`, `waitForTimeout`, or `continue-on-error` introduced (guard-rails check passed).

### `optimize` only

- [ ] No commits, no pushes, no edits to test files.
- [ ] Each recommendation cites an estimated wall-clock saving (ms) based on the trace evidence.
