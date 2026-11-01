import { Test, TestingModule } from '@nestjs/testing';
import { EnrollemntsController } from './enrollemnts.controller.js';
import { EnrollemntsService } from './enrollemnts.service.js';
import { beforeEach, describe, expect, it } from 'vitest';

describe('EnrollemntsController', () => {
  let controller: EnrollemntsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollemntsController],
      providers: [EnrollemntsService],
    }).compile();

    controller = module.get<EnrollemntsController>(EnrollemntsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
