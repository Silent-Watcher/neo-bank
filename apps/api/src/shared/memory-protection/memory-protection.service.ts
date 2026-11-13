import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import type { MemoryProtectionConfig } from '#config/memory-protection.config.js';
import { MEMORY_PROTECTION_CONFIG } from '#config/memory-protection.config.js';

// RSS sample values are read in bytes; thresholds are configured in megabytes.
const BYTES_PER_MB = 1024 * 1024;

/**
 * Samples the process's own RSS on a fixed interval and maintains the
 * memory-protection state (ADR-026).
 *
 * State machine: `protected` activates as soon as one sample reaches the
 * activation threshold (fail-fast), and deactivates only after RSS has stayed
 * below the lower recovery threshold for `stableSamples` consecutive samples
 * (hysteresis — brief spikes below the recovery threshold do not end the
 * protection state). Transitions are logged so operators can correlate them
 * with metrics; sampling itself costs microseconds and never blocks.
 *
 * The protection state is the single source of truth for both consumers: the
 * admission guard (503 + Retry-After for non-exempt routes) and the memory
 * readiness indicator (down while protected).
 */
@Injectable()
export class MemoryProtectionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MemoryProtectionService.name);

  private protectedState = false;
  private consecutiveRecoveries = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(MEMORY_PROTECTION_CONFIG) private readonly config: MemoryProtectionConfig) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.log('Memory protection is disabled by configuration.');
      return;
    }

    // Sample immediately so a process that boots already under pressure enters
    // the protection state without waiting for the first interval to elapse.
    this.sample();
    this.timer = setInterval(() => this.sample(), this.config.sampleIntervalMs);
    // The sampler must never keep the event loop alive on its own; shutdown
    // lifecycle clears it, and unref() additionally de-schedules it when the
    // process would otherwise exit.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isProtected(): boolean {
    return this.protectedState;
  }

  /** Seconds until the next sample — used as the rejection's Retry-After value. */
  getSecondsUntilNextSample(): number {
    return Math.max(1, Math.ceil(this.config.sampleIntervalMs / 1000));
  }

  private sample(): void {
    const rssMb = Math.floor(process.memoryUsage().rss / BYTES_PER_MB);

    if (!this.protectedState) {
      if (rssMb >= this.config.maxRssMb) {
        this.protectedState = true;
        this.consecutiveRecoveries = 0;
        this.logger.warn(
          { rssMb, thresholdMb: this.config.maxRssMb },
          'Memory protection activated: new requests are rejected with 503 until memory recovers.',
        );
      }
      return;
    }

    if (rssMb < this.config.recoveryRssMb) {
      this.consecutiveRecoveries += 1;
      if (this.consecutiveRecoveries >= this.config.stableSamples) {
        this.protectedState = false;
        this.consecutiveRecoveries = 0;
        this.logger.log(
          { rssMb, recoveryThresholdMb: this.config.recoveryRssMb },
          'Memory protection recovered: requests are accepted again.',
        );
      }
      return;
    }

    // Still above the recovery threshold: the stabilization streak restarts.
    this.consecutiveRecoveries = 0;
  }
}
