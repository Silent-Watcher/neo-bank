import { HttpStatus, Injectable } from '@nestjs/common';

import { ErrorCode } from '#errors/error.code.js';
import type { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUS_IN_PROGRESS,
  ENROLLMENT_STATUS_PENDING_REVIEW,
  ENROLLMENT_STEP_COMPLETED,
  ENROLLMENT_STEP_VIDEO_VERIFICATION,
  ENROLLMENT_STEPS,
  EXPIRABLE_ENROLLMENT_STATUSES,
  type EnrollmentStatus,
  type EnrollmentStep,
} from '#modules/enrollments/enrollments.enums.js';
import {
  ENROLLMENT_EXPIRED_DETAIL_KEY,
  ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY,
  EnrollmentStateMachineError,
} from './enrollment-state-machine.error.js';

/**
 * Legal status transitions (master prompt §10.2). Exported as the single
 * source for the table-driven verification: every status not listed as a
 * target is illegal, and an illegal transition is a programming error that
 * the state machine never silently accepts. The future review/correction
 * feature will define the transitions involving `REJECTED` and `APPROVED`.
 */
export const ENROLLMENT_LEGAL_TRANSITIONS: Readonly<
  Record<EnrollmentStatus, readonly EnrollmentStatus[]>
> = {
  INITIAL: ['IN_PROGRESS', 'EXPIRED'],
  IN_PROGRESS: ['PENDING_REVIEW', 'EXPIRED'],
  PENDING_REVIEW: [],
  REJECTED: [],
  APPROVED: [],
  EXPIRED: [],
};

/** Step positions derived once from the single-source step order (§7.4). */
const STEP_ORDER = new Map<EnrollmentStep, number>(
  ENROLLMENT_STEPS.map((step, index) => [step, index]),
);

/** Resolves a step's position; the map is total over the single-source steps. */
function stepIndex(step: EnrollmentStep): number {
  const index = STEP_ORDER.get(step);
  if (index === undefined) {
    throw new Error(`Unknown Enrollment step: ${step}`);
  }
  return index;
}

/**
 * The incomplete lifecycle statuses as a set: exactly the expirable ones
 * (master prompt §7.3) and exactly the step-receptive ones (master prompt
 * §10.4) — an enrollment that can still expire is one that can still
 * receive steps. A set gives the membership check without a narrowing cast.
 */
const INCOMPLETE_ENROLLMENT_STATUSES = new Set<EnrollmentStatus>(EXPIRABLE_ENROLLMENT_STATUSES);

/**
 * Pure domain state machine for the Enrollment lifecycle (master prompt
 * §10). No database access, no Redis access, no independent clock — every
 * time-dependent decision receives `now: Date` explicitly, and the machine
 * only reads and mutates the entity passed to it. Transaction ownership and
 * persistence stay with the caller: the caller persists any expiration
 * transition BEFORE mapping a rejection to HTTP (§11.1) — the transition is
 * already applied to the entity when the rejection is thrown, and the
 * rejection never rolls it back.
 */
@Injectable()
export class EnrollmentStateMachine {
  /**
   * Expires the enrollment when due (master prompt §10.3): for an expirable
   * status (`INITIAL`/`IN_PROGRESS`) whose `expiresAt` instant has arrived
   * (`expiresAt <= now`), transitions the status to `EXPIRED` through the
   * central transition method and returns `true`. Any other state returns
   * `false` untouched — an already-expired record never re-expires.
   */
  expireIfDue(enrollment: Enrollment, now: Date): boolean {
    if (!INCOMPLETE_ENROLLMENT_STATUSES.has(enrollment.status)) {
      return false;
    }
    if (enrollment.expiresAt.getTime() > now.getTime()) {
      return false;
    }
    this.transitionTo(enrollment, ENROLLMENT_STATUS_EXPIRED);
    return true;
  }

  /**
   * Runs a step submission through the state guards (master prompt §10.3/
   * §10.4), invokes `apply()` only after every guard passes, and resolves
   * the next state: the first submitted step moves `INITIAL` to
   * `IN_PROGRESS`, a current-step submission advances `currentStep` by one
   * position, completing `VIDEO_VERIFICATION` moves the enrollment to
   * `PENDING_REVIEW` with `currentStep = COMPLETED` (§10.5), and an
   * earlier-step edit applies the change without moving `currentStep`
   * backwards.
   *
   * Rejections: a due expiration first (the transition is applied, then the
   * error carries `ENROLLMENT_EXPIRED`); `COMPLETED` is never submittable;
   * a future step cannot be submitted before its predecessors; and a
   * non-expirable status cannot receive steps. Every rejection carries the
   * typed `ErrorCode` and the i18n detail key for the request-scoped caller.
   */
  executeStep(enrollment: Enrollment, step: EnrollmentStep, now: Date, apply: () => void): void {
    if (this.expireIfDue(enrollment, now)) {
      throw new EnrollmentStateMachineError(
        ErrorCode.EnrollmentExpired,
        ENROLLMENT_EXPIRED_DETAIL_KEY,
        HttpStatus.GONE,
      );
    }
    // An enrollment that is already EXPIRED (status set by a prior lazy
    // expiration or by the background job) must also return 410 with the
    // same error code/detail so the client sees a consistent "expired"
    // response regardless of whether the expiration happened just now or
    // earlier. This is checked after expireIfDue() because that method
    // returns false for already-EXPIRED records (they are not in
    // INCOMPLETE_ENROLLMENT_STATUSES), so we handle them explicitly here.
    if (enrollment.status === ENROLLMENT_STATUS_EXPIRED) {
      throw new EnrollmentStateMachineError(
        ErrorCode.EnrollmentExpired,
        ENROLLMENT_EXPIRED_DETAIL_KEY,
        HttpStatus.GONE,
      );
    }
    // The step-receptive statuses are exactly the expirable ones: the two
    // incomplete lifecycle states (master prompt §10.4 — PENDING_REVIEW,
    // APPROVED, REJECTED, and EXPIRED cannot receive user steps).
    if (!INCOMPLETE_ENROLLMENT_STATUSES.has(enrollment.status)) {
      throw new EnrollmentStateMachineError(
        ErrorCode.EnrollmentStepNotAllowed,
        ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY,
        HttpStatus.CONFLICT,
      );
    }
    if (step === ENROLLMENT_STEP_COMPLETED) {
      throw new EnrollmentStateMachineError(
        ErrorCode.EnrollmentStepNotAllowed,
        ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY,
        HttpStatus.CONFLICT,
      );
    }
    // Corrupt-state fail-fast (Wave 34 SEC-03 hardening): a receptive
    // status (INITIAL/IN_PROGRESS — the only ones reaching this line)
    // carrying the COMPLETED marker is a pair the machine can never produce
    // (the DB CHECKs validate the columns independently) — every real step
    // would pass the future-step check below as an "earlier-step edit" on a
    // completed form, so the pair fails fast as a programming error instead.
    if (enrollment.currentStep === ENROLLMENT_STEP_COMPLETED) {
      throw new Error(
        `Corrupt Enrollment state: ${enrollment.status} with currentStep ${enrollment.currentStep}`,
      );
    }
    const currentIndex = stepIndex(enrollment.currentStep);
    if (stepIndex(step) > currentIndex) {
      // A future step cannot be submitted before its predecessors.
      throw new EnrollmentStateMachineError(
        ErrorCode.EnrollmentStepNotAllowed,
        ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY,
        HttpStatus.CONFLICT,
      );
    }

    apply();

    if (step === enrollment.currentStep) {
      if (step === ENROLLMENT_STEP_VIDEO_VERIFICATION) {
        // Completion (§10.5): the form is complete and awaiting review.
        enrollment.currentStep = ENROLLMENT_STEP_COMPLETED;
        this.transitionTo(enrollment, ENROLLMENT_STATUS_PENDING_REVIEW);
        return;
      }
      if (enrollment.status === ENROLLMENT_INITIAL_STATUS) {
        this.transitionTo(enrollment, ENROLLMENT_STATUS_IN_PROGRESS);
      }
      enrollment.currentStep = ENROLLMENT_STEPS[currentIndex + 1];
    }
    // Earlier-step edits keep `currentStep` and the status untouched.
  }

  /**
   * Central transition method (master prompt §10.2): validates the legal
   * transition table and applies the status change. An illegal transition
   * is a programming error — it throws a plain `Error` and is never mapped
   * to a client-facing response.
   */
  private transitionTo(enrollment: Enrollment, to: EnrollmentStatus): void {
    const from: EnrollmentStatus = enrollment.status;
    const legalTargets = ENROLLMENT_LEGAL_TRANSITIONS[from];
    if (!legalTargets.includes(to)) {
      throw new Error(`Illegal Enrollment status transition: ${from} -> ${to}`);
    }
    enrollment.status = to;
  }
}
