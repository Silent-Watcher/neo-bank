---
name: nestbruno
description: Use NestBruno's CLI to inspect NestJS routes, parameters, DTO metadata and Bruno collection state, then generate or update accurate API documentation from verified results. Use when documenting, auditing or explaining a NestJS API, when the user mentions NestBruno or a Bruno collection for a NestJS project, or when asked what endpoints a NestJS application exposes.
---

# NestBruno

NestBruno is a Rust CLI (`nestbruno`) that statically analyzes a NestJS
TypeScript project and keeps a [Bruno](https://www.usebruno.com/) API
collection synchronized with its HTTP routes. Your TypeScript is parsed with
a real AST parser (oxc) — never compiled, executed, or sent anywhere: no
Node process, no network call, no decorator evaluation.

It extracts controllers, HTTP methods, effective route paths (including
statically provable global prefixes and URI versioning), parameter
decorators (`@Param`, `@Query`, `@Body`, `@Headers`), and resolves DTO
class/interface/type-alias annotations and a conservative Zod subset across
local imports into JSON body skeletons.

## When to use this skill

- Generate API documentation for a NestJS project.
- Update existing API documentation after routes changed.
- List or inspect the API routes of a NestJS application.
- Explain how a route was discovered and resolved.
- Audit whether a Bruno collection still matches the source code.
- Explain the request-body structure a DTO or Zod schema implies.

## Two different outputs — do not conflate them

1. **The Bruno collection** (`nestbruno sync` / `generate`) — machine-usable
   `.bru` request files for the Bruno API client.
2. **Human-readable API documentation** (Markdown you write) — the kind of
   thing an agent produces for a repository.

NestBruno produces the first. It does **not** generate Markdown
documentation. When asked to document an API, use NestBruno as the _route
inventory and analysis source_, verify its output, then write the
documentation yourself. Never run a collection-mutating command just
because documentation was requested.

## Step 1 — Inspect before using

Always inspect the target project first; never assume configuration or CLI
features exist.

1. Identify the NestJS project root (the directory containing `src/` and
   typically `package.json`).
2. Check for `nestbruno.toml` at the project root.
3. Check whether the CLI is available and which version:
   ```bash
   nestbruno --version
   nestbruno --help
   ```
   The commands documented here are available from NestBruno 0.7.0
   (`--format json`, `verify` and `explain` from 0.6.0;
   `generate --environments` from 0.7.0).
   If flags from this skill are missing from `--help`, trust `--help` and
   say so rather than guessing.
4. If NestBruno is not installed, tell the user how to install it and wait
   for their go-ahead — never install software silently:
   ```bash
   cargo install nestbruno --locked
   ```
5. If `nestbruno.toml` exists, validate the setup:
   ```bash
   nestbruno check
   ```
6. Inspect the existing documentation structure and conventions (where API
   docs live, their format, tone) before deciding where to write or update
   content.

If `nestbruno.toml` is missing, do **not** run `nestbruno init` unprompted.
Explain that initialization writes a default config plus nothing else, and
let the user decide.

## Step 2 — Know the commands

| Command                        | Purpose                                                      | Mutates anything?       |
| ------------------------------ | ------------------------------------------------------------ | ----------------------- |
| `nestbruno check`              | Validate config and project layout                           | No                      |
| `nestbruno discover`           | List candidate controller files                              | No                      |
| `nestbruno routes`             | Extract routes with parameters and metadata                  | No                      |
| `nestbruno explain <SELECTOR>` | Explain how one route was identified and resolved            | No                      |
| `nestbruno verify`             | Check whether the collection matches the sources             | No — strictly read-only |
| `nestbruno sync --dry-run`     | Preview synchronization changes                              | No                      |
| `nestbruno sync`               | Apply synchronization to the Bruno collection                | Yes                     |
| `nestbruno generate`           | Write Bruno request files (create/force only, never deletes) | Yes                     |
| `nestbruno watch`              | Long-running incremental synchronization                     | Yes                     |
| `nestbruno init`               | Write a default `nestbruno.toml` (never overwrites)          | Yes                     |

Global flags: `-C, --project <DIR>` (analyze `DIR` instead of searching
upwards from the cwd) and `-v, --verbose` (extra diagnostics on stderr).

## Step 3 — Prefer machine-readable JSON

`discover`, `routes`, `explain`, `verify` and `sync` accept `--format json`
and print **exactly one JSON document** to stdout. Diagnostics are
structured objects _inside_ the document; human-readable progress and
diagnostics stay on stderr. Repeated runs on identical input are
byte-identical. Prefer JSON over the human format whenever you process
results programmatically:

```bash
nestbruno routes --format json
nestbruno explain "GET /users/:id" --format json
nestbruno verify --format json
nestbruno sync --dry-run --format json
nestbruno discover --format json
```

There is no `--format` on `init`, `check`, `generate`, `completions` or
`watch`.

Top-level document shapes (fields are part of the versioned output
contract):

- `routes`: `routes[]` (each with `controller`, `handler`, `method`, `path`,
  `parameters`, `body`, `source`), `diagnostics`, `complete`.
  A parameter has `kind` (`param`/`query`/`body`/`headers`), `name`, `index`,
  `type_name` (when annotated) and resolved `fields`.
- `discover`: `files`, `directories_read`, `diagnostics`, `complete`.
- `explain`: `found`, `complete`, `route`, `resolution`, `parameters`,
  `body`, `limitations`, `trace`, `matches`, `diagnostics`.
- `verify`: `status` (`in_sync` / `out_of_sync` / `blocked` / `incomplete` /
  `no_staged_changes`), `complete`, `summary` (category counts),
  `changes` (`created`/`updated`/`deleted`), `conflicts`, `failed`,
  `diagnostics`.
- `sync`: `dry_run`, `applied`, `complete`, `staged_changes`, the result
  lists `created`/`updated`/`unchanged`/`deleted`/`preserved`, `conflicts`,
  `failed`, `diagnostics`.

Exit codes: 0 success; 1 runtime failure (also `verify` when out of sync
and `explain` when a route is missing or ambiguous); 2 usage error (also
`explain` with a malformed selector); 3 configuration error; 4 **incomplete
analysis** — some paths could not be processed. Exit 4 means the result is
_unknown_ for the affected paths, not empty.

Always:

- read stdout as the JSON document, stderr as a separate human stream;
- check `complete` and `diagnostics` before trusting the inventory;
- treat `complete: false` as "this API surface is not fully established" —
  say so in anything you produce;
- surface warnings instead of swallowing them.

`explain` selectors: `"METHOD /path"` (e.g. `"GET /users/:id"`) or
`--handler findOne` (optionally with `--controller UsersController`, and
`--file src/users/users.controller.ts` to disambiguate). An ambiguous
handler name exits 1 and lists every candidate.

## Step 4 — Documentation workflow

1. **Inspect** — project structure, existing docs, configuration, CLI
   version (Step 1).
2. **Extract** the route inventory:
   ```bash
   nestbruno routes --format json
   ```
3. **Analyze** individual routes where more detail helps:
   ```bash
   nestbruno explain "POST /users" --format json
   ```
   The `resolution` section shows how the effective path was assembled
   (controller prefix, statically provable global prefix, URI version
   segment, handler fragment); `limitations` lists what could not be
   proven.
4. **Inspect source** where NestBruno's static metadata is not enough:
   controllers, DTOs, schemas, decorators, guards. NestBruno gives verified
   route/parameter/DTO facts; the source gives descriptions, response
   shapes and behavior. Combine both; never present an inference as
   extracted metadata.
5. **Generate documentation** in the project's existing structure and
   format. For a large API, organize by module/controller/domain rather
   than one giant page. A reasonable endpoint entry includes: method and
   effective path; controller and handler; description when the source
   provides one; path/query/header parameters; request body structure;
   response information only when supported by source evidence;
   authentication only when explicitly established; source location;
   limitations or unresolved metadata. Use tables and short examples.
6. **Validate** the result against the route inventory, `explain` output,
   the actual declarations, and internal links. If the analysis was
   incomplete, the documentation must say so.

## Updating existing documentation

1. Read the existing documentation first — conventions, structure,
   manually written descriptions.
2. Re-extract the current inventory (`routes --format json`).
3. Diff the inventory against the documented endpoints: new, removed,
   changed.
4. Update only the affected sections. Preserve manually written
   descriptions and useful examples.
5. Keep navigation and cross-references correct, and report anything the
   analysis could not resolve.

Do not regenerate an entire documentation set when a targeted update
suffices.

## Accuracy rules — never invent API behavior

These limits are the reason verification matters:

1. NestBruno is static analysis; it never runs the application.
2. Dynamically constructed route paths may stay unresolved.
3. Global prefixes and URI versioning appear only when statically
   provable; `RouterModule` and dynamic bootstrap expressions are not
   modeled.
4. DTO resolution has explicit boundaries and resource budgets; uncertain
   resolution degrades to an unknown body shape, never a guess.
5. Resolved DTO fields are **field names only** — not types, defaults or
   validation rules.
6. DTO property extraction is not an OpenAPI schema.
7. Bruno query/header placeholders may be disabled and empty; do not read
   them as required runtime parameters.
8. `@Param()` object DTO fields never create missing URL path parameters.
9. Response schemas are not inferred by route extraction.
10. Guards, interceptors, authentication requirements and business logic
    cannot be derived from route metadata — find them in the source or
    leave them out.
11. Keep unknown values explicitly unknown ("not statically resolvable"),
    never silently omitted or fabricated.
12. An incomplete analysis must never be presented as a complete API
    inventory.

When more detail is needed, read the actual source and use explicit
evidence. Never read `.env` files for values, and never put credentials,
tokens, keys, passwords or other secrets into documentation.

## Safety around the collection

- Inspection commands (`routes`, `discover`, `explain`, `verify`,
  `sync --dry-run`) are safe for any task.
- `sync`, `generate`, `watch` and `init` modify files. Run them only when
  synchronizing the Bruno collection is the user's actual request.
- Run `verify` (or `sync --dry-run`) before any real `sync`.
- Generated requests carry an ownership stamp; files you or the user
  edited are user-owned and reported as conflicts instead of overwritten.
  Unknown `.bru` files are preserved. Never weaken this by suggesting
  `--force` casually — `--force` replaces differing generated files and
  still never touches user-owned or environment files.
- Existing environment files are never modified or merged; placeholders
  are empty by design (values are never read from or invented for the
  analyzed application).
- Deletions happen only for unmodified generated requests of routes that
  no longer exist, and only when the analysis is complete.
