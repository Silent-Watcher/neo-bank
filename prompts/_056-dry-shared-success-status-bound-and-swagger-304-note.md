# _056 — DRY shared success-status bound + Swagger UI 304 clarification

Date: 2026-11-19
Branch: `feature/etag`

## Original user request

> we have two identical constants called success_statuses_max_exclusive inside
> conditional-request.interceptor.ts and conditional-get.openapi.ts. we want to
> reduce duplicate code and use dry and you can only do this if they get
> different meanings [i.e. only merge when the meanings match]. and as a rule
> keep in mind and put it inside agents.md that for enums,interfaces,types,
> constants we always want one single source of truth + plus for values like
> http codes and http status dont use magic strings and use already defined
> enums like HttpStatus or etc. dont use magic strings in conditional
> statements (rule) or any other place.
>
> also: inside swagger ui for 304 no content i get an error from swagger ui
> for not having content — can we remove this error thing? it is just a
> swagger ui thing; the functionality works great in postman or any other
> tools.

## Implementation

### 1. Single source of truth for `SUCCESS_STATUSES_MAX_EXCLUSIVE`

Both definitions carried the identical meaning — the exclusive upper bound of
the 2xx status class for conditional-GET eligibility (ADR-038 §2) — so merging
is the correct DRY move (identical _knowledge_, not coincidentally identical
_text_):

- New `apps/api/src/shared/http/success-status-range.ts` exports
  `SUCCESS_STATUSES_MAX_EXCLUSIVE = HttpStatus.AMBIGUOUS` with the full
  rationale (2xx-class bound; the installed `HttpStatus` enum names 300
  `AMBIGUOUS` and has no `MULTIPLE_CHOICES` member).
- `conditional-request.interceptor.ts` imports it relatively
  (`./success-status-range.js`); `conditional-get.openapi.ts` imports it via
  the existing `#http/` alias — mirroring the established
  `json-content-type.ts` sharing pattern between the same two consumers.
  No new alias needed; local duplicate definitions and their comments removed.

Behavior-preserving refactor: both consumers keep the exact same comparison;
unit specs never referenced the constant directly.

### 2. AGENTS.md — single-source-of-truth rules

Root `AGENTS.md` "No Magic Strings" section extended with three explicit
rules:

- **Single source of truth for shared definitions** — one definition, one
  import path for every multi-use enum/interface/type/constant; never copy a
  definition; DRY applies to identical knowledge, not identical text.
- **HTTP status codes and protocol values** — use `HttpStatus` (or a named
  constant derived from it), never numeric literals or string reason phrases;
  enum-gap cases (300 = `AMBIGUOUS`) documented once at the shared constant.
- **No magic values in conditionals** — conditionals compare against named
  constants/enums/domain definitions, never semantic literals.

### 3. Swagger UI `Error: Not Modified` on bodyless 304s — investigated, accepted, documented

**Reproduction** (live, against the dev server at `localhost:3001`, real
Swagger UI, Try it out → second Execute with `If-None-Match`): the 304
response pane shows `Error: Not Modified` with error styling, above the
correct response headers (`etag` echoed, `cache-control: private,no-cache`,
**no `content-type`**, no body) — the API response itself is fully
RFC 9110-compliant and matches the e2e-pinned contract.

**Root cause** (verified inside the installed swagger-ui-dist 5.34.0
bundle): swagger-client's execute layer throws `new Error(statusText)` for
_every_ response with `ok === false` — anything outside 200–299, which
includes 304 — and Swagger UI surfaces that thrown message as the response
body when there is no body to render. The string "no content" the user
paraphrased does not exist in the bundle; the display is the HTTP reason
phrase of the status. A 204 would render `Error: No Content` the same way.

**Decision:** nothing to fix server-side — the rendering is keyed off the
status class and the empty body, both mandated by RFC 9110 §15.4.5 and
ADR-038 §5 ("genuinely bodyless: no Content-Type, no payload", e2e-pinned).
Sending a body or a body-describing `Content-Type` on a 304 would violate
both; patching the dev-only UI bundle is vendor drift. The behavior is now
documented as a known cosmetic artifact:

- `docs/api.md` (Conditional requests bullet): note that Swagger UI renders
  the bodyless 304 as `Error: Not Modified`, client-side, cosmetic.
- `docs/ai-decisions.md` entry #27: full context/alternatives/trade-offs.

## Validation

- Delegated check run (subagent): `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (unit) in `apps/api` — results recorded in
  the session report.
- GitNexus impact run before editing (`ConditionalRequestInterceptor`
  upstream → `main.ts` bootstrap only; `applyConditionalGetDocumentation`
  absent from the stale index → resolved by text search: sole consumer
  `swagger.setup.ts`). Not committed yet, so graph-change analysis is
  deferred to the commit task.
- e2e tier not run in this task: the refactor is behavior-preserving and the
  304 wire contract is unchanged (unit specs cover both consumers); the
  pre-push hook runs the full four-tier suite.

## Notes

- Reproduction harness (one-off, outside the repo, `/tmp/swagger-304-repro/`)
  was used before the user provided the live dev server; it was torn down
  (zero-orphan rule).
- Mimosa PreToolUse hook blocked writing `.js` via shell heredoc; the harness
  server was written through the Write tool instead.
