# Validation Timing and Commit Workflow Rules

## User prompt

Add two rules to `AGENTS.md`:

1. For every short step, do not run all the formatting, linting, and test commands, and do not run all run scripts to verify that all apps are running. After a feature is added or the prompt target is reached, only run the formatter and linter and then the tests to verify everything is working correctly.
2. Whenever the user commands a commit, do not check Commitlint yourself — the Git hooks automatically catch wrong commit message formats. Use Commitizen when submitting a commit: just call `git cz` and answer the prompts.

Follow-up request (recorded here instead of a new record by user instruction, just this once):

- When modifying files that do not relate to the main source code, do not run lint or test commands or verify that the apps still work, because no source code is changed.

## Completed work

- Added validation-timing rules to the `Code Quality and Testing` section of `AGENTS.md`: full formatting, linting, and test runs, as well as starting run scripts to verify that all applications are running, are reserved for feature completion; short intermediate steps do not trigger them.
- Added commit rules to the `Git and Commits` section of `AGENTS.md`: commits are created through Commitizen (`git cz` or `pnpm cm`) by answering its prompts instead of hand-writing `git commit -m` messages, and Commitlint is not run manually because the Husky `commit-msg` hook validates commit messages automatically.
- Added a non-source-change rule to the `Code Quality and Testing` section of `AGENTS.md`: changes that do not touch main source code (for example documentation or prompt records) do not run lint or tests and do not verify that the applications still run, because no source code changed.

## Validation

Initial source-workflow change:

- `pnpm format` passed.
- `pnpm lint` passed.
- `pnpm test` passed.

Follow-up non-source change (markdown only): validated with `pnpm format` only, per the new non-source-change rule.
