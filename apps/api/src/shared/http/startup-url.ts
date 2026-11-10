import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';

// The Fastify adapter is constructed without HTTPS options (main.ts), so the
// server always speaks plain HTTP. Update this together with any future TLS
// configuration — reverse-proxy TLS termination is not part of the current
// deployment topology, and no external URL is invented for it here.
const PROTOCOL = 'http';

// Addresses that mean "listen on every interface". They select the address
// list below but are never displayed as accessible URLs themselves.
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

// Resolves the addresses to advertise for the configured bind address: the
// host verbatim when it is explicit; for a wildcard host, the family-
// appropriate loopback address first followed by the deduplicated
// non-internal interface addresses. Only loopback is advertised when no
// non-internal interface exists. The interface parameter is injectable so
// tests need no real network state.
export function resolveStartupAddresses(
  host: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  if (!WILDCARD_HOSTS.has(host)) {
    return [host];
  }

  const addresses = [host === '::' ? '::1' : '127.0.0.1'];
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || WILDCARD_HOSTS.has(info.address) || addresses.includes(info.address)) {
        continue;
      }
      addresses.push(info.address);
    }
  }
  return addresses;
}

// Builds a startup URL from an address, the listening port, and a path.
// The path must start with '/'; IPv6 literals are wrapped in brackets as
// URLs require.
export function buildStartupUrl(address: string, port: number, path: string): string {
  const hostPart = address.includes(':') ? `[${address}]` : address;
  return `${PROTOCOL}://${hostPart}:${port}${path}`;
}

export interface StartupUrlSections {
  readonly apiUrls: readonly string[];
  /** `null` when Swagger is not registered (non-development environments). */
  readonly swaggerUrls: readonly string[] | null;
}

// Renders the startup log message. The first address is labeled Local, the
// rest Network; for an explicitly configured host there is a single "Local"
// line carrying that exact host.
export function buildStartupLogMessage({ apiUrls, swaggerUrls }: StartupUrlSections): string {
  const lines: string[] = ['Application successfully started', '', 'API:'];
  lines.push(...labeledUrls(apiUrls));

  if (swaggerUrls !== null) {
    lines.push('', 'Swagger:');
    lines.push(...labeledUrls(swaggerUrls));
  }

  return lines.join('\n');
}

function labeledUrls(urls: readonly string[]): string[] {
  return urls.map((url, index) => (index === 0 ? `  Local:   ${url}` : `  Network: ${url}`));
}
