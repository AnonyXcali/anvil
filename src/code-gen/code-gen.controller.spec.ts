import { Test, TestingModule } from '@nestjs/testing';
import { CodeGenController } from './code-gen.controller';
import { CodeGenService } from './code-gen.service';

describe('CodeGenController', () => {
  let controller: CodeGenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CodeGenController],
      providers: [
        {
          provide: CodeGenService,
          useValue: {
            enqueue: jest.fn(),
            getJob: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CodeGenController>(CodeGenController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
