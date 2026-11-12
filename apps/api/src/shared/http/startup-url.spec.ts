import type { NetworkInterfaceInfoIPv4, NetworkInterfaceInfoIPv6 } from 'node:os';
import { describe, expect, it } from 'vitest';

import { buildStartupLogMessage, buildStartupUrl, resolveStartupAddresses } from './startup-url.js';

// Fake interface maps: every case is covered without real network state.
const wildInterface: NetworkInterfaceInfoIPv4 = {
  address: '192.168.1.10',
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: '192.168.1.10/24',
};
const duplicateInterface: NetworkInterfaceInfoIPv4 = {
  address: '192.168.1.10',
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:01',
  internal: false,
  cidr: '192.168.1.10/24',
};
const loopbackInterface: NetworkInterfaceInfoIPv4 = {
  address: '127.0.0.1',
  netmask: '255.0.0.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: true,
  cidr: '127.0.0.1/8',
};
const wildcardInterface: NetworkInterfaceInfoIPv4 = {
  address: '0.0.0.0',
  netmask: '0.0.0.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: '0.0.0.0/0',
};
const ipv6Interface: NetworkInterfaceInfoIPv6 = {
  address: 'fe80::1',
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal: false,
  scopeid: 2,
  cidr: 'fe80::1/64',
};

describe('resolveStartupAddresses', () => {
  it('returns the configured host verbatim for an explicit IPv4 address', () => {
    expect(resolveStartupAddresses('192.168.1.10')).toEqual(['192.168.1.10']);
  });

  it('returns the configured hostname verbatim', () => {
    expect(resolveStartupAddresses('api.example.com')).toEqual(['api.example.com']);
  });

  it('returns the configured IPv6 address verbatim', () => {
    expect(resolveStartupAddresses('::1')).toEqual(['::1']);
  });

  it('lists loopback first plus deduplicated non-internal interfaces for the wildcard host', () => {
    const interfaces = {
      lo: [wildInterface],
      eth0: [wildInterface, duplicateInterface],
      eth1: [wildInterface],
    };
    expect(resolveStartupAddresses('0.0.0.0', interfaces)).toEqual(['127.0.0.1', '192.168.1.10']);
  });

  it('excludes internal, loopback, and wildcard interface addresses', () => {
    const interfaces = { lo: [loopbackInterface], any: [wildcardInterface], eth0: [wildInterface] };
    expect(resolveStartupAddresses('0.0.0.0', interfaces)).toEqual(['127.0.0.1', '192.168.1.10']);
  });

  it('includes IPv6 interface addresses for the wildcard host', () => {
    const interfaces = { eth0: [ipv6Interface] };
    expect(resolveStartupAddresses('0.0.0.0', interfaces)).toEqual(['127.0.0.1', 'fe80::1']);
  });

  it('advertises only loopback when no non-internal interface exists', () => {
    expect(resolveStartupAddresses('0.0.0.0', { lo: [loopbackInterface] })).toEqual(['127.0.0.1']);
    expect(resolveStartupAddresses('0.0.0.0', {})).toEqual(['127.0.0.1']);
  });

  it('treats the IPv6 wildcard host like the IPv4 wildcard, seeding the IPv6 loopback', () => {
    const interfaces = { eth0: [wildInterface] };
    expect(resolveStartupAddresses('::', interfaces)).toEqual(['::1', '192.168.1.10']);
  });

  it('advertises only the IPv6 loopback when no non-internal interface exists', () => {
    expect(resolveStartupAddresses('::', {})).toEqual(['::1']);
  });
});

describe('buildStartupUrl', () => {
  it('builds an HTTP URL for an IPv4 address with the given path', () => {
    expect(buildStartupUrl('127.0.0.1', 3001, '/api/v1')).toBe('http://127.0.0.1:3001/api/v1');
  });

  it('wraps IPv6 literals in brackets', () => {
    expect(buildStartupUrl('fe80::1', 3001, '/docs')).toBe('http://[fe80::1]:3001/docs');
  });

  it('keeps hostnames unwrapped', () => {
    expect(buildStartupUrl('api.example.com', 80, '/api/v1')).toBe(
      'http://api.example.com:80/api/v1',
    );
  });
});

describe('buildStartupLogMessage', () => {
  it('renders API and Swagger sections with Local and Network lines', () => {
    const message = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1', 'http://192.168.1.10:3001/api/v1'],
      swaggerUrls: ['http://127.0.0.1:3001/docs', 'http://192.168.1.10:3001/docs'],
      mockserverUrls: null,
      redisInsightUrl: null,
    });

    expect(message).toBe(
      [
        'Application successfully started',
        '',
        'API:',
        '  Local:   http://127.0.0.1:3001/api/v1',
        '  Network: http://192.168.1.10:3001/api/v1',
        '',
        'Swagger:',
        '  Local:   http://127.0.0.1:3001/docs',
        '  Network: http://192.168.1.10:3001/docs',
      ].join('\n'),
    );
  });

  it('omits the Swagger section when Swagger is not registered', () => {
    const message = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: null,
      redisInsightUrl: null,
    });

    expect(message).toBe(
      [
        'Application successfully started',
        '',
        'API:',
        '  Local:   http://127.0.0.1:3001/api/v1',
      ].join('\n'),
    );
    expect(message).not.toContain('Swagger');
  });

  it('renders the Redis Insight URL when one is exposed', () => {
    const message = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: null,
      redisInsightUrl: 'http://localhost:8001',
    });

    expect(message).toContain('Redis Insight: http://localhost:8001');
  });

  it('omits the Redis Insight line where none is exposed', () => {
    const message = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: null,
      redisInsightUrl: null,
    });

    expect(message).not.toContain('Redis Insight');
  });

  it('renders the MockServer section with host and Docker addresses between Swagger and Redis Insight', () => {
    const message = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: ['http://127.0.0.1:3001/docs'],
      mockserverUrls: { host: 'http://localhost:1080', docker: 'http://mockserver:1080' },
      redisInsightUrl: 'http://localhost:8001',
    });

    expect(message).toBe(
      [
        'Application successfully started',
        '',
        'API:',
        '  Local:   http://127.0.0.1:3001/api/v1',
        '',
        'Swagger:',
        '  Local:   http://127.0.0.1:3001/docs',
        '',
        'MockServer:',
        '  Host:    http://localhost:1080',
        '  Docker:  http://mockserver:1080',
        '',
        'Redis Insight: http://localhost:8001',
      ].join('\n'),
    );
  });

  it('renders only the MockServer lines that are configured', () => {
    const hostOnly = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: { host: 'http://localhost:1080', docker: null },
      redisInsightUrl: null,
    });
    expect(hostOnly).toContain('MockServer:');
    expect(hostOnly).toContain('  Host:    http://localhost:1080');
    expect(hostOnly).not.toContain('Docker:');

    const dockerOnly = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: { host: null, docker: 'http://mockserver:1080' },
      redisInsightUrl: null,
    });
    expect(dockerOnly).toContain('MockServer:');
    expect(dockerOnly).toContain('  Docker:  http://mockserver:1080');
    expect(dockerOnly).not.toContain('Host:');
  });

  it('omits the MockServer section where no address is exposed', () => {
    const withoutSection = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: null,
      redisInsightUrl: null,
    });
    const withEmptyAddresses = buildStartupLogMessage({
      apiUrls: ['http://127.0.0.1:3001/api/v1'],
      swaggerUrls: null,
      mockserverUrls: { host: null, docker: null },
      redisInsightUrl: null,
    });

    expect(withoutSection).not.toContain('MockServer');
    expect(withEmptyAddresses).not.toContain('MockServer');
  });
});
