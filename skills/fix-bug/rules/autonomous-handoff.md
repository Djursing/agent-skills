---
title: Autonomous Handoff — aw-planner / aw-executor Dispatch
impact: HIGH
tags:
  - handoff
  - autonomous-workflow
  - aw-planner
  - aw-executor
  - draft-pr
---

# Autonomous Handoff

This rule loads when Phase 5 of `/fix-bug` cleared at >= 90% (or the user force-proceeded after
70–89%). It dispatches the autonomous-workflow agents to ship the fix as a draft PR.

## Contents

- [Step 6a — Spawn `aw-planner`](#step-6a--spawn-aw-planner)
- [Step 6b — Spawn `aw-executor`](#step-6b--spawn-aw-executor)
- [Step 6c — Report back](#step-6c--report-back)
- [Failure modes](#failure-modes)

---

## Step 6a — Spawn `aw-planner`

Use the Agent tool with `subagent_type: "aw-planner"` and `isolation: "worktree"`. Pass the **Bug
Fix Pack** from [`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md), filled in from the
Evidence Record (Phase 2) and holistic-analysis output (Phase 3).

The planner runs autonomous-workflow Phases 0–2 (validation, planning, worktree + `plan.md`),
gated by its own internal `confidence(plan) >= 90%`. It returns one of:

| Result | Meaning | Next |
|--------|---------|------|
| **Plan ready** | Worktree created, `plan.md` cleared the gate. | Proceed to Step 6b. |
| **Below gate** | Confidence < 90% after retries; concerns surfaced. | Stop. Present concerns. Do not auto-dispatch the executor. |

## Step 6b — Spawn `aw-executor`

Only if Step 6a returned **Plan ready**.

Use the Agent tool with `subagent_type: "aw-executor"` and `isolation: "worktree"` pointing at the
**same worktree the planner used**. Minimal prompt:

```text
Execute the plan at .agent/<branch>/plan.md in the current worktree.
```

The executor runs autonomous-workflow Phases 3–7 (implement, test, document, draft PR, watch CI).
Do not wait for CI to finish before reporting back — the executor owns CI watching.

## Step 6c — Report back

Print the final status block:

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
| CI | watching (aw-executor still running) |
```

## Failure modes

| Failure | Action |
|---------|--------|
| `aw-planner` returns "Below gate" | Stop. Present the planner's concerns. Offer: refine (re-spawn planner), force-proceed (NOT recommended, only if user explicitly requests), or abandon. |
| `aw-planner` returns an error (tool / worktree creation failed) | Surface the error. Do not retry silently — worktree state may be inconsistent. |
| `aw-executor` fails before opening a PR | Report the worktree path and the failure. The user can resume from the worktree manually or re-spawn the executor. |
| `aw-executor` opens a PR but CI fails immediately | The executor handles its own CI gate (Phase 7). Do not intervene from this skill. |
