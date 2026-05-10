---
title: Observability & Versioning — Tracing, Prompts-as-Code, A/B Releases
impact: HIGH
tags:
  - observability
  - tracing
  - opentelemetry
  - langfuse
  - prompt-versioning
---

# Observability & Versioning

Without traces in production, you cannot do error analysis.
Without error analysis, you cannot do evals.
Without evals, prompt changes are guesses.

Observability is the foundation of every other rule in this skill.

## Contents

- Trace every LLM call (fields, stack: Langfuse, OTEL)
- Span hierarchy for agents
- Redact PII before logging
- Sampling policy — keep all errors and slow paths
- Prompts as code (in-repo, semver, tested)
- A/B release new prompt versions
- Alert on the right things
- Common mistakes

## 1. Trace every LLM call

For every model call, record:

| Field                | Why                                                            |
| -------------------- | -------------------------------------------------------------- |
| Full prompt (input)  | The eval input. Without it, you cannot reproduce a failure.    |
| Full response        | The eval expected/actual.                                      |
| Model + version      | Comparing "claude-sonnet-4-6" vs "4-7" requires the version.   |
| Token counts         | Cost attribution and cache-hit rate.                           |
| Latency              | TTFT and total. Distinct metrics.                              |
| Cache read/write     | Anthropic returns `cache_read_input_tokens` etc.               |
| Tool calls + results | Full nested span tree for agents.                              |
| User / session ID    | Correlation across traces.                                     |

Minimum viable stack (Q1 2026):

- **Langfuse** (open-source, self-hostable) — turnkey LLM tracing.
- **OpenTelemetry** — converging standard.
  Pydantic AI, smolagents, Strands, OpenAI Agents SDK all emit OTEL
  natively.
- **Helicone, Braintrust, Arize Phoenix** — commercial alternatives.

Source: [Langfuse — Tracing](https://langfuse.com/docs/observability/get-started).

## 2. Span hierarchy for agents

Agent calls produce nested spans:

```text
session
└── turn-3
    └── agent-loop
        ├── llm-call (iter 1)
        ├── tool-call: search_customers
        │   └── (database query span if instrumented)
        ├── tool-call: get_account_summary
        │   └── (database query span)
        └── llm-call (iter 2)
```

Without the hierarchy, debugging "why did the agent loop 8 times?" is
impossible.

Pattern:

- One root span per turn.
- Child span per LLM call.
- Sibling spans per tool call.
- Errors propagate up; mark the failing span first.

Source: [Langfuse — OpenTelemetry integration](https://langfuse.com/integrations/native/opentelemetry).

## 3. Redact PII before logging

The trace store is a long-lived data store.
Treat it like any other PII surface:

- Run PII redaction on prompts and responses **before** they hit the
  trace tool.
- Maintain a redaction allowlist (some traces are anonymised analytic
  data, not PII).
- Fail closed: if redaction errors, drop the trace.

See `safety-and-guardrails.md` for the redactor choice.

## 4. Sample, then keep everything that errors

100% trace retention is expensive at scale.
Default policy:

- **All errors:** kept.
- **Slow traces** (> p95 latency): kept.
- **Low confidence / validator failure:** kept.
- **Random sample of successes:** 1–5% kept.

The error/slow/low-confidence subset is what feeds error analysis.
Successes are sampled for trend monitoring.

## 5. Prompts as code

Treat prompts as code:

- **In repo.**
  Not in a database, not in a vendor dashboard.
  The version that shipped is the version in git.
- **Reviewed in PR.**
  Diffs are reviewable; conflicts are mergeable.
- **Tagged with semver.**
  Major bump on contract change, minor on rule change, patch on fix.
- **Tested.**
  Every prompt change runs the golden set (see `evals.md`).

Tooling:

- **In-repo + custom router.**
  Cheapest, most flexible.
  Pattern: `prompts/triage.v3.md` files loaded by a router that picks
  the active version from config.
- **Promptfoo, PromptLayer, Braintrust.**
  Specialist tools with diff/eval/AB built in.
  Useful when many non-engineers edit prompts.

Source: [PromptLayer — Prompt Versioning](https://www.promptlayer.com/glossary/prompt-versioning/).

## 6. A/B release new prompt versions

Never flip a prompt globally.
Pattern:

```text
v3 → v4
  → 5% traffic on v4 for 24h
  → compare metrics: task accuracy, latency, cost, satisfaction
  → 50% traffic for 48h
  → 100% if metrics hold
  → rollback path stays open for 7 days
```

The metric set must include:

- Eval-driven (golden set pass rate).
- Production-driven (validator failure rate, user thumb-down rate).
- Cost (input + output tokens per request).
- Latency (p50, p95).

Rollback is a config flip, not a redeploy.

Source: [PromptLayer — A/B releases](https://docs.promptlayer.com/why-promptlayer/ab-releases).

## 7. Alert on the right things

Useful alerts:

- **Validator failure rate > N%** — schema drift or model regression.
- **Cache hit rate dropped** — someone changed the stable prefix.
- **p95 latency > N ms** — model degradation or load.
- **Cost per request up > 2σ** — token bloat or routing regression.
- **User thumb-down rate up** — leading indicator of quality regression.

Useless alerts (that teams set anyway):

- "Model returned an empty response" — usually a downstream timeout,
  not a model issue.
- "Token count > N" — only matters relative to budget.
- "Tool call failed" — expected; agent should recover.

## Common mistakes

- **No tracing in prod.**
  **Fix:** Langfuse / OTEL — anything is better than nothing.
- **Logging raw PII to the trace store.**
  **Fix:** redact before logging.
- **Prompts edited in a vendor dashboard, not in git.**
  **Fix:** in-repo prompts; dashboard is for reading, not authoring.
- **Globally flipping a new prompt version.**
  **Fix:** A/B at 5% → 50% → 100%.
- **Alerting on every tool failure.**
  **Fix:** alert on validator failure rate and user thumb-down — leading
  indicators that matter.
- **No span hierarchy on agent traces.**
  **Fix:** one root per turn; nest LLM and tool calls.
