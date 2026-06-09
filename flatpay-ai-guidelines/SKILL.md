---
name: flatpay-ai-guidelines
description: >
  Flatpay internal AI coding guidelines enforcer. Reads and applies Flatpay's
  engineering standards from ~/.agents/skills/ai-guidelines/. Run install.sh
  for always-on enforcement via a rules file in ~/.claude/rules/. Explicit
  invocation triggers on: "check flatpay guidelines", "apply flatpay guidelines",
  "review against flatpay standards", "/flatpay-ai-guidelines",
  "flatpay guidelines audit", "guidelines check".
metadata:
  author: flatpay
  version: "1.0.0"
  workflow_type: advisory
---

# Flatpay AI Guidelines

Read and apply Flatpay's internal AI coding guidelines before doing any work.

## Step 1 — Read Guidelines

Read `~/.agents/skills/ai-guidelines/CLAUDE.md`. That file is the authoritative
entry point — it defines which additional files apply to the current task.
Follow any further reading instructions it contains.

## Step 2 — Apply Guidelines

Apply every rule found (including those from any files referenced by CLAUDE.md)
to all code you write, review, or suggest in this session. These guidelines
take priority over default behavior.

## Installation

Run `bash install.sh --global` once to install the always-on rules file into
`~/.claude/rules/`. After that, Claude Code loads the guidelines automatically
at the start of every session — no explicit invocation needed.
