---
title: Input Detection — React vs Chrome vs cpuprofile
impact: HIGH
tags:
  - input-detection
  - file-format
  - intake
---

# Input Detection

Decide which profile format the user passed. Detection is by file shape, not
extension — both React and Chrome use `.json`.

## Decision flow

Read the first ~64 KB of the file (use `head -c 65536` then attempt JSON
parse of the buffer; for very small files, read it all).

| Top-level key signature                                   | Format                       | Notes                                              |
| --------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `dataForRoots` AND `rendererID` (or `version`)            | React DevTools Profiler      | Single root array under `dataForRoots`             |
| `traceEvents` (array of objects with `ph`, `ts`, `cat`)   | Chrome Performance trace     | DevTools-saved trace                               |
| Top-level array starting with `{"args":...,"cat":..."ph":` | Chrome trace (array form)   | Older / minimal format                             |
| `nodes` AND `samples` AND `timeDeltas`                    | Chrome `.cpuprofile`         | Legacy CPU profiler, importable into Performance   |
| Magic bytes `1f 8b`                                       | gzipped — `gunzip -k`, retry | Common for large traces                            |

If none match, ask the user to identify the source. Do not guess.

## Quick checks

Run these in order. The first match wins.

```bash
# 1. Gzipped?
file -b "<path>" | grep -q gzip && gunzip -k "<path>"

# 2. Try React DevTools shape
jq -e 'has("dataForRoots") and (has("rendererID") or has("version"))' "<path>" >/dev/null 2>&1 \
  && echo "react-profiler"

# 3. Try Chrome trace (object form)
jq -e 'has("traceEvents") and (.traceEvents | type == "array")' "<path>" >/dev/null 2>&1 \
  && echo "chrome-trace"

# 4. Try Chrome trace (array form)
jq -e 'type == "array" and (.[0] | has("ph") and has("ts"))' "<path>" >/dev/null 2>&1 \
  && echo "chrome-trace-array"

# 5. Try cpuprofile
jq -e 'has("nodes") and has("samples") and has("timeDeltas")' "<path>" >/dev/null 2>&1 \
  && echo "cpuprofile"
```

Prefer `jq` for structural detection. Avoid loading the full file into
memory if it is > 50 MB — Chrome traces from real apps routinely exceed
200 MB. Use streaming parsers (`jq --stream` or `gron`) when needed.

## Sanity checks before trusting the file

| Check                                                                 | Why                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| File size > 1 KB                                                      | Empty or near-empty profiles capture nothing useful          |
| For React: `dataForRoots` is a non-empty array                        | A profile with no commits cannot be analysed                 |
| For Chrome: at least one event with `cat` containing `devtools.timeline` | Confirms it was saved from the Performance panel             |
| For Chrome: total wall-clock duration ≥ 100ms                          | Sub-100ms traces are too short to identify long tasks         |
| Recording was made on a representative device profile                  | Ask if uncertain — desktop CPU 4× throttle ≠ real mobile     |

If any sanity check fails, surface it to the user before continuing — bad
inputs produce confidently wrong fixes.

## Examples

### Good — minimal React profile shape

```json
{
  "version": 5,
  "rendererID": 1,
  "dataForRoots": [
    {
      "rootID": 1,
      "displayName": "App",
      "commitData": [/* ... */],
      "operations": [/* ... */]
    }
  ]
}
```

### Good — Chrome trace shape

```json
{
  "traceEvents": [
    {"name": "RunTask", "cat": "devtools.timeline", "ph": "X",
     "ts": 1234567890, "dur": 142000, "tid": 1, "pid": 12345,
     "args": {"data": {"type": "RunTask"}}}
  ],
  "metadata": {"source": "DevTools", "startTime": "2026-04-01T..."}
}
```

### Bad — wrong file passed

```json
{ "name": "my-app", "version": "1.0.0", "dependencies": {} }
```

`package.json` is not a profile. Reject and ask the user for the correct file.

## Common mistakes

- **Trusting the extension.** React saves to `.json`; Chrome saves to
  `.json`. **Fix:** always inspect file shape.
- **Forgetting gzip.** Chrome offers compressed `.json.gz` for sharing.
  **Fix:** check magic bytes first.
- **Loading 200 MB into a single `Read` call.** **Fix:** use streaming jq
  or extract only the keys you need.
