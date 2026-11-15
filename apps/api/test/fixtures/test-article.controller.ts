import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { I18nService } from '@nestjs/i18n';
import { EntityManager, LockMode } from '@mikro-orm/core';

import { mapOptimisticLockError } from '#errors/optimistic-lock.mapper.js';
import { getActorContext, runWithActorContext } from '#src/shared/actor-context/actor-context.js';

import { TestArticle } from './test-article.entity.js';

interface CreateProbeBody {
  title: string;
  /**
   * Test-only simulation of the authentication seam (ADR-029): production
   * actor IDs come from the verified principal resolved in the ClsMiddleware
   * setup hook (`actor-context.module.ts`), never from request bodies. The
   * probe opens a nested actor context to prove attribution works end to end.
   */
  actingAs?: string;
}

interface UpdateProbeBody {
  title: string;
  expectedVersion?: number;
  actingAs?: string;
}

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 120;

function parseTitle(title: unknown): string {
  if (
    typeof title !== 'string' ||
    title.length < TITLE_MIN_LENGTH ||
    title.length > TITLE_MAX_LENGTH
  ) {
    throw new BadRequestException('title must be a non-empty string of at most 120 characters');
  }
  return title;
}

function parseExpectedVersion(expectedVersion: unknown): number | undefined {
  if (expectedVersion === undefined) {
    return undefined;
  }
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    throw new BadRequestException('expectedVersion must be a positive integer');
  }
  return expectedVersion;
}

/**
 * Test-only probe controller (ADR-029): drives BaseEntity rows through the
 * real request pipeline — envelope, Problem Details, actor-context
 * middleware — so lifecycle, attribution, and optimistic locking can be
 * asserted over HTTP. Registered only by db-specs via createTestApp's
 * `controllers`; never part of the production module graph.
 */
@Controller('test/articles')
export class TestArticleController {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    private readonly i18n: I18nService,
  ) {}

  @Post()
  create(@Body() body: CreateProbeBody): Promise<TestArticle> {
    const title = parseTitle(body.title);
    return runWithActorContext({ actorId: body.actingAs ?? null }, async () => {
      const article = this.em.create(TestArticle, { title });
      await this.em.flush();
      return article;
    });
  }

  @Get('context/em')
  emContext(): { emId: number } {
    // EntityManager#id respects the RequestContext (ADR-031: verified in
    // @mikro-orm/core 7.2.9 — "global EM will give you the contextual ID if
    // executed inside request context handler"), so two concurrent requests
    // must observe different fork identities.
    return { emId: this.em.id };
  }

  @Get('context/actor')
  actorContext(): { actorContextMounted: boolean } {
    // The CLS middleware establishes the store for every request (ADR-031);
    // `getActorContext()` returns the store when the context is open —
    // distinct from "no context at all" — even though the actor seam
    // currently resolves to null.
    return { actorContextMounted: getActorContext() !== undefined };
  }

  @Get(':id')
  async find(@Param('id') id: string): Promise<TestArticle> {
    const article = await this.em.findOne(TestArticle, { id });
    if (article === null) {
      throw new NotFoundException();
    }
    return article;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateProbeBody): Promise<TestArticle> {
    const title = parseTitle(body.title);
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    return runWithActorContext({ actorId: body.actingAs ?? null }, async () => {
      const article = await this.em.findOne(TestArticle, { id });
      if (article === null) {
        throw new NotFoundException();
      }
      // The lock check and the flush both raise OptimisticLockError (the
      // flush's versioned UPDATE can lose a concurrent race), so both sit
      // inside the mapped boundary — the production pattern for update
      // workflows (ADR-029).
      try {
        if (expectedVersion !== undefined) {
          await this.em.lock(article, LockMode.OPTIMISTIC, { lockVersion: expectedVersion });
        }
        article.title = title;
        await this.em.flush();
      } catch (error) {
        mapOptimisticLockError(error, this.i18n.t('errors.details.versionConflict'));
      }
      return article;
    });
  }
}
