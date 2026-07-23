import { Test, TestingModule } from '@nestjs/testing';
import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';

describe('AnvilAgentSupervisorService', () => {
  let service: AnvilAgentSupervisorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnvilAgentSupervisorService],
    }).compile();

    service = module.get<AnvilAgentSupervisorService>(AnvilAgentSupervisorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
