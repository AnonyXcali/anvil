import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
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
