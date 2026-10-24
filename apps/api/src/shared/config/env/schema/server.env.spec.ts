import { describe, expect, it } from 'vitest';

import { AppEnv } from '../../../enums/app-env.enum.js';
import { serverEnvSchema } from './server.env.js';

const validBaseEnv = {
  HOST: 'localhost',
  PORT: '3001',
};

describe('serverEnvSchema', () => {
  describe('APP_ENV', () => {
    it('defaults to AppEnv.Development when the variable is missing', () => {
      // Arrange
      const input = { ...validBaseEnv };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.APP_ENV).toBe(AppEnv.Development);
    });

    it('accepts every value defined in the AppEnv enum', () => {
      // Arrange & Act & Assert
      for (const appEnv of Object.values(AppEnv)) {
        const result = serverEnvSchema.parse({ APP_ENV: appEnv, ...validBaseEnv });

        expect(result.APP_ENV).toBe(appEnv);
      }
    });

    it('rejects values that are not part of the AppEnv enum', () => {
      // Arrange
      const input = { APP_ENV: 'staging', ...validBaseEnv };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('HOST', () => {
    it('accepts a valid hostname', () => {
      // Arrange
      const input = { ...validBaseEnv, HOST: 'api.example.com' };

      // Act & Assert
      expect(() => serverEnvSchema.parse(input)).not.toThrow();
    });

    it('accepts an IPv4 address', () => {
      // Arrange
      const input = { ...validBaseEnv, HOST: '192.168.1.10' };

      // Act & Assert
      expect(() => serverEnvSchema.parse(input)).not.toThrow();
    });

    it('accepts an IPv6 address', () => {
      // Arrange
      const input = { ...validBaseEnv, HOST: '::1' };

      // Act & Assert
      expect(() => serverEnvSchema.parse(input)).not.toThrow();
    });

    it('rejects a URL', () => {
      // Arrange
      const input = { ...validBaseEnv, HOST: 'http://localhost:3000' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects an empty value', () => {
      // Arrange
      const input = { ...validBaseEnv, HOST: '' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('PORT', () => {
    it('coerces a numeric string into a number', () => {
      // Arrange
      const input = { ...validBaseEnv, PORT: '8080' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.PORT).toBe(8080);
    });

    it('rejects a port below the valid range', () => {
      // Arrange
      const input = { ...validBaseEnv, PORT: '0' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a port above the valid range', () => {
      // Arrange
      const input = { ...validBaseEnv, PORT: '65536' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects an empty value', () => {
      // Arrange
      const input = { ...validBaseEnv, PORT: '' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a non-numeric value', () => {
      // Arrange
      const input = { ...validBaseEnv, PORT: 'not-a-port' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });
  });
});
