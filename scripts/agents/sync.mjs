#!/usr/bin/env node
/**
 * Synchronizes the canonical subagent definitions into platform-native
 * artifacts. The canonical source of truth is `.agents/definitions/*.md`;
 * generated files must never be edited independently.
 *
 * Generated artifacts:
 *   - ZCode plugin agents:   .agents/plugins/monorepo-workflow/agents/<name>.md
 *   - Claude Code agents:    .claude/agents/<name>.md
 *   - ZCode plugin manifest: .agents/plugins/monorepo-workflow/.claude-plugin/plugin.json
 *   - ZCode marketplace:     .agents/plugins/marketplace.json
 *   - Claude marketplace:    .agents/plugins/.claude-plugin/marketplace.json
 *
 * In write mode, orphaned `*.md` files inside the two generated agent
 * directories (left over from renamed or deleted definitions) are removed,
 * so the platforms never load a dead agent.
 *
 * Usage:
 *   node scripts/agents/sync.mjs          write the generated files
 *   node scripts/agents/sync.mjs --check  non-mutating drift check (exit 1 on drift)
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFINITIONS_DIR = path.join(REPO_ROOT, '.agents', 'definitions');
const PLUGIN_DIR = path.join(REPO_ROOT, '.agents', 'plugins', 'monorepo-workflow');
const ZCODE_AGENTS_DIR = path.join(PLUGIN_DIR, 'agents');
const CLAUDE_AGENTS_DIR = path.join(REPO_ROOT, '.claude', 'agents');
const MARKETPLACE_ROOT = path.join(REPO_ROOT, '.agents', 'plugins');
const GENERATED_AGENT_DIRS = [ZCODE_AGENTS_DIR, CLAUDE_AGENTS_DIR];

/** Single source of truth for plugin and marketplace metadata. */
const PLUGIN = {
  name: 'monorepo-workflow',
  version: '0.1.0',
  description:
    'Project multi-agent development workflow: project-explorer, code-reviewer, code-security-analyzer and documentation-writer subagents, with session-start and documentation-write-guard hooks.',
  author: { name: 'neo-bank' },
  category: 'developer-tools',
  displayName: 'Neo Bank Monorepo Workflow',
};

/** Per-agent ZCode presentation metadata; agents without an entry use the defaults. */
const AGENT_PRESENTATION = {
  'project-explorer': { color: 'blue', thoughtLevel: 'high' },
  'code-reviewer': { color: 'yellow', thoughtLevel: 'high' },
  'code-security-analyzer': { color: 'red', thoughtLevel: 'max' },
  'documentation-writer': { color: 'green', thoughtLevel: 'high' },
};
const DEFAULT_PRESENTATION = { color: 'blue', thoughtLevel: 'high' };

class SyncError extends Error {}

/** Parse a minimal frontmatter block: `key: value` scalars and `- item` block lists. */
function parseFrontmatter(source, fileLabel) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) {
    throw new SyncError(`${fileLabel}: missing frontmatter block`);
  }
  const fields = {};
  let currentListKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      currentListKey = null;
      continue;
    }
    const listItem = /^-\s+(.*)$/.exec(rawLine.trim());
    if (listItem && currentListKey) {
      fields[currentListKey].push(unquote(listItem[1].trim()));
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(rawLine.trim());
    if (!entry) {
      throw new SyncError(`${fileLabel}: unparseable frontmatter line: ${rawLine.trim()}`);
    }
    const [, key, rawValue] = entry;
    if (Object.hasOwn(fields, key)) {
      throw new SyncError(`${fileLabel}: duplicate frontmatter key "${key}"`);
    }
    currentListKey = rawValue === '' ? key : null;
    fields[key] = rawValue === '' ? [] : unquote(rawValue);
  }
  return { fields, bodyStart: match[0].length };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function validateDefinition(name, fields) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new SyncError(`${name}: file name must be kebab-case`);
  }
  if (fields.name !== name) {
    throw new SyncError(`${name}: frontmatter name "${fields.name}" does not match the file name`);
  }
  if (typeof fields.description !== 'string' || fields.description.trim() === '') {
    throw new SyncError(`${name}: frontmatter description is required`);
  }
  if (!Array.isArray(fields.tools) || fields.tools.length === 0) {
    throw new SyncError(`${name}: frontmatter tools list is required`);
  }
  for (const tool of fields.tools) {
    if (!/^[A-Za-z0-9_-]+$/.test(tool)) {
      throw new SyncError(`${name}: invalid tool identifier "${tool}"`);
    }
  }
  // Frontmatter values are plain scalars; escape sequences would be emitted
  // verbatim into the generated YAML, silently losing author intent.
  if (fields.description.includes('\\') || fields.tools.some((tool) => tool.includes('\\'))) {
    throw new SyncError(
      `${name}: frontmatter values must be plain scalars without escape sequences`,
    );
  }
}

/** Render a YAML double-quoted scalar (JSON escaping is valid YAML). */
function yamlScalar(value) {
  return JSON.stringify(value);
}

function renderZcodeAgent({ name, description, tools }, body) {
  const presentation = AGENT_PRESENTATION[name] ?? DEFAULT_PRESENTATION;
  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${yamlScalar(description)}`,
    `color: ${presentation.color}`,
    `thoughtLevel: ${presentation.thoughtLevel}`,
    `tools: [${tools.join(', ')}]`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${body}`;
}

function renderClaudeAgent({ name, description, tools }, body) {
  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${yamlScalar(description)}`,
    `tools: ${tools.join(', ')}`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${body}`;
}

function pluginManifest(agentNames) {
  return {
    name: PLUGIN.name,
    version: PLUGIN.version,
    description: PLUGIN.description,
    author: PLUGIN.author,
    // Claude Code's plugin schema requires `./`-prefixed paths (agents as an
    // array of .md files, hooks as the hooks.json file); ZCode reads the same
    // compat manifest and accepts arrays for these component fields.
    agents: agentNames.map((name) => `./agents/${name}.md`),
    hooks: './hooks/hooks.json',
  };
}

function marketplaceEntry() {
  return {
    name: PLUGIN.name,
    source: `./${PLUGIN.name}`,
    version: PLUGIN.version,
    description: PLUGIN.description,
    displayName: PLUGIN.displayName,
    category: PLUGIN.category,
  };
}

function zcodeMarketplace() {
  // Root-level marketplace.json, read by ZCode; sources resolve against this file's directory.
  return {
    name: 'neo-bank-agents',
    description: PLUGIN.description,
    plugins: [marketplaceEntry()],
  };
}

function claudeMarketplace() {
  // `.claude-plugin/marketplace.json`, read by Claude Code; `owner` is required there.
  return {
    name: 'neo-bank-agents',
    owner: { name: PLUGIN.author.name },
    description: PLUGIN.description,
    plugins: [marketplaceEntry()],
  };
}

async function listDefinitions() {
  if (!existsSync(DEFINITIONS_DIR)) {
    throw new SyncError(`canonical definitions directory is missing: ${DEFINITIONS_DIR}`);
  }
  const entries = await readdir(DEFINITIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  const skipped = entries.filter((entry) => entry.name.endsWith('.md') && !entry.isFile());
  for (const entry of skipped) {
    console.error(`skipped  ${entry.name}: not a regular file`);
  }
  if (files.length === 0) {
    throw new SyncError(`${DEFINITIONS_DIR}: no definitions found`);
  }
  return files;
}

async function loadDefinitions() {
  const definitions = [];
  for (const file of await listDefinitions()) {
    // Strip the BOM here so the body offset returned by parseFrontmatter
    // indexes into exactly this string.
    const source = (await readFile(path.join(DEFINITIONS_DIR, file), 'utf8')).replace(
      /^\uFEFF/,
      '',
    );
    const { fields, bodyStart } = parseFrontmatter(source, file);
    const name = path.basename(file, '.md');
    validateDefinition(name, fields);
    definitions.push({
      name,
      description: fields.description,
      tools: fields.tools,
      body: source.slice(bodyStart),
    });
  }
  return definitions;
}

/** Every generated file: absolute path plus exact expected content. */
function expectedOutputs(definitions) {
  const outputs = [];
  for (const definition of definitions) {
    outputs.push({
      path: path.join(ZCODE_AGENTS_DIR, `${definition.name}.md`),
      content: renderZcodeAgent(definition, definition.body),
      label: `zcode agent ${definition.name}`,
    });
    outputs.push({
      path: path.join(CLAUDE_AGENTS_DIR, `${definition.name}.md`),
      content: renderClaudeAgent(definition, definition.body),
      label: `claude agent ${definition.name}`,
    });
  }
  outputs.push({
    path: path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'),
    content: `${JSON.stringify(pluginManifest(definitions.map((definition) => definition.name)), null, 2)}\n`,
    label: 'plugin manifest',
  });
  outputs.push({
    path: path.join(MARKETPLACE_ROOT, 'marketplace.json'),
    content: `${JSON.stringify(zcodeMarketplace(), null, 2)}\n`,
    label: 'zcode marketplace',
  });
  outputs.push({
    path: path.join(MARKETPLACE_ROOT, '.claude-plugin', 'marketplace.json'),
    content: `${JSON.stringify(claudeMarketplace(), null, 2)}\n`,
    label: 'claude marketplace',
  });
  return outputs;
}

async function unexpectedGeneratedFiles(outputs) {
  const problems = [];
  for (const dir of GENERATED_AGENT_DIRS) {
    if (!existsSync(dir)) continue;
    const expectedNames = new Set(
      outputs
        .filter((output) => output.path.startsWith(`${dir}${path.sep}`))
        .map((output) => path.basename(output.path)),
    );
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && !expectedNames.has(entry.name)) {
        problems.push(
          `unexpected generated agent: ${path.relative(REPO_ROOT, path.join(dir, entry.name))}`,
        );
      }
    }
  }
  return problems;
}

async function runCheck(outputs) {
  const problems = [];
  for (const output of outputs) {
    if (!existsSync(output.path)) {
      problems.push(`missing: ${path.relative(REPO_ROOT, output.path)} (${output.label})`);
      continue;
    }
    const actual = await readFile(output.path, 'utf8');
    if (actual !== output.content) {
      problems.push(`outdated: ${path.relative(REPO_ROOT, output.path)} (${output.label})`);
    }
  }
  problems.push(...(await unexpectedGeneratedFiles(outputs)));
  return problems;
}

/** Delete orphaned generated `*.md` agents (from renamed/deleted definitions). */
async function removeOrphanedAgents(outputs) {
  const removed = [];
  for (const dir of GENERATED_AGENT_DIRS) {
    if (!existsSync(dir)) continue;
    const expectedNames = new Set(
      outputs
        .filter((output) => output.path.startsWith(`${dir}${path.sep}`))
        .map((output) => path.basename(output.path)),
    );
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && !expectedNames.has(entry.name)) {
        const orphanPath = path.join(dir, entry.name);
        await rm(orphanPath);
        removed.push(path.relative(REPO_ROOT, orphanPath));
      }
    }
  }
  return removed;
}

async function main() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((argument) => argument !== '--check');
  if (unknownArgs.length > 0) {
    console.error(
      `unknown argument(s): ${unknownArgs.join(', ')}. Usage: node scripts/agents/sync.mjs [--check]`,
    );
    process.exitCode = 1;
    return;
  }
  const checkOnly = args.includes('--check');
  const definitions = await loadDefinitions();
  const outputs = expectedOutputs(definitions);

  if (checkOnly) {
    const problems = await runCheck(outputs);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`DRIFT  ${problem}`);
      console.error(
        `sync --check: ${problems.length} problem(s). Run "node scripts/agents/sync.mjs" to regenerate.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`sync --check: ${outputs.length} generated files match the canonical definitions.`);
    return;
  }

  for (const output of outputs) {
    await mkdir(path.dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content, 'utf8');
    console.log(`wrote  ${path.relative(REPO_ROOT, output.path)}`);
  }
  for (const removed of await removeOrphanedAgents(outputs)) {
    console.log(`removed orphaned generated agent  ${removed}`);
  }
  const problems = await runCheck(outputs);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`DRIFT  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `sync: ${outputs.length} generated files are up to date with the canonical definitions.`,
  );
}

main().catch((error) => {
  console.error(error instanceof SyncError ? error.message : error);
  process.exitCode = 1;
});
