import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('AppController (e2e)', () => {
  it('responds with the starter greeting', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get('/').expect(200);
    expect(response.text).toBe('Hello World!');
    await app.close();
  });
});
