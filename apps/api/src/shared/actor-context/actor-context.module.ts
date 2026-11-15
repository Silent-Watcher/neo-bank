import { ClsModule } from 'nestjs-cls';

import { ACTOR_ID } from './actor-context.js';

/**
 * Resolves the actor performing the current request (ADR-029). Authentication
 * has not landed yet, so every request is attributed to the system (`null`).
 *
 * Ordering contract for the authentication task (SEC-02, Wave 16): Nest
 * middleware runs BEFORE guards, so a guard-populated `request.user` does
 * not exist inside this `setup` hook. When authentication lands, the
 * authentication guard itself must write the verified principal into the
 * store (`cls.set(ACTOR_ID, ...)` after successful verification); `setup`
 * only opens the store with the system default. Never fall back to
 * client-supplied identity data (headers, DTO fields) — that is attribution
 * forgery.
 */
function resolveActorId(_request: unknown): string | null {
  return null;
}

/**
 * Global actor-context module (ADR-031): `nestjs-cls`'s `ClsModule.forRoot`
 * provides the shared, DI-integrated CLS service and mounts `ClsMiddleware`
 * for every route; the library detects the HTTP adapter and mounts through a
 * suitable path (ADR-032: platform-agnostic — under the NodeAdapter the
 * middleware runs through the same Nest middleware pipeline). The `setup`
 * hook opens the store with the actor seam — the store stays the
 * single-field actor shape (ADR-031: no contextual God object), and raw
 * request/response objects are not retained (`saveReq`/`saveRes` off).
 *
 * MikroORM's own `RequestContext` (per-request EntityManager fork) remains a
 * separate, independent mechanism — ADR-031 does not touch it.
 */
export const actorContextModule = ClsModule.forRoot({
  global: true,
  middleware: {
    mount: true,
    saveReq: false,
    saveRes: false,
    setup: (cls, request) => {
      cls.set(ACTOR_ID, resolveActorId(request));
    },
  },
});
