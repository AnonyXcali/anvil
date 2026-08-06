import { Injectable, Logger } from '@nestjs/common';
import {
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { randomUUID } from 'crypto';
import { resolve, sep } from 'path';
import { SshService } from 'src/ssh/ssh.service';

@Injectable()
export class AnvilAgentEditService {
  private readonly logger = new Logger(AnvilAgentEditService.name);
  constructor(private readonly sshService: SshService) {}

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
