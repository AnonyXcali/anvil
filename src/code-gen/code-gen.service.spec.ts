import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { CodeGenService } from './code-gen.service';
import { DbService } from '../db/db.service';
import { LlmService } from '../llm/llm.service';

describe('CodeGenService', () => {
  let service: CodeGenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodeGenService,
        {
          provide: getQueueToken('code-execution'),
          useValue: {
            add: jest.fn(),
          },
        },
        {
          provide: DbService,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: LlmService,
          useValue: {
            chat: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CodeGenService>(CodeGenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
