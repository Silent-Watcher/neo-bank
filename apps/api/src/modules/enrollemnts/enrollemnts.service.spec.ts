import { Test, TestingModule } from '@nestjs/testing';
import { EnrollemntsService } from './enrollemnts.service.js';
import { beforeEach, describe, expect, it } from 'vitest';

describe('EnrollemntsService', () => {
  let service: EnrollemntsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnrollemntsService],
    }).compile();

    service = module.get<EnrollemntsService>(EnrollemntsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
