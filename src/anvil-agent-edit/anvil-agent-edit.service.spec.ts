import { Test, TestingModule } from '@nestjs/testing';
import * as fsPromises from 'fs/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { SshService } from 'src/ssh/ssh.service';

jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, rename: jest.fn(actual.rename) };
});

describe('AnvilAgentEditService', () => {
  let service: AnvilAgentEditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnvilAgentEditService, { provide: SshService, useValue: {} }],
    }).compile();

    service = module.get<AnvilAgentEditService>(AnvilAgentEditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('replaceLocalFile', () => {
    let tempDirectory: string;
    let localFilePath: string;

    beforeEach(async () => {
      await mkdir(join(process.cwd(), 'temp'), { recursive: true });
      tempDirectory = await mkdtemp(
        join(process.cwd(), 'temp', 'anvil-agent-edit-'),
      );
      localFilePath = join(tempDirectory, 'test.txt');
      await writeFile(localFilePath, 'original', 'utf8');
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await rm(localFilePath, { force: true });
      await rm(tempDirectory, { recursive: true, force: true });
    });

    it('atomically replaces the file while preserving exact UTF-8 content', async () => {
      const content = 'café\n東京\n終端';

      await expect(
        service.replaceLocalFile(localFilePath, content),
      ).resolves.toBe(localFilePath);
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(content);
    });

    it.each([
      ['', 'Local file path is not provided'],
      [
        join(process.cwd(), 'outside.txt'),
        'Local file path must be inside the temporary root',
      ],
      [
        join(process.cwd(), 'temp', '..', 'outside.txt'),
        'Local file path must be inside the temporary root',
      ],
    ])('rejects unsafe path %s', async (path, message) => {
      await expect(service.replaceLocalFile(path, 'content')).rejects.toThrow(
        message,
      );
    });

    it('rejects a directory', async () => {
      const directoryPath = join(
        process.cwd(),
        'temp',
        `directory-${Date.now()}`,
      );
      await mkdir(directoryPath);

      await expect(
        service.replaceLocalFile(directoryPath, 'content'),
      ).rejects.toThrow('Local file path must point to a regular file');

      await rm(directoryPath, { recursive: true, force: true });
    });

    it('cleans up the sibling temp file when rename fails', async () => {
      (fsPromises.rename as jest.Mock).mockRejectedValueOnce(
        new Error('rename failed'),
      );

      await expect(
        service.replaceLocalFile(localFilePath, 'content'),
      ).rejects.toThrow('rename failed');
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe('original');
      await expect(fsPromises.readdir(tempDirectory)).resolves.not.toContain(
        expect.stringMatching(/\.tmp$/),
      );
    });
  });
});
