import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import memoryProtectionConfig, {
  MEMORY_PROTECTION_CONFIG,
} from '#config/memory-protection.config.js';
import { MemoryHealthIndicator } from './memory.health.indicator.js';
import { MemoryProtectionService } from './memory-protection.service.js';

/**
 * Global memory-protection module (ADR-026). Registered exactly once
 * (AppModule); its exports are available everywhere without importing it,
 * mirroring the Redis module. The guard is NOT provided here: the AppModule
 * registers it as APP_GUARD with `useClass` (ordering matters there), and
 * that registration instantiates the guard against the globally visible
 * dependencies. The config namespace token is provided here so the service's
 * `@Inject(MEMORY_PROTECTION_CONFIG)` resolves in this module's context (e2e
 * specs override this exact token to force the protection state).
 * TerminusModule supplies HealthIndicatorService for the memory health
 * indicator; it is the same plain module AppModule and RedisModule import,
 * so no duplicate Terminus providers are created.
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [
    { provide: MEMORY_PROTECTION_CONFIG, useFactory: () => memoryProtectionConfig() },
    MemoryProtectionService,
    MemoryHealthIndicator,
  ],
  exports: [MemoryProtectionService, MemoryHealthIndicator],
})
export class MemoryProtectionModule {}
