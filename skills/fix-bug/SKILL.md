---
name: fix-bug
description: >
  Resolves a single bug from any starting evidence — Dash0 telemetry (span / log / web event / RUM
  error link), raw stack trace, error message, code pointer (file:line), screen recording, or
  free-text symptom — by classifying the input, resolving evidence, mapping it to source,
  delegating root-cause analysis to holistic-analysis, and gating the fix on confidence(bug-analysis).
  At >= 90% confidence the skill hands off to autonomous-workflow (aw-planner + aw-executor) to
  ship a draft PR; below 90% it returns the proposal for human review. Pass --analyse-only to stop
  after the proposal regardless of confidence (read-only analysis). Video inputs delegate to
  /video-analyser. Triggers on "fix this bug", "investigate this error", "this Dash0 span shows a
  failure", "this stack trace looks wrong", "/fix-bug".
license: MIT
user-invocable: true
disable-model-invocation: true
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: orchestrator
  architecture: classify/resolve/map/analyse/gate/handoff
  agents:
    planner: aw-planner
    executor: aw-executor
  composes:
    - holistic-analysis
    - confidence
    - video-analyser
    - autonomous-workflow
  phases:
    - intake
    - evidence_resolution
    - source_mapping
    - holistic_analysis
    - confidence_gate
    - branch_decision
    - autonomous_handoff
  tags:
    - bug-fix
    - debugging
    - telemetry
    - dash0
    - confidence-gated
    - autonomous-workflow
    - root-cause
    - orchestrator
---

# Fix Bug

Take a bug — described in any form the user has at hand — and either ship a draft PR with the fix
or hand back a clear, evidence-backed proposal for human review. This skill is a **thin
orchestrator**: heavy reasoning lives in `holistic-analysis`, gating in `confidence`, implementation
in `aw-planner` + `aw-executor`. This skill owns input classification, evidence collection, and the
user-facing decision at the confidence boundary.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures live in `rules/*.md`
> and `templates/*.md` and load on demand.

## Architecture

```text
Phase 0: Intake                → classify input, ask clarifying questions if needed
Phase 1: Evidence Resolution   → Dash0 MCP / /video-analyser / parse stack / read code pointer
Phase 2: Source Mapping        → telemetry → file:line; group by component
Phase 3: Holistic Analysis     → Skill("holistic-analysis", "fix")
Phase 4: Confidence Gate       → /confidence bug-analysis
Phase 5: Branch Decision       → >= 90% auto-implement; < 90% return proposal
Phase 6: Autonomous Handoff    → spawn aw-planner -> aw-executor in a worktree
```

The Phase 6 handoff mirrors `batch-linear-tickets` (single-bug case): planner consumes the Bug
Fix Pack, produces `plan.md` gated by its own internal `confidence(plan) >= 90%`, executor reads
`plan.md` and ships a draft PR.

---

## Modes

| Flag | Default | Behaviour |
|------|---------|-----------|
| (none) | **yes** | Full pipeline. Phase 5 dispatches `aw-planner` + `aw-executor` when confidence >= 90%. |
| `--analyse-only` | | Read-only analysis. Phases 0–4 run as normal; Phase 5 **always** returns the proposal regardless of confidence; Phase 6 is skipped. Use when you want findings without shipping a PR — e.g. triage, second opinion, or as the analysis primitive `/batch-linear-tickets` calls per ticket. |

The flag is detected in Phase 0 and stripped from `$ARGUMENTS` before input classification.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `holistic-analysis` skill | Phase 3 root-cause analysis | **Yes** |
| `confidence` skill | Phase 4 gate (also used inside holistic-analysis) | **Yes** |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 6 implementation | **Yes** for auto-fix path |
| `gh` CLI | Draft PR creation by `aw-executor` | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (planner) | Recommended |
| `video-analyser` skill | Resolve video / screen-recording inputs | If video input |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs | If Dash0 input |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Linear-ticket input adapter (when invoked from `/batch-linear-tickets` or with a Linear URL) | If Linear input |

If a required-conditional dependency is missing, surface it at Phase 1 and ask the user how to
proceed.

---

## Rules

| Rule | When it loads |
|------|---------------|
| [evidence-resolution](./rules/evidence-resolution.md) | Phase 1 — per-input procedures (Dash0, stack, error, code pointer, multi-input merging) |
| [autonomous-handoff](./rules/autonomous-handoff.md)   | Phase 6 — `aw-planner` + `aw-executor` dispatch |

## Templates

| Template | Used in |
|----------|---------|
| [bug-fix-pack](./templates/bug-fix-pack.md) | Phase 6 — passed to `aw-planner` |

---

## Phase 0 — Intake & Input Classification

### Step 0a — Detect mode flag

Scan `$ARGUMENTS` for `--analyse-only` (also accept `--analyze-only`). If present, set
`ANALYSE_ONLY=true`, remove the flag from the argument string, and state the detected mode in one
line before continuing:

```text
Mode: analyse-only
```

If the flag is absent, do not print a mode line.

### Step 0b — Classify the input

Parse the remaining `$ARGUMENTS`. The argument may be empty, a single token (URL or path), free
text, or a multi-line block (e.g. a pasted stack trace).

Walk the table top-to-bottom. The first matching row wins.

| # | Input shape | Detection rule | Route |
|---|-------------|----------------|-------|
| 1 | Dash0 URL | Matches `https?://[^/]*dash0\.com/` or contains `traceId=` / `spanId=` query parameters | [Dash0 resolution](./rules/evidence-resolution.md#dash0-resolution) |
| 2 | Linear ticket URL | Matches `https?://linear\.app/.+/issue/` | [Linear input](./rules/evidence-resolution.md#linear-input) |
| 3 | Video / screen recording | Path / URL ends in `.mp4`, `.mov`, `.webm`, `.avi`; or text mentions "screen recording", "video of the bug" | `Skill("video-analyser", "<input>")` then loop back to Phase 1 with the structured findings as evidence |
| 4 | Code pointer | Matches `<path>:<line>` or `<path>#L<line>` | [Code pointer](./rules/evidence-resolution.md#code-pointer) |
| 5 | Stack trace | Multi-line input containing `at .+ \(.+:\d+:\d+\)`, `File ".+", line \d+`, or `\s+at\s+\S+:\d+` | [Stack trace](./rules/evidence-resolution.md#stack-trace) |
| 6 | Error message text | Short block matching `Error:`, `Exception:`, `Traceback`, `panic:`, `TypeError`, etc., without resolvable frames | [Error message](./rules/evidence-resolution.md#error-message) |
| 7 | Free-text symptom | Anything else | [Clarifying questions](#clarifying-questions) |

If `$ARGUMENTS` is empty, jump straight to [Clarifying questions](#clarifying-questions).

If the user provides multiple pieces of evidence, classify each independently and merge their
resolved evidence in Phase 2. See [multi-input merging](./rules/evidence-resolution.md#multi-input-merging).

### Clarifying questions

If the input is free text or empty, ask up to **3 questions** in a single message. Stop and wait
for the answer before proceeding. Suggested questions, in priority order:

1. "Do you have a Dash0 link, stack trace, error message, or code pointer for this?"
2. "When did this start happening? Is it on a specific request / user / environment?"
3. "What did you expect to happen, and what happened instead?"

Do not run holistic analysis on free text alone. Without at least one concrete artefact, Phase 3
cannot ground its hypotheses, and the skill will produce low-confidence guesses.

---

## Phase 1 — Evidence Resolution

Walk only the procedures in [`rules/evidence-resolution.md`](./rules/evidence-resolution.md) that
match the inputs classified in Phase 0. Each procedure produces a partial evidence record.

---

## Phase 2 — Source Mapping

Merge the partial records from Phase 1 into a single **Evidence Record** that downstream phases
consume:

```markdown
## Evidence Record

### Symptom
<one paragraph: what the user observed>

### Sources
- <Dash0 span URL / video summary / stack trace / code pointer>

### Affected code (initial scope)
| File | Line(s) | Symbol | Role | Source of suspicion |
|------|---------|--------|------|---------------------|
| ...  | ...     | ...    | entry / boundary / leaf | top-of-stack frame / Dash0 attribute |

### Telemetry summary (Dash0 only)
- Service / env / version: ...
- Span attributes that matter: ...
- Linked spans: ...

### Reproduction (if known)
<from video, from Dash0 user_id / request_id, or "unknown">
```

This record is the input to Phase 3.

---

## Phase 3 — Holistic Analysis

Invoke `holistic-analysis` in `fix` mode with the Evidence Record:

```text
Skill("holistic-analysis", "fix\n\n<Evidence Record from Phase 2>")
```

`holistic-analysis` runs its own 8-phase protocol (context gathering, execution-path walkthrough,
contract-boundary analysis, hypothesis generation, meta-cognitive check, confidence gate, change
plan). It also internally calls `/confidence bug-analysis` at its Phase 6.

Do **not** duplicate that analysis here. This skill's Phase 3 is purely a delegation step.

When the analysis returns, capture:

- The identified root cause.
- The proposed change (plain-language description + impact analysis).
- The confidence score from the embedded `/confidence bug-analysis` gate.

If `holistic-analysis` reports it could not converge (its own escalation path triggered), surface
that to the user and stop. Do not paper over a failed analysis.

---

## Phase 4 — Confidence Gate

`holistic-analysis` already ran `/confidence bug-analysis` at its Phase 6. Reuse that score.

Re-run `/confidence bug-analysis` here **only** if:

- The user has provided new evidence between Phase 3 and now, or
- The proposed fix has materially changed since `holistic-analysis` emitted its score.

Otherwise the score from Phase 3 is authoritative — do not re-evaluate.

---

## Phase 5 — Branch Decision

If `ANALYSE_ONLY=true`, **always return the proposal** regardless of confidence. Skip the
auto-implement row below and skip Phase 6. Surface the confidence score and what would raise it,
but do not offer to dispatch `aw-planner`. The output's `Outcome` line indicates `analyse-only
(no PR)`.

Otherwise (default mode):

| Confidence | Action |
|------------|--------|
| **>= 90%** | Proceed to Phase 6. Inform the user before dispatching: one-line summary of root cause + proposed fix + confidence score, and that a draft PR will follow. |
| **70–89%** | Stop. Present the Evidence Record, the proposed fix, the confidence breakdown, and **what would raise the score** (specific evidence still missing — e.g. "a successful repro", "the value of `request.user_id` in the failing span"). Offer: collect more evidence, force-proceed (NOT recommended), or abandon. |
| **< 70%** | Stop. Do NOT offer force-proceed. Present the Evidence Record and the holistic-analysis findings as a discussion document. Ask the user for direction. |

The 90% threshold matches `autonomous-workflow`'s Phase 1 plan gate. The same number is used
deliberately so the two skills compose without surprise.

---

## Phase 6 — Autonomous Handoff

Runs only when **all** of the following are true:

- `ANALYSE_ONLY` is not set.
- Phase 5 cleared at >= 90% (or the user force-proceeded after 70–89%).

See [`rules/autonomous-handoff.md`](./rules/autonomous-handoff.md) for the dispatch procedure and
[`templates/bug-fix-pack.md`](./templates/bug-fix-pack.md) for the literal pack passed to
`aw-planner`.

---

## Output Format

Use this format for every Phase 5 outcome — auto-fix or proposal-only. The user gets the same
structure regardless of whether the fix shipped; only the tail varies.

```markdown
## Fix-bug summary

### Evidence
<Evidence Record from Phase 2>

### Root cause
<one paragraph from holistic-analysis>

### Proposed change
<plain-language description + impact + verification plan>

### Confidence (bug-analysis)
- Evidence strength: X%
- Root cause certainty: X%
- Fix confidence: X%
- **Overall: X%**

### Outcome
<one of:>
- Auto-implemented: PR <url> on branch <name>. CI watching.
- Analyse-only (no PR): proposal returned at X% confidence. To ship a fix, re-run without --analyse-only.
- Below gate (X%): proposal returned for review. To raise the score, collect: <specific evidence>.
- Stopped: <reason>.
```

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free-text symptom triggers low-confidence holistic analysis | Medium | Phase 0 refuses to run analysis on free text alone — asks clarifying questions first. |
| Dash0 MCP not configured | Medium | Detection step in `evidence-resolution.md` prints the install / paste-evidence fallback. |
| Stack-trace frames are vendored / generated and don't map to source | Medium | Filter to application frames; fall back to error-message search. |
| Holistic analysis returns a confident-but-wrong root cause | Low–Medium | Two independent gates (`confidence(bug-analysis)` here, `confidence(plan)` in `aw-planner`). Both must clear 90% for auto-fix. |
| User wants to force-proceed below 70% | Low | Phase 5 explicitly does NOT offer force-proceed under 70%. Stop and ask for direction. |
| Auto-fix opens a noisy PR with unrelated changes | Low | `aw-executor` is bound by `plan.md`; the planner's plan is bounded by the Evidence Record's affected-files table. |

---

## Key Principles

1. **Orchestrate, don't analyse.** Holistic analysis lives in `holistic-analysis`, gating in
   `confidence`, implementation in `aw-planner` + `aw-executor`. This skill only classifies input,
   resolves evidence, and decides at the confidence boundary.
2. **Evidence first.** Never run analysis on free text alone — ask clarifying questions until at
   least one concrete artefact is in hand.
3. **Two independent confidence gates.** `confidence(bug-analysis)` at Phase 4 and
   `confidence(plan)` inside `aw-planner`. Both must clear 90% for auto-fix to ship.
4. **Reuse, don't duplicate.** If `holistic-analysis` already ran `/confidence bug-analysis`, do not
   re-run it in Phase 4 unless evidence has materially changed.
5. **No force-proceed under 70%.** Below 70% the skill stops and hands back to the user. No escape
   hatch.
6. **Linear is one input adapter among several.** A Linear URL routes through
   `linear-ticket-investigator` to produce an Evidence Record, then continues at Phase 2 like any
   other input. `/batch-linear-tickets` is a thin wrapper that fans out `/fix-bug --analyse-only`
   per ticket, runs cross-ticket correlation, then fans out `/fix-bug` (without the flag) for
   approved tickets.
