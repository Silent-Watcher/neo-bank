# 007 — Agent workflow rules for delegated validation, decision records, and testing

## Original Request

> i want to add 3 rules to the AGENTS.md file:
>
> - give some tasks like formating, linting, runnning tests, run typecheck commands to a subagent and read the report of subagent instead of doing it byyourself
> - if we are adding something or changing something or anything that be worthy to be mentioned as ADR inside decisions.md propose one and ask me for permission if its ok to be added or not
> - writing unit tests with following AAA principle with integeration tests are very important to us . so we write tests for our features
>
> (rules were reworded into clear English, as requested)

## Implementation

Updated `AGENTS.md` in three places:

1. **Delegated Validation** (new subsection under Agent Workflow): validation tasks such as formatting, linting, tests, and type checking must be delegated to a subagent, and the agent must base its conclusions on the subagent's report.
2. **Decision Records**: the agent must proactively propose an architecture decision record for changes significant enough to warrant one, and ask the user for permission before adding it to `DECISIONS.md`; approved records are created with **Pending** status (existing rule preserved).
3. **Code Quality and Testing**: unit tests for features must follow the Arrange–Act–Assert (AAA) pattern and be accompanied by integration tests where the feature warrants end-to-end verification.

## Validation

- Documentation-only change; per the AGENTS.md rules, lint, test, and run verification were skipped because no source code changed.
- Final diff reviewed: only `AGENTS.md` and this record were modified or added.

## Notes

- No commit made; awaiting explicit user approval per the commit workflow rules.
