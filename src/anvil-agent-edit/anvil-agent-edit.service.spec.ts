import { Test, TestingModule } from '@nestjs/testing';
import { AnvilAgentEditService } from './anvil-agent-edit.service';

describe('AnvilAgentEditService', () => {
  let service: AnvilAgentEditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnvilAgentEditService],
    }).compile();

    service = module.get<AnvilAgentEditService>(AnvilAgentEditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
