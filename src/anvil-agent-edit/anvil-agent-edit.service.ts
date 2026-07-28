import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat, unlink, writeFile } from 'fs/promises';
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

    await writeFile(localFilePath, lines.join('\n'), 'utf8');

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

      const localFileStat = await stat(localFilePath);

      if (!localFileStat.isFile()) {
        this.logger.error('Local cleanup path is not a file');
        return;
      }

      await unlink(localFilePath);
    } catch (e: unknown) {
      this.logger.error('Anvil agent edit cleanup failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
    }
  }
}
