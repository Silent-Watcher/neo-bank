import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from './redis.service.js';

// Bounds the probe below both the client's commandTimeout (5000 ms — the
// losing PING keeps running after this deadline and settles there) and the
// Compose API healthcheck timeout (5 s), so worst-case liveness latency fits
// the outer window exactly as the PostgreSQL probe does (ADR-036/ADR-037).
const REDIS_HEALTH_PROBE_TIMEOUT_MS = 3000;

// Health probes are coalesced (ADR-037): one in-flight probe per instance,
// results cached briefly so a request flood cannot amplify into Redis
// commands. The failure cooldown doubles as the outage probe interval — a
// failed probe is never cached beyond this window, so recovery is detected
// on the next probe after expiry.
const REDIS_HEALTH_CACHE_SUCCESS_TTL_MS = 5000;
const REDIS_HEALTH_CACHE_FAILURE_TTL_MS = 3000;

export type RedisProbeOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Runs the Redis health probe with a hard client-side deadline,
 * single-flight coalescing, and a short-lived result cache (ADR-037).
 *
 * The probe is a PING through the shared client — no extra connections. Its
 * deadline is a `Promise.race`: the losing PING is *not* cancelled, it
 * settles via the client's `commandTimeout`, and its in-flight residue is
 * bounded by the client's `socketTimeout` (which destroys a black-holed
 * socket and recovers it through the bounded reconnect cycle) — the ADR-036
 * distinction between caller rejection, command abandonment, and connection
 * destruction applies verbatim.
 *
 * Shutdown needs no dedicated hook: once the client ends, `ping()` rejects
 * immediately ("Connection is closed."), and an in-flight probe claims
 * failure within the deadline.
 */
@Injectable()
export class RedisHealthProbe {
  private readonly logger = new Logger(RedisHealthProbe.name);

  /** Last probe outcome with its expiry; success and failure TTLs differ. */
  private cache: { outcome: RedisProbeOutcome; expiresAt: number } | null = null;

  /** Shared in-flight probe — the single-flight guard. */
  private inflight: Promise<RedisProbeOutcome> | null = null;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Returns the current Redis reachability outcome. Concurrent callers
   * share one probe; results within the TTL window are served from the
   * cache. Outcomes are frozen at creation — the same reference reaches
   * every concurrent caller, so they must not (and cannot) be mutated.
   */
  async probe(): Promise<RedisProbeOutcome> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.outcome;
    }
    if (this.inflight) {
      return this.inflight;
    }
    const flight = this.runBoundedProbe().finally(() => {
      this.inflight = null;
    });
    this.inflight = flight;
    return flight;
  }

  // One probe run: deadline-bounded ping, then cache the outcome. Failures
  // (including the deadline) are logged here once per probe, never per
  // request — the cooldown keeps both the probe rate and the log rate
  // bounded during an outage.
  private async runBoundedProbe(): Promise<RedisProbeOutcome> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // Promise.race subscribes to both promises, so the losing PING's late
      // settlement (commandTimeout rejection after this deadline already
      // fired) can never surface as an unhandled rejection.
      await Promise.race([
        this.redisService.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`Redis probe timed out after ${REDIS_HEALTH_PROBE_TIMEOUT_MS} ms`)),
            REDIS_HEALTH_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      // Frozen: the same object reference reaches every concurrent caller on
      // both health endpoints, so immutability must be a property of the
      // data, not a convention (SEC-01, Wave 24).
      const success: RedisProbeOutcome = Object.freeze({ ok: true });
      this.cache = {
        outcome: success,
        expiresAt: Date.now() + REDIS_HEALTH_CACHE_SUCCESS_TTL_MS,
      };
      return success;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const outcome: RedisProbeOutcome = Object.freeze({ ok: false, reason });
      this.cache = {
        outcome,
        expiresAt: Date.now() + REDIS_HEALTH_CACHE_FAILURE_TTL_MS,
      };
      this.logger.warn({ reason }, 'Redis health probe failed.');
      return outcome;
    } finally {
      clearTimeout(timer);
    }
  }
}
