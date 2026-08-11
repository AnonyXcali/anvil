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

  describe('applyUnifiedPatch', () => {
    let tempDirectory: string;
    let localFilePath: string;

    beforeEach(async () => {
      await mkdir(join(process.cwd(), 'temp'), { recursive: true });
      tempDirectory = await mkdtemp(
        join(process.cwd(), 'temp', 'anvil-agent-edit-patch-'),
      );
      localFilePath = join(tempDirectory, 'test.txt');
      await writeFile(localFilePath, 'one\ntwo\nthree\nfour\n', 'utf8');
    });

    afterEach(async () => {
      await rm(localFilePath, { force: true });
      await rm(tempDirectory, { recursive: true, force: true });
    });

    it('applies exact multi-hunk unified diffs atomically', async () => {
      const patch = [
        'diff --git a/src/test.txt b/src/test.txt',
        'index 1111111..2222222 100644',
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -1,2 +1,2 @@',
        ' one',
        '-two',
        '+TWO',
        '@@ -4,1 +4,2 @@',
        ' four',
        '+five',
        '',
      ].join('\n');

      await expect(
        service.applyUnifiedPatch(localFilePath, patch, 'src/test.txt'),
      ).resolves.toEqual({
        localFilePath,
        projectPath: 'src/test.txt',
        hunksApplied: 2,
        changed: true,
      });
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
        'one\nTWO\nthree\nfour\nfive\n',
      );
    });

    it.each([
      [
        '--- a/../test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-one\n+ONE',
        'src/test.txt',
      ],
      [
        '--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-one\n+ONE',
        'src/test.txt',
      ],
    ])(
      'rejects unsafe or mismatched paths without mutation',
      async (patch, expectedPath) => {
        await expect(
          service.applyUnifiedPatch(localFilePath, patch, expectedPath),
        ).rejects.toThrow();
        await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
          'one\ntwo\nthree\nfour\n',
        );
      },
    );

    it('rejects context mismatches and overlapping hunks without mutation', async () => {
      const contextMismatch = [
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -1,1 +1,1 @@',
        '-wrong',
        '+ONE',
      ].join('\n');
      await expect(
        service.applyUnifiedPatch(
          localFilePath,
          contextMismatch,
          'src/test.txt',
        ),
      ).rejects.toThrow('context does not match');

      const overlapping = [
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -1,1 +1,1 @@',
        '-one',
        '+ONE',
        '@@ -1,1 +1,1 @@',
        '-one',
        '+ONE AGAIN',
      ].join('\n');
      await expect(
        service.applyUnifiedPatch(localFilePath, overlapping, 'src/test.txt'),
      ).rejects.toThrow('overlapping or ambiguous');
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
        'one\ntwo\nthree\nfour\n',
      );
    });

    it('rejects malformed hunk counts before replacement', async () => {
      const malformed = [
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -1,2 +1,2 @@',
        '-one',
        '+ONE',
      ].join('\n');

      await expect(
        service.applyUnifiedPatch(localFilePath, malformed, 'src/test.txt'),
      ).rejects.toThrow('line counts do not match');
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
        'one\ntwo\nthree\nfour\n',
      );
    });

    it('uses original-file hunk positions when an earlier hunk changes line count', async () => {
      const patch = [
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -1,1 +1,2 @@',
        ' one',
        '+one-and-a-half',
        '@@ -3,1 +4,1 @@',
        '-three',
        '+THREE',
      ].join('\n');

      await expect(
        service.applyUnifiedPatch(localFilePath, patch, 'src/test.txt'),
      ).resolves.toMatchObject({ hunksApplied: 2, changed: true });
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
        'one\none-and-a-half\ntwo\nTHREE\nfour\n',
      );
    });

    it('accepts standard insertion and deletion hunk ranges', async () => {
      const patch = [
        '--- a/src/test.txt',
        '+++ b/src/test.txt',
        '@@ -0,0 +1,1 @@',
        '+zero',
        '@@ -4,1 +4,0 @@',
        '-four',
      ].join('\n');

      await expect(
        service.applyUnifiedPatch(localFilePath, patch, 'src/test.txt'),
      ).resolves.toMatchObject({ hunksApplied: 2, changed: true });
      await expect(readFile(localFilePath, 'utf8')).resolves.toBe(
        'zero\none\ntwo\nthree\n',
      );
    });
  });
});
