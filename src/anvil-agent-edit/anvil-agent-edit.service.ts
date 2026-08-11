import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  cp,
  mkdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { randomUUID } from 'crypto';
import { dirname, posix, resolve, sep } from 'path';
import { SshService } from 'src/ssh/ssh.service';
import { UNIFIED_PATCH_RESULT } from './anvil-agent-edit.types';
import { AnvilEditStagingService } from './anvil-edit-staging.service';

type UnifiedPatchHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<{ kind: 'context' | 'add' | 'delete'; content: string }>;
};

@Injectable()
export class AnvilAgentEditService implements OnModuleInit {
  private readonly logger = new Logger(AnvilAgentEditService.name);
  constructor(
    private readonly sshService: SshService,
    @Optional()
    private readonly stagingService?: AnvilEditStagingService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.stagingService) return;
    const abandoned = await this.stagingService.findAbandonedWorkspaces();
    for (const transaction of abandoned) {
      try {
        const { manifest } = transaction;
        for (const file of [...manifest.files].reverse()) {
          if (
            file.commitStatus === 'rolled-back' ||
            file.commitStatus === 'rollback-failed' ||
            (file.commitStatus === 'pending' &&
              !file.backupPath &&
              file.operation !== 'create')
          ) {
            continue;
          }
          if (file.operation === 'create') {
            try {
              await this.sshService.removeCreatedProjectFile(
                manifest.projectId,
                file.projectPath,
              );
            } catch (error) {
              if (
                !(
                  error instanceof Error &&
                  /not found|no such file/i.test(error.message)
                )
              ) {
                throw error;
              }
            }
          } else if (file.backupPath) {
            await this.sshService.restoreProjectFile(
              manifest.projectId,
              file.backupPath,
              file.projectPath,
            );
          }
          if (file.backupPath) {
            await this.sshService.removeCommitBackup(
              manifest.projectId,
              file.backupPath,
              manifest.editRunId,
            );
          }
        }
        for (const directory of [...manifest.createdDirectories].reverse()) {
          await this.sshService.removeEmptyCreatedDirectory(
            manifest.projectId,
            directory,
          );
        }
        await this.stagingService.cleanup(transaction.workspace);
      } catch (error) {
        this.logger.error(
          `Abandoned edit recovery failed for ${transaction.manifest.projectId}/${transaction.manifest.editRunId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async createStagingWorkspace(
    projectId: string,
    editRunId: string,
  ): Promise<string> {
    if (
      !projectId.trim() ||
      projectId.includes('/') ||
      projectId.includes('\\')
    ) {
      throw new Error('Project ID is invalid for staging');
    }
    if (
      !editRunId.trim() ||
      editRunId.includes('/') ||
      editRunId.includes('\\')
    ) {
      throw new Error('Edit run ID is invalid for staging');
    }
    const stagingRoot = resolve(process.cwd(), 'temp', projectId, editRunId);
    await mkdir(stagingRoot, { recursive: true });
    return stagingRoot;
  }

  private resolveStagingPath(stagingRoot: string, projectPath: string): string {
    const normalized = posix.normalize(projectPath.replaceAll('\\', '/'));
    if (
      !normalized ||
      normalized === '.' ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.startsWith('/')
    ) {
      throw new Error(`Unsafe staged project path: ${projectPath}`);
    }
    const root = resolve(stagingRoot);
    const target = resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(
        `Staged project path escapes staging root: ${projectPath}`,
      );
    }
    return target;
  }

  async stageRemoteFile(
    projectId: string,
    projectPath: string,
    stagingRoot: string,
  ): Promise<{ localPath: string; hash: string }> {
    const target = this.resolveStagingPath(stagingRoot, projectPath);
    const downloaded = await this.downloadFile(projectId, projectPath);
    await mkdir(dirname(target), { recursive: true });
    await cp(downloaded.localFilePath, target, { errorOnExist: true });
    await this.cleanUpLocalFile(downloaded.localFilePath);
    return { localPath: target, hash: downloaded.hash };
  }

  async stageNewFile(
    projectPath: string,
    stagingRoot: string,
    content: string,
  ): Promise<string> {
    const target = this.resolveStagingPath(stagingRoot, projectPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    return target;
  }

  async readStagedFile(localPath: string): Promise<string> {
    await this.assertSafeLocalFilePath(localPath);
    return await readFile(localPath, 'utf8');
  }

  async removeStagingWorkspace(stagingRoot: string): Promise<void> {
    const tempRoot = resolve(process.cwd(), 'temp');
    const root = resolve(stagingRoot);
    if (root === tempRoot || !root.startsWith(`${tempRoot}${sep}`)) {
      throw new Error('Staging root must be inside the temporary root');
    }
    await rm(root, { recursive: true, force: true });
  }

  async downloadFile(
    projectId: string,
    filePath: string,
  ): Promise<{
    remoteFilePath: string;
    localFilePath: string;
    hash: string;
  }> {
    return await this.sshService.downloadProjectFile(projectId, filePath);
  }

  async createBackupFile(projectId: string, filePath: string): Promise<string> {
    return await this.sshService.backupProjectFile(projectId, filePath);
  }

  async getProjectFileState(
    projectId: string,
    filePath: string,
  ): Promise<{ exists: boolean; hash: string | null }> {
    return await this.sshService.getProjectFileState(projectId, filePath);
  }

  async createCommitBackup(
    projectId: string,
    filePath: string,
    editRunId: string,
  ): Promise<string> {
    return await this.sshService.createCommitBackup(
      projectId,
      filePath,
      editRunId,
    );
  }

  async removeCommitBackup(
    projectId: string,
    backupPath: string,
    editRunId: string,
  ): Promise<void> {
    await this.sshService.removeCommitBackup(projectId, backupPath, editRunId);
  }

  async removeCreatedProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    return await this.sshService.removeCreatedProjectFile(projectId, filePath);
  }

  async removeEmptyCreatedDirectory(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    return await this.sshService.removeEmptyCreatedDirectory(
      projectId,
      folderPath,
    );
  }

  async edit(
    localFilePath: string,
    targetChange: string,
    range: { start: number; end: number },
  ): Promise<string> {
    if (!localFilePath.trim()) {
      throw new Error('Local file path is not provided');
    }

    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
      throw new Error('Range start and end must be finite numbers');
    }

    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      throw new Error('Range start and end must be integers');
    }

    if (range.start <= 0 || range.end <= 0) {
      throw new Error('Range start and end must be positive numbers');
    }

    if (range.start > range.end) {
      throw new Error('Range start must be less than or equal to range end');
    }

    const content = await readFile(localFilePath, 'utf8');
    const lines = content.split('\n');

    if (range.start > lines.length) {
      throw new Error('Range start is beyond the file length');
    }

    const startIndex = range.start - 1;
    const endIndex = Math.min(range.end, lines.length) - 1;
    const deleteCount = endIndex - startIndex + 1;
    const replacementLines = targetChange.split('\n');

    lines.splice(startIndex, deleteCount, ...replacementLines);

    return await this.replaceLocalFile(localFilePath, lines.join('\n'));
  }

  async replaceLocalFile(
    localFilePath: string,
    content: string,
  ): Promise<string> {
    if (!localFilePath.trim()) {
      throw new Error('Local file path is not provided');
    }

    await this.assertSafeLocalFilePath(localFilePath);

    const tempFilePath = `${localFilePath}.${randomUUID()}.tmp`;

    try {
      await writeFile(tempFilePath, content, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(tempFilePath, localFilePath);
    } catch (error: unknown) {
      try {
        await unlink(tempFilePath);
      } catch {
        // Preserve the original replacement failure.
      }
      throw error;
    }

    return localFilePath;
  }

  private async assertSafeLocalFilePath(localFilePath: string): Promise<void> {
    const tempRoot = resolve(process.cwd(), 'temp');
    const requestedPath = resolve(localFilePath);
    const tempRootRealPath = await realpath(tempRoot);
    const tempRootPrefix = `${tempRootRealPath}${sep}`;
    if (!requestedPath.startsWith(`${tempRoot}${sep}`)) {
      throw new Error('Local file path must be inside the temporary root');
    }

    const localFileRealPath = await realpath(localFilePath);
    if (!localFileRealPath.startsWith(tempRootPrefix)) {
      throw new Error('Local file path must be inside the temporary root');
    }

    const localFileStat = await lstat(localFilePath);
    if (!localFileStat.isFile()) {
      throw new Error('Local file path must point to a regular file');
    }
  }

  async applyUnifiedPatch(
    localFilePath: string,
    patch: string,
    expectedProjectPath: string,
  ): Promise<UNIFIED_PATCH_RESULT> {
    if (!localFilePath.trim()) {
      throw new Error('Local file path is not provided');
    }
    if (!patch.trim()) {
      throw new Error('Unified patch is not provided');
    }
    if (!expectedProjectPath.trim()) {
      throw new Error('Expected project path is not provided');
    }

    const patchLines = patch.split('\n');
    if (patchLines.at(-1) === '') {
      patchLines.pop();
    }

    let lineIndex = 0;
    let oldPath: string | undefined;
    let newPath: string | undefined;
    const hunks: UnifiedPatchHunk[] = [];

    while (lineIndex < patchLines.length) {
      const line = patchLines[lineIndex];
      if (line === 'diff --git ' || line.startsWith('diff --git ')) {
        const paths = line.slice('diff --git '.length).trim().split(' ');
        if (paths.length !== 2) {
          throw new Error('Unified patch has an invalid git header');
        }
        lineIndex += 1;
        continue;
      }
      if (line.startsWith('--- ')) {
        if (oldPath !== undefined) {
          throw new Error('Unified patch must contain exactly one file');
        }
        oldPath = line.slice(4).split('\t', 1)[0];
        lineIndex += 1;
        if (
          lineIndex >= patchLines.length ||
          !patchLines[lineIndex].startsWith('+++ ')
        ) {
          throw new Error('Unified patch is missing its new-file header');
        }
        newPath = patchLines[lineIndex].slice(4).split('\t', 1)[0];
        lineIndex += 1;
        continue;
      }
      if (line.startsWith('@@ ')) {
        if (oldPath === undefined || newPath === undefined) {
          throw new Error('Unified patch hunk has no file header');
        }
        const match =
          /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
        if (!match) {
          throw new Error('Unified patch has an invalid hunk header');
        }
        const hunk: UnifiedPatchHunk = {
          oldStart: Number(match[1]),
          oldCount: Number(match[2] ?? '1'),
          newStart: Number(match[3]),
          newCount: Number(match[4] ?? '1'),
          lines: [],
        };
        lineIndex += 1;
        let oldLines = 0;
        let newLines = 0;
        while (
          lineIndex < patchLines.length &&
          !patchLines[lineIndex].startsWith('@@ ') &&
          !patchLines[lineIndex].startsWith('--- ')
        ) {
          const hunkLine = patchLines[lineIndex];
          if (hunkLine === '\\ No newline at end of file') {
            if (hunk.lines.length === 0) {
              throw new Error('Unified patch has an invalid newline marker');
            }
            lineIndex += 1;
            continue;
          }
          const prefix = hunkLine[0];
          if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
            throw new Error('Unified patch has an invalid hunk line');
          }
          hunk.lines.push({
            kind:
              prefix === ' ' ? 'context' : prefix === '+' ? 'add' : 'delete',
            content: hunkLine.slice(1),
          });
          if (prefix !== '+') oldLines += 1;
          if (prefix !== '-') newLines += 1;
          lineIndex += 1;
        }
        if (oldLines !== hunk.oldCount || newLines !== hunk.newCount) {
          throw new Error(
            'Unified patch hunk line counts do not match its header',
          );
        }
        hunks.push(hunk);
        continue;
      }
      if (line === 'index ' || line.startsWith('index ') || line === '') {
        lineIndex += 1;
        continue;
      }
      throw new Error('Unified patch has an unexpected line');
    }

    if (oldPath === undefined || newPath === undefined || hunks.length === 0) {
      throw new Error(
        'Unified patch must contain one file and at least one hunk',
      );
    }

    const normalizePatchPath = (path: string): string => {
      if (
        !path ||
        path === '/dev/null' ||
        path.startsWith('/') ||
        path.includes('\\')
      ) {
        throw new Error('Unified patch contains an unsafe file path');
      }
      const withoutPrefix =
        path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
      const normalized = resolve('/', withoutPrefix).slice(1);
      if (
        normalized !== withoutPrefix ||
        normalized.startsWith('../') ||
        normalized === '..'
      ) {
        throw new Error('Unified patch contains an unsafe file path');
      }
      return normalized;
    };
    const normalizedOldPath = normalizePatchPath(oldPath);
    const normalizedNewPath = normalizePatchPath(newPath);
    const normalizedExpectedPath = normalizePatchPath(expectedProjectPath);
    if (
      normalizedOldPath !== normalizedNewPath ||
      normalizedNewPath !== normalizedExpectedPath
    ) {
      throw new Error(
        'Unified patch path does not match the expected project path',
      );
    }

    await this.assertSafeLocalFilePath(localFilePath);
    const content = await readFile(localFilePath, 'utf8');
    const fileLines = content.split('\n');
    let previousEnd = -1;
    let lineOffset = 0;
    for (const hunk of hunks) {
      if (
        hunk.oldStart < 0 ||
        hunk.oldCount < 0 ||
        hunk.newStart < 0 ||
        hunk.newCount < 0 ||
        (hunk.oldStart === 0 && hunk.oldCount !== 0) ||
        (hunk.newStart === 0 && hunk.newCount !== 0)
      ) {
        throw new Error('Unified patch has invalid hunk ranges');
      }
      const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
      const end = start + hunk.oldCount;
      if (
        start < previousEnd ||
        (hunk.oldCount === 0 && start === previousEnd)
      ) {
        throw new Error(
          'Unified patch contains overlapping or ambiguous hunks',
        );
      }
      if (start < 0 || end > fileLines.length) {
        throw new Error('Unified patch hunk is outside the local file');
      }
      const expectedNewStart =
        start + lineOffset + (hunk.newCount === 0 ? 0 : 1);
      if (hunk.newStart !== expectedNewStart) {
        throw new Error(
          'Unified patch new-file range does not match its content',
        );
      }
      const replacement: string[] = [];
      let sourceIndex = start + lineOffset;
      const expectedOldLines = hunk.lines
        .filter((hunkLine) => hunkLine.kind !== 'add')
        .map((hunkLine) => hunkLine.content);
      if (expectedOldLines.length > 0) {
        let occurrences = 0;
        for (
          let index = 0;
          index <= fileLines.length - expectedOldLines.length;
          index += 1
        ) {
          if (
            expectedOldLines.every(
              (line, offset) => fileLines[index + offset] === line,
            )
          ) {
            occurrences += 1;
          }
        }
        if (occurrences > 1) {
          throw new Error(
            'Unified patch context is ambiguous in the local file',
          );
        }
      }
      for (const hunkLine of hunk.lines) {
        if (hunkLine.kind === 'add') {
          replacement.push(hunkLine.content);
          continue;
        }
        if (
          sourceIndex >= fileLines.length ||
          fileLines[sourceIndex] !== hunkLine.content
        ) {
          throw new Error(
            'Unified patch context does not match the local file',
          );
        }
        if (hunkLine.kind === 'context') replacement.push(hunkLine.content);
        sourceIndex += 1;
      }
      if (sourceIndex !== end + lineOffset) {
        throw new Error('Unified patch hunk range does not match its content');
      }
      fileLines.splice(start + lineOffset, hunk.oldCount, ...replacement);
      lineOffset += replacement.length - hunk.oldCount;
      previousEnd = end;
    }

    const updatedContent = fileLines.join('\n');
    await this.replaceLocalFile(localFilePath, updatedContent);
    return {
      localFilePath,
      projectPath: normalizedExpectedPath,
      hunksApplied: hunks.length,
      changed: updatedContent !== content,
    };
  }

  async upload(
    projectId: string,
    localFilePath: string,
    originalFilePath: string,
    originalHash: string,
  ): Promise<string> {
    return await this.sshService.uploadProjectFile(
      projectId,
      localFilePath,
      originalFilePath,
      originalHash,
    );
  }

  async restore(
    projectId: string,
    backupFilePath: string,
    originalFilePath: string,
  ): Promise<string> {
    return await this.sshService.restoreProjectFile(
      projectId,
      backupFilePath,
      originalFilePath,
    );
  }

  async createProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    return await this.sshService.createProjectFile(projectId, filePath);
  }

  async createProjectFolder(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    return await this.sshService.createProjectFolder(projectId, folderPath);
  }

  async deleteProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    return await this.sshService.deleteProjectFile(projectId, filePath);
  }

  async deleteProjectFolder(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    return await this.sshService.deleteProjectFolder(projectId, folderPath);
  }

  async verifyProjectFileExists(
    projectId: string,
    filePath: string,
  ): Promise<boolean> {
    return await this.sshService.verifyProjectFileExists(projectId, filePath);
  }

  async verifyProjectFolderExists(
    projectId: string,
    folderPath: string,
  ): Promise<boolean> {
    return await this.sshService.verifyProjectFolderExists(
      projectId,
      folderPath,
    );
  }

  async readProjectFileRange(
    projectId: string,
    filePath: string,
    lineRange: { startLine: number; endLine: number },
  ): Promise<string> {
    return await this.sshService.readProjectFileRange(
      projectId,
      filePath,
      lineRange,
    );
  }

  async getRelatedStyleFiles(
    projectId: string,
    cssFilePath: string,
  ): Promise<Array<{ projectFilePath: string; content: string }>> {
    const cssFileName = cssFilePath.split('/').pop() ?? cssFilePath;
    const projectFiles = await this.sshService.findProjectFilesContaining(
      projectId,
      cssFileName,
    );
    return await Promise.all(
      projectFiles.map(async (projectFilePath) => ({
        projectFilePath,
        content: await this.sshService.readProjectFile(
          projectId,
          projectFilePath,
        ),
      })),
    );
  }

  async readLocal(
    path: string,
    line_range?: { start: number; end: number },
  ): Promise<string> {
    return await this.sshService.readLocalFile(path, line_range);
  }

  async cleanUp(
    projectId: string,
    backFilePath: string,
    localFilePath: string,
  ): Promise<void> {
    if (!projectId.trim()) {
      this.logger.error('Project ID is not provided for cleanup');
      return;
    }

    if (!backFilePath.trim()) {
      this.logger.error('Backup file path is not provided for cleanup');
      return;
    }

    if (!localFilePath.trim()) {
      this.logger.error('Local file path is not provided for cleanup');
      return;
    }

    try {
      await this.sshService.deleteProjectFile(projectId, backFilePath);
    } catch (e: unknown) {
      this.logger.error('Remote backup cleanup failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
    }

    await this.cleanUpLocalFile(localFilePath);
  }

  async cleanUpLocalFile(localFilePath: string): Promise<void> {
    if (!localFilePath.trim()) {
      return;
    }

    try {
      const tempRoot = resolve(process.cwd(), 'temp');
      const resolvedPath = resolve(localFilePath);
      const realTempRoot = await realpath(tempRoot);
      const realLocalPath = await realpath(localFilePath);
      if (
        !resolvedPath.startsWith(`${tempRoot}${sep}`) ||
        !realLocalPath.startsWith(`${realTempRoot}${sep}`)
      ) {
        this.logger.error('Local cleanup path is outside the temporary root');
        return;
      }

      const localFileStat = await stat(localFilePath);
      if (localFileStat.isFile()) {
        await unlink(localFilePath);
      }
    } catch (error: unknown) {
      this.logger.error('Local temporary file cleanup failed');
      if (error instanceof Error) {
        this.logger.error(error.message);
      }
    }
  }
}
