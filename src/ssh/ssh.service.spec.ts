import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SshService } from './ssh.service';
import { PortService } from './port.service';

const execCommandMock = jest.fn<
  Promise<{ stdout: string; stderr: string; code: number }>,
  [string]
>();
const connectMock = jest.fn<Promise<void>, [unknown]>();

const lastExecutedCommand = (): string => {
  const lastCall = execCommandMock.mock.calls.at(-1);
  if (!lastCall || typeof lastCall[0] !== 'string') {
    throw new Error('No SSH command was executed');
  }
  return lastCall[0];
};

jest.mock('node-ssh', () => ({
  NodeSSH: jest.fn().mockImplementation(() => ({
    connect: connectMock,
    execCommand: execCommandMock,
    dispose: jest.fn(),
    getFile: jest.fn(),
    putFile: jest.fn(),
  })),
}));

describe('SshService', () => {
  let service: SshService;

  beforeEach(async () => {
    process.env.SSH_HOST = 'localhost';
    process.env.SSH_PORT = '22';
    process.env.SSH_PRIVATE_KEY_PATH = '/dev/null';
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns remote existence and hash without exposing file contents', async () => {
    execCommandMock.mockResolvedValueOnce({
      stdout: 'ABC123\n',
      stderr: '',
      code: 0,
    });

    await expect(
      service.getProjectFileState('project-id', 'src/App.tsx'),
    ).resolves.toEqual({ exists: true, hash: 'abc123' });

    const command = lastExecutedCommand();
    expect(command).toContain('sha256sum');
    expect(command).not.toContain('cat --');
  });

  it('recognizes a missing target from the state sentinel', async () => {
    execCommandMock.mockResolvedValueOnce({
      stdout: '__MISSING__',
      stderr: '',
      code: 0,
    });

    await expect(
      service.getProjectFileState('project-id', 'src/New.tsx'),
    ).resolves.toEqual({ exists: false, hash: null });
  });

  it('rejects unsafe commit backup inputs before connecting', async () => {
    await expect(
      service.createCommitBackup('project-id', '../secret.ts', 'run-1'),
    ).rejects.toThrow('cannot traverse');
    await expect(
      service.createCommitBackup('project-id', 'src/App.tsx', '../run'),
    ).rejects.toThrow('single path segment');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('creates transaction-scoped backups and guards symlinks', async () => {
    await service.createCommitBackup('project-id', 'src/App.tsx', 'run-1');

    const command = lastExecutedCommand();
    expect(command).toContain('.anvil-backups/run-1/src/App.tsx');
    expect(command).toContain('test ! -L');
    expect(command).toContain('cp --');
  });

  it('only removes backups belonging to the requested edit run', async () => {
    await expect(
      service.removeCommitBackup(
        'project-id',
        '.anvil-backups/other-run/src/App.tsx',
        'run-1',
      ),
    ).rejects.toThrow('does not belong');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('removes only empty, non-symlink transaction directories', async () => {
    await service.removeEmptyCreatedDirectory(
      'project-id',
      'src/features/new-feature',
    );

    const command = lastExecutedCommand();
    expect(command).toContain('test -d');
    expect(command).toContain('test ! -L');
    expect(command).toContain('find');
    expect(command).toContain('rmdir --');
  });
});
