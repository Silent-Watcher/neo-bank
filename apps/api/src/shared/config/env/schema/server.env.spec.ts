import { describe, expect, it } from 'vitest';

import { AppEnv } from '#enums/app-env.enum.js';
import {
  isCorsOriginRequiredInProduction,
  parseCorsOrigins,
  serverEnvSchema,
} from './server.env.js';

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

  describe('CORS_ORIGIN', () => {
    it('parses a comma-separated list into an array of origins', () => {
      // Arrange
      const input = {
        ...validBaseEnv,
        CORS_ORIGIN: 'http://localhost:3000,https://app.example.com',
      };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toEqual(['http://localhost:3000', 'https://app.example.com']);
    });

    it('trims whitespace around each origin', () => {
      // Arrange
      const input = {
        ...validBaseEnv,
        CORS_ORIGIN: '  http://localhost:3000 , https://app.example.com  ',
      };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toEqual(['http://localhost:3000', 'https://app.example.com']);
    });

    it('ignores empty entries created by trailing and repeated commas', () => {
      // Arrange
      const input = {
        ...validBaseEnv,
        CORS_ORIGIN: 'http://localhost:3000,,,https://app.example.com,',
      };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toEqual(['http://localhost:3000', 'https://app.example.com']);
    });

    it('resolves to undefined when the variable is unset', () => {
      // Arrange
      const input = { ...validBaseEnv };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toBeUndefined();
    });

    it('resolves to undefined when the variable is empty', () => {
      // Arrange
      const input = { ...validBaseEnv, CORS_ORIGIN: '' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toBeUndefined();
    });

    it('resolves to undefined when it contains only empty entries', () => {
      // Arrange
      const input = { ...validBaseEnv, CORS_ORIGIN: ',,,' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.CORS_ORIGIN).toBeUndefined();
    });

    it('rejects an entry containing a path instead of an origin', () => {
      // Arrange
      const input = { ...validBaseEnv, CORS_ORIGIN: 'http://localhost:3000/api/v1' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects an entry without a scheme', () => {
      // Arrange
      const input = { ...validBaseEnv, CORS_ORIGIN: 'localhost:3000' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('parseCorsOrigins', () => {
    it('returns undefined for an unset value', () => {
      // Arrange, Act & Assert
      expect(parseCorsOrigins(undefined)).toBeUndefined();
    });

    it('returns an empty-value-only list as undefined', () => {
      // Arrange, Act & Assert
      expect(parseCorsOrigins(' , , ')).toBeUndefined();
    });
  });

  describe('TRUST_PROXY', () => {
    it('defaults to false when the variable is unset', () => {
      // Arrange
      const input = { ...validBaseEnv };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.TRUST_PROXY).toBe(false);
    });

    it('resolves the string "true" to Boolean true', () => {
      // Arrange
      const input = { ...validBaseEnv, TRUST_PROXY: 'true' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.TRUST_PROXY).toBe(true);
    });

    it('resolves the string "false" to Boolean false', () => {
      // Arrange
      const input = { ...validBaseEnv, TRUST_PROXY: 'false' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.TRUST_PROXY).toBe(false);
    });

    it('rejects values other than the exact strings "true" and "false"', () => {
      // Arrange & Act & Assert
      for (const value of ['True', 'TRUE', '1', '0', 'yes', '']) {
        const result = serverEnvSchema.safeParse({ ...validBaseEnv, TRUST_PROXY: value });

        expect(result.success).toBe(false);
      }
    });
  });

  describe('BODY_LIMIT', () => {
    it('defaults to 1048576 bytes when the variable is unset', () => {
      // Arrange
      const input = { ...validBaseEnv };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.BODY_LIMIT).toBe(1048576);
    });

    it('parses a valid custom positive integer', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '2097152' };

      // Act
      const result = serverEnvSchema.parse(input);

      // Assert
      expect(result.BODY_LIMIT).toBe(2097152);
    });

    it('rejects an empty value', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a non-numeric value', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: 'not-a-number' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a decimal value', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '1048576.5' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects zero', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '0' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a negative value', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '-1048576' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });

    it('rejects a value outside the safe integer range', () => {
      // Arrange
      const input = { ...validBaseEnv, BODY_LIMIT: '99999999999999999999' };

      // Act
      const result = serverEnvSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
    });
  });

  describe('isCorsOriginRequiredInProduction', () => {
    it('requires CORS origins in production when they are missing', () => {
      // Arrange
      const env = { APP_ENV: AppEnv.Production, CORS_ORIGIN: undefined };

      // Act & Assert
      expect(isCorsOriginRequiredInProduction(env)).toBe(true);
    });

    it('does not require CORS origins in production when they are configured', () => {
      // Arrange
      const env = { APP_ENV: AppEnv.Production, CORS_ORIGIN: ['https://app.example.com'] };

      // Act & Assert
      expect(isCorsOriginRequiredInProduction(env)).toBe(false);
    });

    it('does not require CORS origins outside production', () => {
      // Arrange & Act & Assert
      for (const appEnv of [AppEnv.Development, AppEnv.Test]) {
        const env = { APP_ENV: appEnv, CORS_ORIGIN: undefined };

        expect(isCorsOriginRequiredInProduction(env)).toBe(false);
      }
    });
  });
});
