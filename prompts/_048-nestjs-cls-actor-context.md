# _048 — nestjs-cls Actor Context (ALS Architecture Alignment)

- **Date:** 2026-11-15
- **Status:** Implemented; code review + security gates pending; db-tier test execution pending Docker daemon
- **ADR:** ADR-031 (Use nestjs-cls for the Application Actor Context) — Accepted before any implementation write; refines ADR-029's actor-context mechanism (architecture unchanged).

## Original request

The user supplied a master prompt (Phases 1–7, two-stage mandatory approval workflow): review the application's AsyncLocalStorage architecture, align it with the officially documented NestJS conventions, and verify MikroORM's per-request EntityManager context under Fastify. The user additionally directed: prefer the `nestjs-cls` package for better ALS integration, and submit an ADR for it.

Stage 1 (investigation, no repo writes) produced a report covering: current ALS architecture (bespoke module-level ALS singleton outside DI + `ActorContextMiddleware`), deviations from the official recipe (ALS not a DI provider; no typed-store/test ergonomics), Fastify adapter state (verified working), MikroORM configuration (`warnWhenNoEntities: false` already in place; `registerRequestContext` enabled and verified at source level: `MikroOrmCoreModule.configure` → `MikroOrmMiddleware` → `RequestContext.create` → native ALS `run()` → per-request `em.fork({ useContext: true })`), the test gap (per-request EM isolation not asserted under Fastify), and the full `nestjs-cls` dependency evaluation. Stage 2 proceeded only after the user's explicit approval of ADR-031 and the scope.

## Dependency evaluation (ADR-031)

`nestjs-cls@7.0.2`: MIT; **zero runtime dependencies**; peer deps `@nestjs/core|common >= 10 < 13` (covers Nest 12) + `rxjs >= 7`; `engines.node >= 22` (Node 24 in use); ESM build present; OSV query for 7.0.2: 0 advisories; no consumer-side install scripts; active maintenance (released 2026-09-24). Verified by inspecting the published package: `ClsService` wraps native `AsyncLocalStorage`; `ClsMiddleware` is a standard Nest middleware with adapter-specific mount-point detection (`MOUNT_POINT_FASTIFY_5 = '{*path}'`); `ClsServiceManager.getClsService()` is the public non-DI seam (backed by a `globalThis` ALS). `pnpm audit` after install: 7 pre-existing advisories in the existing tree (lodash/tmp/multer transitive), none introduced by this dependency. Upstream docs make no Fastify-specific statement — noted honestly; the mechanism (Nest middleware pipeline) is adapter-agnostic and source-verified.

## Implementation

| File                                                                   | Change                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DECISIONS.md`                                                         | ADR-031 accepted (first repo write)                                                                                                                                                                                                                                                                                  |
| `apps/api/package.json`                                                | `nestjs-cls@7.0.2` added                                                                                                                                                                                                                                                                                             |
| `apps/api/src/shared/actor-context/actor-context.ts`                   | rewritten as a typed bridge over `ClsServiceManager` — same public surface (`ActorContext`, `runWithActorContext`, `getActorContext`, `getActorId`); store rides a symbol key (`ACTOR_ID`), so reads/writes stay type-checked **without assertions**; `isActive()` guards preserve the no-context → system semantics |
| `apps/api/src/shared/actor-context/actor-context.module.ts`            | new `actorContextModule` = `ClsModule.forRoot({ global: true, middleware: { mount: true, saveReq: false, saveRes: false, setup } })`; `resolveActorId` seam moved here (still `null` until auth)                                                                                                                     |
| `apps/api/src/shared/actor-context/actor-context.middleware.ts` + spec | **deleted** (library middleware replaces it)                                                                                                                                                                                                                                                                         |
| `apps/api/src/modules/app/app.module.ts`                               | imports `actorContextModule`, `NestModule.configure` removed                                                                                                                                                                                                                                                         |
| `apps/api/test/fixtures/test-article.controller.ts`                    | two probe endpoints: `GET context/actor` (store mounted per request) and `GET context/em` (`EntityManager#id`, which "respects the context")                                                                                                                                                                         |
| `apps/api/test/base-entity.db-spec.ts`                                 | new "Request contexts under Fastify (ADR-031)" describe: CLS store mounted per request; three concurrent requests observe three distinct EM fork ids (Phase 5/6.2 verification gap closed)                                                                                                                           |
| docs                                                                   | `apps/api/AGENTS.md` (actor bullet), `apps/api/ONBOARDING.md` (stack row + structure), `docs/current-state.md` (counts, ADR list), feature record                                                                                                                                                                    |

BaseEntity untouched — the bridge preserved `getActorId()` semantics exactly.

## Key implementation decisions (for the AI decision log)

1. **Symbol store key, no typed `ClsService<ActorStore>` generic:** `ClsServiceManager.getClsService()` returns the untyped `ClsService`; binding the store generic requires a downcast assertion (project bans unsafe assertions). A symbol key on the default store keeps every access typed through narrowing (`Record<symbol, unknown>` + `typeof` check) with zero assertions; symbol keys cannot collide or serialize.
2. **`runWithActorContext` → `cls.runWith`:** verified `runWith(store, callback)` creates a fresh context — the nested-context override semantics of the probe's `actingAs` flows and the db-spec concurrent-attribution test are preserved.
3. **Library middleware mounting is adapter-aware:** `ClsRootModule.configure` applies `ClsMiddleware` with `getMiddlewareMountPoint(adapter)` — Fastify 5 gets `'{*path}'`. No manual registration in `main.ts` or `AppModule.configure` (the master prompt's rule against duplicating integration behavior).
4. **EM-fork proof via `EntityManager#id`:** v7's getter is documented to resolve the contextual fork; the db-spec asserts three concurrent requests get three distinct ids — proving MikroORM's automatic RequestContext under the real Fastify pipeline (previously mechanism-verified only).

## Validation

- `pnpm test` (unit): **42 files / 362 tests, all passed** (364 − deleted middleware spec; the 5 ALS bridge specs pass unchanged — surface preserved).
- `pnpm typecheck`: clean. `pnpm build` (swc): clean. `pnpm lint`: 0 errors; 58 pre-existing warnings. `pnpm format:check`: clean. `pnpm audit`: 7 pre-existing advisories (none from nestjs-cls).
- `pnpm test:db` / `pnpm test:e2e`: **NOT executed** — Docker daemon down at validation time (not retried per retry-loop rules). The new db-spec tests are written and ready.
- Zero orphans: no task-started processes or containers.

## Remaining limitations

- db-tier and e2e execution pending Docker (includes the two new context tests).
- Actor attribution stays `NULL` (system) until authentication lands.
- `pnpm audit` carries the pre-existing tree advisories (unchanged by this task).
