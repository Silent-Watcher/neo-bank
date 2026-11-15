import { Check, Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { BigIntType } from '@mikro-orm/core';
import type { Opt } from '@mikro-orm/core';

import { getActorId } from '#src/shared/actor-context/actor-context.js';

/**
 * Shared persistence base for every API entity (ADR-029). Decorated
 * `@Entity({ abstract: true })` — MikroORM v7's mapped-superclass mechanism —
 * so the class generates no table and its properties are inlined into every
 * concrete entity during discovery, including the class-level check
 * constraint.
 *
 * Feature entities extend this class and never redefine its properties.
 * ORM-managed fields (`createdAt`, `updatedAt`, `version`, and the audit
 * attribution) are never assigned by application services or DTOs: the
 * `onCreate`/`onUpdate` callbacks and the Unit of Work own them.
 */
@Entity({ abstract: true })
// PostgreSQL has no unsigned BIGINT; the check preserves the positive
// identifier invariant on every concrete table and is propagated by the
// base-entity discovery pass.
@Check({ name: 'base_entity_id_positive', expression: 'id > 0' })
export abstract class BaseEntity {
  /**
   * PostgreSQL BIGINT primary key via `bigserial` (explicit `autoincrement`,
   * the platform default for a single numeric PK). TypeScript `string` keeps
   * values beyond `Number.MAX_SAFE_INTEGER` exact — the string-mode
   * `BigIntType` converts every direction explicitly.
   */
  @PrimaryKey({ type: new BigIntType('string'), autoincrement: true })
  id!: string;

  /**
   * Absolute creation instant, UTC-stored (`timestamptz(3)` — millisecond
   * resolution matches `Date`, ADR-030). The initializer keeps the value
   * available before flush; `onCreate` is the ORM-managed backstop.
   */
  @Property({ onCreate: () => new Date(), columnType: 'timestamptz(3)' })
  createdAt: Opt<Date> = new Date();

  /**
   * `NULL` while the row is unmodified; bumped by the ORM only when a real
   * update changeset exists (no-op updates are skipped by design).
   */
  @Property({ onUpdate: () => new Date(), nullable: true, columnType: 'timestamptz(3)' })
  updatedAt: Opt<Date> | null = null;

  /**
   * Actor that created the row; `NULL` means the system created it. Plain
   * scalar — no foreign key, no relation (no Users table exists, ADR-029).
   */
  @Property({ type: new BigIntType('string'), nullable: true, onCreate: () => getActorId() })
  createdBy: Opt<string> | null = null;

  /**
   * Actor that last updated the row; `NULL` means the last update was
   * performed by the system. Resolved on every real update.
   */
  @Property({ type: new BigIntType('string'), nullable: true, onUpdate: () => getActorId() })
  updatedBy: Opt<string> | null = null;

  /**
   * MikroORM-owned optimistic-locking version (ADR-029): the initial value is
   * 1 and every successful update increments it inside the UPDATE statement —
   * application services never touch it. Conflicts surface through
   * `em.lock()` and `ErrorCode.VersionConflict` (HTTP 409).
   */
  @Property({ version: true })
  version: Opt<number> = 1;

  /**
   * Soft-delete surface only (ADR-029): no filters, subscribers, or restore
   * flows exist yet.
   */
  @Property({ nullable: true, columnType: 'timestamptz(3)' })
  deletedAt: Opt<Date> | null = null;
}
