import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, LockMode, OptimisticLockError } from '@mikro-orm/core';
import { I18nService } from '@nestjs/i18n';
import { hash, argon2id } from 'argon2';

import { AppHttpException } from '#errors/app-http.exception.js';
import { ErrorCode } from '#errors/error.code.js';
import { RedisService } from '#redis/redis.service.js';
import { ENROLLMENTS_CONFIG } from '#config/enrollments.config.js';
import type { EnrollmentsConfig } from '#config/enrollments.config.js';
import { Enrollment } from '#modules/enrollments/entities/enrollment.entity.js';
import {
  ARGON2_MEMORY_COST,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  ENROLLMENT_INITIAL_STATUS,
  ENROLLMENT_INITIAL_STEP,
  ENROLLMENT_STATUS_EXPIRED,
  ENROLLMENT_TTL_MS,
} from '#modules/enrollments/enrollments.enums.js';
import type { EnrollmentStep } from '#modules/enrollments/enrollments.enums.js';

import {
  challengeAttemptsKey,
  challengeLockoutKey,
  challengeOtpKey,
  challengeRateLimitKey,
} from './enrollments.keys.js';
import {
  composeOtpChallengeValue,
  computeOtpDigest,
  otpDigestMatches,
  parseOtpChallengeValue,
} from './enrollments.otp-digest.js';
import { EnrollmentStateMachine } from './enrollment-state-machine.service.js';
import { EnrollmentStateMachineError } from './enrollment-state-machine.error.js';

// OTPs cover every six-digit code from 100000 to 999999; randomInt's upper
// bound is exclusive, hence the + 1 at the call site.
const OTP_MIN = 100_000;
const OTP_MAX = 999_999;

// The challenge OTP expires exactly 120 seconds after it is issued.
export const CHALLENGE_OTP_TTL_SECONDS = 120;

// Maximum OTP sends allowed per phone number within a rolling 60-minute window.
const MAX_OTP_SENDS_PER_HOUR = 5;

// Width of the rolling window for the per-phone send quota, in minutes.
const OTP_SEND_WINDOW_MINUTES = 60;

/**
 * Maximum concurrent password hashing operations (SEC-01 mitigation).
 * Each Argon2id hash allocates ~19 MiB (OWASP minimum). This limit bounds
 * peak memory regardless of IP diversity or rate-limit bypass.
 * Value chosen to fit within typical container memory (e.g., 10 * 19 MiB ≈ 190 MiB).
 */
const MAX_CONCURRENT_HASHES = 10;

// Verification failures share one generic message (missing, expired, or
// incorrect OTPs are deliberately indistinguishable to clients), and the
// hourly quota is deliberately indistinguishable from the cooldown — both
// translate the same catalog keys for the request's locale.

@Injectable()
export class EnrollmentsService {
  // Simple counting semaphore: bounds concurrent Argon2id hashing operations
  // so a distributed request burst cannot exhaust memory (SEC-01).
  private hashInFlight = 0;
  private readonly hashWaiters: Array<() => void> = [];

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
    private readonly stateMachine: EnrollmentStateMachine,
    // The EntityManager is the per-request fork MikroORM mounts onto the CLS
    // context (ADR-031); every call in this method runs inside the same unit
    // of work so a single flush commits all changes atomically.
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  async requestChallenge(phoneNumber: string): Promise<void> {
    // First, check the per-phone hourly rate limit (rolling 60-minute window).
    // This is independent of the 120-second cooldown and IP-based rate limiting.
    const rateLimitKey = challengeRateLimitKey(phoneNumber);
    const allowed = await this.redisService.checkOtpRateLimit(
      rateLimitKey,
      MAX_OTP_SENDS_PER_HOUR,
      OTP_SEND_WINDOW_MINUTES,
    );

    if (!allowed) {
      throw new AppHttpException(
        ErrorCode.OtpRateLimitExceeded,
        this.i18n.t('otp.rateLimited'),
        HttpStatus.BAD_REQUEST,
      );
    }

    // Atomically check the lockout and store the challenge value: an OTP can
    // never be issued while a verification lockout is active for this phone
    // number. Only the HMAC digest — bound to a per-issuance challenge ID — is
    // stored; the plaintext OTP never reaches Redis (ADR-018/019).
    const otp = randomInt(OTP_MIN, OTP_MAX + 1).toString();
    const { otpHmacSecret } = this.configService.getOrThrow<EnrollmentsConfig>(ENROLLMENTS_CONFIG);
    const otpDigest = computeOtpDigest(phoneNumber, otp, otpHmacSecret);
    const challengeValue = composeOtpChallengeValue(randomUUID(), otpDigest);
    const issueResult = await this.redisService.issueOtp(
      challengeOtpKey(phoneNumber),
      challengeLockoutKey(phoneNumber),
      challengeValue,
      CHALLENGE_OTP_TTL_SECONDS,
    );

    if (issueResult === 'locked') {
      // Indistinguishable from the hourly quota to clients: same error code and
      // generic detail, so the lockout state is not disclosed.
      throw new AppHttpException(
        ErrorCode.OtpRateLimitExceeded,
        this.i18n.t('otp.rateLimited'),
        HttpStatus.BAD_REQUEST,
      );
    }

    if (issueResult === 'exists') {
      throw new AppHttpException(
        ErrorCode.OtpVerificationFailed,
        this.i18n.t('otp.verificationFailed'),
        HttpStatus.BAD_REQUEST,
      );
    }

    // The OTP is deliberately not returned: delivery is not implemented yet.
    // The endpoint answers 202 Accepted with an empty body (ADR-039).
  }

  async verifyChallenge(
    phone: string,
    otp: string,
  ): Promise<{ phoneNumber: string; publicId: string }> {
    const { maxVerifyAttempts, lockoutTtlSeconds, otpHmacSecret } =
      this.configService.getOrThrow<EnrollmentsConfig>(ENROLLMENTS_CONFIG);

    // The digest comparison happens in Node (timing-safe, ADR-018); the
    // script below only transitions the Redis state atomically, consuming
    // only the exact challenge whose digest matched (challenge identity,
    // ADR-019). A missing or malformed stored value is a failed match, never
    // an exception.
    const otpKey = challengeOtpKey(phone);
    const storedChallenge = parseOtpChallengeValue(await this.redisService.get(otpKey));
    const submittedDigest = computeOtpDigest(phone, otp, otpHmacSecret);
    const matched =
      storedChallenge !== null && otpDigestMatches(submittedDigest, storedChallenge.digest);

    const verified = await this.redisService.resolveOtpVerification(
      otpKey,
      challengeAttemptsKey(phone),
      challengeLockoutKey(phone),
      storedChallenge?.challengeId ?? '',
      matched,
      maxVerifyAttempts,
      lockoutTtlSeconds,
    );

    if (!verified) {
      throw new AppHttpException(
        ErrorCode.OtpVerificationFailed,
        this.i18n.t('otp.verificationFailed'),
        HttpStatus.BAD_REQUEST,
      );
    }

    // OTP consumed atomically in Redis before any DB touch — per master prompt
    // §12, the enrollment row must exist before we surface the publicId.
    // An implicit upsert preserves the one-active-per-phone invariant while
    // giving returning users their existing session back instead of a second
    // row (the alternative — rejecting on pre-existing active enrollment —
    // would fail with a database-conflict error for a user who let their
    // form expire and re-verifies; that Option B path is documented below).
    const enrollment = await this.ensureEnrollment(phone);

    // PublicId is the only client-visible Enrollment identifier (ADR-041).
    // It is never proof of authorization — authentication lives behind it.
    return { phoneNumber: phone, publicId: enrollment.publicId };
  }

  /**
   * Submits a step for the given enrollment.
   *
   * Flow:
   * 1. Load enrollment by publicId with pessimistic lock (for update) to
   *    serialize concurrent step submissions and the expiration race.
   * 2. Run lazy expiration — if due, transition to EXPIRED and persist BEFORE
   *    mapping the rejection (master prompt §11.1 / DEFERRED _062 #2).
   * 3. Execute the step through the state machine (guards + apply callback).
   * 4. Flush with optimistic locking (mapOptimisticLockError → VersionConflict).
   * 5. Return the updated enrollment state.
   *
   * Authorization is explicitly deferred (master prompt §13.5): the endpoint
   * uses publicId as the lookup key without ownership verification. This is a
   * temporary BOLA exposure documented in DEFERRED.md.
   */
  async submitStep(
    publicId: string,
    step: EnrollmentStep,
    now: Date,
    apply: (enrollment: Enrollment) => void,
  ): Promise<{
    publicId: string;
    status: string;
    currentStep: string;
    expiresAt: string;
  }> {
    // Lock the row for update to serialize concurrent submissions and the
    // lazy expiration race (DEFERRED _062 #3: optimistic-lock failure maps
    // through mapOptimisticLockError — the caller owns the try/catch).
    const enrollment = await this.em.findOneOrFail(
      Enrollment,
      { publicId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

    // Run lazy expiration FIRST — the state machine will throw if expired,
    // but the transition is already applied to the entity. We must persist it
    // before mapping the error (master prompt §11.1 / DEFERRED _062 #2).
    const wasExpired = this.stateMachine.expireIfDue(enrollment, now);
    if (wasExpired) {
      await this.em.flush();
      throw new AppHttpException(
        ErrorCode.EnrollmentExpired,
        this.i18n.t('enrollment.expired'),
        HttpStatus.GONE,
      );
    }

    // Execute the step through the pure domain state machine.
    // The machine validates guards, invokes apply(), and advances state.
    try {
      this.stateMachine.executeStep(enrollment, step, now, () => apply(enrollment));
    } catch (error) {
      if (error instanceof EnrollmentStateMachineError) {
        // Map the domain rejection to the localized HTTP exception.
        // The expiration case (410) is already handled above; here we handle
        // step-not-allowed (409) and any other machine rejections.
        throw new AppHttpException(error.code, this.i18n.t(error.detailKey), error.status);
      }
      throw error;
    }

    // Persist the step data and state transition.
    // Optimistic locking via inherited BaseEntity.version — map conflicts.
    // Flat error handling: optimistic lock first, then unique violations,
    // then re-throw any other error (DEFERRED _062 #3: caller-owned mapping).
    try {
      await this.em.flush();
      // Refresh to get updated optimistic lock version for any subsequent operations.
      await this.em.refresh(enrollment);
    } catch (error) {
      // 1) Optimistic-lock failure → VersionConflict (409)
      if (error instanceof OptimisticLockError) {
        throw new AppHttpException(
          ErrorCode.VersionConflict,
          this.i18n.t('errors.details.versionConflict'),
          HttpStatus.CONFLICT,
        );
      }

      // 2) PostgreSQL unique constraint violation (SQLSTATE 23505)
      if (this.isPostgresUniqueViolation(error)) {
        const constraint = error.constraint;
        if (constraint === 'enrollments_national_code_active_unique') {
          // National code collision → indistinguishable generic error
          // (DEFERRED _061 #5: CWE-204, privacy — third-party enumeration).
          throw new AppHttpException(
            ErrorCode.EnrollmentStepNotAllowed,
            this.i18n.t('enrollment.stepNotAllowed'),
            HttpStatus.CONFLICT,
          );
        }
        if (constraint === 'enrollments_username_active_unique') {
          // Username collision — standard UX (username-taken disclosure
          // is acceptable per DEFERRED _061 #5 / SEC-04).
          throw new AppHttpException(
            ErrorCode.EnrollmentStepNotAllowed,
            this.i18n.t('enrollment.usernameTaken'),
            HttpStatus.CONFLICT,
          );
        }
      }

      // 3) Any other error — re-throw unchanged.
      throw error;
    }

    return {
      publicId: enrollment.publicId,
      status: enrollment.status,
      currentStep: enrollment.currentStep,
      expiresAt: enrollment.expiresAt.toISOString(),
    };
  }

  /**
   * Type guard for PostgreSQL unique constraint violations (SQLSTATE 23505).
   */
  private isPostgresUniqueViolation(error: unknown): error is { code: string; constraint: string } {
    return (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505' &&
      'constraint' in error &&
      typeof (error as { constraint?: unknown }).constraint === 'string'
    );
  }

  /**
   * Acquires a slot in the hashing concurrency semaphore.
   * Returns a release function that must be called when hashing completes.
   * If the limit is reached, waits until a slot becomes available.
   */
  private async acquireHashSlot(): Promise<() => void> {
    if (this.hashInFlight < MAX_CONCURRENT_HASHES) {
      this.hashInFlight++;
      return () => {
        this.hashInFlight--;
        this.signalNextWaiter();
      };
    }
    return new Promise<() => void>((resolve) => {
      this.hashWaiters.push(() => {
        this.hashInFlight++;
        resolve(() => {
          this.hashInFlight--;
          this.signalNextWaiter();
        });
      });
    });
  }

  private signalNextWaiter(): void {
    const next = this.hashWaiters.shift();
    if (next) next();
  }

  /**
   * Hashes a plaintext password using Argon2id (ADR-043, OWASP minimum:
   * memory 19456 KiB, time cost 2, parallelism 1). Each call generates an
   * independent cryptographically secure salt via the library; the result is
   * a complete PHC-formatted string. Never stores plaintext passwords.
   *
   * Concurrency is bounded by a semaphore (MAX_CONCURRENT_HASHES) to prevent
   * memory exhaustion under distributed request bursts (SEC-01).
   */
  async hashPassword(password: string): Promise<string> {
    const release = await this.acquireHashSlot();
    try {
      return await hash(password, {
        type: argon2id,
        memoryCost: ARGON2_MEMORY_COST,
        timeCost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
      });
    } finally {
      release();
    }
  }

  /**
   * Ensures an active Enrollment exists for the given normalized phone number
   * (master prompt §12, option A — implicit upsert). Returns the live entity
   * after committing any necessary change:
   *
   * - No row at all → create INITIAL + flush.
   * - EXPIRED row → transition back to INITIAL, reset currentStep, refresh
   *   expiresAt to now() + ENROLLMENT_TTL_MS, then flush. Keeps historical
   *   EXPIRED rows out of the table (one less dead row, same invariant).
   * - Any other status (INITIAL / IN_PROGRESS / PENDING_REVIEW / REJECTED /
   *   APPROVED) → return as-is (idempotent reuse — the flow has already
   *   advanced enough that the caller should not restart).
   *
   * This intentionally differs from the stricter Option B (throw when an
   * active enrollment already exists). Option B would force a user who let
   * their form expire (or whose previous verification landed them in a
   * non-expired-but-incomplete state) to start over — a bad UX on a path
   * we explicitly designed to allow re-verification after expiry. If future
   * requirements harden this to Option B, switch the branch below to
   * `throw new AppHttpException(ErrorCode.BadRequest, ...)` instead.
   */
  private async ensureEnrollment(phoneNumber: string): Promise<Enrollment> {
    // Per-request EntityManager fork: findOneOrNull returns null (not undefined)
    // when no row matches, and stays inside the same Unit of Work so flush()
    // commits both creates and updates in a single round trip.
    const existing = await this.em.findOne(Enrollment, { phoneNumber });

    if (existing === null) {
      // Explicit payload construction — DEFERRED _060 #4 (SEC-03): never
      // spread request input. Only phoneNumber is supplied; the ORM assigns
      // id/publicId/status/currentStep/createdAt via defaults + initializer.
      try {
        const enrollment = this.em.create(Enrollment, { phoneNumber });
        await this.em.flush();
        // Refresh to get generated fields (publicId, version) for immediate use.
        await this.em.refresh(enrollment);
        return enrollment;
      } catch (error) {
        // Unique constraint violation (SQLSTATE 23505) between findOne
        // and flush: another concurrent request won the race. Only narrow
        // on that specific code so transient / configuration errors surface
        // unmodified rather than being swallowed by the retry.
        if ((error as { code?: string }).code !== '23505') throw error;
        const retry = await this.em.findOne(Enrollment, { phoneNumber });
        if (retry !== null) return retry;
        // If still null after retry, re-throw the original error (should be
        // extremely unlikely — a truly simultaneous double-delete scenario).
        throw error;
      }
    }

    if (existing.status === ENROLLMENT_STATUS_EXPIRED) {
      // Reset to a fresh working session (DEFERRED _060 #4): only
      // phoneNumber is forwarded by explicit assignment; lifecycle fields are
      // owned by the ORM / initializer.
      existing.status = ENROLLMENT_INITIAL_STATUS;
      existing.currentStep = ENROLLMENT_INITIAL_STEP;
      // One fresh clock reading for the new window (same as creation-time,
      // ADR-041). The old expires_at is unreachable once status clears the
      // partial index predicate.
      existing.expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
      await this.em.flush();
      // Refresh to get updated optimistic lock version for immediate use.
      await this.em.refresh(existing);
      return existing;
    }

    // Already active — return without mutation. Idempotent for repeated
    // verifications on the same phone within the same enrollment.
    return existing;
  }
}
