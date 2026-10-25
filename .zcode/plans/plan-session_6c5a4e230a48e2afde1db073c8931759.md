## Refactor: Remove `app.setup.ts`, bootstrap configuration lives in `main.ts`

### 1. New rule in `AGENTS.md`

Add an "Application Bootstrap" subsection under "Backend — NestJS" (after the NestJS Configuration subsection):

- Keep all bootstrap-time application configuration — Fastify adapter options (`trustProxy`, `bodyLimit`), global API prefix, URI versioning, and CORS — directly inside the `bootstrap` function in `apps/api/src/main.ts`.
- Do not extract bootstrap configuration into a separate file such as `app.setup.ts`.

### 2. `apps/api/src/main.ts` — inline everything into `bootstrap()`

`createFastifyAdapter()` and `configureApp()` disappear as exported functions; their code moves verbatim into `bootstrap()`:

- Destructure `{ host, port, trustProxy, bodyLimit, corsOrigins }` from one `serverConfig()` call.
- `new FastifyAdapter({ trustProxy, bodyLimit })` inside `NestFactory.create` — keeping the trustProxy (spoofing risk) and bodyLimit (memory/abuse) comments.
- `setGlobalPrefix('api', { exclude: health })` (with the VERSION_NEUTRAL-doesn't-remove-prefix comment), `enableVersioning({ type: URI, defaultVersion: '1' })`, conditional `enableCors({ origin: corsOrigins })` (with the explicit-origins comment).
- `enableShutdownHooks()` + `listen(port, host)` unchanged.

### 3. Delete `apps/api/src/app.setup.ts`

### 4. `apps/api/src/health.controller.ts`

Update the comment that references `app.setup.ts` → references the bootstrap function in `main.ts`.

### 5. `apps/api/test/create-test-app.ts` — inline mirror instead of importing

The e2e helper can no longer import from `app.setup.ts`. It inlines the same adapter options + prefix/versioning/CORS setup, with a comment stating it mirrors the bootstrap configuration in `src/main.ts` (e2e tests must boot the app the way production does). It also gains an optional `beforeInit?: (app) => void` hook parameter, invoked before `app.init()`/`ready()`, so specs can register raw Fastify routes before the instance is sealed.

### 6. `apps/api/test/http-config.e2e-spec.ts`

Drop the `app.setup` imports. BODY_LIMIT test keeps using `createTestApp()`. The TRUST_PROXY probe test uses the new `beforeInit` hook to register `/__probe__/ip` before init — same behavioral assertion (`X-Forwarded-For: 10.1.2.3` → `request.ip === '10.1.2.3'`), no post-ready route addition.

### 7. Documentation touch-ups

- `DECISIONS.md` ADR-007: two phrases say "application setup"/"setup code" — reworded to "application bootstrap"/"bootstrap code" to stay truthful after the refactor.
- `prompts/009-api-versioning-cors-trust-proxy-body-limit.md`: update to the final state — remove `app.setup.ts` references, record your follow-up decision (no separate setup file; code in bootstrap function; AGENTS.md rule added; e2e helper mirrors bootstrap), refresh validation results.

### 8. Validation

Delegate to the validation subagent: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` in `apps/api`. Also grep for any leftover `app.setup` references. Test counts should stay 40 unit / 13 e2e — no behavior changes, pure structural move.

Note: the trade-off of this rule is that the e2e helper duplicates ~8 lines of bootstrap configuration (tests can't import `main.ts` since it self-executes `bootstrap()`); drift between them is mitigated by the e2e route/CORS assertions. No commit until you approve one.
