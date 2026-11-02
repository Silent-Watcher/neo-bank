# Phone OTP Generation Endpoint

## User Request

Implement a minimal phone OTP generation endpoint inside the enrollment module: accept an Iranian mobile phone number, validate it with a dedicated Zod schema, generate a random 6-digit OTP using cryptographically secure randomness, and return both values in the response. No storage, SMS, verification, expiry, rate limiting, or new dependencies. Mid-implementation the user amended the requirements: (1) the schema should normalize common variants (whitespace, `+98`/`0098`/`98` prefixes, omitted leading zero) instead of rejecting them, (2) the response shape is temporary because the feature will be completed later, (3) the route segment must be plural (`/enrollments/otp`), and (4) the OTP must be drawn from 100000–999999.

## Implementation

- Renamed the misspelled `enrollemnts` module (directory, files, classes) to `enrollments` via `git mv`, preserving history. Route path is `enrollments`.
- `apps/api/src/modules/enrollments/enrollments.schema.ts`: `requestOtpSchema` — `z.string().transform(toNationalMobile).pipe(regex)` for `^09\d{9}$`. `toNationalMobile` trims whitespace and folds `+98`/`0098`/`98` country codes and an omitted leading zero into the `09` prefix; anything else passes through untouched so the regex reports it. Exports `RequestOtpBody`.
- `apps/api/src/modules/enrollments/enrollments.service.ts`: `EnrollmentsService.requestOtp(phoneNumber)` returns `{ phoneNumber, otp }` with `otp = randomInt(100000, 1000000).toString()` from `node:crypto` — a uniform draw over all six-digit codes with no leading-zero concern. Commented as temporary pending storage/delivery/verification.
- `apps/api/src/modules/enrollments/enrollments.controller.ts`: `POST /enrollments/otp` with `@Body(new ZodValidationPipe(requestOtpSchema))`, delegating to the service.
- `apps/api/test/subpath-import-aliases.ts`: added the `#filters/`, `#interceptors/`, and `#modules/` alias replacements. This fixes a pre-existing e2e breakage: commit ae59f51 made `app.module.ts` import through these aliases but never updated the Vitest alias list, so every e2e spec booting the full `AppModule` failed with "Cannot find module '#modules/enrollemnts/...'".

## Tests

- `enrollments.schema.spec.ts` (12 tests): canonical number unchanged, `+98`/`0098`/`98`/omitted-zero normalization, whitespace trimming, landline rejected, wrong lengths rejected, letters/spaces/special characters rejected, empty/whitespace rejected, missing/non-string rejected, meaningful issue message.
- `enrollments.service.spec.ts` (4 tests): mocked `node:crypto` `randomInt` via `vi.hoisted`; phone passthrough, 6-digit string OTP, both range boundaries, and the exact `randomInt(100000, 1000000)` call.
- `enrollments.controller.spec.ts` (1 test): delegation with the validated phone number.
- `test/enrollments.e2e-spec.ts` (3 tests): valid number → 201 with phone + 6-digit OTP inside the response envelope, `+98` normalization e2e, invalid numbers → 400 `application/problem+json` with `phoneNumber:` detail.

## Decisions

- Normalization before validation per user instruction: trim → country-code/zero folding → strict `^09\d{9}$` regex, implemented as a Zod `transform` piped into the regex so invalid input still fails validation rather than being masked.
- OTP range 100000–999999 per user instruction instead of a zero-padded 0–999999 draw, eliminating leading-zero handling entirely; the string representation is kept for contract stability.
- No `RequestOtpResponse` named type: the user marked the response shape temporary, so the service returns an inline object literal type.
- Reused `ZodValidationPipe`, the global `ProblemDetailsFilter` error contract, and the response envelope; no new dependencies or abstractions.
- The e2e alias fix was required for this feature's e2e coverage to run at all and is included here despite predating the task.

## Validation

- `pnpm format` (oxfmt): clean after one rewrite of `enrollments.controller.spec.ts`.
- `pnpm lint` (oxlint): 0 errors; 13 warnings, all pre-existing in files not touched by this task.
- `pnpm typecheck` (tsc --noEmit): passed.
- `pnpm test` (vitest): 17 files, 122 tests passed.
- `pnpm test:e2e` (vitest e2e): 11 files, 49 tests passed; route confirmed mapped as `POST /api/v1/enrollments/otp`.
- Validation was executed directly because subagent delegation was unavailable (model concurrency limit); results above are from real command runs.

## Remaining Limitations

- The OTP is returned in the response and not stored, delivered, verified, or expired — intentional scope cut pending the full feature.
- Normalization handles the common Iranian mobile variants only; no Persian-digit or separator normalization.
