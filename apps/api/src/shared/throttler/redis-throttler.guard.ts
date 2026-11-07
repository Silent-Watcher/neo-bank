import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';

/**
 * The official ThrottlerGuard with the project's response-header additions:
 * a rejected (blocked) request only receives the named `Retry-After-<name>`
 * header from the official implementation, so this override also sets the
 * standard unsuffixed `Retry-After` plus the `X-RateLimit-*` quota headers
 * (remaining 0) before the throttling exception is thrown.
 *
 * Everything else — named-throttler iteration, metadata resolution, skip
 * behavior, tracker and key generation — is inherited unchanged so upgrades
 * of @nestjs/throttler keep working.
 */
export class RedisThrottlerGuard extends ThrottlerGuard {
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit, ttl, throttler, blockDuration, getTracker, generateKey } = requestProps;
    const { req, res } = this.getRequestResponse(context);
    const ignoreUserAgents = throttler.ignoreUserAgents ?? this.commonOptions.ignoreUserAgents;
    if (Array.isArray(ignoreUserAgents)) {
      for (const pattern of ignoreUserAgents) {
        if (pattern.test(req.headers['user-agent'] ?? '')) {
          return true;
        }
      }
    }

    // The guard's onModuleInit always fills a name; the type keeps it
    // optional, so fall back to the official default name.
    const throttlerName = throttler.name ?? 'default';
    const tracker = await getTracker(req, context);
    const key = generateKey(context, tracker, throttlerName);
    const record = await this.storageService.increment(
      key,
      ttl,
      limit,
      blockDuration,
      throttlerName,
    );

    const suffix = throttlerName === 'default' ? '' : `-${throttlerName}`;
    const setHeaders = throttler.setHeaders ?? this.commonOptions.setHeaders ?? true;

    if (record.isBlocked) {
      if (setHeaders) {
        // The standard header clients expect, plus the official named variant.
        this.setResponseHeader(res, 'Retry-After', record.timeToBlockExpire);
        this.setResponseHeader(res, `Retry-After${suffix}`, record.timeToBlockExpire);
        this.setResponseHeader(res, `${this.headerPrefix}-Limit${suffix}`, limit);
        this.setResponseHeader(res, `${this.headerPrefix}-Remaining${suffix}`, 0);
        this.setResponseHeader(res, `${this.headerPrefix}-Reset${suffix}`, record.timeToExpire);
      }
      await this.throwThrottlingException(context, {
        limit,
        ttl,
        key,
        tracker,
        ...record,
      });
    }

    if (setHeaders) {
      this.setResponseHeader(res, `${this.headerPrefix}-Limit${suffix}`, limit);
      this.setResponseHeader(
        res,
        `${this.headerPrefix}-Remaining${suffix}`,
        Math.max(0, limit - record.totalHits),
      );
      this.setResponseHeader(res, `${this.headerPrefix}-Reset${suffix}`, record.timeToExpire);
    }

    return true;
  }
}
