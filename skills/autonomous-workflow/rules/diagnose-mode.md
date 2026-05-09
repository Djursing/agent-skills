---
title: 'Diagnose Mode'
impact: HIGH
tags:
  - diagnose
  - self-improvement
  - retrospective
  - meta
---

# Diagnose Mode

## Contents

- [Overview](#overview)
- [When to Run Diagnose Mode](#when-to-run-diagnose-mode)
- [Invocation](#invocation)
- [Procedure](#procedure)
- [Failure Taxonomy](#failure-taxonomy)
- [Phase-Attribution Matrix](#phase-attribution-matrix)
- [Output Artifact](#output-artifact)
- [Applying the Proposed Change](#applying-the-proposed-change)
- [Sharing the Improvement Upstream](#sharing-the-improvement-upstream)
- [Hard Rules](#hard-rules)
- [References](#references)

---

## Overview

Diagnose Mode is a **retrospective self-analysis** entry point.
It does not run the workflow phases.
It analyses a session that *already executed* the workflow and produced an unsatisfactory result, identifies which phase / gate / companion *should* have caught the problem, and emits a proposed change to the skill itself so the same class of failure cannot recur.

**Diagnose Mode never modifies anything autonomously.** It writes one report file and stops. Any proposed change to the skill is **gated through `Skill("confidence", "bug-analysis")`** and **always requires explicit user confirmation** before `--apply` runs `git apply` against the skill's source — Auto mode does not bypass that confirmation. If the confidence score is below 90%, `--apply` is **disabled for that report** and the diagnosis becomes a discussion artifact rather than an applyable patch.

The mode is designed to **adapt and learn** — the failure taxonomy grows from real, confidence-gated, user-approved diagnoses, not from speculation — while keeping the agent unable to weaken its own gates without the user in the loop.

Run Diagnose Mode while the failing session is still in context — that is when the agent has the maximum amount of evidence (plan, tests, user feedback, transcripts) to attribute the failure to a specific gate.

---

## When to Run Diagnose Mode

Trigger on any of:

- The user observes that the workflow shipped incorrect or low-quality code despite all gates passing.
- A bug found post-merge traces back to a missed Phase 3/4 check.
- A companion was *not* invoked when it should have been (missing trigger).
- A companion *was* invoked but its gate passed for the wrong reason (false-green).
- The user asks: "why did the workflow miss this?", "how could the workflow have caught this?", or "/autonomous-workflow --diagnose".

Do **not** run Diagnose Mode for:

- Routine bugs in the user's product code unrelated to workflow gaps (use `/holistic-analysis`).
- Failures already in-progress mid-workflow (use Phase 4 stuck-loop or `confidence(bug-analysis)` instead).

---

## Invocation

Diagnose Mode is invoked with the `--diagnose` flag on the orchestrator skill.

```
Skill("autonomous-workflow", "--diagnose")
```

Or via slash command:

```
/autonomous-workflow --diagnose
```

### Optional flags

| Flag                   | Effect                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `--symptom "<text>"`   | Verbatim user description of the failure. Becomes Section 1 of the report.                          |
| `--scope <name>`       | Restrict analysis to a specific phase (`phase-3`), companion (`tdd`), or rule file.                 |
| `--apply`              | After report generation, apply the proposed diff to the local skill checkout. Always confirm first. |
| `--pr`                 | After applying locally, open a PR against `agent-skills.git` with the improvement.                  |
| `--no-write`           | Print the report to stdout only — do not write `.agent/{branch}/diagnose-*.md`.                     |

`--apply` and `--pr` modify the **skill's own source files**, not the user's product code. Treat them with the same caution as any other source-modifying action — show the diff and ask for confirmation, even in Auto mode.

---

## Procedure

Diagnose Mode is seven steps. Each step has a concrete deliverable. The
confidence gate at Step 5 is **mandatory** — there is no path to `--apply`
that bypasses it.

### Step 1 — Evidence collection

Gather every observable that describes what happened:

1. The **user's symptom description** (from `--symptom` or the conversation).
2. The current **branch name** and worktree path.
3. The **plan.md** at `.agent/{branch}/plan.md` (and every `plan.v{N}.md` snapshot).
4. The **walkthrough.md** at `.agent/{branch}/walkthrough.md` (if Phase 6 reached).
5. The **Progress Log** companion-invocation lines from `plan.md` (which companions ran, when, with what outcome).
6. Any **diff** between the produced code and what the user says was correct.
7. The **transcript** of any tests, lint runs, or CI runs that "passed" while the bug was present.

If any of (3)–(7) are missing because the workflow ran in Lite Mode or in a session without artifacts, note that fact explicitly — Lite Mode runs have a thinner evidence trail and the report should call that out as a contributing factor.

### Step 2 — Failure classification

Match the symptom against the [Failure Taxonomy](#failure-taxonomy).
Each taxonomy entry maps to a primary phase / companion responsible for catching the class.
Pick **exactly one** primary class.
If the failure is a novel mode not in the taxonomy, classify it as `F-novel` and propose adding a new taxonomy row.

### Step 3 — Phase-attribution analysis

Walk every phase using the [Phase-Attribution Matrix](#phase-attribution-matrix) and answer four questions per phase:

1. Did this phase run?
2. Was its gate satisfied or bypassed (and how)?
3. Could a tighter check at this phase plausibly have caught the failure?
4. If yes, what is the **smallest concrete change** that would have caught it?

The output is a table — one row per phase — with the answers.
Highlight the phases where (3) is `yes` and (4) is non-trivial.

### Step 4 — Proposed improvement

Construct **one** improvement proposal targeted at the earliest phase where a tighter check would have caught the failure (earliest is better — fail fast, save downstream tokens).

The proposal must contain:

- **Type** — one of: new check in an existing rule, new companion skill, new trigger condition, new gate, taxonomy/registry update.
- **Target file** — full path inside `skills/autonomous-workflow/`.
- **Concrete edit** — before/after blocks with the exact text to add, change, or remove.
- **Unified diff** — fenced \`\`\`diff block in the report, ready to apply with `git apply`.
- **Mechanical vs. judgment** — is the new check rule-based (deterministic) or LLM-judged? Prefer mechanical when possible.
- **Cost** — how many tokens or seconds the new check adds per workflow run.
- **Validation plan** — how to confirm the change actually catches the failure mode (ideally: a regression test or a worked example placed in `references/`).

### Step 5 — Confidence gate (MANDATORY)

Run:

```
Skill("confidence", "bug-analysis")
```

Pass the diagnosis as the work-under-review: the symptom, the failure-class,
the phase-attribution table, and the proposed edit. The skill scores how
confident it is that the **proposal actually fixes the failure class without
weakening other gates**.

| Score   | Meaning                                                                                  | Effect on `--apply`             |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------- |
| ≥ 90 %  | Proposal is well-grounded; targeted change unlikely to regress other gates              | `--apply` permitted (still asks for confirmation) |
| 75–89 % | Proposal is plausible but not reliable enough to change skill source                    | `--apply` **disabled**; report saved as discussion artifact; user invited to refine the proposal manually |
| < 75 %  | Proposal is speculative or addresses the wrong root cause                               | `--apply` **disabled**; report saved with `status: low-confidence` so it shows up in future audits |

Record the score and the gate outcome in the report (Section 6 below). If the
score is below 90%, **the agent does not offer `--apply`** even if the user
passed the flag — it states the score, links to the report, and suggests the
user iterate on the proposal manually.

This is the load-bearing safety check. Without it, Diagnose Mode could weaken
the skill's own gates whenever the agent is overconfident in a wrong analysis.

### Step 6 — Write the report

Write the diagnosis report to:

```
.agent/{branch}/diagnose-{YYYYMMDD-HHMMSS}.md
```

The report is **self-contained** — another user with no access to the original session must be able to read it and apply the improvement. Use the structure in [Output Artifact](#output-artifact).

If `--no-write` is set, print the report to stdout instead.

### Step 7 — Optional apply / PR (only if Step 5 ≥ 90 %)

If `--apply` is set **and** the Step 5 confidence score is ≥ 90 %:

1. Show the unified diff inline.
2. **Ask the user to confirm.** Always — Auto mode does not bypass this.
3. On confirmation, run `git apply` against the diff inside `skills/autonomous-workflow/`.
4. Run any local skill validators (e.g. `claude plugin validate` if available).
5. Report success or rollback.

If `--apply` is set **but** the Step 5 score is below 90 %:

- Refuse to apply.
- Print the score, the reason, and the path to the report.
- Suggest: "Refine the proposal, run Diagnose Mode again, or apply the diff manually after review."

If `--pr` is also set (still gated on Step 5 ≥ 90 %):

1. Stage the changes locally.
2. Create a feature branch named `diagnose/<failure-class>-<short-slug>` in the `agent-skills.git` repo.
3. Open a PR titled `autonomous-workflow: harden against <failure-class>` with the diagnosis report attached as the PR description.
4. **Do not auto-push without confirmation.** Show the branch + PR title and wait for the user.

---

## Failure Taxonomy

Single source of truth for the known failure modes. **The taxonomy is
append-only and grows from real, confidence-gated, user-approved diagnoses.**
It is intentionally seeded with only one row + a catch-all — speculative
categories were removed because they push the agent toward forcing a match
where none exists.

| ID      | Class                  | Symptom                                                                                       | Primary phase | Primary companion / gate                                          |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F1      | Test-by-construction   | New test imports a private copy of the SUT or duplicates its body — passes regardless of prod | 4             | `test-provenance-guard` (static + mutation) — should have run     |
| F-novel | Novel mode             | Does not match any existing row                                                               | —             | Diagnosis proposes a new row inline (added on user approval only) |

Each diagnosis MUST cite either an existing row OR `F-novel` plus a proposal
to add a new row. New rows are appended to this table only when a diagnosis
clears the Step 5 confidence gate AND the user approves `--apply`. This keeps
the taxonomy grounded in evidence rather than prediction.

---

## Phase-Attribution Matrix

Use this matrix in Step 3 to walk every phase. Each cell is a checklist of guards that exist today.

| Phase | Existing guards                                                                                                  | Typical gaps                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | Mode detection; user confirms understanding                                                                      | Mode set to Lite for a task that should have been Full → fewer downstream gates                               |
| 1     | `code-quality(plan)`; `confidence(plan)` ≥ 90% gate (LLM + deterministic rule checks)                            | Plan missed a hidden constraint; rule checks didn't cover the failure shape                                   |
| 2     | Worktree isolation; `aw-create-plan` writes `plan.md`                                                            | `plan.md` missing a section that downstream phases rely on                                                    |
| 3     | `tdd` (RED-GREEN-REFACTOR + mutation); `ux`; `code-quality(code)` at end                                         | Companion not triggered because trigger condition was too narrow; mutation step skipped in non-TDD path       |
| 4     | Stuck-loop cap (3 Lite / 5 Full); `confidence(bug-analysis)`; auto-replan via `holistic-analysis`                | Tests passed first try → no RED phase → no mutation check; cap miscounted                                      |
| 5     | `update-claude`                                                                                                  | Skip condition matched wrongly; `CLAUDE.md` drift                                                             |
| 6     | `review-changes`; `aw-create-walkthrough`; `create-pr`                                                           | Reviewer didn't compare diff against `plan.md`; walkthrough hid the issue                                     |
| 7     | CI watcher; `ci-auto-fix`; optional `reviewer` agent (PR Mode)                                                   | CI passed because tests were narrow; `reviewer` not installed                                                 |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of the proposal.

---

## Output Artifact

The diagnosis report uses plain Markdown — no YAML frontmatter. The metadata
header at the top is parseable enough for any future tooling, and skips the
ceremony.

```markdown
# Diagnosis: <one-line failure summary>

- Generated: <ISO 8601 timestamp>
- Branch: <branch-name>
- Mode: Full | Lite
- Failure class: F1 | F-novel
- Confidence (Step 5): <score>%
- Apply status: permitted | disabled-low-confidence

## 1. Symptom

<verbatim user description, or summary if synthesised from session>

## 2. Evidence

- plan.md present: yes/no (path)
- walkthrough.md present: yes/no
- Companion invocations observed: <list from Progress Log>
- Tests that passed while bug was present: <list>
- Diff between shipped code and corrected code: <link or inline>

## 3. Failure classification

- Class: <ID> — <name>
- Reasoning: <2–4 sentences citing evidence>

## 4. Phase-attribution analysis

| Phase | Ran? | Gate satisfied? | Could a tighter check have caught it? | Smallest fix |
| ----- | ---- | --------------- | ------------------------------------- | ------------ |
| 0     | …    | …               | …                                     | …            |
| 1     | …    | …               | …                                     | …            |
| …     | …    | …               | …                                     | …            |

## 5. Proposed improvement

- Type: <new check | new companion | new trigger | new gate | taxonomy update>
- Target: <full path>
- Mechanical or judgment: <mechanical | judgment>
- Cost: <tokens / seconds>

### Before

\```<lang>
<existing content>
\```

### After

\```<lang>
<new content>
\```

### Unified diff

\```diff
<git-apply-ready diff>
\```

## 6. Confidence gate result

- Score: <N>%
- Reasoning: <2–4 sentences from `confidence(bug-analysis)`>
- Outcome: `--apply` permitted | `--apply` disabled (score below 90 %)

## 7. Validation plan

- How to confirm the new check catches the failure: <steps>
- Optional: a regression worked-example to add under `references/`

## 8. Sharing

- Apply locally: `cd skills/autonomous-workflow && git apply <path-to-this-report>` (or use `--apply` if Section 6 permitted it)
- Open a PR: `--pr` flag (also gated on Section 6 ≥ 90 %), or manually with the diff above
```

If a future user wants machine-readable metadata, the header is regular enough
to grep — and a real consumer can be added later without breaking past
reports.

---

## Applying the Proposed Change

`--apply` is gated on **two** preconditions, in order:

1. **Step 5 confidence ≥ 90 %.** If the gate failed, `--apply` is refused — the agent prints the score and the report path and stops.
2. **Explicit user confirmation.** Even with the gate passing, the agent must show the diff and ask before running `git apply`.

When both preconditions are met:

1. Print the unified diff to the conversation.
2. Ask for confirmation. Auto mode does not bypass this.
3. On confirm: extract the diff block from the report and run `git apply` from `skills/autonomous-workflow/`.
4. If `git apply` fails, fall back to manual `Edit` / `Write` based on the Before/After blocks. Treat any difference between the diff and the actual edit as a fresh decision and re-confirm.
5. Report which files changed.

When the agent operates from a copy of this skill that is not a checked-out repo (e.g. `~/.claude/skills/autonomous-workflow/` symlinked to a read-only path), `--apply` resolves the real source via `readlink -f` first.

---

## Sharing the Improvement Upstream

The diagnosis report is designed to be shareable. Other users improve their local skill in two ways:

1. **Receive a report file** — drop the `diagnose-*.md` into their `agent-skills.git` checkout and run `git apply` on the embedded diff.
2. **Pull an upstream PR** — when `--pr` is used, the PR carries the report as its description and the diff as its commit, so any user who pulls the merged change inherits the fix.

The report is intentionally provider-neutral: another agent harness (Codex, Cursor, OpenCode) can read the report, apply the diff, and benefit from the improvement without needing this Claude Code session.

---

## Hard Rules

- **Diagnose Mode never modifies user product code.** It only proposes changes to the `autonomous-workflow` skill source.
- **Diagnose Mode never auto-applies.** `--apply` requires (a) Step 5 confidence ≥ 90 % and (b) explicit user confirmation, in that order. `--pr` requires a successful local apply first. Auto mode does not bypass either check.
- **No `--apply` without confidence.** If `Skill("confidence", "bug-analysis")` returns < 90 %, `--apply` is refused even if the user passed the flag — the report becomes a discussion artifact.
- **Every diagnosis cites a taxonomy class.** Either an existing row, or `F-novel` plus a proposed new row. New rows are appended only when a diagnosis clears the confidence gate AND the user approves the apply.
- **Earliest-phase fix wins.** When multiple phases could have caught the failure, propose the change at the earliest phase — failing fast saves the most tokens.
- **Mechanical checks beat judgment checks.** A deterministic rule that can be evaluated without an LLM call is always preferred over an LLM-judged review step.
- **One proposal per report.** If the analysis surfaces multiple independent gaps, run Diagnose Mode again per gap rather than bundling fixes.
- **The agent does not weaken existing gates.** Proposals that *remove* or *relax* an existing check require the user to type the change manually — Diagnose Mode will surface the analysis but will not pre-fill an apply diff for a relaxation.

---

## References

- [`SKILL.md`](../SKILL.md) — orchestrator entry point, lists the diagnose flag.
- [`rules/companion-skills.md`](./companion-skills.md) — registry of every gate that a diagnosis might propose changing.
- [`rules/safety-guardrails.md`](./safety-guardrails.md) — existing validation checkpoints that the matrix maps onto.
- [`references/error-recovery-scenarios.md`](../references/error-recovery-scenarios.md) — pre-existing failure transcripts useful as worked examples.
