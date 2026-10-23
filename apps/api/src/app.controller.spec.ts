import { describe, expect, it } from 'vitest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  it('returns the starter greeting', () => {
    const controller = new AppController(new AppService());
    expect(controller.getHello()).toBe('Hello World!');
  });
});
