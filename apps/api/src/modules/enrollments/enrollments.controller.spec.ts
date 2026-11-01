import { describe, expect, it, vi } from 'vitest';
import { EnrollmentsController } from './enrollments.controller.js';

describe('EnrollmentsController', () => {
  it('delegates to the service with the validated phone number and returns its result', () => {
    // Arrange
    const response = { phoneNumber: '09123456789', otp: '483921' };
    const enrollmentsService = {
      requestOtp: vi.fn<() => typeof response>().mockReturnValue(response),
    };
    const controller = new EnrollmentsController(enrollmentsService as never);

    // Act
    const result = controller.requestOtp({ phoneNumber: '09123456789' });

    // Assert
    expect(result).toBe(response);
    expect(enrollmentsService.requestOtp).toHaveBeenCalledWith('09123456789');
  });
});
