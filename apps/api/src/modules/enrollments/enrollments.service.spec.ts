import { beforeEach, describe, expect, it, vi } from 'vitest';

const { randomIntMock } = vi.hoisted(() => ({
  randomIntMock: vi.fn<(min: number, max: number) => number>(),
}));

vi.mock('node:crypto', () => ({ randomInt: randomIntMock }));

import { EnrollmentsService } from './enrollments.service.js';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  beforeEach(() => {
    randomIntMock.mockReset();
    service = new EnrollmentsService();
  });

  it('returns the submitted phone number with the generated OTP', () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    const result = service.requestOtp('09123456789');

    // Assert
    expect(result).toEqual({ phoneNumber: '09123456789', otp: '483921' });
  });

  it('generates the OTP as a string of exactly six digits', () => {
    // Arrange
    randomIntMock.mockReturnValue(483_921);

    // Act
    const { otp } = service.requestOtp('09123456789');

    // Assert
    expect(otp).toBeTypeOf('string');
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('supports both range boundaries as six-digit OTPs', () => {
    // Arrange
    randomIntMock.mockReturnValue(100_000);
    const lower = service.requestOtp('09123456789').otp;
    randomIntMock.mockReturnValue(999_999);

    // Act
    const upper = service.requestOtp('09123456789').otp;

    // Assert
    expect(lower).toBe('100000');
    expect(upper).toBe('999999');
  });

  it('draws the OTP from the cryptographically secure randomInt over the six-digit range', () => {
    // Arrange
    randomIntMock.mockReturnValue(123_456);

    // Act
    service.requestOtp('09123456789');

    // Assert
    expect(randomIntMock).toHaveBeenCalledTimes(1);
    expect(randomIntMock).toHaveBeenCalledWith(100_000, 1_000_000);
  });
});
