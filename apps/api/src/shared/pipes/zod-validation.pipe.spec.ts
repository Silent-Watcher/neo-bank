import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe.js';

// Extracts the validation message array the global filter joins into the
// Problem Details `detail` member.
function validationMessages(pipe: ZodValidationPipe<unknown>, value: unknown): string[] {
  try {
    pipe.transform(value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse();
    expect(response).toBeTypeOf('object');
    return (response as { message: string[] }).message;
  }
  throw new Error('Expected the pipe to throw.');
}

describe('ZodValidationPipe', () => {
  it('returns the parsed data for valid input', () => {
    // Arrange
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));

    // Act
    const result = pipe.transform({ name: 'Ada' });

    // Assert
    expect(result).toEqual({ name: 'Ada' });
  });

  it('throws a BadRequestException with issue details for invalid input', () => {
    // Arrange
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));

    // Act
    const messages = validationMessages(pipe, { name: 42 });

    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^name: /);
  });

  it('returns the transformed output instead of the original input', () => {
    // Arrange
    const pipe = new ZodValidationPipe(z.object({ name: z.string().transform((v) => v.length) }));

    // Act
    const result = pipe.transform({ name: 'Ada' });

    // Assert
    expect(result).toEqual({ name: 3 });
  });

  it('coerces string input to the target type', () => {
    // Arrange
    const pipe = new ZodValidationPipe(z.object({ age: z.coerce.number().int().positive() }));

    // Act
    const result = pipe.transform({ age: '42' });

    // Assert
    expect(result).toEqual({ age: 42 });
  });

  it('reports every issue when multiple fields are invalid', () => {
    // Arrange
    const pipe = new ZodValidationPipe(
      z.object({ name: z.string().min(1), age: z.coerce.number().int().positive() }),
    );

    // Act
    const messages = validationMessages(pipe, { name: '', age: 'abc' });

    // Assert
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/^name: /);
    expect(messages[1]).toMatch(/^age: /);
  });

  it('formats root-level issues without a path prefix', () => {
    // Arrange
    const pipe = new ZodValidationPipe(z.string());

    // Act
    const messages = validationMessages(pipe, 42);

    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toMatch(/^: /);
  });
});
