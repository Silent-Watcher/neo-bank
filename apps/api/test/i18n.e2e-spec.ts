import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ContractController } from './contract.controller.js';
import { createTestApp } from './create-test-app.js';

const ENVELOPE_FA_MESSAGE = 'با موفقیت انجام شد';
const PHONE_VALIDATION_FA = 'شماره تلفن همراه باید یک شماره همراه ایران با قالب 09XXXXXXXXX باشد.';
const OTP_VALIDATION_FA = 'رمز یک‌بار مصرف باید رشته‌ای عددی با شش رقم باشد.';

// GET /api/v1/echo through the real app: locale resolution, envelope
// localization, and the Content-Language / Vary response headers in one call.
async function echo(
  server: unknown,
  acceptLanguage: string | undefined,
): Promise<request.Response> {
  const agent = request(server as Parameters<typeof request>[0]).get('/api/v1/echo');
  if (acceptLanguage !== undefined) agent.set('Accept-Language', acceptLanguage);
  return agent;
}

describe('Locale resolution (e2e)', () => {
  it('resolves an explicit supported language', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const en = await echo(app.getHttpServer(), 'en');
    const fa = await echo(app.getHttpServer(), 'fa');

    expect(en.headers['content-language']).toBe('en');
    expect(en.body.message).toBe('Success');
    expect(fa.headers['content-language']).toBe('fa');
    expect(fa.body.message).toBe(ENVELOPE_FA_MESSAGE);
    await app.close();
  });

  it('falls back from regional identifiers to their base language', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const faIr = await echo(app.getHttpServer(), 'fa-IR');
    const enUs = await echo(app.getHttpServer(), 'en-US');

    expect(faIr.headers['content-language']).toBe('fa');
    expect(faIr.body.message).toBe(ENVELOPE_FA_MESSAGE);
    expect(enUs.headers['content-language']).toBe('en');
    expect(enUs.body.message).toBe('Success');
    await app.close();
  });

  it('honors q-values across multiple languages', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const prefersFa = await echo(app.getHttpServer(), 'fr-CH,fr;q=0.9,fa;q=0.8');
    const prefersEn = await echo(app.getHttpServer(), 'fa;q=0.5,en;q=0.9');

    expect(prefersFa.headers['content-language']).toBe('fa');
    expect(prefersEn.headers['content-language']).toBe('en');
    await app.close();
  });

  it('uses the default locale for unsupported languages and a missing header', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const unsupported = await echo(app.getHttpServer(), 'xx-YY');
    const missing = await echo(app.getHttpServer(), undefined);

    expect(unsupported.headers['content-language']).toBe('en');
    expect(unsupported.body.message).toBe('Success');
    expect(missing.headers['content-language']).toBe('en');
    expect(missing.body.message).toBe('Success');
    await app.close();
  });
});

describe('Locale response headers (e2e)', () => {
  it('advertises Vary for Accept-Language so caches keep per-language copies', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const response = await echo(app.getHttpServer(), 'fa');

    expect(response.headers.vary?.toLowerCase()).toContain('accept-language');
    await app.close();
  });
});

describe('Localized validation errors (e2e)', () => {
  it('returns Persian validation messages for the enrollments challenge endpoint', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .set('Accept-Language', 'fa')
      .send({ phoneNumber: '02112345678', extra: 'ignored' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.detail).toContain(PHONE_VALIDATION_FA);
    await app.close();
  });

  it('translates unkeyed type issues so no English Zod message leaks into Persian responses', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const response = await request(app.getHttpServer())
      .post('/api/v1/validate/things')
      .set('Accept-Language', 'fa')
      .send({ name: 42, age: 30 });

    expect(response.status).toBe(400);
    expect(response.body.detail).toMatch(/^name: .+ انتظار می‌رفت، اما .+ دریافت شد\.$/);
    await app.close();
  });

  it('translates the OTP format message in Persian while keeping field paths untouched', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/verify')
      .set('Accept-Language', 'fa')
      .send({ phoneNumber: '09123456789', otp: '12345' });

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe(`otp: ${OTP_VALIDATION_FA}`);
    await app.close();
  });

  it('keeps English messages when no Accept-Language is sent', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer())
      .post('/api/v1/enrollments/challenge')
      .send({ phoneNumber: '02112345678' });

    expect(response.status).toBe(400);
    expect(response.body.detail).toContain(
      'phoneNumber: Phone number must be an Iranian mobile number in the format 09XXXXXXXXX.',
    );
    await app.close();
  });
});

describe('Localized error titles with a stable contract (e2e)', () => {
  it('translates the Problem Details title while code, status, and type stay identical', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    const en = await request(app.getHttpServer()).get('/api/v1/app-error');
    const fa = await request(app.getHttpServer())
      .get('/api/v1/app-error')
      .set('Accept-Language', 'fa');

    expect(en.body.title).toBe('Application Error');
    expect(fa.body.title).toBe('خطای برنامه');
    for (const field of ['code', 'status', 'type', 'detail'] as const) {
      expect(fa.body[field]).toBe(en.body[field]);
    }
    await app.close();
  });
});

describe('Request locale isolation (e2e)', () => {
  it('serves concurrent requests in their own language without leakage', async () => {
    const app = await createTestApp(undefined, { controllers: [ContractController] });

    // The requests run in small concurrent batches, interleaving two locales:
    // each request must resolve and render its own language. Batches of 4 sit
    // inside what the local e2e stack sustains — issuing dozens of parallel
    // first-time supertest connections resets them (read ECONNRESET); that
    // behavior reproduces on the pre-i18n code base too and is a property of
    // the test stack, not the application.
    for (let batch = 0; batch < 10; batch++) {
      const [en, fa] = await Promise.all([
        echo(app.getHttpServer(), 'en'),
        echo(app.getHttpServer(), 'fa'),
      ]);

      expect(en.body.message).toBe('Success');
      expect(fa.body.message).toBe(ENVELOPE_FA_MESSAGE);
    }
    await app.close();
  });
});

describe('Health endpoint with localization headers (e2e)', () => {
  it('keeps the monitoring contract for both supported languages', async () => {
    const app = await createTestApp();

    const en = await request(app.getHttpServer()).get('/health').set('Accept-Language', 'en');
    const fa = await request(app.getHttpServer()).get('/health').set('Accept-Language', 'fa');

    for (const response of [en, fa]) {
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('ok');
      expect(response.body.data.details.redis.status).toBe('up');
    }
    expect(en.headers['content-language']).toBe('en');
    expect(fa.headers['content-language']).toBe('fa');
    await app.close();
  });
});
