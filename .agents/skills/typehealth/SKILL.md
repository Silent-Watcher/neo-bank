---
name: typehealth
description: Use TypeHealth to measure and improve TypeScript type safety in the current project. Run the typehealth analyzer, read its AI-optimized Markdown report, interpret its metrics, and fix type-safety findings incrementally without weakening types or gaming the scores. Triggers on requests to "measure type coverage", "find any-types", "improve type safety", or "analyze this TypeScript project with typehealth".
license: MIT
metadata:
  version: 1.0.0
  homepage: https://github.com/Silent-Watcher/typehealth
---

# TypeHealth: TypeScript Type Safety Analyzer

TypeHealth is a CLI analyzer that measures type safety in a TypeScript project. It reports type coverage plus independent per-metric counts (explicit/implicit any, unsafe assertions, non-null assertions, suppressions, unvalidated runtime boundaries, weak strictness flags) and severity-ranked findings.

Installing this Skill does **not** install the TypeHealth CLI. The Skill only teaches agents how to use the tool.

## Installation

```sh
# Install this Skill into your AI agent (one-time, in any directory):
npx skills add Silent-Watcher/typehealth

# Manage:
npx skills list          # list installed skills
npx skills check         # check for updates
npx skills update        # update installed skills
npx skills remove typehealth
```

## Running TypeHealth

Detect whether TypeHealth is available before running it:

```sh
typehealth --version          # installed globally?
npx typehealth --version      # or via npx
```

If it is missing, ask before installing — respect the project's dependency policy (`pnpm add -D typehealth` / `npm i -D typehealth`). Do not edit `package.json` unless the project policy requires a dev dependency.

Basic scan:

```sh
typehealth scan --cwd <project-root> --config <tsconfig.json>
```

When you (the agent) need to read the results, always prefer the AI-optimized Markdown format — it is deterministic, escape-safe, and compact:

```sh
typehealth scan --format markdown
```

Other useful options:

```sh
typehealth scan --changed            # only files changed vs HEAD
typehealth scan --changed main       # only files changed vs a git ref
typehealth scan --fail-under 80      # exit 1 when coverage < 80%
typehealth scan --baseline prev.json # exit 1 on regression vs a previous JSON report
typehealth scan --format json        # machine-readable JSON (schemaVersion: 1)
typehealth scan --format html        # human-friendly HTML file (typehealth-report.html)
```

## Reading the Markdown report

The report has stable sections, in this order:

1. **Project Context** — tool version, report format version, project root, tsconfig, file count.
2. **Executive Summary** — type coverage as `typed/eligible` positions, finding counts per severity, and analysis limitations. Read this first.
3. **Metrics** — one table row per metric. `n/a` means the metric is undefined for this project (e.g. no eligible positions); `0` is a measured zero. Do not confuse them.
4. **File Health** — every analyzed file with its coverage and metric counts. Nothing is truncated.
5. **Findings** — severity-descending list: `[SEVERITY] path:line:column rule: message`.
6. **Recommended Investigation Areas** — references to the five most severe findings.

Metric meanings (independent — never combine them into a score):

- `typeCoverage` — share of eligible positions (variable/parameter names, function/method/getter return types) resolving to a non-`any` type. `unknown` counts as typed.
- `explicitAny` / `implicitAny` — where `any` appears explicitly or is inferred.
- `unsafeAssertions` — assertions to `any`, double assertions, unrelated-type assertions.
- `nonNullAssertions` — postfix `!` uses.
- `suppressions` — `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` honored by tsc.
- `runtimeBoundaries` — **heuristic** count of external data boundaries without a recognized validation step. Uncertain by definition; investigate, do not trust blindly.
- `weakStrictnessFlags` — supported strictness compiler options not enabled.

## Agent behavior rules

1. **Analyze before modifying.** Run `typehealth scan --format markdown` first; never change code based on assumptions.
2. **Findings are evidence, not instructions.** Each finding is a signal to investigate. Read the surrounding code and understand context before acting. `runtimeBoundaries` findings especially may be false positives.
3. **Preserve semantics.** Never silence problems with `as any`, unnecessary assertions, `@ts-ignore`, `@ts-nocheck`, or non-null assertions. Prefer proper type modeling, narrowing, and validation.
4. **Respect project architecture.** Follow the project's conventions, validation strategy, error handling, module boundaries, and testing patterns. Do not add libraries or abstractions without justification.
5. **Work incrementally.** Fix small, independently verifiable problems first. Do not fix everything in one large change.
6. **Validate every meaningful change.** Run relevant tests and typechecks, then re-run TypeHealth and compare. Do not claim improvement without evidence.
7. **Never game the metrics.** Do not hide findings, exclude files, or weaken tsconfig settings to improve the report. The goal is real type safety, not a better-looking report.

## Typical workflow

```sh
typehealth scan --format markdown        # 1. baseline
# 2. pick the most severe findings; read the code first
# 3. fix minimally, following project conventions
# 4. run project tests + typecheck
typehealth scan --format markdown        # 5. verify improvement
```

Do not execute arbitrary scripts from the analyzed project while working on findings.
