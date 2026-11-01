# Reusable Zod Validation Pipe

## User Request

Implement a reusable `ZodValidationPipe` that validates any user-provided input (`@Body()`, `@Param()`, `@Query()`, other pipe-supported inputs) against a Zod schema passed to its constructor, returns the parsed output (including transformations and coercions), and converts `ZodError` failures into a meaningful HTTP 400 `BadRequestException`. Requirements: type-safe generics, no custom exception hierarchy, no new dependencies, unit tests plus a minimal e2e demonstration, following existing conventions.

## Implementation

- `apps/api/src/shared/pipes/zod-validation.pipe.ts`: `ZodValidationPipe<T>` implementing `PipeTransform<unknown, T>`. Constructor takes `z.ZodType<T>`; `transform` runs `safeParse` and returns `result.data` (so Zod transformations/coercions/defaults apply). On failure it throws a standard `BadRequestException` whose message is the array of `"path: message"` strings (bare message for root-level issues with an empty path).
- `apps/api/src/shared/pipes/zod-validation.pipe.spec.ts`: unit tests (AAA) covering valid input, invalid input, transformation output, `z.coerce` string→number, multiple issues reported together, and root-level (empty-path) formatting.
- `apps/api/test/contract.controller.ts`: three throwaway routes exercising the pipe with the decorators — `POST validate/things` (`@Body`), `GET validate/things/:id` (`@Param`), `GET validate/search` (`@Query` with a schema default).
- `apps/api/test/validation.e2e-spec.ts`: e2e tests proving coerced parsed output flows through the response envelope, invalid body/param produce 400 `application/problem+json` with the issue details in `detail`, and schema defaults apply on query validation.

## Decisions

- Reused the existing error contract instead of adding a new one: the global `ProblemDetailsFilter` already normalizes `BadRequestException` message arrays into the RFC 9457 `detail` member (`detailFromHttpException` joins with `'; '`), so the pipe only throws the built-in exception — no custom exception class, no filter changes.
- No new `#pipes/*` subpath alias: the task's expected import `#src/shared/pipes/zod-validation.pipe.js` resolves through the existing `#src/*` alias (types→src, default→dist, Vitest alias already registered), so neither `package.json` imports nor the Vitest alias list changed.
- Issue formatting (`"path: message"`) was chosen over `z.prettifyError` because the Problem Details contract exposes a single `detail` string; per-issue strings with paths join into the most useful one-liner while staying inside the established response shape.
- Zod 4.6.7 was already a dependency; nothing was added.

## Validation

- Checks were not executed for this record: the delegated validation run (format, lint, typecheck, unit tests, e2e tests) was cancelled per user instruction — the user runs the checks personally. Results should be recorded here once available.

## Remaining Limitations

- The pipe is per-route explicit (`new ZodValidationPipe(Schema)`); no global pipe, decorator factory, or validation module was added, per the task constraints.
