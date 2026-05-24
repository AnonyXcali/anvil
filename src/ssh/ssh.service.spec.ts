import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SshService } from './ssh.service';
import { PortService } from './port.service';

describe('SshService', () => {
  let service: SshService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SshService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(),
          },
        },
        {
          provide: PortService,
          useValue: {
            acquirePort: jest.fn(),
            releasePort: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SshService>(SshService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
