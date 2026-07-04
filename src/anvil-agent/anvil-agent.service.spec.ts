import { Test, TestingModule } from '@nestjs/testing';
import { AnvilAgentService } from './anvil-agent.service';

describe('AnvilAgentService', () => {
  let service: AnvilAgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnvilAgentService],
    }).compile();

    service = module.get<AnvilAgentService>(AnvilAgentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
