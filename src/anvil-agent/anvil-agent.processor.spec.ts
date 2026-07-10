import { Test, TestingModule } from '@nestjs/testing';
import { AnvilAgentProcessor } from './anvil-agent.processor';

describe('AnvilAgentProcessor', () => {
  let provider: AnvilAgentProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnvilAgentProcessor],
    }).compile();

    provider = module.get<AnvilAgentProcessor>(AnvilAgentProcessor);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });
});
