import { Injectable, Logger } from '@nestjs/common';
import { isAbsolute } from 'path';
import { SshService } from 'src/ssh/ssh.service';
import {
  HISTORY_FILE_PATH,
  BUGS_FILE_PATH,
  type HistoryEntryInput,
} from './anvil-history.types';

@Injectable()
export class AnvilHistoryService {
  private readonly logger = new Logger(AnvilHistoryService.name);

  constructor(private readonly sshService: SshService) {}

  async readHistory(projectId: string): Promise<string> {
    return await this.sshService.readProjectFile(projectId, HISTORY_FILE_PATH);
  }

  async readBugs(projectId: string): Promise<string> {
    return await this.sshService.readProjectFile(projectId, BUGS_FILE_PATH);
  }

  async appendBugEntry(projectId: string, content: string): Promise<string> {
    if (!content.trim() || content.includes('\u0000')) {
      throw new Error('Bug entry must contain safe non-empty content');
    }
    const bugId = content.match(/^## (BUG-[A-Z0-9-]+)$/m)?.[1];
    if (!bugId) {
      return await this.sshService.appendProjectFile(
        projectId,
        BUGS_FILE_PATH,
        content.endsWith('\n') ? content : `${content}\n`,
      );
    }
    const existing = await this.readBugs(projectId);
    const normalized = content.endsWith('\n') ? content : `${content}\n`;
    const blocks = existing.split(/(?=^## BUG-[^\n]+$)/m);
    const index = blocks.findIndex((block) =>
      new RegExp(`^## ${bugId}$`, 'm').test(block),
    );
    if (index >= 0) blocks[index] = normalized;
    else blocks.push(normalized);
    return await this.sshService.replaceProjectFile(
      projectId,
      BUGS_FILE_PATH,
      blocks.join(''),
    );
  }

  async removeBugEntry(projectId: string, bugId: string): Promise<string> {
    if (!/^BUG-[A-Z0-9-]+$/.test(bugId)) {
      throw new Error('Invalid bug ID');
    }
    const content = await this.readBugs(projectId);
    const blocks = content.split(/(?=^## BUG-[^\n]+$)/m);
    const next = blocks
      .filter((block) => !new RegExp(`^## ${bugId}$`, 'm').test(block))
      .join('');
    if (next === content) return content;
    return await this.sshService.replaceProjectFile(
      projectId,
      BUGS_FILE_PATH,
      next,
    );
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
      ...(entry.bugId ? [`[bug_id] - ${entry.bugId}`] : []),
      ...(entry.milestoneId ? [`[milestone_id] - ${entry.milestoneId}`] : []),
      ...(entry.validator ? [`[validator] - ${entry.validator}`] : []),
      ...(entry.originatingRunId
        ? [`[originating_run_id] - ${entry.originatingRunId}`]
        : []),
      ...(entry.repairRunId ? [`[repair_run_id] - ${entry.repairRunId}`] : []),
      ...(entry.attempt !== undefined ? [`[attempt] - ${entry.attempt}`] : []),
      ...(entry.classification
        ? [`[classification] - ${entry.classification}`]
        : []),
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
