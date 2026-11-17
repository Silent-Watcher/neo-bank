import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment (the
// RedisService import chain validates the environment eagerly).
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: undefined,
    REDIS_PASSWORD: undefined,
    REDIS_DB: undefined,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_SOCKET_TIMEOUT_MS: 6000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { RedisHealthProbe } from './redis.probe.js';
import { RedisService } from './redis.service.js';

type PingStub = { ping: ReturnType<typeof vi.fn> };

async function createProbe(ping: PingStub['ping']): Promise<RedisHealthProbe> {
  const module = await Test.createTestingModule({
    providers: [RedisHealthProbe, { provide: RedisService, useValue: { ping } }],
  }).compile();

  return module.get(RedisHealthProbe);
}

describe('RedisHealthProbe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings once and reports success', async () => {
    // Arrange
    const ping = vi.fn<() => Promise<void>>(async () => undefined);
    const probe = await createProbe(ping);

    // Act
    const outcome = await probe.probe();

    // Assert
    expect(outcome).toEqual({ ok: true });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('reports the failure reason when PING rejects', async () => {
    // Arrange
    const ping = vi.fn<() => Promise<void>>(async () => {
      throw new Error('Command timed out');
    });
    const probe = await createProbe(ping);

    // Act
    const outcome = await probe.probe();

    // Assert
    expect(outcome).toEqual({ ok: false, reason: 'Command timed out' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('stringifies non-error rejections into the failure reason', async () => {
    // Arrange
    const ping = vi.fn<() => Promise<never>>(async () => {
      throw 'boom';
    });
    const probe = await createProbe(ping);

    // Act
    const outcome = await probe.probe();

    // Assert
    expect(outcome).toEqual({ ok: false, reason: 'boom' });
  });

  it('fails bounded when PING never settles, within the deadline', async () => {
    // Arrange — a black-holed command whose commandTimeout somehow never
    // fires. Fake timers fire the probe deadline without real waiting.
    vi.useFakeTimers();
    const ping = vi.fn<() => Promise<never>>(() => new Promise(() => undefined));
    const probe = await createProbe(ping);

    // Act
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await pending;

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: 'Redis probe timed out after 3000 ms',
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('keeps the deadline outcome when the losing PING settles late', async () => {
    // Arrange — the deadline fires first; the black-holed PING eventually
    // settles afterwards (e.g. via commandTimeout). The late result must be
    // absorbed: the already-returned failure outcome is final, and the late
    // settlement never surfaces as an unhandled rejection.
    vi.useFakeTimers();
    let settlePing!: () => void;
    const ping = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          settlePing = resolve;
        }),
    );
    const probe = await createProbe(ping);

    // Act
    const pending = probe.probe();
    await vi.advanceTimersByTimeAsync(3000);
    const outcome = await pending;
    settlePing();
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: 'Redis probe timed out after 3000 ms',
    });
  });

  it('shares one in-flight probe across concurrent callers', async () => {
    // Arrange — four concurrent probes (e.g. a request burst on liveness and
    // readiness) must coalesce into one Redis command.
    vi.useFakeTimers();
    let settlePing!: () => void;
    const ping = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          settlePing = resolve;
        }),
    );
    const probe = await createProbe(ping);

    // Act
    const pending = Promise.all([probe.probe(), probe.probe(), probe.probe(), probe.probe()]);
    await vi.advanceTimersByTimeAsync(0);
    settlePing();
    const results = await pending;

    // Assert
    expect(ping).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result === results[0])).toBe(true);
    expect(results[0]).toEqual({ ok: true });
  });

  it('serves the cached outcome within the success TTL and re-probes after expiry', async () => {
    // Arrange
    vi.useFakeTimers();
    const ping = vi.fn<() => Promise<void>>(async () => undefined);
    const probe = await createProbe(ping);

    // Act & Assert — a fresh probe populates the cache; every call inside the
    // TTL window reuses the cached outcome; expiry triggers a new probe.
    const first = await probe.probe();
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4999);
    const second = await probe.probe();
    expect(second).toBe(first);
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await probe.probe();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('serves the failure outcome during the cooldown and re-probes after it', async () => {
    // Arrange — the first probe fails; the next one (after the cooldown)
    // succeeds, proving a failure never blocks future probes.
    vi.useFakeTimers();
    const ping = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Command timed out'))
      .mockResolvedValue(undefined);
    const probe = await createProbe(ping);

    // Act & Assert
    const first = await probe.probe();
    expect(first).toEqual({ ok: false, reason: 'Command timed out' });
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2999);
    const second = await probe.probe();
    expect(second).toBe(first);
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    const third = await probe.probe();
    expect(third).toEqual({ ok: true });
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
