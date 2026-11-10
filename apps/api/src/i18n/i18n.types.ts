import type common from './en/common.json';
import type errors from './en/errors.json';
import type health from './en/health.json';
import type otp from './en/otp.json';
import type validation from './en/validation.json';

// The English catalog is the source of truth for translation keys (ADR-021).
// Registering its shape with the i18n module makes every translation key —
// in I18nService.t(), t(), i18nIssueMessage() — a compile-time checked path,
// and Persian catalogs are validated against it by the catalog-consistency
// tests. Each file's name is the namespace the JsonI18nLoader serves it under
// at runtime, so the type mirrors that `<namespace>.<path>` key space.
export interface Translations {
  common: typeof common;
  errors: typeof errors;
  health: typeof health;
  otp: typeof otp;
  validation: typeof validation;
}

declare module '@nestjs/i18n' {
  interface I18nTypes {
    translations: Translations;
  }
}
