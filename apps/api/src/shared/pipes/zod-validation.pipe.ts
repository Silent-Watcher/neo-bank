import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { t, translateStandardSchemaIssues } from '@nestjs/i18n';
import type { z } from 'zod';

// Accepts both a raw Zod issue and one returned by
// translateStandardSchemaIssues (the library's Standard Schema issue shape,
// whose path is optional).
function formatIssue(issue: {
  readonly path?: readonly unknown[];
  readonly message: string;
}): string {
  const path = (issue.path ?? []).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Primitive issue fields (expected, received, minimum, ...) feed the message
// placeholders; object-valued fields such as `path` are not interpolable.
function primitiveParams(issue: z.ZodIssue): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(issue).filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
    ),
  );
}

// translateStandardSchemaIssues deliberately skips issues about the whole
// input (no path): their built-in keys are written for fields. A request body
// that is not an object would otherwise leak Zod's English message into
// Persian responses, so it is translated here with the same catalog key the
// field-level invalid_type issues use. Extend this branch when a future
// schema introduces new issue codes for the whole input.
function translateWholeInputIssue(issue: z.ZodIssue): z.ZodIssue {
  if (issue.path.length > 0 || issue.code !== 'invalid_type') return issue;

  return {
    ...issue,
    message: t('validation.invalid_type', { args: primitiveParams(issue) }),
  };
}

// Validates any user-provided input (@Body, @Param, @Query, ...) against a
// Zod schema and returns the parsed output, so transformations and coercions
// apply. Validation failures throw a standard BadRequestException whose
// message array the global ProblemDetailsFilter normalizes. Issue messages
// are translated for the request's resolved locale: messages written with
// i18nIssueMessage() carry their catalog key, other issues fall back to the
// `validation.<issue code>` catalog keys (ADR-021).
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // One translation pass over all issues; the helper maps 1:1, keeping
      // untranslated issues as-is.
      const issues = translateStandardSchemaIssues(
        result.error.issues.map(translateWholeInputIssue),
      );
      throw new BadRequestException(issues.map(formatIssue));
    }

    return result.data;
  }
}
