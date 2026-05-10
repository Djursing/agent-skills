---
name: fix-bug
description: >
  Resolve a bug from any starting point — Dash0 telemetry (span / log / web event / RUM error link),
  raw stack trace, error message, code pointer (file:line), screen recording, free-text symptom — by
  classifying the input, resolving evidence, mapping it to source code, running holistic analysis,
  and gating a fix proposal on confidence(bug-analysis). At >= 90% confidence the skill hands off to
  autonomous-workflow (aw-planner + aw-executor) to implement the fix and open a draft PR. Below
  90% it returns the proposal for human review. If the input is a video / screen recording, delegate
  to /video-analyser. If the input is a Linear ticket URL, the skill currently asks the user to
  extract telemetry / trace evidence; full Linear integration is documented as a follow-up.
  Triggers on: "fix this bug", "investigate this error", "this Dash0 span shows a failure",
  "/fix-bug".
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
    - observability
    - confidence-gated
    - autonomous-workflow
    - root-cause
---

# Fix Bug

Take a bug — described in any form the user has at hand — and either deliver a draft PR with the fix
or hand back a clear, evidence-backed proposal for human review. The skill is a **thin orchestrator**:
all heavy reasoning is delegated to `/holistic-analysis`, all gating to `/confidence`, all
implementation to `aw-planner` + `aw-executor`. This skill owns input classification, evidence
collection, and the user-facing decision at the confidence boundary.

## Architecture

```
Phase 0: Intake                       → classify input, ask clarifying questions if needed
Phase 1: Evidence Resolution          → Dash0 MCP / /video-analyser / parse stack / read code pointer
Phase 2: Source Mapping               → telemetry → file:line; group by component
Phase 3: Holistic Analysis            → Skill("holistic-analysis", "fix")
Phase 4: Confidence Gate              → /confidence bug-analysis
Phase 5: Branch Decision              → >= 90% auto-implement; < 90% return proposal
Phase 6: Autonomous Handoff           → spawn aw-planner -> aw-executor in a worktree
```

The handoff in Phase 6 mirrors `batch-linear-tickets` (single-ticket case): planner consumes the
Bug Fix Pack, produces `plan.md` gated by its own internal `confidence(plan) >= 90%`, executor
reads `plan.md` and ships a draft PR.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `holistic-analysis` skill | Phase 3 root-cause analysis | **Yes** |
| `confidence` skill | Phase 4 gate (also used inside holistic-analysis) | **Yes** |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 6 implementation | **Yes** for auto-fix path |
| `gh` CLI | Draft PR creation by `aw-executor` | **Yes** for auto-fix path |
| `gw` CLI | Worktree management (planner) | Recommended |
| `video-analyser` skill | Resolve video / screen-recording inputs | **If video input** |
| Dash0 MCP server (`mcp__dash0__*` or equivalent) | Resolve span / log / web event URLs | **If Dash0 input** |
| Linear MCP (`mcp__claude_ai_Linear__*`) | Future: Linear-ticket input path (see [Future: Linear integration](#future-linear-integration)) | Optional today |

If a required-conditional dependency is missing, surface it at Phase 1 and ask the user how to
proceed (paste evidence directly, switch input type, install the dependency).

---

## Phase 0 — Intake & Input Classification

Parse `$ARGUMENTS`. The argument may be empty, a single token (URL or path), free text, or a
multi-line block (e.g. a pasted stack trace).

Walk the table top-to-bottom. The first matching row wins.

| # | Input shape | Detection rule | Route |
|---|-------------|----------------|-------|
| 1 | Dash0 URL | Matches `https?://[^/]*dash0\.com/` or contains `traceId=` / `spanId=` query parameters | [Dash0 resolution](#dash0-resolution) |
| 2 | Linear ticket URL | Matches `https?://linear\.app/.+/issue/` | [Linear input](#linear-input) |
| 3 | Video file or recording link | Path / URL ends in `.mp4`, `.mov`, `.webm`, `.avi`; or text mentions "screen recording", "video of the bug" | `Skill("video-analyser", "<input>")` then loop back to Phase 1 with the structured findings as evidence |
| 4 | Code pointer | Matches `<path>:<line>` or `<path>#L<line>` (relative or absolute) | [Code pointer](#code-pointer) |
| 5 | Stack trace | Multi-line input containing `at .+ \(.+:\d+:\d+\)`, `File ".+", line \d+`, or `\s+at\s+\S+:\d+` | [Stack trace](#stack-trace) |
| 6 | Error message text | Single-line or short block matching `Error:`, `Exception:`, `Traceback`, `panic:`, `TypeError`, `ReferenceError`, etc., without resolvable frames | [Error message](#error-message) |
| 7 | Free-text symptom | Anything else | [Clarifying questions](#clarifying-questions) |

If `$ARGUMENTS` is empty, jump straight to [Clarifying questions](#clarifying-questions).

**Multi-input handling.** If the user provides more than one piece of evidence (e.g. a Dash0 link
plus a stack trace), classify each independently in this phase, then merge their resolved evidence
in Phase 2. Do not pick "the most authoritative" one and discard the rest — they are usually
complementary.

### Clarifying questions

If the input is free text or empty, ask up to **3 questions** in a single message. Stop and wait
for the answer before proceeding. Suggested questions, in priority order:

1. "Do you have a Dash0 link, stack trace, error message, or code pointer for this?"
2. "When did this start happening? Is it on a specific request / user / environment?"
3. "What did you expect to happen, and what happened instead?"

Do not run holistic analysis on free text alone — without at least one concrete artefact, Phase 3
cannot ground its hypotheses, and the skill will produce low-confidence guesses. Ask before
analysing.

---

## Phase 1 — Evidence Resolution

Resolve each classified input to a concrete evidence record the analysis phase can consume.

### Dash0 resolution

1. **Detect Dash0 MCP availability.** Scan the available MCP tool list for any tool prefixed with
   `mcp__dash0__` (or equivalent — the prefix may vary by MCP server name).
2. If no Dash0 MCP is configured, print:
   > `Dash0 MCP is not configured for this session. Either install it, or paste the relevant span / log payload directly into the chat and I will use that as evidence.`
   Then wait for the user.
3. Extract the artefact identifier from the URL:
   - Trace / span: `traceId`, `spanId` query parameters or path components.
   - Log: log entry ID or query expression.
   - Web event: RUM event ID, session replay ID.
4. Call the appropriate Dash0 MCP tool to fetch the artefact. Capture:
   - Service name, environment, deployment / release version.
   - Operation name, span attributes (especially `code.*`, `exception.*`, `http.*`, `db.*`).
   - Stack trace if present (often in `exception.stacktrace`).
   - Linked spans (parent, root, children) if available — bugs frequently live one or two hops up
     the trace from where they surface.
   - Surrounding logs in the same trace (correlate by `trace_id`).
5. If the span has `exception.stacktrace`, route the stacktrace through the [Stack trace](#stack-trace)
   procedure as well, so source mapping benefits from both signals.

### Linear input

Today this skill does **not** auto-resolve Linear tickets. Print:

> `Linear-ticket integration is documented but not yet implemented. Open the ticket, copy the most useful evidence (Dash0 link, stack trace, screenshot or video, code pointer) into this chat, and I will continue.`

Then wait. See [Future: Linear integration](#future-linear-integration) for the planned shape.

### Code pointer

1. Read the file at the pointer.
2. Read at least 30 lines of context above and below the pointed line.
3. Read all callers via `grep` / `Grep` over the workspace.
4. Capture the pointer, the function the line belongs to, and the immediate caller graph as the
   evidence record.

### Stack trace

1. For each frame, extract `<file>:<line>` (filter out node_modules / vendored frames unless the
   user explicitly asks for them — application frames are almost always where bugs live).
2. For each application frame, read the file region (10 lines above and below the frame's line).
3. Build a frame table:

   | # | File | Line | Function | Application? | Notes |
   |---|------|------|----------|--------------|-------|
   | 0 | ... | ... | ... | yes | top-of-stack — start hypothesis here |

4. The top-of-stack application frame is the **starting** evidence. Holistic analysis (Phase 3)
   will walk both directions from it.

### Error message

1. Search the codebase for the literal error message (or its template, if it contains
   interpolations — strip everything that looks like `${...}` or `%s` first).
2. Locate the `throw` / `raise` / `panic` site(s).
3. Treat the throw site as a synthetic stack-trace top-of-stack and follow the [Stack trace](#stack-trace)
   procedure from there.
4. If the message is too generic to locate (e.g. `"Failed"`, `"undefined"`), fall back to
   [Clarifying questions](#clarifying-questions) and ask for stack-trace or telemetry.

---

## Phase 2 — Source Mapping

Produce a single **Evidence Record** that downstream phases consume.

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
<from video, from Dash0 user_id / request_id, or "unknown — to be inferred by holistic analysis">
```

This record is the input to Phase 3.

---

## Phase 3 — Holistic Analysis

Invoke the `holistic-analysis` skill in `fix` mode with the Evidence Record:

```text
Skill("holistic-analysis", "fix\n\n<Evidence Record from Phase 2>")
```

`holistic-analysis` runs its own 8-phase protocol (context gathering, execution-path walkthrough,
contract-boundary analysis, hypothesis generation, meta-cognitive check, confidence gate, change
plan). It also internally calls `/confidence bug-analysis` at its Phase 6.

**Do not** duplicate that analysis here. This skill's Phase 3 is purely a delegation step.

When the holistic analysis returns, capture:

- The identified root cause.
- The proposed change (plain-language description + impact analysis).
- The confidence score from the embedded `/confidence bug-analysis` gate.

If holistic-analysis reports it could not converge (its own escalation path triggered), surface
that to the user and stop — do not paper over a failed analysis.

---

## Phase 4 — Confidence Gate

`holistic-analysis` already ran `/confidence bug-analysis` at its Phase 6. Reuse that score.

Re-run `/confidence bug-analysis` here **only** if:
- The user has provided new evidence between Phase 3 and now, or
- The proposed fix has materially changed since holistic-analysis emitted its score.

Otherwise the score from Phase 3 is authoritative — do not re-evaluate just to feel thorough.

---

## Phase 5 — Branch Decision

| Confidence | Action |
|------------|--------|
| **>= 90%** | Proceed to Phase 6 (autonomous handoff). Inform the user before dispatching: one-line summary of root cause + proposed fix + confidence score, and that a draft PR will follow. |
| **70–89%** | Stop. Present the Evidence Record, the proposed fix, the confidence breakdown, and **what would raise the score** (specific evidence still missing — e.g. "a successful repro", "the value of `request.user_id` in the failing span", "logs from the upstream service"). Offer: collect more evidence, force-proceed anyway (NOT recommended), or abandon. |
| **< 70%** | Stop. Do NOT propose to force-proceed. Present the Evidence Record and the holistic-analysis findings as a discussion document. Ask the user for direction. |

The 90% threshold matches `autonomous-workflow`'s Phase 1 plan gate — the same number is used
deliberately so the two skills compose without surprise.

---

## Phase 6 — Autonomous Handoff

This phase only runs when Phase 5 cleared at >= 90% (or the user force-proceeded after 70–89%).

### Step 6a — Spawn `aw-planner`

Use the Agent tool with `subagent_type: "aw-planner"` and `isolation: "worktree"`. Pass a **Bug Fix
Pack** that gives the planner everything it needs without re-investigating:

```text
Plan a fix for the following bug.

## Symptom
<from Evidence Record>

## Sources
<from Evidence Record>

## Root cause (from holistic-analysis)
<root cause + supporting evidence>

## Proposed change (from holistic-analysis)
<plain-language description + impact analysis>

## Confidence
- bug-analysis: <X%>
- breakdown:
  - Evidence strength: <Y%>
  - Root cause certainty: <Y%>
  - Fix confidence: <Y%>

## Affected files (initial scope)
<file table from Evidence Record>

## Reproduction
<from Evidence Record, or "unknown">

## Requirements
- Branch: fix/<short-slug>
- The PR description (created later by the executor) must reference the Dash0 span / Linear ticket / source URL where applicable.
- Open the PR as a draft.
```

The planner runs autonomous-workflow Phases 0–2 (validation, planning, worktree + `plan.md`),
gated by its own internal `confidence(plan) >= 90%`. It returns one of:

- **Plan ready** — worktree path + `plan.md` cleared the gate.
- **Below gate** — concerns surfaced for user decision.

If **below gate**, stop and present the planner's concerns. Do not auto-dispatch the executor.

### Step 6b — Spawn `aw-executor` (only if planner returned Plan ready)

Use the Agent tool with `subagent_type: "aw-executor"` and `isolation: "worktree"` pointing at the
**same worktree the planner used**. Minimal prompt:

```text
Execute the plan at .agent/<branch>/plan.md in the current worktree.
```

The executor runs autonomous-workflow Phases 3–7: implement, test, document, open the draft PR,
watch CI. The skill's job is done once the executor has dispatched — it does not need to wait for
CI to finish before reporting back.

### Step 6c — Report back

Print a final status block:

```markdown
## Fix-bug result

| Field | Value |
|-------|-------|
| Source | <Dash0 link / stack trace / code pointer> |
| Root cause | <one line> |
| Confidence (bug-analysis) | <X%> |
| Plan confidence | <Y%> |
| PR | <url> (draft) |
| Branch | fix/<slug> |
| Worktree | .agent/fix/<slug>/ |
| CI | watching (if `aw-executor` is still running) |
```

---

## Output Format

Use this format for **every** Phase 5 outcome (auto-fix or proposal-only). The user gets the same
structure regardless of whether the fix shipped — only the tail varies.

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
- Below gate (X%): proposal returned for review. To raise the score, collect: <specific evidence>.
- Stopped: <reason>.
```

---

## Future: Linear integration

The current `linear-ticket-investigator` agent and `batch-linear-tickets` skill cover Linear
investigation end-to-end, but they own their own planner-and-executor handoff. The intended
end-state for `/fix-bug` is to become **the single bug-fixing engine**, with Linear as one of
several input adapters:

```
/fix-bug <Linear URL>
  → linear-ticket-investigator (refactored: returns an Evidence Record, not a Decision Pack)
  → Phase 2 (source mapping)
  → Phase 3 (holistic analysis)
  → Phase 4 / 5 / 6 as today
```

`/batch-linear-tickets` would then become a thin batching wrapper:

```
/batch-linear-tickets SUP-1 SUP-2 SUP-3
  → for each: invoke linear-ticket-investigator -> Evidence Record
  → fan out /fix-bug Phases 3–6 in parallel
```

This refactor is **not** part of v1 of this skill. It is documented here so the migration target is
unambiguous when the work is picked up. Tracking this as a follow-up keeps the v1 diff small and
the bug-fix loop testable in isolation.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free-text symptom triggers low-confidence holistic analysis | Medium | Phase 0 refuses to run analysis on free text alone — asks clarifying questions first. |
| Dash0 MCP not configured | Medium | Detection step in Phase 1 prints the install / paste-evidence fallback. |
| Stack-trace frames are vendored / generated and don't map to source | Medium | Filter to application frames in [Stack trace](#stack-trace); fall back to error-message search. |
| Holistic analysis returns a confident-but-wrong root cause | Low–Medium | The 90% gate is the same gate `autonomous-workflow` uses; `aw-planner` runs `confidence(plan)` again. Two independent gates catch most over-confidence. |
| User wants to force-proceed below 70% | Low | Phase 5 explicitly does NOT offer force-proceed under 70%. Stop and ask for direction. |
| Video is silent / has no UI text | Low | `/video-analyser` returns "None detected" gracefully; this skill then asks for additional evidence. |
| Auto-fix opens a noisy PR with unrelated changes | Low | `aw-executor` is bound by `plan.md`; the planner's plan is bounded by the Evidence Record's affected-files table. |

---

## Key Principles

1. **Orchestrate, don't analyse.** Holistic analysis lives in `holistic-analysis`, gating in
   `confidence`, implementation in `aw-planner` + `aw-executor`. This skill only classifies input,
   resolves evidence, and decides at the confidence boundary.
2. **Evidence first.** Never run analysis on free text alone — ask clarifying questions until at
   least one concrete artefact (telemetry, trace, code pointer, video) is in hand.
3. **Two independent confidence gates.** `confidence(bug-analysis)` at Phase 4 and
   `confidence(plan)` inside `aw-planner`. Both must clear 90% for auto-fix to ship.
4. **Reuse, don't duplicate.** If `holistic-analysis` already ran `/confidence bug-analysis`, do not
   re-run it in Phase 4 unless evidence has materially changed.
5. **No force-proceed under 70%.** Below 70% the skill stops and hands back to the user — no escape
   hatch.
6. **Linear is a future input adapter, not a separate orchestrator.** When the refactor lands,
   `/batch-linear-tickets` becomes a thin batching wrapper around `/fix-bug`. Until then it is
   documented as a follow-up and `/fix-bug` does not duplicate Linear logic.
