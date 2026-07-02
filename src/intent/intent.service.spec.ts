import { Test, TestingModule } from '@nestjs/testing';
import { IntentService } from './intent.service';

describe('IntentService', () => {
  let service: IntentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntentService],
    }).compile();

    service = module.get<IntentService>(IntentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
