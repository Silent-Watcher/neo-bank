import { HttpStatus } from '@nestjs/common';
import type { I18nKey } from '@nestjs/i18n';

import type { ErrorCode } from '#errors/error.code.js';

/**
 * i18n detail keys for the state machine's domain rejections (single source;
 * the catalogs in `src/i18n/{en,fa}/enrollment.json` mirror them). Typed as
 * `I18nKey` so the Phase 6 mapping call site compiles without an assertion.
 */
export const ENROLLMENT_EXPIRED_DETAIL_KEY: I18nKey = 'enrollment.expired';
export const ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY: I18nKey = 'enrollment.stepNotAllowed';

/**
 * Domain rejection raised by the Enrollment state machine (master prompt
 * §10). The machine is a pure domain component — no HTTP, no i18n, no clock
 * — so it carries the typed `ErrorCode`, the i18n detail key, and the
 * intended HTTP status instead of a localized message. The request-scoped
 * caller maps it to the localized `AppHttpException`, persisting any pending
 * expiration FIRST: the state transition is already applied to the entity
 * when this error is thrown, and the expiration must survive (master prompt
 * §11.1 — the error never rolls it back).
 */
export class EnrollmentStateMachineError extends Error {
  readonly code: ErrorCode;
  readonly detailKey: I18nKey;
  readonly status: HttpStatus;

  constructor(code: ErrorCode, detailKey: I18nKey, status: HttpStatus) {
    super(detailKey);
    this.name = 'EnrollmentStateMachineError';
    this.code = code;
    this.detailKey = detailKey;
    this.status = status;
  }
}
