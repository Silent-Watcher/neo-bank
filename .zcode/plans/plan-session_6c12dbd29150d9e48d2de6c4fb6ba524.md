## Plan: Unit test for `health.controller.ts`

**Approach:** Follow the existing unit-test convention in `apps/api/src/app.controller.spec.ts` — a plain Vitest spec next to the source file, instantiating the controller directly with a mocked dependency (no Nest testing module needed for this).

### Steps

1. **Create `apps/api/src/health.controller.spec.ts`** with the following content:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('delegates the health check to HealthCheckService', async () => {
    const health = { check: vi.fn().mockResolvedValue({ status: 'ok' }) };
    const controller = new HealthController(health as never);

    const result = await controller.check();

    expect(result).toEqual({ status: 'ok' });
    expect(health.check).toHaveBeenCalledWith([]);
  });
});
```

- Mocks `HealthCheckService` with a resolved value and asserts the controller calls `check()` with the empty indicator list and returns its result. The single `as never` cast is needed because we only stub one method of the real service; no `any` is used.

2. **Create the feature record `prompts/006-health-controller-unit-test.md`** (next number after existing `005-...`), containing the original request, implementation summary, and validation results — per AGENTS.md feature-record rules.

3. **Validate:** run `pnpm --filter @neo-bank/api test` (Vitest unit run) and confirm the new spec plus the existing `app.controller.spec.ts` pass. Then run `pnpm --filter @neo-bank/api lint` since source code changed.

**No commit** — per AGENTS.md, commits happen only after explicit approval.
