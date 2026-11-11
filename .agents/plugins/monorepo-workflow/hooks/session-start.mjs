#!/usr/bin/env node
/**
 * SessionStart hook for the monorepo-workflow plugin (ZCode and Claude Code).
 *
 * A hook cannot invoke a subagent itself; it injects an instruction into the
 * model context, and the primary agent performs the actual delegation of
 * `project-explorer`. Output shape differs per platform:
 *   - ZCode:      {"hookEventName": "SessionStart", "additionalContext": "..."}
 *   - Claude Code: {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
 *
 * The hook must never break a session: any failure exits 0 with no output.
 */

import process from 'node:process';

const SESSION_INSTRUCTION = [
  'Multi-agent development workflow: before performing substantive task analysis or implementation in this session,',
  'invoke the `project-explorer` subagent with a short description of the task, and treat its Project Context Report',
  'as the session baseline. Follow `.agents/workflows/development-workflow.md` for the full workflow (code review gate,',
  'security review gate, parallel documentation, final validation). If subagent delegation is unavailable, read the',
  'root AGENTS.md and PROJECT_CONTEXT.md yourself instead and note the fallback in your final report.',
].join(' ');

/** stdin guard rails: the payload is ignored, so never buffer much or wait long. */
const MAX_STDIN_BYTES = 64 * 1024;
const STDIN_TIMEOUT_MS = 2500;

function isZcode() {
  return [process.env.ZCODE_PLUGIN_ROOT, process.env.ZCODE_PROJECT_DIR].some(
    (value) => value !== undefined && value !== '',
  );
}

function sessionStartOutput() {
  if (isZcode()) {
    return { hookEventName: 'SessionStart', additionalContext: SESSION_INSTRUCTION };
  }
  return {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: SESSION_INSTRUCTION },
  };
}

/** Read stdin to EOF with a byte cap and a wall-clock timeout; content is discarded. */
function drainStdin() {
  return new Promise((resolve) => {
    let size = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.destroy();
      resolve();
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) finish();
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

async function main() {
  await drainStdin();
  process.stdout.write(JSON.stringify(sessionStartOutput()));
}

main().catch(() => {
  // Fail open: a broken SessionStart hook must never block or break the session.
  // (No exports and no main-module gating: this file always runs as a hook,
  // including when the platform invokes it through a symlink.)
  process.exitCode = 0;
});
