import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
import { mkdir, readFile, realpath, stat } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { dirname, join, posix, resolve, sep } from 'path';
import { AppEnv } from '../config/env.validation';
import { getDockerBuildCommands } from './constants/dockerBuild.constants';
import { getDockerServeCommands } from './constants/dockerServe.constants';
import { getScaffoldCommands } from './constants/scaffolding.constants';
import { getDockerOperationalCommands } from './constants/dockerOperations.constants';
import { TOOL_REQUEST_SHAPE } from 'src/anvil-agent/anvil-agent.types';
import {
  buildContentSearchCommand,
  buildExpandContextCommand,
  buildFileSearchCommand,
} from './constants/searchToolCmds.constants';
import { buildRegexPattern } from 'src/utils';
import { ToolExecutionContext } from '@mastra/core/tools';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';

//TODO: move this to types
type RemoteStepResult = {
  step: string;
  stdout: string;
  stderr: string;
  code: number | null;
};

/**
 * Make a simple loop
 * - generate file
 * -
 */

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  private validateProjectId(projectId: string): void {
    if (!projectId.trim()) {
      throw new Error('Project ID is not provided');
    }

    if (projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Project ID must be a single folder name');
    }
  }

  private validateSinglePathSegment(value: string, label: string): void {
    if (
      !value.trim() ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\')
    ) {
      throw new Error(`${label} must be a single path segment`);
    }
  }

  private normalizeProjectRelativePath(
    projectRelativePath: string,
    label: string,
  ): string {
    if (!projectRelativePath.trim()) {
      throw new Error(`${label} is not provided`);
    }

    const normalizedPath = posix.normalize(
      projectRelativePath.replaceAll('\\', '/'),
    );

    if (posix.isAbsolute(normalizedPath)) {
      throw new Error(`${label} must be project-relative`);
    }

    if (
      normalizedPath === '.' ||
      normalizedPath === '..' ||
      normalizedPath.startsWith(`..${posix.sep}`) ||
      normalizedPath.split(posix.sep).includes('..')
    ) {
      throw new Error(`${label} cannot traverse outside the project workspace`);
    }

    return normalizedPath;
  }

  private getProjectWorkspaceDir(projectId: string): string {
    return `/mnt/preview-data/preview-platform/workspaces/${projectId}`;
  }

  private shellQuote(value: string): string {
    return `'${value.replaceAll(`'`, `'\\''`)}'`;
  }

  async sshConnect() {
    const ssh = new NodeSSH();
    const privateKey = readFileSync(
      this.configService.getOrThrow<string>('SSH_PRIVATE_KEY_PATH', {
        infer: true,
      }),
      'utf-8',
    );

    try {
      await ssh.connect({
        host: this.configService.getOrThrow<string>('SSH_HOST', {
          infer: true,
        }),
        port: this.configService.getOrThrow<number>('SSH_PORT'),
        username: this.configService.getOrThrow<string>('SSH_USERNAME', {
          infer: true,
        }),
        privateKey,
        readyTimeout: 10_000,
      });
      console.log('Connected!');
    } catch (e: unknown) {
      //TODO: FIX THIS FAILS INSIDE THE WORKER
      console.error('SSH command failed:', e);
      throw e;
    } finally {
      ssh.dispose();
    }
  }

  async runStep(
    sshNode: NodeSSH,
    step: string,
    command: string,
    config: {
      allowedExitCodes?: number[];
    } = {},
  ): Promise<RemoteStepResult> {
    console.log(`==== Executing step: ${step} ====`);

    const result = await sshNode.execCommand(command);

    const stepResult: RemoteStepResult = {
      step,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code ?? null,
    };

    console.log(`==== Finished step: ${step} ====`, stepResult);

    const allowedExitCodes = config.allowedExitCodes ?? [0];

    if (!allowedExitCodes.includes(result.code ?? 0)) {
      throw new Error(
        [
          `Step failed: ${step}`,
          `Exit code: ${result.code}`,
          result.stderr,
          result.stdout,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    return stepResult;
  }

  async runCommand(command: string) {
    const ssh = new NodeSSH();
    const privateKey = readFileSync(
      this.configService.getOrThrow<string>('SSH_PRIVATE_KEY_PATH', {
        infer: true,
      }),
      'utf-8',
    );

    try {
      await ssh.connect({
        host: this.configService.getOrThrow<string>('SSH_HOST', {
          infer: true,
        }),
        port: this.configService.getOrThrow<number>('SSH_PORT'),
        username: this.configService.getOrThrow<string>('SSH_USERNAME', {
          infer: true,
        }),
        privateKey,
        readyTimeout: 10_000,
      });

      const result = await ssh.execCommand(command);

      if (result.code !== 0) {
        throw new Error(
          [
            `SSH command failed with exit code ${result.code}`,
            result.stderr,
            result.stdout,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }

      return result.stdout;
    } catch (e: unknown) {
      console.error('SSH command failed:', e);
      throw e;
    } finally {
      ssh.dispose();
    }
  }

  async previewBuild(
    port: number,
    imageName: string,
    containerName: string,
    projectId: string,
  ) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const workspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      steps.push(...(await this.scaffolding(sshNode, workspaceDir)));

      steps.push(
        ...(await this.dockerServe(
          sshNode,
          workspaceDir,
          imageName,
          containerName,
          port,
        )),
      );
      return steps;
    } finally {
      sshNode.dispose();
    }
  }

  async runnerBuild(
    port: number,
    appTsx: string,
    imageName: string,
    containerName: string,
    projectId: string,
  ) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    //TODO: can move outside
    const workspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      steps.push(...(await this.scaffolding(sshNode, workspaceDir)));

      steps.push(
        await this.runStep(
          sshNode,
          'create-app-tsx-file',
          `cat > "${workspaceDir}/src/App.tsx" <<'EOF'
${appTsx}
EOF`,
          {},
        ),
      );

      steps.push(
        ...(await this.dockerServe(
          sshNode,
          workspaceDir,
          imageName,
          containerName,
          port,
        )),
      );
      return steps;
    } finally {
      sshNode.dispose();
    }
  }

  async dockerBuild(
    sshNode: NodeSSH,
    baseDir: string,
    imageName: string,
    containerName: string,
    port: number,
  ) {
    const steps: RemoteStepResult[] = [];
    const commands = getDockerBuildCommands(
      baseDir,
      imageName,
      containerName,
      port,
    );

    steps.push(
      await this.runStep(
        sshNode,
        'create-dockerfile',
        commands.createDockerfile,
        {},
      ),
    );

    steps.push(
      await this.runStep(sshNode, 'verify-files', commands.verifyFiles, {}),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'docker-build-image',
        commands.dockerBuildImage,
        {},
      ),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'remove-old-container',
        commands.removeOldContainer,
        {},
      ),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'run-preview-container',
        commands.runPreviewContainer,
        {},
      ),
    );

    return steps;
  }

  async dockerServe(
    sshNode: NodeSSH,
    workspaceDir: string,
    imageName: string,
    containerName: string,
    port: number,
  ) {
    const steps: RemoteStepResult[] = [];
    const commands = getDockerServeCommands(
      workspaceDir,
      imageName,
      containerName,
      port,
      process.env.SSH_HOST,
    );

    steps.push(
      await this.runStep(
        sshNode,
        'create-dockerfile',
        commands.createDockerfile,
        {},
      ),
    );

    steps.push(
      await this.runStep(sshNode, 'verify-files', commands.verifyFiles, {}),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'build-preview-image',
        commands.buildPreviewImage,
        {},
      ),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'remove-existing-container',
        commands.removeExistingContainer,
        {},
      ),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'run-preview-container',
        commands.runPreviewContainer,
        {},
      ),
    );

    steps.push(
      await this.runStep(
        sshNode,
        'preview-url-log',
        commands.previewUrlLog,
        {},
      ),
    );

    return steps;
  }

  //TODO: UTIL CLASS
  async scaffolding(sshNode: NodeSSH, baseDir: string) {
    const steps: RemoteStepResult[] = [];
    const commands = getScaffoldCommands(baseDir);

    steps.push(
      await this.runStep(
        sshNode,
        'create-workspace',
        commands.copyTemplateProject,
        {},
      ),
    );

    return steps;
  }

  //TODO: Duplicated Code need to refactor this file
  //SERVICE
  async runPreviewBuild(
    appTsx: string,
    buildId: string,
    imageName: string,
    containerName: string,
    port: number,
    //need project id passed.
  ): Promise<RemoteStepResult[]> {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const baseDir = `/mnt/preview-data/preview-platform/builds/${buildId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      steps.push(...(await this.scaffolding(sshNode, baseDir)));

      steps.push(
        await this.runStep(
          sshNode,
          'create-app-tsx-file',
          `cat > "${baseDir}/src/App.tsx" <<'EOF'
${appTsx}
EOF`,
          {},
        ),
      );

      steps.push(
        ...(await this.dockerBuild(
          sshNode,
          baseDir,
          imageName,
          containerName,
          port,
        )),
      );

      //TODO: buggy causes the job to fail
      // steps.push(
      //   await this.runStep(
      //     sshNode,
      //     'health-check-preview',
      //     `curl -f http://127.0.0.1:3000`,
      //   ),
      // );

      return steps;
    } finally {
      sshNode.dispose();
    }
  }

  //TODO: Duplicated Code need to refactor this file
  //SERVICE
  async updateFile(appTsx: string, projectId: string) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const baseDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      //connect to the instance
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      //add the new file
      steps.push(
        await this.runStep(
          sshNode,
          'create-app-tsx-file',
          `cat > "${baseDir}/src/App.tsx" <<'EOF'
${appTsx}
EOF`,
          {},
        ),
      );

      console.log('done');

      return steps;
    } finally {
      sshNode.dispose();
    }
  }

  async downloadProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<{ remoteFilePath: string; localFilePath: string; hash: string }> {
    if (!projectId) {
      throw new Error('Project ID is not provided');
    }

    if (projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Project ID must be a single folder name');
    }

    if (!filePath.trim()) {
      throw new Error('File path is not provided');
    }

    const normalizedFilePath = posix.normalize(filePath.replaceAll('\\', '/'));

    if (posix.isAbsolute(normalizedFilePath)) {
      throw new Error('File path must be project-relative');
    }

    if (
      normalizedFilePath === '.' ||
      normalizedFilePath === '..' ||
      normalizedFilePath.startsWith(`..${posix.sep}`) ||
      normalizedFilePath.split(posix.sep).includes('..')
    ) {
      throw new Error(
        'File path cannot traverse outside the project workspace',
      );
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;
    const remoteFilePath = posix.join(remoteWorkspaceDir, normalizedFilePath);
    const localFilePath = join(
      process.cwd(),
      'temp',
      projectId,
      normalizedFilePath,
    );

    try {
      await mkdir(dirname(localFilePath), { recursive: true });

      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'verify-download-source-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      await sshNode.getFile(localFilePath, remoteFilePath);

      const downloadedFileStat = await stat(localFilePath);

      if (!downloadedFileStat.isFile()) {
        throw new Error('Downloaded local path is not a file');
      }

      const buffer = await readFile(localFilePath);
      const hash = createHash('sha256').update(buffer).digest('hex');

      return {
        remoteFilePath,
        localFilePath,
        hash,
      };
    } catch (e: unknown) {
      this.logger.error('Project file download failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async readLocalFile(
    path: string,
    line_range?: { start: number; end: number },
  ): Promise<string> {
    if (!path.trim()) {
      throw new Error('Local file path is not provided');
    }

    const tempRoot = resolve(process.cwd(), 'temp');
    const resolvedPath = resolve(path);
    const realTempRoot = await realpath(tempRoot);

    if (
      resolvedPath !== tempRoot &&
      !resolvedPath.startsWith(`${tempRoot}${sep}`)
    ) {
      throw new Error('Local file path must be inside the temp directory');
    }

    const localFileStat = await stat(resolvedPath);
    const realLocalPath = await realpath(resolvedPath);

    if (!localFileStat.isFile()) {
      throw new Error('Local path is not a file');
    }

    if (
      realLocalPath !== realTempRoot &&
      !realLocalPath.startsWith(`${realTempRoot}${sep}`)
    ) {
      throw new Error('Local file path must resolve inside the temp directory');
    }

    const content = await readFile(realLocalPath, 'utf8');

    if (!line_range) {
      return content;
    }

    if (
      !Number.isFinite(line_range.start) ||
      !Number.isFinite(line_range.end)
    ) {
      throw new Error('Line range start and end must be finite numbers');
    }

    if (
      !Number.isInteger(line_range.start) ||
      !Number.isInteger(line_range.end)
    ) {
      throw new Error('Line range start and end must be integers');
    }

    if (line_range.start <= 0 || line_range.end <= 0) {
      throw new Error('Line range start and end must be positive numbers');
    }

    if (line_range.start > line_range.end) {
      throw new Error('Line range start must be less than or equal to end');
    }

    const lines = content.split('\n');
    const startIndex = line_range.start - 1;
    const endIndex = Math.min(line_range.end, lines.length);

    return lines.slice(startIndex, endIndex).join('\n');
  }

  async backupProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    if (!projectId) {
      throw new Error('Project ID is not provided');
    }

    if (projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Project ID must be a single folder name');
    }

    if (!filePath.trim()) {
      throw new Error('File path is not provided');
    }

    const normalizedFilePath = posix.normalize(filePath.replaceAll('\\', '/'));

    if (posix.isAbsolute(normalizedFilePath)) {
      throw new Error('File path must be project-relative');
    }

    if (
      normalizedFilePath === '.' ||
      normalizedFilePath === '..' ||
      normalizedFilePath.startsWith(`..${posix.sep}`) ||
      normalizedFilePath.split(posix.sep).includes('..')
    ) {
      throw new Error(
        'File path cannot traverse outside the project workspace',
      );
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;
    const sourceDir = posix.dirname(normalizedFilePath);
    const sourceFileName = posix.basename(normalizedFilePath);
    const sourceExtension = posix.extname(sourceFileName);
    const sourceNameWithoutExtension = sourceExtension
      ? sourceFileName.slice(0, -sourceExtension.length)
      : sourceFileName;
    const backupFileName = sourceExtension
      ? `${sourceNameWithoutExtension}.${projectId}.backup${sourceExtension}`
      : `${sourceNameWithoutExtension}.${projectId}.backup`;
    const backupFilePath =
      sourceDir === '.'
        ? backupFileName
        : posix.join(sourceDir, backupFileName);
    const shellQuote = (value: string) => `'${value.replaceAll(`'`, `'\\''`)}'`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'backup-project-file',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `test -f ${shellQuote(normalizedFilePath)}`,
          `cp ${shellQuote(normalizedFilePath)} ${shellQuote(backupFilePath)}`,
          `test -f ${shellQuote(backupFilePath)}`,
        ].join(' && '),
        {},
      );

      return backupFilePath;
    } catch (e: unknown) {
      this.logger.error('Project file backup failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async getProjectFileState(
    projectId: string,
    filePath: string,
  ): Promise<{ exists: boolean; hash: string | null }> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'inspect-project-file-state',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `if test -L ${this.shellQuote(normalizedFilePath)}; then exit 2; elif test -f ${this.shellQuote(normalizedFilePath)}; then sha256sum ${this.shellQuote(normalizedFilePath)} | awk '{print $1}'; else printf '%s' '__MISSING__'; fi`,
        ].join(' && '),
        {},
      );
      const hash = result.stdout.trim().toLowerCase();
      return hash === '__missing__'
        ? { exists: false, hash: null }
        : { exists: true, hash };
    } finally {
      sshNode.dispose();
    }
  }

  async createCommitBackup(
    projectId: string,
    filePath: string,
    editRunId: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    this.validateSinglePathSegment(editRunId, 'Edit run ID');
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const backupFilePath = posix.join(
      '.anvil-backups',
      editRunId,
      normalizedFilePath,
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      await this.runStep(
        sshNode,
        'create-commit-backup',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `test ! -L ${this.shellQuote(normalizedFilePath)}`,
          `test ! -L ${this.shellQuote('.anvil-backups')}`,
          `mkdir -p -- ${this.shellQuote(posix.join('.anvil-backups', editRunId, posix.dirname(normalizedFilePath)))}`,
          `test ! -L ${this.shellQuote(posix.join('.anvil-backups', editRunId))}`,
          `cp -- ${this.shellQuote(normalizedFilePath)} ${this.shellQuote(backupFilePath)}`,
          `test -f ${this.shellQuote(backupFilePath)}`,
          `test ! -L ${this.shellQuote(backupFilePath)}`,
        ].join(' && '),
        {},
      );
      return backupFilePath;
    } finally {
      sshNode.dispose();
    }
  }

  async removeCommitBackup(
    projectId: string,
    backupPath: string,
    editRunId: string,
  ): Promise<void> {
    this.validateProjectId(projectId);
    this.validateSinglePathSegment(editRunId, 'Edit run ID');
    const normalizedBackupPath = this.normalizeProjectRelativePath(
      backupPath,
      'Backup file path',
    );
    const expectedPrefix = posix.join('.anvil-backups', editRunId) + '/';
    if (!normalizedBackupPath.startsWith(expectedPrefix)) {
      throw new Error('Backup path does not belong to the edit run');
    }
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      await this.runStep(
        sshNode,
        'remove-commit-backup',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test ! -L ${this.shellQuote(normalizedBackupPath)}`,
          `rm -f -- ${this.shellQuote(normalizedBackupPath)}`,
        ].join(' && '),
        {},
      );
    } finally {
      sshNode.dispose();
    }
  }

  async removeCreatedProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const remoteFilePath = posix.join(remoteWorkspaceDir, normalizedFilePath);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      await this.runStep(
        sshNode,
        'remove-created-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `test ! -L ${this.shellQuote(normalizedFilePath)}`,
          `rm -- ${this.shellQuote(normalizedFilePath)}`,
          `test ! -e ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );
      return remoteFilePath;
    } finally {
      sshNode.dispose();
    }
  }

  async removeEmptyCreatedDirectory(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFolderPath = this.normalizeProjectRelativePath(
      folderPath,
      'Folder path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const remoteFolderPath = posix.join(
      remoteWorkspaceDir,
      normalizedFolderPath,
    );

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      await this.runStep(
        sshNode,
        'remove-empty-created-directory',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -d ${this.shellQuote(normalizedFolderPath)}`,
          `test ! -L ${this.shellQuote(normalizedFolderPath)}`,
          `test -z "$(find ${this.shellQuote(normalizedFolderPath)} -mindepth 1 -maxdepth 1 -print -quit)"`,
          `rmdir -- ${this.shellQuote(normalizedFolderPath)}`,
          `test ! -e ${this.shellQuote(normalizedFolderPath)}`,
        ].join(' && '),
        {},
      );
      return remoteFolderPath;
    } finally {
      sshNode.dispose();
    }
  }

  async restoreProjectFile(
    projectId: string,
    backupFilePath: string,
    originalFilePath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedBackupPath = this.normalizeProjectRelativePath(
      backupFilePath,
      'Backup file path',
    );
    const normalizedOriginalPath = this.normalizeProjectRelativePath(
      originalFilePath,
      'Original file path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      await this.runStep(
        sshNode,
        'restore-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedBackupPath)}`,
          `test ! -L ${this.shellQuote(normalizedBackupPath)}`,
          `test ! -L ${this.shellQuote(normalizedOriginalPath)}`,
          `cp ${this.shellQuote(normalizedBackupPath)} ${this.shellQuote(normalizedOriginalPath)}`,
          `test -f ${this.shellQuote(normalizedOriginalPath)}`,
        ].join(' && '),
        {},
      );
      return normalizedOriginalPath;
    } finally {
      sshNode.dispose();
    }
  }

  async uploadProjectFile(
    projectId: string,
    localFilePath: string,
    originalFilePath: string,
    hash: string,
  ): Promise<string> {
    if (!projectId) {
      throw new Error('Project ID is not provided');
    }

    if (projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Project ID must be a single folder name');
    }

    if (!localFilePath.trim()) {
      throw new Error('Local file path is not provided');
    }

    if (!originalFilePath.trim()) {
      throw new Error('Original file path is not provided');
    }

    if (!hash.trim()) {
      throw new Error('Hash is not provided');
    }

    const tempRoot = resolve(process.cwd(), 'temp');
    const resolvedLocalPath = resolve(localFilePath);
    const realTempRoot = await realpath(tempRoot);
    const realLocalPath = await realpath(localFilePath);
    if (
      !resolvedLocalPath.startsWith(`${tempRoot}${sep}`) ||
      !realLocalPath.startsWith(`${realTempRoot}${sep}`)
    ) {
      throw new Error('Local file path must resolve inside the temp directory');
    }

    const localFileStat = await stat(realLocalPath);

    if (!localFileStat.isFile()) {
      throw new Error('Local file path must point to a file');
    }

    const normalizedOriginalFilePath = posix.normalize(
      originalFilePath.replaceAll('\\', '/'),
    );

    if (posix.isAbsolute(normalizedOriginalFilePath)) {
      throw new Error('Original file path must be project-relative');
    }

    if (
      normalizedOriginalFilePath === '.' ||
      normalizedOriginalFilePath === '..' ||
      normalizedOriginalFilePath.startsWith(`..${posix.sep}`) ||
      normalizedOriginalFilePath.split(posix.sep).includes('..')
    ) {
      throw new Error(
        'Original file path cannot traverse outside the project workspace',
      );
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;
    const remoteTargetDir = posix.dirname(normalizedOriginalFilePath);
    const remoteFilePath = posix.join(
      remoteWorkspaceDir,
      normalizedOriginalFilePath,
    );
    const shellQuote = (value: string) => `'${value.replaceAll(`'`, `'\\''`)}'`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'verify-upload-target-directory',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `test -d ${shellQuote(remoteTargetDir)}`,
        ].join(' && '),
        {},
      );

      await this.runStep(
        sshNode,
        'verify-upload-target-file',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `test -f ${shellQuote(normalizedOriginalFilePath)}`,
        ].join(' && '),
        {},
      );

      // Use remote sha256sum instead of cat/stdout hashing so both sides compare file bytes.
      // Security notes:
      // - normalizedOriginalFilePath is project-relative and rejects traversal before this command.
      // - shellQuote prevents command injection through unusual file names.
      // - sha256sum exposes only a digest, not file contents, which is safer than cat logging.
      // - test -f verifies the target is a regular file before hashing.
      const remoteFileHashResult = await this.runStep(
        sshNode,
        'hash-upload-target-file',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `sha256sum ${shellQuote(normalizedOriginalFilePath)} | awk '{print $1}'`,
        ].join(' && '),
        {},
      );
      const remoteFileHash = remoteFileHashResult.stdout.trim().toLowerCase();
      const expectedHash = hash.trim().toLowerCase();

      if (remoteFileHash !== expectedHash) {
        throw new Error(
          `Remote file hash does not match expected hash: expected ${expectedHash}, received ${remoteFileHash}`,
        );
      }

      await sshNode.putFile(realLocalPath, remoteFilePath);

      const localFinalHash = createHash('sha256')
        .update(await readFile(realLocalPath))
        .digest('hex');
      const uploadedHashResult = await this.runStep(
        sshNode,
        'verify-uploaded-project-file',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `test -f ${shellQuote(normalizedOriginalFilePath)}`,
          `sha256sum ${shellQuote(normalizedOriginalFilePath)} | awk '{print $1}'`,
        ].join(' && '),
        {},
      );
      if (uploadedHashResult.stdout.trim().toLowerCase() !== localFinalHash) {
        throw new Error(
          `Uploaded file hash does not match local staged content: ${normalizedOriginalFilePath}`,
        );
      }

      return remoteFilePath;
    } catch (e: unknown) {
      this.logger.error('Project file upload failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async deleteProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    if (!projectId) {
      throw new Error('Project ID is not provided');
    }

    if (projectId.includes('/') || projectId.includes('\\')) {
      throw new Error('Project ID must be a single folder name');
    }

    if (!filePath.trim()) {
      throw new Error('File path is not provided');
    }

    const normalizedFilePath = posix.normalize(filePath.replaceAll('\\', '/'));

    if (posix.isAbsolute(normalizedFilePath)) {
      throw new Error('File path must be project-relative');
    }

    if (
      normalizedFilePath === '.' ||
      normalizedFilePath === '..' ||
      normalizedFilePath.startsWith(`..${posix.sep}`) ||
      normalizedFilePath.split(posix.sep).includes('..')
    ) {
      throw new Error(
        'File path cannot traverse outside the project workspace',
      );
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;
    const remoteFilePath = posix.join(remoteWorkspaceDir, normalizedFilePath);
    const shellQuote = (value: string) => `'${value.replaceAll(`'`, `'\\''`)}'`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'delete-project-file',
        [
          `cd ${shellQuote(remoteWorkspaceDir)}`,
          `test -f ${shellQuote(normalizedFilePath)}`,
          `rm -- ${shellQuote(normalizedFilePath)}`,
          `test ! -e ${shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      return remoteFilePath;
    } catch (e: unknown) {
      this.logger.error('Project file delete failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async createProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const remoteFilePath = posix.join(remoteWorkspaceDir, normalizedFilePath);
    const remoteTargetDir = posix.dirname(normalizedFilePath);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'create-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -d ${this.shellQuote(remoteTargetDir)}`,
          `test ! -e ${this.shellQuote(normalizedFilePath)}`,
          `: > ${this.shellQuote(normalizedFilePath)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      return remoteFilePath;
    } catch (e: unknown) {
      this.logger.error('Project file create failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async createProjectFolder(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFolderPath = this.normalizeProjectRelativePath(
      folderPath,
      'Folder path',
    );

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const remoteFolderPath = posix.join(
      remoteWorkspaceDir,
      normalizedFolderPath,
    );
    const remoteParentDir = posix.dirname(normalizedFolderPath);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'create-project-folder',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -d ${this.shellQuote(remoteParentDir)}`,
          `test ! -e ${this.shellQuote(normalizedFolderPath)}`,
          `mkdir -- ${this.shellQuote(normalizedFolderPath)}`,
          `test -d ${this.shellQuote(normalizedFolderPath)}`,
        ].join(' && '),
        {},
      );

      return remoteFolderPath;
    } catch (e: unknown) {
      this.logger.error('Project folder create failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async verifyProjectFileExists(
    projectId: string,
    filePath: string,
  ): Promise<boolean> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'verify-project-file-exists',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        { allowedExitCodes: [0, 1] },
      );

      return result.code === 0;
    } catch (e: unknown) {
      this.logger.error('Project file verify failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async verifyProjectFolderExists(
    projectId: string,
    folderPath: string,
  ): Promise<boolean> {
    this.validateProjectId(projectId);
    const normalizedFolderPath = this.normalizeProjectRelativePath(
      folderPath,
      'Folder path',
    );

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'verify-project-folder-exists',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -d ${this.shellQuote(normalizedFolderPath)}`,
        ].join(' && '),
        { allowedExitCodes: [0, 1] },
      );

      return result.code === 0;
    } catch (e: unknown) {
      this.logger.error('Project folder verify failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async readProjectFileRange(
    projectId: string,
    filePath: string,
    lineRange: { startLine: number; endLine: number },
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );

    if (
      !Number.isFinite(lineRange.startLine) ||
      !Number.isFinite(lineRange.endLine)
    ) {
      throw new Error('Line range start and end must be finite numbers');
    }

    if (
      !Number.isInteger(lineRange.startLine) ||
      !Number.isInteger(lineRange.endLine)
    ) {
      throw new Error('Line range start and end must be integers');
    }

    if (lineRange.startLine <= 0 || lineRange.endLine <= 0) {
      throw new Error('Line range start and end must be positive numbers');
    }

    if (lineRange.startLine > lineRange.endLine) {
      throw new Error('Line range start must be less than or equal to end');
    }

    if (lineRange.endLine - lineRange.startLine + 1 > 200) {
      throw new Error('Read file line range cannot exceed 200 lines');
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const sedRange = `${lineRange.startLine},${lineRange.endLine}p`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'read-project-file-range',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `sed -n ${this.shellQuote(sedRange)} -- ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      return result.stdout;
    } catch (e: unknown) {
      this.logger.error('Project file read failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async readProjectFile(projectId: string, filePath: string): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'read-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `cat -- ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async findProjectFilesContaining(
    projectId: string,
    query: string,
  ): Promise<string[]> {
    this.validateProjectId(projectId);
    if (!query.trim()) {
      return [];
    }

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      const result = await this.runStep(
        sshNode,
        'find-project-files-containing',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `rg -l --glob '*.tsx' --glob '*.jsx' --fixed-strings -- ${this.shellQuote(query)} . || true`,
        ].join(' && '),
        {},
      );
      return result.stdout
        .split('\n')
        .map((filePath) => filePath.trim().replace(/^\.\//, ''))
        .filter(Boolean);
    } finally {
      sshNode.dispose();
    }
  }

  async appendProjectFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'append-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `printf '%s' ${this.shellQuote(encodedContent)} | base64 --decode >> ${this.shellQuote(normalizedFilePath)}`,
          `cat -- ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );

      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async replaceProjectFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFilePath = this.normalizeProjectRelativePath(
      filePath,
      'File path',
    );
    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const encodedContent = Buffer.from(content, 'utf8').toString('base64');

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });
      const temporaryPath = `${normalizedFilePath}.anvil-${randomUUID()}.tmp`;
      const result = await this.runStep(
        sshNode,
        'replace-project-file',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -f ${this.shellQuote(normalizedFilePath)}`,
          `printf '%s' ${this.shellQuote(encodedContent)} | base64 --decode > ${this.shellQuote(temporaryPath)}`,
          `mv -- ${this.shellQuote(temporaryPath)} ${this.shellQuote(normalizedFilePath)}`,
          `cat -- ${this.shellQuote(normalizedFilePath)}`,
        ].join(' && '),
        {},
      );
      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async deleteProjectFolder(
    projectId: string,
    folderPath: string,
  ): Promise<string> {
    this.validateProjectId(projectId);
    const normalizedFolderPath = this.normalizeProjectRelativePath(
      folderPath,
      'Folder path',
    );

    const sshNode = new NodeSSH();
    const remoteWorkspaceDir = this.getProjectWorkspaceDir(projectId);
    const remoteFolderPath = posix.join(
      remoteWorkspaceDir,
      normalizedFolderPath,
    );

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      await this.runStep(
        sshNode,
        'delete-project-folder',
        [
          `cd ${this.shellQuote(remoteWorkspaceDir)}`,
          `test -d ${this.shellQuote(normalizedFolderPath)}`,
          `test -z "$(find ${this.shellQuote(normalizedFolderPath)} -mindepth 1 -maxdepth 1 -print -quit)"`,
          `rmdir -- ${this.shellQuote(normalizedFolderPath)}`,
          `test ! -e ${this.shellQuote(normalizedFolderPath)}`,
        ].join(' && '),
        {},
      );

      return remoteFolderPath;
    } catch (e: unknown) {
      this.logger.error('Project folder delete failed');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async readFile(): Promise<string> {
    const sshNode = new NodeSSH();
    const buildId = 'abc123';

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const result = await this.runStep(
        sshNode,
        'read-file',
        `cat ../../mnt/preview-data/preview-platform/builds/${buildId}/src/App.tsx`,
        {},
      );

      if (result.code !== 0) {
        throw new Error('Container could not be stopped due to an error');
      }

      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async stopPreviewContainer(containerName: string) {
    const sshNode = new NodeSSH();

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const commands = getDockerOperationalCommands(containerName);

      const result = await this.runStep(
        sshNode,
        'stop-preview-container',
        commands.stopPreviewContainer,
        {},
      );
      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async startPreviewContainer(containerName: string) {
    const sshNode = new NodeSSH();

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      const commands = getDockerOperationalCommands(containerName);

      const result = await this.runStep(
        sshNode,
        'stop-preview-container',
        commands.startPreviewContainer,
        {},
      );
      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }

  async searchFile(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    context: ToolExecutionContext,
  ) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const baseDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      if (!projectId) {
        throw new Error('Project ID is not provided');
      }

      if (!request.query.keyword) {
        throw new Error('No keywords for file search provided');
      }

      const pattern = buildRegexPattern(request.query.keyword);

      const command = buildFileSearchCommand({
        pattern,
        workspacePath: baseDir,
      });

      await context?.writer?.custom({
        type: StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG,
        data: { line: `Searching for ${pattern} in ${baseDir}..` },
        transient: true,
      });

      steps.push(
        await this.runStep(sshNode, 'search-tool-search-files', command, {
          allowedExitCodes: [0, 1],
        }),
      );

      return steps;
    } catch (e: unknown) {
      this.logger.fatal('SEARCH TOOL FAILED');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async searchContent(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    context: ToolExecutionContext,
  ) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const baseDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      if (!projectId) {
        throw new Error('Project ID is not provided');
      }

      if (!request.query.keyword) {
        throw new Error('No keywords for content search provided');
      }

      if (
        !request.query.files_paths_for_content_search ||
        request.query.files_paths_for_content_search.length <= 0
      ) {
        throw new Error('No files for content search provided');
      }

      const pattern = buildRegexPattern(request.query.keyword);

      const filesSearchSpace = request.query.files_paths_for_content_search;

      await context?.writer?.custom({
        type: StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG,
        data: {
          line: `Searching for ${pattern} in ${baseDir}.., within ${filesSearchSpace.join(' ')}`,
        },
        transient: true,
      });

      const command = buildContentSearchCommand({
        pattern,
        workspacePath: baseDir,
        files: filesSearchSpace,
      });

      steps.push(
        await this.runStep(sshNode, 'search-tool-content-search', command, {
          allowedExitCodes: [0, 1],
        }),
      );

      return steps;
    } catch (e: unknown) {
      this.logger.fatal('CONTENT SEARCH TOOL FAILED');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }

  async expandFiles(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    context: ToolExecutionContext,
  ) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const baseDir = `/mnt/preview-data/preview-platform/workspaces/${projectId}`;

    try {
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      if (!projectId) {
        throw new Error('Project ID is not provided');
      }

      if (!request.query.files_path_for_expansion) {
        throw new Error('No file for expansive search provided');
      }

      if (
        !request.query.files_path_for_expansion.ranges ||
        request.query.files_path_for_expansion.ranges.length <= 0
      ) {
        throw new Error('File ranges are not provided');
      }

      //TODO: need to support multiple range
      const start = request.query.files_path_for_expansion.ranges[0].startLine;
      const end = request.query.files_path_for_expansion.ranges[0].endLine;
      const fileSearchSpace = request.query.files_path_for_expansion.file_name;

      const command = buildExpandContextCommand({
        workspacePath: baseDir,
        file: fileSearchSpace,
        range: {
          start,
          end,
        },
      });

      await context?.writer?.custom({
        type: StreamEventType.SEARCH_TOOL_EXPANSIVE_SEARCH_LOG,
        data: {
          line: `Searching in ${fileSearchSpace} with range ${start} : ${end}`,
        },
        transient: true,
      });

      steps.push(
        await this.runStep(
          sshNode,
          'search-tool-expansive-search',
          command,
          {},
        ),
      );

      return steps;
    } catch (e: unknown) {
      this.logger.fatal('EXPANSE TOOL FAILED');
      if (e instanceof Error) {
        this.logger.error(e.name);
        this.logger.error(e.message);
      }
      throw e;
    } finally {
      sshNode.dispose();
    }
  }
}
