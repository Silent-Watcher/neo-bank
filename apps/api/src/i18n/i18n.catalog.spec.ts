import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Catalog consistency (ADR-021): the English catalog is the source of truth
// for keys, and every other locale must mirror its structure, keep the same
// placeholders, and carry the plural categories Persian grammar requires.
// Files are read directly so the spec stays independent of module resolution.

type Catalog = Record<string, unknown>;

function isCatalog(value: unknown): value is Catalog {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadCatalog(locale: string, namespace: string): Catalog {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`./${locale}/${namespace}.json`, import.meta.url), 'utf8'),
  );
  if (!isCatalog(parsed)) {
    throw new Error(`Catalog ${locale}/${namespace}.json must hold a JSON object.`);
  }
  return parsed;
}

const ENGLISH_CATALOG: Record<string, Record<string, unknown>> = {
  common: loadCatalog('en', 'common'),
  errors: loadCatalog('en', 'errors'),
  health: loadCatalog('en', 'health'),
  otp: loadCatalog('en', 'otp'),
  validation: loadCatalog('en', 'validation'),
};

const PERSIAN_CATALOG: Record<string, Record<string, unknown>> = {
  common: loadCatalog('fa', 'common'),
  errors: loadCatalog('fa', 'errors'),
  health: loadCatalog('fa', 'health'),
  otp: loadCatalog('fa', 'otp'),
  validation: loadCatalog('fa', 'validation'),
};

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

// The categories Intl.PluralRules can select for fa; a plural message for
// Persian must carry all of them.
const PERSIAN_PLURAL_CATEGORIES: ReadonlySet<string> = new Set(
  new Intl.PluralRules('fa').resolvedOptions().pluralCategories,
);

function isRecord(value: unknown): value is Catalog {
  return typeof value === 'object' && value !== null;
}

// A plural-shaped message: every key is a plural category and `other` (the
// mandatory fallback) is present.
function isPluralForms(value: Catalog): boolean {
  return 'other' in value && Object.keys(value).every((key) => PERSIAN_PLURAL_CATEGORIES.has(key));
}

function placeholdersOf(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();
}

// Array-excluding guard (isCatalog): an array-valued catalog entry is an
// authoring mistake and must surface as a failing string-type assertion, not
// as numeric-keyed pseudo leaves.
function* leaves(catalog: Catalog, prefix: string): Generator<{ key: string; value: unknown }> {
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isCatalog(value)) {
      yield* leaves(value, key);
    } else {
      yield { key, value };
    }
  }
}

function messageAt(catalog: Catalog, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, segment) => (isRecord(node) ? node[segment] : undefined), catalog);
}

describe('translation catalog consistency', () => {
  it('mirrors the English key structure in Persian', () => {
    const englishKeys = [...leaves(ENGLISH_CATALOG, '')].map((leaf) => leaf.key).sort();
    const persianKeys = [...leaves(PERSIAN_CATALOG, '')].map((leaf) => leaf.key).sort();

    expect(persianKeys).toEqual(englishKeys);
  });

  it('keeps message values strings and non-empty in both locales', () => {
    for (const [locale, catalog] of [
      ['en', ENGLISH_CATALOG],
      ['fa', PERSIAN_CATALOG],
    ] as const) {
      for (const { key, value } of leaves(catalog, '')) {
        expect(typeof value, `${locale}:${key}`).toBe('string');
        expect(value, `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('keeps placeholders identical between English and Persian', () => {
    for (const { key, value } of leaves(ENGLISH_CATALOG, '')) {
      if (isRecord(value)) continue;
      if (typeof value !== 'string') {
        throw new Error(`Catalog key en:${key} must be a string, got ${typeof value}.`);
      }

      const persianLeaf = messageAt(PERSIAN_CATALOG, key);

      if (typeof persianLeaf !== 'string') {
        throw new Error(`Catalog key fa:${key} must be a string, got ${typeof persianLeaf}.`);
      }
      expect(placeholdersOf(persianLeaf), `fa:${key}`).toEqual(placeholdersOf(value));
    }
  });

  it('carries every Persian plural category for plural-shaped messages', () => {
    for (const { key, value } of leaves(ENGLISH_CATALOG, '')) {
      if (!isRecord(value) || !isPluralForms(value)) continue;

      const persianLeaf = messageAt(PERSIAN_CATALOG, key);

      expect(isRecord(persianLeaf) && isPluralForms(persianLeaf), `fa:${key}`).toBe(true);
      if (isRecord(persianLeaf)) {
        for (const category of PERSIAN_PLURAL_CATEGORIES) {
          expect(category in persianLeaf, `fa:${key}:${category}`).toBe(true);
        }
      }
    }
  });
});
