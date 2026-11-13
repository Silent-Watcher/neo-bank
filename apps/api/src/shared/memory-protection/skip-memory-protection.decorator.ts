import { SetMetadata } from '@nestjs/common';

import { SKIP_MEMORY_PROTECTION } from './memory-protection.constants.js';

/**
 * Marks a route (or a whole controller) as exempt from memory-based load
 * shedding: while the protection state is active, exempt routes are still
 * served instead of receiving the 503 rejection. Intended for health probes
 * and the static Problem-Type documentation page only — no business route
 * should carry it.
 */
export const SkipMemoryProtection = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_MEMORY_PROTECTION, true);
