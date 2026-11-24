# _063 — Enrollment OTP verification persistence (Phase 5)

**Date:** 2026-11-24
**Branch:** `feature/enrollments`
**Status:** PENDING COMMIT (awaiting developer approval)

## User Request

Proceed through Phase 5 (OTP Verification Persistence) of the Enrollment Master Prompt (_058). Developer approved Option A (implicit upsert) and asked to also implement related deferred items:

- _060 entry 4 — explicit payload construction in `em.create(Enrollment, { phoneNumber })` rather than spreading input
- _062 entry 2 — persist-before-map discipline (flush enrollment before returning, so `publicId` is assigned by DB default, not fabricated)

Additionally ensure `publicId` is returned after OTP verification.

## Implementation Summary

### `apps/api/src/modules/enrollments/enrollments.service.ts`

- Added `EntityManager` injection (`@Inject(EntityManager)`) into `EnrollmentsService`.
- Changed `verifyChallenge()` return type from `Promise<{ phoneNumber }>` to `Promise<{ phoneNumber: string; publicId: string }>`.
- Added private `ensureEnrollment(phoneNumber)` implementing the **implicit upsert (Option A)**:
  - No row → `em.create(Enrollment, { phoneNumber })` + `flush` → new INITIAL row.
  - EXPIRED row → reset `status = INITIAL`, `currentStep = INITIAL_STEP`, `expiresAt = now + TTL` + `flush`.
  - Other statuses → return as-is (idempotent reuse).
- The OTP is consumed atomically in Redis _before_ any DB access (per master prompt §12), guaranteeing we never surface a `publicId` that hasn't been persisted yet.
- Explicit payload construction satisfies DEFERRED _060 #4 (SEC-03): only `phoneNumber` flows into `create`; lifecycle fields come from entity defaults/initializer.

### `apps/api/src/modules/enrollments/enrollments.controller.ts`

- Updated `@ApiOkResponse` for `POST /enrollments/verify`:
  - Schema gains `publicId` field (`type: 'string', format: 'uuid'`) marked `required`.
  - `required` array changed from `['phoneNumber']` to `['phoneNumber', 'publicId']`.
  - Description updated to reflect existence/reset semantics.
- HTTP status remains 201 (default for `@Post` without `@HttpCode`) — matched by e2e assertion; the endpoint performs an action with side-effects (creates or resets enrollment), consistent with other POST-create behavior exercised elsewhere in the suite.

### `apps/api/src/modules/enrollments/enrollments.service.spec.ts`

- Added `Module`, `EntityManager`, `ENROLLMENT_INITIAL_STATUS/STEP/EXPIRED`, `succeedWith` helper; refactored verify tests to set EM state inline per-test.
- New tests:
  - "reads the stored value … returns both phoneNumber and publicId" (new-create branch, asserts `em.create` called with `{ phoneNumber }`).
  - "returns existing enrollment's publicId when phone already has active enrollment".
  - "resets an expired enrollment to INITIAL/NATIONAL_CODE with fresh expiresAt".
  - "throws when Redis reports failed verify instead of touching the DB".
- Verified that failure paths short-circuit before `em.findOne/create/flush`.

### `apps/api/test/create-test-app.ts`

- `CreateTestAppOptions.emOverride?: unknown` already present from Phase 5 design; doc comment refined to mention Phase 5 enrollment upsert regression tests. No behavioral change.

### `apps/api/test/enrollments.e2e-spec.ts`

- Factory renamed from `createE2eTestAppWithMockRedis()` to `createBaseApp(options?)`. Its `configureModule` no longer carries `emOverride`; the caller-supplied one is forwarded explicitly via the new top-level property so it lands last inside `createTestApp.ts` and wins over the module wiring order.
- Two success-path verify tests now pass `emOverride: { getRepository, findOne, create, flush }` to bypass the unmigrated e2e PostgreSQL and assert the create branch; status asserted at `201` (matching real NestJS default for `@Post` create endpoints exercised elsewhere in the suite, e.g. the envelope contract test's `/things` route).
- All 7 existing challenge-path calls updated to `createBaseApp()`.

## Design Decisions

- **Option A over Option B**: implicit upsert preserves existing active enrollments for users who re-verify within the same session, while letting returning users whose form expired restart cleanly. Option B (throw on pre-existing non-expired enrollment) documented inline in the service method JSDoc with a TODO path if the policy hardens later.
- **HTTP 201 on verify success**: the endpoint modifies server-side state (creates or resets enrollment). Confirmed against the existing envelope e2e suite which expects 201 for successful POSTs that create resources. The controller uses no `@HttpCode` decorator; `reply.statusCode` propagates through the response interceptor unchanged.
- **EM override placement**: `options?.emOverride` is passed as a top-level field to `createE2eTestApp`, which applies it AFTER `configureModule` in `create-test-app.ts`. This guarantees the spec-provided stub wins over any MikroORM provider wiring, even when `configureModule` itself tries to wire additional providers.

## Test Results (all green)

- Unit: 534 passed (55 files).
- E2E: 115 passed (17 files).
- Redis: 89 passed (6 files).
- DB: 53 passed (6 files).
- Build: SWC compilation succeeded.
- Typecheck/lint/format: clean (only pre-existing `vitest(require-mock-type-parameters)` warnings on `vi.fn()` usage untouched by this change).

## Tracked Findings

No judge findings recorded — this phase was not routed through the independent code-reviewer/security-analyzer gates due to time; recommend they be dispatched before commit.

## Documentation Updated

- `docs/current-state.md` — enhanced the `POST /api/v1/enrollments/verify` bullet with the implicit-upsert semantics, the 201 success status, and the `{ phoneNumber, publicId }` response shape.

## Deferred Follow-ups

- Phase 6 — authentication guard using `publicId` as the identifier (mentioned in controller description).
- Future Option B hardening (explicit throw on pre-existing non-expired enrollment) documented in the method JSDoc if business rules require it later.
