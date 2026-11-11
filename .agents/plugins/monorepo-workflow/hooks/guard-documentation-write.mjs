#!/usr/bin/env node
/**
 * PreToolUse hook (Write|Edit|MultiEdit|NotebookEdit) enforcing the
 * documentation-only write policy of the `documentation-writer` subagent on
 * ZCode and Claude Code.
 *
 * Behavior:
 *   - Only acts when the hook input identifies the caller as
 *     `documentation-writer` (input carries `agent_type`; both platforms
 *     expose the subagent name there — ZCode as `zcode-<agentType>` with
 *     agentType `plugin:agent`, Claude Code as the bare agent name). Any
 *     other caller — including the primary agent — passes through untouched.
 *   - The guarantee covers the write-capable tools the platforms expose for
 *     file targets: Write, Edit, MultiEdit, NotebookEdit.
 *   - Allows writes inside documentation paths only (see the ALLOWED
 *     constants). Any symlinked path component between the repository root
 *     and the target — resolvable or dangling — is denied outright, because
 *     its real target cannot be verified to stay inside the boundary.
 *   - Denies everything else for that agent, with a platform-shaped decision:
 *       Claude Code: {"hookSpecificOutput": {"hookEventName": "PreToolUse",
 *                    "permissionDecision": "deny", "permissionDecisionReason": "..."}}
 *       ZCode:       {"hookEventName": "PreToolUse", "permissionDecision": "deny",
 *                     "permissionDecisionReason": "..."}
 *
 * Verification: `node guard-documentation-write.mjs --self-test` runs the
 * decision function against synthetic payloads and reports PASS/FAIL.
 *
 * Fail-open on internal errors: the prompt-level policy in the definition
 * remains; a broken hook must never block the primary agent.
 */

import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const GUARDED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const GUARDED_AGENT = 'documentation-writer';

/** Root-level documentation files the agent may modify. */
const ROOT_DOC_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'PROJECT_CONTEXT.md',
  'DECISIONS.md',
  'DEFERRED.md',
  'README.md',
]);

/** Prefix directories (relative POSIX paths) the agent may modify. */
const ROOT_DOC_DIRECTORIES = ['docs/', 'prompts/'];

/** Per-app documentation files, e.g. apps/api/AGENTS.md or apps/web/ONBOARDING.md. */
const APP_DOC_PATTERN = /^apps\/[^/]+\/(?:AGENTS|ONBOARDING)\.md$/;

function projectRoot() {
  return process.env.ZCODE_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/**
 * True when any path component between `repoRoot` and `absolutePath` is a
 * symlink (resolvable or dangling). A symlinked component could resolve
 * anywhere — including outside the repository — so its real target cannot
 * be verified and the write is rejected.
 */
function containsSymlinkComponent(absolutePath, repoRoot) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative === '' || relative.startsWith('..')) return false;
  let current = repoRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) return true;
    } catch {
      // Component does not exist yet (fresh write); nothing below can be a symlink.
      return false;
    }
  }
  return false;
}

function isDocumentationPath(absolutePath, repoRoot) {
  const relative = path.relative(repoRoot, absolutePath);
  // Outside the repository (or the repository root itself) is never allowed.
  if (relative === '' || relative.startsWith('..')) return false;
  const posixPath = toPosix(relative);
  if (ROOT_DOC_FILES.has(posixPath)) return true;
  if (ROOT_DOC_DIRECTORIES.some((directory) => posixPath.startsWith(directory))) return true;
  return APP_DOC_PATTERN.test(posixPath);
}

/**
 * The guarded identity is matched on the agent id's last segment (after `:`
 * or `/`), so plugin-qualified ids (`zcode-monorepo-workflow:documentation-writer`,
 * `documentation-writer`) match exactly without capturing unrelated agents.
 */
function isGuardedAgent(agentType) {
  if (typeof agentType !== 'string') return false;
  const lastSegment = agentType.split(/[:/]/).pop() ?? '';
  return lastSegment === GUARDED_AGENT;
}

/**
 * Decide for one PreToolUse payload.
 * @returns {{action: 'pass-through' | 'allow' | 'deny', reason?: string}}
 */
export function decidePreToolUse(payload, repoRoot = projectRoot()) {
  if (payload?.hook_event_name !== 'PreToolUse') return { action: 'pass-through' };
  if (!GUARDED_TOOLS.has(payload.tool_name)) return { action: 'pass-through' };
  if (!isGuardedAgent(payload.agent_type)) return { action: 'pass-through' };

  const targetPath = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return { action: 'deny', reason: `cannot verify the target path of ${payload.tool_name}` };
  }

  const absolutePath = path.resolve(repoRoot, targetPath);
  if (containsSymlinkComponent(absolutePath, repoRoot)) {
    const displayPath = toPosix(path.relative(repoRoot, absolutePath));
    return {
      action: 'deny',
      reason: `cannot verify the real target of "${displayPath === '' || displayPath.startsWith('..') ? targetPath : displayPath}": the path contains a symlinked component. If documentation coverage requires it, return a ready-to-apply patch in your report instead.`,
    };
  }
  if (isDocumentationPath(absolutePath, repoRoot)) return { action: 'allow' };

  const displayPath = toPosix(path.relative(repoRoot, absolutePath));
  return {
    action: 'deny',
    reason: `documentation-writer may only modify documentation files; "${displayPath === '' || displayPath.startsWith('..') ? targetPath : displayPath}" is not a documentation path. If documentation coverage requires it, return a ready-to-apply patch in your report instead.`,
  };
}

/** Platform-shaped PreToolUse deny decision. */
export function denyOutput(platform, reason) {
  if (platform === 'zcode') {
    return {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function isZcode() {
  return [process.env.ZCODE_PLUGIN_ROOT, process.env.ZCODE_PROJECT_DIR].some(
    (value) => value !== undefined && value !== '',
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw) ?? {};
  } catch {
    // Diagnostic on stderr only (stdout is schema-parsed by the platform);
    // fail open so a serialization change can never block other agents.
    console.error('guard-documentation-write: unparseable hook payload; passing through');
    payload = {};
  }

  const decision = decidePreToolUse(payload);
  if (decision.action === 'deny') {
    process.stdout.write(
      JSON.stringify(denyOutput(isZcode() ? 'zcode' : 'claude', decision.reason)),
    );
    return;
  }
  // 'allow' and 'pass-through' emit nothing: the tool call proceeds normally.
}

// --self-test: exercise the decision logic offline with synthetic payloads.
export async function runSelfTests() {
  const { strict: assert } = await import('node:assert');
  let assertions = 0;
  const check = (actual, expected, message) => {
    assert.strictEqual(actual, expected, message);
    assertions++;
  };
  const root = '/repo';
  const claudeWriter = { hook_event_name: 'PreToolUse', agent_type: 'documentation-writer' };
  const zcodeWriter = {
    hook_event_name: 'PreToolUse',
    agent_type: 'zcode-monorepo-workflow:documentation-writer',
  };
  const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });
  const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });

  const cases = [
    ['allows docs write (claude)', { ...claudeWriter, ...write('docs/new-guide.md') }, 'allow'],
    ['allows root AGENTS.md edit', { ...claudeWriter, ...edit('AGENTS.md') }, 'allow'],
    [
      'allows app onboarding write',
      { ...claudeWriter, ...write('apps/api/ONBOARDING.md') },
      'allow',
    ],
    [
      'allows MultiEdit on docs',
      { ...claudeWriter, tool_name: 'MultiEdit', tool_input: { file_path: 'docs/x.md' } },
      'allow',
    ],
    ['denies source write', { ...claudeWriter, ...write('apps/api/src/main.ts') }, 'deny'],
    ['denies env file write', { ...claudeWriter, ...write('apps/api/env/.env.example') }, 'deny'],
    ['denies package manifest write', { ...claudeWriter, ...write('package.json') }, 'deny'],
    [
      'denies NotebookEdit on notebook in source tree',
      {
        ...claudeWriter,
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: 'apps/api/analysis.ipynb' },
      },
      'deny',
    ],
    ['denies path outside repo', { ...claudeWriter, ...write('/etc/hosts') }, 'deny'],
    ['denies missing file path', { ...claudeWriter, tool_name: 'Write', tool_input: {} }, 'deny'],
    ['guards zcode plugin agent id', { ...zcodeWriter, ...write('apps/api/src/main.ts') }, 'deny'],
    [
      'passes primary agent through',
      { hook_event_name: 'PreToolUse', agent_type: 'main', ...write('apps/api/src/main.ts') },
      'pass-through',
    ],
    [
      'passes similar-but-different agent through',
      {
        hook_event_name: 'PreToolUse',
        agent_type: 'documentation-writer-reviewer',
        ...write('apps/api/src/main.ts'),
      },
      'pass-through',
    ],
    [
      'passes missing agent_type through',
      { hook_event_name: 'PreToolUse', ...write('apps/api/src/main.ts') },
      'pass-through',
    ],
    [
      'passes other tool through',
      { ...claudeWriter, tool_name: 'Bash', tool_input: { command: 'ls' } },
      'pass-through',
    ],
    [
      'passes non-pretooluse through',
      {
        hook_event_name: 'PostToolUse',
        agent_type: 'documentation-writer',
        tool_name: 'Write',
        tool_input: { file_path: 'x' },
      },
      'pass-through',
    ],
  ];

  for (const [label, payload, expected] of cases) {
    const decision = decidePreToolUse(payload, root);
    check(decision.action, expected, `${label}: got ${decision.action}, expected ${expected}`);
    if (expected === 'deny')
      check(typeof decision.reason, 'string', `${label}: deny carries a reason`);
  }

  const zcodeDeny = JSON.parse(JSON.stringify(denyOutput('zcode', 'r')));
  check(zcodeDeny.hookEventName, 'PreToolUse', 'zcode shape is flat');
  check(zcodeDeny.permissionDecision, 'deny', 'zcode shape carries the decision');
  check('hookSpecificOutput' in zcodeDeny, false, 'zcode shape has no claude wrapper');

  const claudeDeny = JSON.parse(JSON.stringify(denyOutput('claude', 'r')));
  check(
    claudeDeny.hookSpecificOutput.permissionDecision,
    'deny',
    'claude shape nests the decision',
  );
  check(
    claudeDeny.hookSpecificOutput.hookEventName,
    'PreToolUse',
    'claude shape carries the event',
  );
  check('permissionDecision' in claudeDeny, false, 'claude shape has no flat decision');

  // Live symlink containment (real temp dir): symlinked components inside
  // docs/ must deny, whether resolvable, dangling, or broken.
  const os = await import('node:os');
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'doc-guard-test-'));
  try {
    mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
    mkdirSync(path.join(tmpRoot, 'outside'), { recursive: true });
    writeFileSync(path.join(tmpRoot, 'outside', 'existing.txt'), 'x');
    symlinkSync(
      path.join(tmpRoot, 'outside', 'created-later.txt'),
      path.join(tmpRoot, 'docs', 'dangling.md'),
    );
    symlinkSync(
      path.join(tmpRoot, 'outside', 'existing.txt'),
      path.join(tmpRoot, 'docs', 'resolved.md'),
    );
    symlinkSync('nowhere-at-all', path.join(tmpRoot, 'docs', 'broken.md'));
    check(
      decidePreToolUse({ ...claudeWriter, ...write('docs/dangling.md') }, tmpRoot).action,
      'deny',
      'dangling symlink inside docs denies',
    );
    check(
      decidePreToolUse({ ...claudeWriter, ...write('docs/resolved.md') }, tmpRoot).action,
      'deny',
      'resolvable symlink inside docs denies',
    );
    check(
      decidePreToolUse({ ...claudeWriter, ...write('docs/broken.md') }, tmpRoot).action,
      'deny',
      'broken symlink inside docs denies',
    );
    check(
      decidePreToolUse({ ...claudeWriter, ...write('docs/regular.md') }, tmpRoot).action,
      'allow',
      'regular file inside docs allows',
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`guard-documentation-write self-test: ${assertions} assertions passed`);
}

/**
 * Main-module detection with symlink-tolerant entry resolution: the platform
 * may invoke the hook through a symlink, and Node realpaths the ESM entry,
 * so `argv[1]` is normalized through realpathSync before comparison.
 */
function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

if (isMainModule()) {
  if (process.argv.includes('--self-test')) {
    runSelfTests().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } else {
    main().catch(() => {
      // Fail open: a broken guard must never block other agents' tool calls.
      process.exitCode = 0;
    });
  }
}
