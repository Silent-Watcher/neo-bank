// Metadata key for @SkipMemoryProtection(). Routes flagged with it stay
// reachable while the protection state is active: health probes must keep
// answering (a 503 readiness is meaningful, an unreachable probe is not) and
// the Problem-Type documentation page is static HTML with no handler cost.
export const SKIP_MEMORY_PROTECTION = 'skipMemoryProtection';
