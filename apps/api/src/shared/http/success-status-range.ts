import { HttpStatus } from '@nestjs/common';

// Exclusive upper bound of the successful (2xx) status class: only a
// successful response has a selected representation a validator can identify
// (ADR-038 §2). The installed HttpStatus enum names 300 `AMBIGUOUS` and has
// no `MULTIPLE_CHOICES` member, so the 3xx boundary is written explicitly.
// Single source of truth for every consumer that classifies responses as
// successful: the conditional-request interceptor's runtime eligibility gate
// and the conditional-GET OpenAPI transform's documented-success filter.
export const SUCCESS_STATUSES_MAX_EXCLUSIVE = HttpStatus.AMBIGUOUS;
