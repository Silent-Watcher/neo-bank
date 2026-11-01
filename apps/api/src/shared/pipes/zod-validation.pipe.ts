import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Validates any user-provided input (@Body, @Param, @Query, ...) against a
// Zod schema and returns the parsed output, so transformations and coercions
// apply. Validation failures throw a standard BadRequestException whose
// message array the global ProblemDetailsFilter normalizes.
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException(result.error.issues.map(formatIssue));
    }

    return result.data;
  }
}
