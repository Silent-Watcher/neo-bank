import { Entity, Property } from '@mikro-orm/decorators/legacy';

import { BaseEntity } from '#database/base.entity.js';

/**
 * Test-only fixture entity (ADR-029): exercises every BaseEntity column
 * through real persistence. Never registered in production discovery — it is
 * supplied explicitly through test overrides and exists under `test/` only.
 * Explicit `type` keeps the metadata independent of the transformer pipeline.
 */
@Entity()
export class TestArticle extends BaseEntity {
  @Property({ type: 'string', length: 120 })
  title!: string;
}
