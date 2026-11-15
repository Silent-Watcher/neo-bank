import { isIP } from 'node:net';

import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';

/**
 * The official ThrottlerGuard with the project's response-header additions:
 * a rejected (blocked) request only receives the named `Retry-After-<name>`
 * header from the official implementation, so this override also sets the
 * standard unsuffixed `Retry-After` plus the `X-RateLimit-*` quota headers
 * (remaining 0) before the throttling exception is thrown.
 *
 * The tracker is additionally bounded: the default tracker keys on the
 * trust-proxy-resolved `req.ip`, which in the documented trust-all state
 * (`TRUST_PROXY=true` without a `TRUST_PROXY_PROXIES` allowlist) can be any
 * client-chosen X-Forwarded-For string. A tracker that is exactly the
 * resolved request IP but not a valid IP falls back to the socket address,
 * so garbage forwarded values cannot mint unbounded quota keys (Wave 18
 * SEC-01). Route-supplied custom trackers pass through untouched. Residual,
 * accepted: under trust-all a client cycling well-formed spoofed IPs still
 * mints one key per value — the allowlist is the real control for that.
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
    const tracker = this.boundedTracker(await getTracker(req, context), req);
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

  /**
   * Falls back to the socket address when the tracker is exactly the resolved
   * request IP and that value is not a valid IP — the signature of the
   * default tracker consuming a garbage forwarded value. Comparing against
   * `req.ip` keeps route-supplied custom trackers (which never equal the
   * request IP) untouched.
   */
  private boundedTracker(
    tracker: string,
    req: { ip?: unknown; socket?: { remoteAddress?: unknown } },
  ): string {
    if (tracker === req.ip && !isIP(tracker)) {
      const remoteAddress = req.socket?.remoteAddress;
      return typeof remoteAddress === 'string' && remoteAddress !== '' ? remoteAddress : 'unknown';
    }
    return tracker;
  }
}
