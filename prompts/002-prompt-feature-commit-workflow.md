# Prompt, Feature, and Commit Workflow

## User prompt

Use one prompt file per user prompt. Treat subsequent prompts as correction features: collect each prompt with the work completed in its own prompt file, then include that file with the feature changes in one commit. Follow one prompt, one feature, one prompt file, and one commit. Do not create many commits; wait for user approval before committing. Move agent rules into `AGENTS.md`. Run tests in pre-push; keep formatting and linting of staged files in pre-commit.

## Completed work

Consolidated the initial scaffold request into one prompt record, added this workflow prompt record, added repository agent rules, and configured a test-only pre-push hook. No commit was created because approval has not been granted.
