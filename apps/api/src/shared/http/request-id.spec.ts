import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { fastifyGenReqId, isValidUuidV4, X_REQUEST_ID_HEADER } from './request-id.js';

const VALID_UUID_V4_UPPERCASE = '550E8400-E29B-41D4-A716-446655440000';
const VALID_UUID_V4_LOWERCASE = '550e8400-e29b-41d4-a716-446655440000';
const UUID_V1 = '550e8400-e29b-11d4-a716-446655440000';
const UUID_V7 = '018f6a1c-9b7a-7ccf-b2a3-9c4e5d6f7a8b';

function requestWithHeader(
  value: string | string[] | undefined,
): Parameters<typeof fastifyGenReqId>[0] {
  return { headers: { [X_REQUEST_ID_HEADER]: value } };
}

describe('isValidUuidV4', () => {
  it('accepts a valid lowercase UUIDv4', () => {
    expect(isValidUuidV4(VALID_UUID_V4_LOWERCASE)).toBe(true);
  });

  it('accepts a valid uppercase UUIDv4', () => {
    expect(isValidUuidV4(VALID_UUID_V4_UPPERCASE)).toBe(true);
  });

  it('accepts a freshly generated UUIDv4', () => {
    expect(isValidUuidV4(randomUUID())).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4('550e8400e29b41d4a716446655440000')).toBe(false);
    expect(isValidUuidV4(`${VALID_UUID_V4_LOWERCASE}, another-value`)).toBe(false);
  });

  it('rejects UUIDs of other versions', () => {
    expect(isValidUuidV4(UUID_V1)).toBe(false);
    expect(isValidUuidV4(UUID_V7)).toBe(false);
  });

  it('rejects values with wrong variant bits', () => {
    expect(isValidUuidV4('550e8400-e29b-41d4-0716-446655440000')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidUuidV4(undefined)).toBe(false);
    expect(isValidUuidV4(123)).toBe(false);
  });
});

describe('fastifyGenReqId', () => {
  it('reuses a valid inbound UUIDv4, normalized to lowercase', () => {
    const id = fastifyGenReqId(requestWithHeader(VALID_UUID_V4_UPPERCASE));

    expect(id).toBe(VALID_UUID_V4_LOWERCASE);
  });

  it('generates a UUIDv4 when the header is absent', () => {
    const id = fastifyGenReqId(requestWithHeader(undefined));

    expect(isValidUuidV4(id)).toBe(true);
  });

  it('generates a UUIDv4 instead of echoing a malformed header', () => {
    const id = fastifyGenReqId(requestWithHeader('garbage'));

    expect(isValidUuidV4(id)).toBe(true);
    expect(id).not.toBe('garbage');
  });

  it('generates a UUIDv4 instead of echoing a UUID of another version', () => {
    const id = fastifyGenReqId(requestWithHeader(UUID_V1));

    expect(isValidUuidV4(id)).toBe(true);
    expect(id).not.toBe(UUID_V1);
  });

  it('treats multiple header values as invalid and generates a UUIDv4', () => {
    const id = fastifyGenReqId(requestWithHeader([VALID_UUID_V4_LOWERCASE, randomUUID()]));

    expect(isValidUuidV4(id)).toBe(true);
    expect(id).not.toBe(VALID_UUID_V4_LOWERCASE);
  });
});
