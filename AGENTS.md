# Agent Workflow

## Feature records and commits

1. Treat each user prompt as one feature unless the user explicitly splits it.
2. Create one prompt record in `prompts/` for that feature. Include the user request and a concise record of the completed work.
3. Make no more than one commit for that feature.
4. Include the feature's prompt record in that commit.
5. Never create a commit until the user explicitly approves it.

## Required checks

- Before committing, run the checks relevant to the changed feature.
- Pre-commit formats and lints staged supported files.
- Pre-push runs the repository test suite.

## Process cleanup

- Stop every development server, preview server, test watcher, and child process started for a task before reporting completion.
- Terminate active command sessions after collecting the required result; do not leave application ports listening.
- The execution platform owns the sandbox lifecycle. Clean up processes started inside it, but do not attempt to terminate the host sandbox.
