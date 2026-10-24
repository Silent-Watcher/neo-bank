# 006 — Unit test for the health controller

## Original Request

> write a .spec.ts file for the health.controller.ts file

## Implementation

- Added `apps/api/src/health.controller.spec.ts`, a Vitest unit test following the existing convention of `app.controller.spec.ts`.
- The test instantiates `HealthController` directly with a stubbed `HealthCheckService` whose `check()` resolves to `{ status: 'ok' }`.
- Assertions cover that the controller returns the service's result and that it calls `check()` with the empty indicators array (`[]`).

## Validation

- `pnpm --filter @neo-bank/api test` — passed: 2 test files, 2 tests (including the new spec).
- `pnpm --filter @neo-bank/api lint` — passed: 0 warnings, 0 errors (after typing the mock's function signature to satisfy Oxlint's `require-mock-type-parameters` rule).

## Notes

- No new dependencies; mocking is done with Vitest's built-in `vi.fn()`.
- No commit made; awaiting explicit user approval per the commit workflow rules.
