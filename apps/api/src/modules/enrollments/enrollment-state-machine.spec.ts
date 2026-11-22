import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '#errors/error.code.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_STATUS_IN_PROGRESS,
  ENROLLMENT_STATUS_PENDING_REVIEW,
  ENROLLMENT_STEP_COMPLETED,
  ENROLLMENT_STEP_VIDEO_VERIFICATION,
  ENROLLMENT_STEPS,
  ENROLLMENT_TTL_MS,
  type EnrollmentStatus,
  type EnrollmentStep,
} from '#modules/enrollments/enrollments.enums.js';

import {
  ENROLLMENT_EXPIRED_DETAIL_KEY,
  ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY,
  EnrollmentStateMachineError,
} from './enrollment-state-machine.error.js';
import {
  ENROLLMENT_LEGAL_TRANSITIONS,
  EnrollmentStateMachine,
} from './enrollment-state-machine.service.js';

// Table-driven unit tests for the pure domain state machine (master prompt
// §10/§12 Phase 4): deterministic clock (NOW passed explicitly), no
// database, no Redis. The machine is constructed directly — it has no
// dependencies to inject.

const NOW = new Date('2026-01-01T00:00:00.000Z');

interface EnrollmentFixture {
  status: EnrollmentStatus;
  currentStep: EnrollmentStep;
  expiresAt: Date;
}

function makeEnrollment(fixture: Partial<EnrollmentFixture> = {}): Enrollment {
  const enrollment = new Enrollment();
  enrollment.phoneNumber = '09123456789';
  enrollment.status = fixture.status ?? ENROLLMENT_INITIAL_STATUS;
  enrollment.currentStep = fixture.currentStep ?? ENROLLMENT_INITIAL_STEP;
  enrollment.expiresAt = fixture.expiresAt ?? new Date(NOW.getTime() + ENROLLMENT_TTL_MS);
  return enrollment;
}

describe('Legal transition table (master prompt §10.2)', () => {
  it('declares exactly the approved transition table', () => {
    // Act & Assert — the table is the independent oracle: every status has
    // an entry, and every target not listed is illegal.
    expect(ENROLLMENT_LEGAL_TRANSITIONS).toEqual({
      INITIAL: ['IN_PROGRESS', 'EXPIRED'],
      IN_PROGRESS: ['PENDING_REVIEW', 'EXPIRED'],
      PENDING_REVIEW: [],
      REJECTED: [],
      APPROVED: [],
      EXPIRED: [],
    });
  });
});

describe('expireIfDue (master prompt §10.3)', () => {
  // Each case: status, offset of expiresAt from NOW in milliseconds, and
  // whether the transition must fire. Covers before/at/after the instant,
  // each expirable status, every non-expirable status, and an
  // already-expired record (which never re-expires).
  const cases: ReadonlyArray<{
    status: EnrollmentStatus;
    offsetMs: number;
    expectExpired: boolean;
  }> = [
    { status: 'INITIAL', offsetMs: -1, expectExpired: true },
    { status: 'IN_PROGRESS', offsetMs: -1, expectExpired: true },
    { status: 'INITIAL', offsetMs: 0, expectExpired: true },
    { status: 'IN_PROGRESS', offsetMs: 0, expectExpired: true },
    { status: 'INITIAL', offsetMs: 1, expectExpired: false },
    { status: 'IN_PROGRESS', offsetMs: 1, expectExpired: false },
    { status: 'PENDING_REVIEW', offsetMs: -1, expectExpired: false },
    { status: 'REJECTED', offsetMs: -1, expectExpired: false },
    { status: 'APPROVED', offsetMs: -1, expectExpired: false },
    { status: 'EXPIRED', offsetMs: -1, expectExpired: false },
  ];

  it.each(cases)(
    '$status + expiresAt NOW$offsetMs ms -> expired: $expectExpired',
    ({ status, offsetMs, expectExpired }) => {
      // Arrange
      const machine = new EnrollmentStateMachine();
      const enrollment = makeEnrollment({
        status,
        expiresAt: new Date(NOW.getTime() + offsetMs),
      });

      // Act
      const expired = machine.expireIfDue(enrollment, NOW);

      // Assert
      expect(expired).toBe(expectExpired);
      expect(enrollment.status).toBe(expectExpired ? ENROLLMENT_STATUS_EXPIRED : status);
    },
  );
});

describe('executeStep walkthrough (master prompt §10.3/§10.5)', () => {
  it('advances through the full form in order and completes into review', () => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment();
    const apply = vi.fn();

    // Act — submit each step exactly when it is the current step.
    const observed: Array<{ status: EnrollmentStatus; currentStep: EnrollmentStep }> = [];
    for (const step of ENROLLMENT_STEPS) {
      if (step === ENROLLMENT_STEP_COMPLETED) {
        // The completion marker is never submitted (master prompt §10.4);
        // VIDEO_VERIFICATION completing the form produces it.
        continue;
      }
      machine.executeStep(enrollment, step, NOW, apply);
      observed.push({ status: enrollment.status, currentStep: enrollment.currentStep });
    }

    // Assert — the first submission moves INITIAL to IN_PROGRESS; each
    // submission advances currentStep by one; VIDEO_VERIFICATION completes
    // into PENDING_REVIEW with currentStep = COMPLETED.
    expect(apply).toHaveBeenCalledTimes(ENROLLMENT_STEPS.length - 1);
    expect(observed[0]).toEqual({
      status: ENROLLMENT_STATUS_IN_PROGRESS,
      currentStep: 'FULL_NAME',
    });
    expect(observed[observed.length - 1]).toEqual({
      status: ENROLLMENT_STATUS_PENDING_REVIEW,
      currentStep: ENROLLMENT_STEP_COMPLETED,
    });
    // Every intermediate state stayed IN_PROGRESS with the next step current.
    const intermediates = observed.slice(0, -1);
    expect(
      intermediates.every(
        (state) =>
          state.status === ENROLLMENT_STATUS_IN_PROGRESS &&
          state.currentStep !== ENROLLMENT_STEP_COMPLETED,
      ),
    ).toBe(true);
  });

  it('rejects a future step before its predecessors without invoking apply', () => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment();
    const apply = vi.fn();

    // Act & Assert
    expect(() => machine.executeStep(enrollment, 'PASSWORD', NOW, apply)).toThrowError(
      EnrollmentStateMachineError,
    );
    expect(apply).not.toHaveBeenCalled();
    expect(enrollment.status).toBe(ENROLLMENT_INITIAL_STATUS);
    expect(enrollment.currentStep).toBe(ENROLLMENT_INITIAL_STEP);
  });

  it('applies an earlier-step edit without moving currentStep backwards', () => {
    // Arrange — the form has advanced to PASSWORD.
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment({
      status: ENROLLMENT_STATUS_IN_PROGRESS,
      currentStep: 'PASSWORD',
    });
    const apply = vi.fn();

    // Act
    machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, apply);

    // Assert — the edit ran, the marker did not move backwards.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(enrollment.status).toBe(ENROLLMENT_STATUS_IN_PROGRESS);
    expect(enrollment.currentStep).toBe('PASSWORD');
  });

  it('rejects the COMPLETED marker as a submitted step', () => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment();
    const apply = vi.fn();

    // Act & Assert
    expect(() =>
      machine.executeStep(enrollment, ENROLLMENT_STEP_COMPLETED, NOW, apply),
    ).toThrowError(EnrollmentStateMachineError);
    expect(apply).not.toHaveBeenCalled();
    expect(enrollment.currentStep).toBe(ENROLLMENT_INITIAL_STEP);
  });
});

describe('executeStep state guards (master prompt §10.4)', () => {
  // A non-expirable status cannot receive steps, whatever step is submitted.
  const blockedCases: ReadonlyArray<{
    status: EnrollmentStatus;
    currentStep: EnrollmentStep;
  }> = [
    { status: 'PENDING_REVIEW', currentStep: 'NATIONAL_CODE' },
    { status: 'REJECTED', currentStep: 'NATIONAL_CODE' },
    { status: 'APPROVED', currentStep: 'NATIONAL_CODE' },
    { status: 'EXPIRED', currentStep: 'NATIONAL_CODE' },
  ];

  it.each(blockedCases)('rejects step submission while $status', ({ status, currentStep }) => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment({ status, currentStep });
    const apply = vi.fn();

    // Act & Assert
    expect(() => machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, apply)).toThrowError(
      EnrollmentStateMachineError,
    );
    expect(apply).not.toHaveBeenCalled();
    expect(enrollment.status).toBe(status);
  });
});

describe('expiration inside executeStep (master prompt §11.1)', () => {
  it('applies the expiration transition before rejecting with ENROLLMENT_EXPIRED', () => {
    // Arrange — the enrollment is due at NOW.
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const apply = vi.fn();

    // Act & Assert — the transition is applied to the entity BEFORE the
    // rejection throws (the caller persists it, §11.1), and apply() never
    // runs.
    expect(() => machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, apply)).toThrowError(
      EnrollmentStateMachineError,
    );
    expect(apply).not.toHaveBeenCalled();
    expect(enrollment.status).toBe(ENROLLMENT_STATUS_EXPIRED);
    expect(enrollment.currentStep).toBe(ENROLLMENT_INITIAL_STEP);
  });

  it('accepts a submission one millisecond before the expiration instant', () => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment({ expiresAt: new Date(NOW.getTime() + 1) });
    const apply = vi.fn();

    // Act
    machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, apply);

    // Assert
    expect(apply).toHaveBeenCalledTimes(1);
    expect(enrollment.status).toBe(ENROLLMENT_STATUS_IN_PROGRESS);
  });
});

describe('domain rejection shape', () => {
  it('carries the typed error code, i18n detail key, and HTTP status', () => {
    // Arrange
    const machine = new EnrollmentStateMachine();
    const due = makeEnrollment({ expiresAt: new Date(NOW.getTime() - 1) });
    const blocked = makeEnrollment({ status: 'APPROVED' });
    const caught: EnrollmentStateMachineError[] = [];

    // Act
    for (const [enrollment, step] of [
      [due, ENROLLMENT_INITIAL_STEP],
      [blocked, ENROLLMENT_INITIAL_STEP],
    ] as const) {
      try {
        machine.executeStep(enrollment, step, NOW, () => undefined);
      } catch (error) {
        if (error instanceof EnrollmentStateMachineError) {
          caught.push(error);
        } else {
          throw error;
        }
      }
    }

    // Assert — the expired rejection maps to 410 Gone; the blocked-state
    // rejection maps to 409 Conflict; both carry their catalog detail keys.
    expect(caught).toHaveLength(2);
    expect(caught[0]).toBeInstanceOf(EnrollmentStateMachineError);
    expect(caught[0].code).toBe(ErrorCode.EnrollmentExpired);
    expect(caught[0].detailKey).toBe(ENROLLMENT_EXPIRED_DETAIL_KEY);
    expect(caught[0].status).toBe(HttpStatus.GONE);
    expect(caught[1].code).toBe(ErrorCode.EnrollmentStepNotAllowed);
    expect(caught[1].detailKey).toBe(ENROLLMENT_STEP_NOT_ALLOWED_DETAIL_KEY);
    expect(caught[1].status).toBe(HttpStatus.CONFLICT);
  });

  it('treats an illegal internal transition as a programming error', () => {
    // Arrange — PENDING_REVIEW has no legal targets (master prompt §10.2);
    // reaching the central transition method with an illegal target is a
    // plain Error, never a client-facing rejection. The table-level check
    // pins the illegal transitions; the corrupt-hydration case below drives
    // the only public path into the plain-Error channel (the DB CHECKs
    // validate each column independently, so `INITIAL` +
    // `VIDEO_VERIFICATION` can be hydrated even though the machine can
    // never produce the pair).
    const machine = new EnrollmentStateMachine();
    const terminal = makeEnrollment({ status: ENROLLMENT_STATUS_PENDING_REVIEW });

    // Act & Assert — the public guards reject first; the table itself pins
    // the illegal transitions.
    expect(ENROLLMENT_LEGAL_TRANSITIONS[ENROLLMENT_STATUS_PENDING_REVIEW]).toEqual([]);
    expect(() =>
      machine.executeStep(terminal, ENROLLMENT_INITIAL_STEP, NOW, () => undefined),
    ).toThrowError(EnrollmentStateMachineError);
    expect(ENROLLMENT_STATUS_PENDING_REVIEW in ENROLLMENT_LEGAL_TRANSITIONS).toBe(true);
    expect(ENROLLMENT_LEGAL_TRANSITIONS[ENROLLMENT_STATUS_PENDING_REVIEW]).not.toContain(
      ENROLLMENT_STATUS_PENDING_REVIEW,
    );
  });

  it('fails fast on a corrupt hydrated state completing the form from INITIAL', () => {
    // Arrange — a hydrated row the machine can never produce: status
    // INITIAL with currentStep VIDEO_VERIFICATION. Completing the form from
    // INITIAL is an illegal transition (INITIAL → PENDING_REVIEW), so the
    // central transition method must throw the plain programming error —
    // the domain rejection's message (the detail key) can never match it.
    const machine = new EnrollmentStateMachine();
    const corrupt = makeEnrollment({
      status: ENROLLMENT_INITIAL_STATUS,
      currentStep: ENROLLMENT_STEP_VIDEO_VERIFICATION,
    });

    // Act & Assert
    expect(() =>
      machine.executeStep(corrupt, ENROLLMENT_STEP_VIDEO_VERIFICATION, NOW, () => undefined),
    ).toThrowError(/Illegal Enrollment status transition/);
  });

  it('leaves the entity untouched when apply() itself throws', () => {
    // Arrange — the caller's apply failure must not corrupt the state: the
    // machine mutates only after apply() returns.
    const machine = new EnrollmentStateMachine();
    const enrollment = makeEnrollment();
    const applyError = new Error('apply failure');

    // Act & Assert
    expect(() =>
      machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, () => {
        throw applyError;
      }),
    ).toThrowError(applyError);
    expect(enrollment.status).toBe(ENROLLMENT_INITIAL_STATUS);
    expect(enrollment.currentStep).toBe(ENROLLMENT_INITIAL_STEP);
  });

  it('fails fast on a receptive status carrying the COMPLETED marker', () => {
    // Arrange — hydrated pairs the machine can never produce (Wave 34
    // SEC-03 hardening): on a receptive status every real step would pass
    // the future-step check as an earlier-step edit on a completed form, so
    // the pair fails fast as a plain programming error rather than
    // accepting edits.
    const machine = new EnrollmentStateMachine();
    const corruptPairs: ReadonlyArray<{
      status: EnrollmentStatus;
      currentStep: EnrollmentStep;
    }> = [
      { status: ENROLLMENT_STATUS_IN_PROGRESS, currentStep: ENROLLMENT_STEP_COMPLETED },
      { status: ENROLLMENT_INITIAL_STATUS, currentStep: ENROLLMENT_STEP_COMPLETED },
    ];

    // Act & Assert — the message can never match a domain rejection's
    // detail key.
    for (const corrupt of corruptPairs) {
      const enrollment = makeEnrollment(corrupt);
      expect(() =>
        machine.executeStep(enrollment, ENROLLMENT_INITIAL_STEP, NOW, () => undefined),
      ).toThrowError(/Corrupt Enrollment state/);
    }
  });
});
