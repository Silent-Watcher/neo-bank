// Resolves the API version represented in the request URI, matching the
// bootstrap configuration: the `api` global prefix with a `v<N>` version
// segment (URI versioning, ADR-005). Everything else — version-neutral routes
// such as /health, and unversioned paths — resolves to `neutral`.
const API_VERSION_PATTERN = /^\/api\/v(\d+)(?:\/|$)/;

export const NEUTRAL_API_VERSION = 'neutral';

export function resolveApiVersion(url: string): string {
  const match = API_VERSION_PATTERN.exec(url);

  return match ? `v${match[1]}` : NEUTRAL_API_VERSION;
}
