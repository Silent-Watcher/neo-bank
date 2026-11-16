import { Entity, Property } from '@mikro-orm/decorators/legacy';

import { BaseEntity } from '#database/base.entity.js';

/**
 * A phone number entering the enrollment flow (the persistence face of the
 * enrollments feature). First concrete entity — carries the inherited
 * `BaseEntity` columns (ADR-029) and adds nothing else.
 */
@Entity({ tableName: 'enrollments' })
export class Enrollment extends BaseEntity {
  /** E.164 phone number; column follows the default underscore naming strategy. */
  @Property()
  phoneNumber!: string;
}
