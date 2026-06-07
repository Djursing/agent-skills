#!/usr/bin/env node
// L2 — Behavioral eval: does the `aw` dispatcher route tasks to the right tier?
//
// This RUNS A MODEL (unlike L1). It feeds the dispatcher's ACTUAL tier-detection
// rubric (read live from dispatcher.template.md) + each golden task to the model,
// parses the emitted tier, and compares to the human-labelled expected tier.
//
// Tier routing is a CLASSIFICATION task with a deterministic label, so we use
// exact-match scoring — NOT LLM-as-judge (no judge bias to manage).
//
//   ANTHROPIC_API_KEY=sk-... node scripts/eval/l2-tier-routing.mjs
//   EVAL_MODEL=claude-sonnet-4-6 ... (override actor model)
//
// Report-only by design: the golden set is < 50 cases, which the repo's own
// evals.md calls "statistically noisy — do not gate CI on it." Grow to ≥ 50
// before adding `--gate`. Skips cleanly (exit 0) when no API key is present.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;

if (!KEY) {
  console.log("⊘ L2 tier-routing: no ANTHROPIC_API_KEY — skipping (this is an LLM eval; set the key to run).");
  process.exit(0);
}

// Read the dispatcher's real tier-detection section so the eval tests the SHIPPED rubric.
const tpl = readFileSync(join(REPO_ROOT, "skills/workflow/autonomous-workflow/templates/dispatcher.template.md"), "utf8");
const rubric = tpl.split("## Tier detection")[1]?.split("\n## ")[0]?.trim();
if (!rubric) { console.error("could not extract '## Tier detection' from dispatcher.template.md"); process.exit(2); }

const system = `You are the autonomous-workflow dispatcher. Using ONLY the tier-detection rules below, classify the task into exactly one tier. Reply with a single word: Micro, Lite, or Full. No explanation.

${rubric}`;

const cases = readFileSync(join(REPO_ROOT, "scripts/eval/golden/tier-routing.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function classify(task) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8, system, messages: [{ role: "user", content: `Task: ${task}` }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || "").trim();
  const m = /\b(Micro|Lite|Full)\b/i.exec(text);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : `?(${text})`;
}

const results = [];
for (const c of cases) {
  let got;
  try { got = await classify(c.task); } catch (e) { got = `ERR(${e.message.slice(0, 40)})`; }
  const ok = got === c.expected;
  results.push({ ...c, got, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${c.id}: expected ${c.expected}, got ${got}`);
}

const pass = results.filter((r) => r.ok).length;
const acc = ((pass / results.length) * 100).toFixed(1);
console.log(`\nTier-routing accuracy: ${pass}/${results.length} (${acc}%)  model=${MODEL}`);

const misses = results.filter((r) => !r.ok);
if (misses.length) {
  console.log("\nMisses (inspect — a miss is either a model error OR a too-vague rubric/golden label):");
  for (const m of misses) console.log(`  - ${m.id}: ${m.expected}→${m.got}  «${m.task}»`);
}
// Report-only: always exit 0 (golden set < 50). When you grow it to ≥ 50, gate here.
process.exit(0);
