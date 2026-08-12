import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'path';
import type { STAGING_MANIFEST } from './anvil-agent-edit.types';

export const MAX_STAGED_FILE_COUNT = 500;
export const MAX_STAGED_BYTES = 256 * 1024 * 1024;

export type StagingWorkspace = {
  projectId: string;
  editRunId: string;
  rootPath: string;
  fileSizes: Map<string, number>;
  totalBytes: number;
};

export type AbandonedStagingManifest = {
  workspace: StagingWorkspace;
  manifest: STAGING_MANIFEST;
};

/**
 * Owns backend-local staging paths for a single edit run.
 *
 * This service deliberately does not know about workflow state or remote SSH
 * operations. It only provides an isolated, bounded, symlink-safe local root.
 */
@Injectable()
export class AnvilEditStagingService {
  private readonly logger = new Logger(AnvilEditStagingService.name);

  async createWorkspace(
    projectId: string,
    editRunId: string,
  ): Promise<StagingWorkspace> {
    this.assertSinglePathSegment(projectId, 'Project ID');
    this.assertSinglePathSegment(editRunId, 'Edit run ID');

    const tempRoot = resolve(process.cwd(), 'temp');
    await mkdir(tempRoot, { recursive: true });
    const realTempRoot = await realpath(tempRoot);
    const rootPath = join(realTempRoot, projectId, editRunId);

    await mkdir(rootPath, { recursive: true });
    const realRootPath = await realpath(rootPath);
    this.assertWithin(realTempRoot, realRootPath, 'Staging root');

    return {
      projectId,
      editRunId,
      rootPath: realRootPath,
      fileSizes: new Map<string, number>(),
      totalBytes: 0,
    };
  }

  async openWorkspace(
    projectId: string,
    editRunId: string,
    rootPath: string,
  ): Promise<StagingWorkspace> {
    this.assertSinglePathSegment(projectId, 'Project ID');
    this.assertSinglePathSegment(editRunId, 'Edit run ID');
    const realRootPath = await realpath(rootPath);
    const tempRoot = resolve(process.cwd(), 'temp');
    const realTempRoot = await realpath(tempRoot);
    this.assertWithin(realTempRoot, realRootPath, 'Staging root');
    const files = await this.collectWorkspaceFiles(realRootPath);
    const fileSizes = new Map<string, number>();
    let totalBytes = 0;
    for (const file of files) {
      const size = (await stat(file.localPath)).size;
      fileSizes.set(file.projectPath, size);
      totalBytes += size;
    }
    return {
      projectId,
      editRunId,
      rootPath: realRootPath,
      fileSizes,
      totalBytes,
    };
  }

  resolveProjectPath(workspace: StagingWorkspace, projectPath: string): string {
    const normalizedProjectPath = this.normalizeProjectPath(projectPath);
    const localPath = resolve(
      workspace.rootPath,
      ...normalizedProjectPath.split('/'),
    );
    this.assertWithin(workspace.rootPath, localPath, 'Project path');
    return localPath;
  }

  async writeFile(
    workspace: StagingWorkspace,
    projectPath: string,
    content: string | Uint8Array,
  ): Promise<string> {
    const localPath = this.resolveProjectPath(workspace, projectPath);
    await this.assertSafeTarget(workspace, localPath, false);
    await mkdir(dirname(localPath), { recursive: true });
    await this.assertSafeTarget(workspace, localPath, false);

    const bytes = Buffer.byteLength(content);
    await this.replaceAtomically(workspace, localPath, content, bytes);
    return localPath;
  }

  async copyFile(
    workspace: StagingWorkspace,
    projectPath: string,
    sourcePath: string,
  ): Promise<string> {
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error('Source staging file must be a regular file');
    }
    const content = await readFile(sourcePath);
    return await this.writeFile(workspace, projectPath, content);
  }

  async readFile(
    workspace: StagingWorkspace,
    projectPath: string,
  ): Promise<Buffer> {
    const localPath = this.resolveProjectPath(workspace, projectPath);
    await this.assertSafeTarget(workspace, localPath, true);
    return await readFile(localPath);
  }

  async deleteFile(
    workspace: StagingWorkspace,
    projectPath: string,
  ): Promise<void> {
    const localPath = this.resolveProjectPath(workspace, projectPath);
    await this.assertSafeTarget(workspace, localPath, true);
    const normalizedProjectPath = this.projectPathFromLocalPath(
      workspace,
      localPath,
    );
    const size =
      workspace.fileSizes.get(normalizedProjectPath) ??
      (await stat(localPath)).size;
    await unlink(localPath);
    workspace.fileSizes.delete(normalizedProjectPath);
    workspace.totalBytes -= size;
  }

  async refreshFileAccounting(
    workspace: StagingWorkspace,
    projectPath: string,
  ): Promise<void> {
    const localPath = this.resolveProjectPath(workspace, projectPath);
    await this.assertSafeTarget(workspace, localPath, true);
    const nextBytes = (await stat(localPath)).size;
    const previousBytes = workspace.fileSizes.get(projectPath) ?? 0;
    const nextTotalBytes = workspace.totalBytes - previousBytes + nextBytes;
    if (nextTotalBytes > MAX_STAGED_BYTES) {
      throw new Error(`Staging byte limit exceeded (${MAX_STAGED_BYTES})`);
    }
    workspace.fileSizes.set(projectPath, nextBytes);
    workspace.totalBytes = nextTotalBytes;
  }

  async cleanup(workspace: StagingWorkspace): Promise<void> {
    this.assertSinglePathSegment(workspace.projectId, 'Project ID');
    this.assertSinglePathSegment(workspace.editRunId, 'Edit run ID');
    const tempRoot = resolve(process.cwd(), 'temp');
    const realTempRoot = await realpath(tempRoot);
    const rootPath = resolve(workspace.rootPath);
    this.assertWithin(realTempRoot, rootPath, 'Staging root');
    await rm(rootPath, { recursive: true, force: true });
  }

  private async collectWorkspaceFiles(
    rootPath: string,
  ): Promise<Array<{ projectPath: string; localPath: string }>> {
    const result: Array<{ projectPath: string; localPath: string }> = [];
    const visit = async (currentPath: string): Promise<void> => {
      for (const entry of await readdir(currentPath, { withFileTypes: true })) {
        const localPath = join(currentPath, entry.name);
        if (entry.name === '.anvil-manifest.json') continue;
        if (entry.isDirectory()) {
          await visit(localPath);
        } else if (entry.isFile()) {
          result.push({
            projectPath: relative(rootPath, localPath).split(sep).join('/'),
            localPath,
          });
        }
      }
    };
    await visit(rootPath);
    return result;
  }

  async writeManifest(
    workspace: StagingWorkspace,
    manifest: Record<string, unknown>,
  ): Promise<void> {
    const manifestPath = join(workspace.rootPath, '.anvil-manifest.json');
    await this.assertSafeTarget(workspace, manifestPath, false);
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, manifestPath);
      this.logger.log({
        event: 'staging_manifest_updated',
        projectId: workspace.projectId,
        editRunId: workspace.editRunId,
        fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
      });
    } catch (error: unknown) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original manifest write failure.
      }
      throw error;
    }
  }

  async readManifest(workspace: StagingWorkspace): Promise<STAGING_MANIFEST> {
    const manifestPath = join(workspace.rootPath, '.anvil-manifest.json');
    await this.assertSafeTarget(workspace, manifestPath, true);
    return JSON.parse(await readFile(manifestPath, 'utf8')) as STAGING_MANIFEST;
  }

  /**
   * Finds manifests left by a worker that stopped after remote commit began.
   * Callers can use these durable manifests to perform compensating recovery.
   */
  async findAbandonedWorkspaces(
    maxAgeMs = 60 * 60 * 1000,
  ): Promise<AbandonedStagingManifest[]> {
    const tempRoot = resolve(process.cwd(), 'temp');
    let projectIds: string[];
    try {
      projectIds = await readdir(tempRoot);
    } catch {
      return [];
    }
    const realTempRoot = await realpath(tempRoot);
    const cutoff = Date.now() - maxAgeMs;
    const abandoned: AbandonedStagingManifest[] = [];
    for (const projectId of projectIds) {
      let editRunIds: string[];
      try {
        editRunIds = await readdir(join(tempRoot, projectId));
      } catch {
        continue;
      }
      for (const editRunId of editRunIds) {
        const rootPath = join(tempRoot, projectId, editRunId);
        const manifestPath = join(rootPath, '.anvil-manifest.json');
        try {
          const manifestStat = await stat(manifestPath);
          if (manifestStat.mtimeMs > cutoff) continue;
          const realRootPath = await realpath(rootPath);
          this.assertWithin(realTempRoot, realRootPath, 'Staging root');
          const workspace = {
            projectId,
            editRunId,
            rootPath: realRootPath,
            fileSizes: new Map<string, number>(),
            totalBytes: 0,
          } satisfies StagingWorkspace;
          abandoned.push({
            workspace,
            manifest: await this.readManifest(workspace),
          });
        } catch {
          // Ignore partial directories and malformed manifests. The active
          // workflow remains responsible for reporting its own failure.
        }
      }
    }
    return abandoned;
  }

  private async replaceAtomically(
    workspace: StagingWorkspace,
    localPath: string,
    content: string | Uint8Array,
    nextBytes: number,
  ): Promise<void> {
    const projectPath = this.projectPathFromLocalPath(workspace, localPath);
    const previousBytes = workspace.fileSizes.get(projectPath) ?? 0;
    const isNewFile = !workspace.fileSizes.has(projectPath);
    const nextTotalBytes = workspace.totalBytes - previousBytes + nextBytes;

    if (isNewFile && workspace.fileSizes.size >= MAX_STAGED_FILE_COUNT) {
      throw new Error(`Staging file limit exceeded (${MAX_STAGED_FILE_COUNT})`);
    }
    if (nextTotalBytes > MAX_STAGED_BYTES) {
      throw new Error(`Staging byte limit exceeded (${MAX_STAGED_BYTES})`);
    }

    const temporaryPath = `${localPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { flag: 'wx' });
      await rename(temporaryPath, localPath);
      workspace.fileSizes.set(projectPath, nextBytes);
      workspace.totalBytes = nextTotalBytes;
    } catch (error: unknown) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original staging failure.
      }
      throw error;
    }
  }

  private async assertSafeTarget(
    workspace: StagingWorkspace,
    localPath: string,
    requireFile: boolean,
  ): Promise<void> {
    const rootPath = await realpath(workspace.rootPath);
    this.assertWithin(rootPath, resolve(localPath), 'Local staging path');

    const relativePath = relative(rootPath, resolve(localPath));
    let currentPath = rootPath;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      currentPath = join(currentPath, segment);
      try {
        const currentStat = await lstat(currentPath);
        if (currentStat.isSymbolicLink()) {
          throw new Error('Staging paths must not contain symbolic links');
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          break;
        }
        throw error;
      }
    }

    try {
      const targetStat = await lstat(localPath);
      if (targetStat.isSymbolicLink()) {
        throw new Error('Staging paths must not contain symbolic links');
      }
      if (requireFile && !targetStat.isFile()) {
        throw new Error('Staging path must point to a regular file');
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      if (requireFile) {
        throw new Error('Staging file does not exist');
      }
    }
  }

  private projectPathFromLocalPath(
    workspace: StagingWorkspace,
    localPath: string,
  ): string {
    const projectPath = relative(
      resolve(workspace.rootPath),
      resolve(localPath),
    );
    return projectPath.split(sep).join('/');
  }

  private normalizeProjectPath(projectPath: string): string {
    if (!projectPath.trim()) {
      throw new Error('Project path is not provided');
    }
    const normalizedPath = posix.normalize(projectPath.replaceAll('\\', '/'));
    if (
      posix.isAbsolute(normalizedPath) ||
      normalizedPath === '.' ||
      normalizedPath === '..' ||
      normalizedPath.split('/').includes('..')
    ) {
      throw new Error('Project path must remain inside the staging workspace');
    }
    return normalizedPath;
  }

  private assertSinglePathSegment(value: string, label: string): void {
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

  private assertWithin(
    rootPath: string,
    targetPath: string,
    label: string,
  ): void {
    const root = resolve(rootPath);
    const target = resolve(targetPath);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`${label} must remain inside the allowed root`);
    }
  }
}
