---
title: Telemetry Verification — Confirm the Fix in Production
impact: MEDIUM
tags:
  - telemetry
  - dash0
  - post-deploy
  - production-verification
  - closed-loop
---

# Telemetry Verification

Phase 8. Runs only when the original input was a telemetry source (Dash0 span / log / web event).
The fix is not done at PR merge — it is done when the originating signal **stops firing in
production**.

Source: [Datadog Watchdog Faulty Deployment Detection](https://docs.datadoghq.com/watchdog/faulty_deployment_detection/),
[Sentry + Datadog collaborative bug-fixing](https://blog.sentry.io/collaborative-bug-fixing-with-datadog/).
The pattern is the same across vendors: tag the deploy, poll the original query filtered by the
release tag, decide based on rate decay.

## Contents

- [When this phase runs](#when-this-phase-runs)
- [MCP capability gate](#mcp-capability-gate)
- [Procedure](#procedure)
- [Outcomes](#outcomes)

---

## When this phase runs

Runs only when **all** hold:

- Phase 0 classified the input as a Dash0 / telemetry URL.
- Phase 7 verifier returned green and the PR was undrafted.
- The PR has been merged and deployed to the environment that produced the original signal
  (this is typically not while `/fix-bug` is still in the foreground — see [Outcomes](#outcomes)).

Skipped silently when the input was not a telemetry URL.

---

## MCP capability gate

Detect whether the Dash0 MCP exposes the tools needed to poll a saved query with a release-tag
filter:

| Capability | Required tool (or equivalent) |
|------------|------------------------------|
| Run a saved query / metric query | `mcp__dash0__run_query` (name may vary) |
| Filter by release / deploy tag | The query supports a `service.version` or `deployment.version` parameter |
| Return a numeric rate (events/min or events/hour) | The query result includes a count or rate field |

If any capability is missing, skip Phase 8 and print:

```text
Telemetry verification unavailable: Dash0 MCP missing required capability
(<capability>). Skipping post-deploy poll. Manually re-check the originating
query for a rate decay after deploy.
```

Append the skip to the bug-notes ledger.

---

## Procedure

### Step 8a — Capture the deploy ID

When the PR is merged, capture the deploy / release identifier. Sources, in order:

1. PR labels matching `release/*` or `deploy/*`.
2. The merge commit's `service.version` if the executor wrote it (per the project's deploy
   pipeline).
3. The CI run that built the merge commit — its build number serves as the release ID.

If no deploy ID is recoverable, flag in the bug-notes ledger and skip Phase 8.

### Step 8b — Build the verification query

Take the originating query from the Evidence Record's `Sources.Dash0` field. Add a filter:

```text
service.version = "<deploy_id>"
time_range = [deploy_timestamp, deploy_timestamp + 30 minutes]
```

The filter scopes the poll to **only** events from the new deploy. A rate-decay claim only holds
if compared to events from the fix's release tag.

### Step 8c — Poll

Poll the verification query at fixed intervals. Recommended cadence:

| Time elapsed | Cadence |
|--------------|---------|
| 0–10 min     | Every 1 min |
| 10–30 min    | Every 5 min |

Stop polling when **either** holds:

- Rate has decayed below threshold (default: 5% of the pre-fix baseline rate).
- 30-minute budget exhausted.

### Step 8d — Evaluate

Compute the rate over the budget window. Compare to the **pre-fix baseline** (the rate observed
in the Evidence Record's source span at original-bug time).

| Outcome | Condition | Action |
|---------|-----------|--------|
| **Decayed** | Post-deploy rate ≤ 5% of pre-fix baseline | Phase 8 passes. Append to bug-notes ledger. Comment on Linear / PR with the post-deploy rate. |
| **Persistent** | Post-deploy rate > 5% of pre-fix baseline at the 30-min mark | Reopen the bug. Append `Phase 8: persistent — rate did not decay` to the bug-notes ledger. Comment on Linear / PR. |
| **Inconclusive** | Total events < 10 in the 30-min window (low traffic) | Extend the budget to 24 h, or note in the bug-notes ledger that production traffic was insufficient to verify. |

---

## Outcomes

### Operating mode

`/fix-bug` is typically not running in the foreground when the deploy actually happens. Phase 8
runs in one of two modes:

| Mode | When | How |
|------|------|-----|
| **Inline** | The deploy completes within the same session as the merge (e.g., dev environment with auto-deploy on merge) | Run synchronously after merge confirmation |
| **Deferred** | Production deploys happen later (release trains, manual cuts) | Emit a follow-up task: a Linear comment with the verification query, the deploy filter, and a 30-minute polling reminder. The user (or a CI hook) re-invokes `/fix-bug --verify-deploy <PR>` once the deploy lands. |

Default to **deferred** — most production teams do not auto-deploy on merge. The inline mode is
opt-in via a `--inline-verify` flag if the project has auto-deploy.

### Reopened bugs

If Phase 8 returns `persistent`, the bug is reopened with the verification artefact (poll results,
deploy ID, comparison rates). The user decides whether to:

- Roll back the deploy.
- Iterate with `aw-executor` on the same branch (treat the persistent rate as a counterexample).
- Investigate whether the bug class was misdiagnosed (e.g., a config bug shipped as a code bug).
