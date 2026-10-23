# Process Cleanup Rule

## User prompt

When applications are run to validate work, terminate their ports and clean up the sandbox after finishing.

## Completed work

Added the process-cleanup rule to `AGENTS.md`. Agents must stop every application process and watcher they start, terminate their command sessions, and leave no development ports listening before completion. The host sandbox itself is platform-managed and cannot be terminated by an agent.
