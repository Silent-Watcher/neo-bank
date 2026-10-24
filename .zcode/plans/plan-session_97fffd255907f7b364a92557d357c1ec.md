# Plan: Fastify + SWC + Graceful Shutdown + Health Check for apps/api

## Baseline (verified by reading the code)

`apps/api` is a bare **NestJS 12.2.0** scaffold (CLI 12.0.10) on the **Express** adapter, in a pnpm 12.10.1 / Turbo monorepo on Node 24.20.0. Key facts that shape the plan:

- **ESM project**: `"type": "module"`, `module/moduleResolution: NodeNext`, `target: ES2024`, `emitDecoratorMetadata` + `experimentalDecorators`, `verbatimModuleSyntax`, imports use explicit `.js` extensions. **No path aliases** (`baseUrl`/`paths` unset).
- **Nothing to port or preserve**: `main.ts` is minimal — no global prefix, no CORS, no ValidationPipe, no filters/interceptors, no `app.use(...)` Express middleware, no shutdown hooks. Port: `process.env.PORT ?? 3001`.
- **Testing is vitest 5** (not Jest — SWC doesn't touch it): unit `test` script + supertest e2e via `test:test:e2e` config.
- **`typecheck` script (`tsc --noEmit`) already exists** and runs in the Turbo pipeline — type checking is already separate, exactly what the SWC task wants.
- Lint/format: oxlint (per-app config) + oxfmt (root `.oxfmtrc.json`). Deps are exact-pinned.
- `DECISIONS.md` contains ADR-001 (format: `## ADR-NNN: Title`, Status/Date bullets, Context/Decision/Consequences/Alternatives sections). `prompts/` next free number: **006**. Working tree already has unrelated uncommitted changes (`AGENTS.md` modified, `prompts/005` untracked) — left untouched.

## 1. Migrate Express → Fastify

- `pnpm --filter @neo-bank/api add --save-exact @nestjs/platform-fastify` (12.x, matching installed Nest) and `pnpm --filter @neo-bank/api remove @nestjs/platform-express` (updates `pnpm-lock.yaml`; `express` itself is only transitive).
- `apps/api/src/main.ts`:
  ```ts
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
  ```
  No Express-specific middleware exists, so nothing needs replacing; no CORS/prefix/validation exists to reconfigure.
- **ADR-002 "Adopt Fastify as the NestJS HTTP Platform"** appended to `DECISIONS.md` with the exact content from the task, following the existing ADR structure. No performance-guarantee claims.

## 2. Enable SWC

- devDep: **`@swc/core` only** (exact-pinned). The Nest CLI SWC builder does not invoke the `swc` CLI binary, so `@swc/cli` is omitted per "install only when needed" — added back only if the build demands it.
- `apps/api/nest-cli.json`: add `"builder": "swc"` to `compilerOptions` (keeps `deleteOutDir`).
- New `apps/api/.swcrc` preserving current build semantics: TypeScript parser with `decorators`, `legacyDecorator` + `decoratorMetadata` transforms, `target: es2024`, `module: { type: "es" }` (package is `"type": "module"`), source maps on. No path aliases to configure.
- Type checking stays with the existing `typecheck` script (`tsc --noEmit`); scripts need no changes (`dev`, `build`, `start`, `test`, `test:e2e` all keep working — vitest transpiles independently).
- Known behavior change to record: SWC emits no `.d.ts` files into `dist` (nothing consumes them in a private app).
- **ADR-003 "Adopt SWC for TypeScript Compilation"** appended to `DECISIONS.md` per task content, independent of ADR-002; ADR-001 untouched.

## 3. Graceful shutdown

`app.enableShutdownHooks()` in `main.ts` (above) — covers SIGTERM and SIGINT via Nest lifecycle events. No DB/Redis/queues/workers exist yet, no `process.exit()` anywhere. Verified at runtime (below).

## 4. Health check

- Dep: `@nestjs/terminus` (Nest 12-compatible version, exact-pinned).
- New `apps/api/src/health.controller.ts` (flat, matching the scaffold's structure — no separate module for one trivial controller):
  ```ts
  @Controller('health')
  export class HealthController {
    constructor(private readonly health: HealthCheckService) {}
    @Get()
    @HealthCheck()
    check() {
      return this.health.check([]);
    }
  }
  ```
  Final route: **`GET /health`** (no global prefix exists, so none is applied). Empty indicator list returns healthy `{ status: 'ok' }` — no DB/external checks, per scope.
- `app.module.ts`: import `TerminusModule`, register `HealthController`.
- New `apps/api/test/health.e2e-spec.ts`: supertest `GET /health` expects HTTP 200, following the existing e2e pattern.
- Update `apps/api/test/app.e2e-spec.ts` for Fastify compatibility (regression from the migration): pass `new FastifyAdapter()` to `createNestApplication()` and `await app.getHttpAdapter().getInstance().ready()` before supertest calls — the documented Nest Fastify e2e pattern.

## 5. Verification (executed in order, real results reported)

1. `pnpm --filter @neo-bank/api add/remove ...` (updates lockfile); record actual resolved versions.
2. `pnpm format` (root oxfmt) → `pnpm lint` (turbo/oxlint) → unit tests (`vitest run`) and e2e tests (`test:e2e`) for the api.
3. `pnpm --filter @neo-bank/api typecheck` (separate tsc) → `pnpm --filter @neo-bank/api build` (SWC production build) → confirm ESM output runs: `node dist/main.js` briefly, `curl /health` (expect 200 ok), `curl /` (expect Hello World), then send SIGTERM and confirm clean shutdown exit; kill any leftovers so no task-started process survives.
4. Fix regressions caused by these changes; report anything unresolved honestly.

## Records

- `prompts/006-fastify-swc-shutdown-health.md` — English, same shape as record 005 (user prompt, completed work, validation results, limitation notes).
- `DECISIONS.md` — append ADR-002 and ADR-003. Note: the task text itself dictates **Status: Accepted**, and your approval of this plan constitutes the acceptance the AGENTS.md Pending-workflow requires — so they are written Accepted directly, not staged as Pending.

## Out of scope (not doing)

No CORS/helmet/compression/ValidationPipe/global prefix (none exist to preserve); no extra health indicators or monitoring; no turbo.json or script changes; no jest migration; web/admin untouched; no refactor of the flat src layout; no commit (waits for your explicit approval, per AGENTS.md).
