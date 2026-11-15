import { ClsServiceManager } from 'nestjs-cls';

/**
 * The acting principal resolved for the currently executing operation. Actor
 * IDs are BIGINT values represented as strings (ADR-029); `null` means the
 * operation was performed by the system.
 *
 * This is the whole store — deliberately minimal (ADR-031: the official
 * NestJS ALS guidance warns against contextual God objects; only genuinely
 * useful request metadata may join this shape).
 */
export interface ActorContext {
  readonly actorId: string | null;
}

// Symbol store key (ADR-031): the actor context rides the shared CLS
// service (nestjs-cls) under a symbol key instead of an untyped string key,
// so every read/write stays type-checked without assertions. Symbol keys
// are excluded from serialization and cannot collide with other store users.
const ACTOR_ID = Symbol('actorId');
export { ACTOR_ID };

/**
 * Bridge to the shared CLS service for non-DI consumers (BaseEntity audit
 * callbacks, background jobs). The service exists from module load
 * (`ClsServiceManager` backs it with a globalThis ALS instance) and reads
 * return `null`/`undefined` when no context is open — the same system
 * semantics the bespoke singleton had (ADR-029), now on maintained upstream
 * APIs (ADR-031).
 */
function activeCls() {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive() ? cls : null;
}

/**
 * Runs `callback` inside a fresh actor context (nested contexts shadow, not
 * merge). Trust contract (SEC-01, Wave 16): `actorId` is an audit-attribution
 * value — call sites must pass verified principals only (the authentication
 * layer, or explicit system identities); never client-derived input (DTO
 * fields, headers, query params), which would forge the audit trail silently.
 */
export function runWithActorContext<T>(context: ActorContext, callback: () => T): T {
  return ClsServiceManager.getClsService().runWith({ [ACTOR_ID]: context.actorId }, callback);
}

export function getActorContext(): ActorContext | undefined {
  const cls = activeCls();
  if (cls === null) {
    return undefined;
  }
  const store: Record<symbol, unknown> = cls.get();
  const actorId: unknown = store[ACTOR_ID];
  return { actorId: typeof actorId === 'string' ? actorId : null };
}

/**
 * Resolves the actor of the current async execution context, or `null` when
 * no context is open (background jobs, system operations) or the actor is
 * anonymous.
 */
export function getActorId(): string | null {
  return getActorContext()?.actorId ?? null;
}
