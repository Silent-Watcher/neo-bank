import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests must not depend on ambient environment state, so the env
// validation layer is replaced with a fully valid environment.
vi.mock('#config/env/env.config.js', () => ({
  _env: {
    REDIS_URL: 'redis://localhost:6379',
    REDIS_USERNAME: undefined,
    REDIS_PASSWORD: undefined,
    REDIS_DB: undefined,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10000,
    REDIS_COMMAND_TIMEOUT_MS: 5000,
    REDIS_MAX_RETRIES_PER_REQUEST: 3,
    REDIS_SHUTDOWN_TIMEOUT_MS: 2000,
  },
}));

import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

// A real ioredis instance with lazyConnect never dials the server, so the
// suite stays independent of a running Redis while behavior (event emitter,
// status machine) remains genuine.
function createClient(): Redis {
  return new Redis({ lazyConnect: true });
}

function createConfigServiceDouble(shutdownTimeoutMs = 2000) {
  return {
    getOrThrow: vi.fn(() => ({ shutdownTimeoutMs })),
  };
}

async function createService(client: Redis, shutdownTimeoutMs?: number): Promise<RedisService> {
  const module = await Test.createTestingModule({
    providers: [
      RedisService,
      { provide: REDIS_CLIENT, useValue: client },
      { provide: ConfigService, useValue: createConfigServiceDouble(shutdownTimeoutMs) },
    ],
  }).compile();

  return module.get(RedisService);
}

describe('RedisService', () => {
  let client: Redis;

  beforeEach(() => {
    client = createClient();
  });

  afterEach(() => {
    client.disconnect();
    vi.restoreAllMocks();
  });

  describe('operations', () => {
    it('returns values from GET', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'get').mockResolvedValue('stored');

      // Act
      const value = await service.get('key');

      // Assert
      expect(value).toBe('stored');
    });

    it('returns null for missing keys', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'get').mockResolvedValue(null);

      // Act
      const value = await service.get('missing');

      // Assert
      expect(value).toBeNull();
    });

    it('stores values without TTL through plain SET', async () => {
      // Arrange
      const service = await createService(client);
      const set = vi.spyOn(client, 'set').mockResolvedValue('OK');

      // Act
      await service.set('key', 'value');

      // Assert
      expect(set).toHaveBeenCalledWith('key', 'value');
    });

    it('stores expiring values through SET with EX', async () => {
      // Arrange
      const service = await createService(client);
      const set = vi.spyOn(client, 'set').mockResolvedValue('OK');

      // Act
      await service.set('key', 'value', { ttlSeconds: 60 });

      // Assert
      expect(set).toHaveBeenCalledWith('key', 'value', 'EX', 60);
    });

    it('deletes keys with UNLINK, never DEL', async () => {
      // Arrange
      const service = await createService(client);
      const unlink = vi.spyOn(client, 'unlink').mockResolvedValue(2);
      const del = vi.spyOn(client, 'del');

      // Act
      const removed = await service.delete('a', 'b');

      // Assert
      expect(removed).toBe(2);
      expect(unlink).toHaveBeenCalledWith('a', 'b');
      expect(del).not.toHaveBeenCalled();
    });

    it('maps EXISTS to a boolean', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'exists').mockResolvedValue(1);

      // Act & Assert
      await expect(service.exists('key')).resolves.toBe(true);
    });

    it('maps EXPIRE to a boolean', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'expire').mockResolvedValue(1);

      // Act & Assert
      await expect(service.expire('key', 30)).resolves.toBe(true);
    });

    it('returns the TTL in seconds', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'ttl').mockResolvedValue(42);

      // Act
      const ttl = await service.ttl('key');

      // Assert
      expect(ttl).toBe(42);
    });

    it('increments and decrements atomically through INCRBY', async () => {
      // Arrange
      const service = await createService(client);
      const incrby = vi.spyOn(client, 'incrby').mockResolvedValue(5);

      // Act
      const incremented = await service.increment('counter');
      const decremented = await service.decrement('counter', 3);

      // Assert
      expect(incremented).toBe(5);
      expect(decremented).toBe(5);
      expect(incrby).toHaveBeenNthCalledWith(1, 'counter', 1);
      expect(incrby).toHaveBeenNthCalledWith(2, 'counter', -3);
    });

    it('propagates client errors instead of masking them', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'get').mockRejectedValue(new Error('connection lost'));

      // Act & Assert
      await expect(service.get('key')).rejects.toThrow('connection lost');
    });

    it('iterates keys with SCAN and stops at the limit', async () => {
      // Arrange
      const service = await createService(client);
      const scan = vi
        .spyOn(client, 'scan')
        .mockResolvedValue(['7', ['batch:1', 'batch:2', 'batch:3']]);

      // Act
      const keys = await service.scanKeys('batch:*', { limit: 3 });

      // Assert
      expect(keys).toEqual(['batch:1', 'batch:2', 'batch:3']);
      expect(scan).toHaveBeenCalledTimes(1);
      expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'batch:*', 'COUNT', 100);
    });

    it('continues scanning until the cursor returns to zero', async () => {
      // Arrange
      const service = await createService(client);
      const scan = vi
        .spyOn(client, 'scan')
        .mockResolvedValueOnce(['5', ['a']])
        .mockResolvedValueOnce(['0', ['b']]);

      // Act
      const keys = await service.scanKeys('*');

      // Assert
      expect(keys).toEqual(['a', 'b']);
      expect(scan).toHaveBeenCalledTimes(2);
    });
  });

  describe('atomic deleteIfEquals', () => {
    it('executes a single atomic Lua read-check-delete with the key and expected value', async () => {
      // Arrange
      const service = await createService(client);
      const evalSpy = vi.spyOn(client, 'eval').mockResolvedValue(1);

      // Act
      const consumed = await service.deleteIfEquals('some:key', '048391');

      // Assert
      expect(consumed).toBe(true);
      expect(evalSpy).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, value] = evalSpy.mock.calls[0];
      expect(numKeys).toBe(1);
      expect(key).toBe('some:key');
      expect(value).toBe('048391');
      // The script performs the read, the comparison, and the deletion
      // together; no separate GET/DEL commands are issued.
      expect(script).toContain("redis.call('GET', KEYS[1])");
      expect(script).toContain('== ARGV[1]');
      expect(script).toContain("redis.call('UNLINK', KEYS[1])");
    });

    it('maps the script result to a boolean', async () => {
      // Arrange
      const service = await createService(client);
      const evalSpy = vi.spyOn(client, 'eval');

      // Act & Assert
      evalSpy.mockResolvedValue(1);
      await expect(service.deleteIfEquals('some:key', '048391')).resolves.toBe(true);
      evalSpy.mockResolvedValue(0);
      await expect(service.deleteIfEquals('some:key', 'wrong')).resolves.toBe(false);
    });

    it('rejects a non-numeric script reply — stringNumbers is never enabled (ADR-019)', async () => {
      // Arrange
      const service = await createService(client);
      const evalSpy = vi.spyOn(client, 'eval');
      evalSpy.mockResolvedValue('1');

      // Act & Assert — the reply type is a fixed numeric contract; anything
      // else is a programming error and fails fast.
      await expect(service.deleteIfEquals('some:key', '048391')).rejects.toThrow(
        'Unexpected Redis script reply type.',
      );
    });

    it('propagates Redis errors from the script execution', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'eval').mockRejectedValue(new Error('connection lost'));

      // Act & Assert
      await expect(service.deleteIfEquals('some:key', '048391')).rejects.toThrow('connection lost');
    });
  });

  describe('connection lifecycle', () => {
    it('registers listeners exactly once and initiates the connection on init', async () => {
      // Arrange
      const service = await createService(client);
      const connect = vi.spyOn(client, 'connect').mockResolvedValue();

      // Act
      service.onModuleInit();

      // Assert
      expect(client.listenerCount('connect')).toBe(1);
      expect(client.listenerCount('ready')).toBe(1);
      expect(client.listenerCount('error')).toBe(1);
      expect(client.listenerCount('close')).toBe(1);
      expect(client.listenerCount('reconnecting')).toBe(1);
      expect(client.listenerCount('end')).toBe(1);
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it('logs each distinct connection error once', async () => {
      // Arrange
      const service = await createService(client);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      service.onModuleInit();

      // Act
      client.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      client.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      client.emit('error', new Error('connect ETIMEDOUT 127.0.0.1:6379'));

      // Assert
      const warnings = warnSpy.mock.calls.map((call) => String(call[1]));
      expect(warnings).toHaveLength(2);
    });

    it('logs recovery after an outage and re-enables error logging', async () => {
      // Arrange
      const service = await createService(client);
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      service.onModuleInit();

      // Act
      client.emit('ready');
      client.emit('error', new Error('connection dropped'));
      client.emit('ready');
      client.emit('error', new Error('connection dropped'));

      // Assert
      const logs = logSpy.mock.calls.map((call) => String(call[0]));
      expect(logs).toContain('Redis connection ready.');
      expect(logs).toContain('Redis connection recovered.');
    });
  });

  describe('graceful shutdown', () => {
    it('quits gracefully and skips disconnect when QUIT completes', async () => {
      // Arrange
      const service = await createService(client);
      const status = vi.spyOn(client, 'status', 'get');
      status.mockReturnValueOnce('ready').mockReturnValueOnce('ready').mockReturnValue('end');
      const quit = vi.spyOn(client, 'quit').mockResolvedValue('OK');
      const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(() => client);

      // Act
      await service.onApplicationShutdown();

      // Assert
      expect(quit).toHaveBeenCalledTimes(1);
      expect(disconnect).not.toHaveBeenCalled();
      expect(client.listenerCount('error')).toBe(0);
    });

    it('force-disconnects when the shutdown timeout expires', async () => {
      // Arrange
      const service = await createService(client, 20);
      vi.spyOn(client, 'status', 'get').mockReturnValue('ready');
      vi.spyOn(client, 'quit').mockImplementation(() => new Promise(() => {}));
      const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(() => client);

      // Act
      await service.onApplicationShutdown();

      // Assert
      expect(disconnect).toHaveBeenCalled();
    });

    it('force-disconnects when QUIT is rejected', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'status', 'get').mockReturnValue('ready');
      vi.spyOn(client, 'quit').mockRejectedValue(new Error('QUIT failed'));
      const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(() => client);

      // Act
      await service.onApplicationShutdown();

      // Assert
      expect(disconnect).toHaveBeenCalled();
    });

    it('disconnects immediately when the client is not ready', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'status', 'get').mockReturnValue('connecting');
      const quit = vi.spyOn(client, 'quit');
      const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(() => client);

      // Act
      await service.onApplicationShutdown();

      // Assert
      expect(quit).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalled();
    });

    it('does nothing when the client has already ended', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'status', 'get').mockReturnValue('end');
      const quit = vi.spyOn(client, 'quit');
      const disconnect = vi.spyOn(client, 'disconnect').mockImplementation(() => client);

      // Act
      await service.onApplicationShutdown();

      // Assert
      expect(quit).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    });

    it('is idempotent across repeated shutdown calls', async () => {
      // Arrange
      const service = await createService(client);
      vi.spyOn(client, 'status', 'get').mockReturnValue('ready');
      const quit = vi.spyOn(client, 'quit').mockResolvedValue('OK');

      // Act
      await service.onApplicationShutdown();
      await service.onApplicationShutdown();

      // Assert
      expect(quit).toHaveBeenCalledTimes(1);
    });
  });
});
