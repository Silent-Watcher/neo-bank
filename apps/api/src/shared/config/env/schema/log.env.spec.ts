import { describe, expect, it } from 'vitest';

import { logEnvSchema } from './log.env.js';

describe('logEnvSchema', () => {
  it('accepts every documented log level', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace']) {
      const result = logEnvSchema.safeParse({ LOG_LEVEL: level });

      expect(result.success).toBe(true);
    }
  });

  it('defaults to info when LOG_LEVEL is unset', () => {
    const result = logEnvSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.LOG_LEVEL).toBe('info');
  });

  it('rejects unknown levels with a message listing the accepted values', () => {
    const result = logEnvSchema.safeParse({ LOG_LEVEL: 'verbose' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodMessage(result.error)).toContain('LOG_LEVEL must be one of:');
      expect(zodMessage(result.error)).toContain('trace');
    }
  });

  it('rejects uppercase values, which are not part of the level set', () => {
    const result = logEnvSchema.safeParse({ LOG_LEVEL: 'INFO' });

    expect(result.success).toBe(false);
  });
});

function zodMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join('\n');
}
