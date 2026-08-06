import { Injectable, Logger } from '@nestjs/common';
import { isAbsolute } from 'path';
import { SshService } from 'src/ssh/ssh.service';
import {
  HISTORY_FILE_PATH,
  type HistoryEntryInput,
} from './anvil-history.types';

@Injectable()
export class AnvilHistoryService {
  private readonly logger = new Logger(AnvilHistoryService.name);

  constructor(private readonly sshService: SshService) {}

  async readHistory(projectId: string): Promise<string> {
    return await this.sshService.readProjectFile(projectId, HISTORY_FILE_PATH);
  }

  async appendHistoryEntry(
    projectId: string,
    entry: HistoryEntryInput,
  ): Promise<string> {
    const existing = await this.readHistory(projectId);
    const entryNumbers = [...existing.matchAll(/^## Entry (\d+)$/gm)].map(
      (match) => Number(match[1]),
    );
    const nextEntry = Math.max(0, ...entryNumbers) + 1;
    const separator = existing.endsWith('\n') ? '' : '\n';
    const files =
      entry.files
        .filter((file) => !isAbsolute(file) && !file.includes('/temp/'))
        .join(', ') || 'none';
    const sanitize = (value: string) =>
      value
        .replaceAll(process.cwd(), '[workspace]')
        .replace(
          /(?:^|\s)(?:\/[^\s]+\/temp\/[^\s]+|[A-Za-z]:\\[^\s]+\\temp\\[^\s]+)/g,
          ' [local-temp]',
        );
    const content = [
      `${separator}\n## Entry ${nextEntry}`,
      `[date] - ${new Date().toISOString()}`,
      `[subject] - ${sanitize(entry.subject)}`,
      `[changes made] - ${sanitize(entry.changesMade)}`,
      `[status] - ${entry.status}`,
      `[files] - ${files}`,
      `[actor] - ${entry.actor}`,
      '',
    ].join('\n');

    try {
      return await this.sshService.appendProjectFile(
        projectId,
        HISTORY_FILE_PATH,
        content,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to append history for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
