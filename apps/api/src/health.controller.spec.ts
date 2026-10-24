import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('delegates the health check to HealthCheckService', async () => {
    const health = {
      check: vi.fn<() => Promise<{ status: string }>>().mockResolvedValue({ status: 'ok' }),
    };
    const controller = new HealthController(health as never);
    const result = await controller.check();

    expect(result).toEqual({ status: 'ok' });
    expect(health.check).toHaveBeenCalledWith([]);
  });
});
