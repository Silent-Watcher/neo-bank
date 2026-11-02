import { describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    APP_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: 3001,
    LOG_LEVEL: 'info',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TLS: 'false',
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { EnrollmentsController } from './enrollments.controller.js';

describe('EnrollmentsController', () => {
  it('delegates to the service with the validated phone number and returns its result', async () => {
    // Arrange
    const response = { phoneNumber: '09123456789' };
    const enrollmentsService = {
      requestChallenge: vi
        .fn<(phoneNumber: string) => Promise<typeof response>>()
        .mockResolvedValue(response),
    };
    const controller = new EnrollmentsController(enrollmentsService as never);

    // Act
    const result = await controller.requestChallenge({ phoneNumber: '09123456789' });

    // Assert
    expect(result).toBe(response);
    expect(enrollmentsService.requestChallenge).toHaveBeenCalledWith('09123456789');
  });
});
