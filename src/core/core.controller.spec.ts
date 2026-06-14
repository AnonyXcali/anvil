import { Test, TestingModule } from '@nestjs/testing';
import { CoreController } from './core.controller';

describe('CoreController', () => {
  let controller: CoreController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoreController],
    }).compile();

    controller = module.get<CoreController>(CoreController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
