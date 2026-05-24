import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
import { AppEnv } from '../config/env.validation';
import { DbService } from '../db/db.service';

// type ProjectFileRow = {
//   id: string;
//   project_id: string;
//   path: string;
//   content: string;
// };

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
  constructor(
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly dbService: DbService,
  ) {}

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

    if (result.code !== 0) {
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

  async runPreviewBuild(
    appTsx: string,
    buildId: string,
    imageName: string,
    containerName: string,
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

      steps.push(
        await this.runStep(
          sshNode,
          'delete-old-create-new-folder',
          `rm -rf "${baseDir}" && mkdir -p "${baseDir}/src"`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-package-json-file',
          `cat > "${baseDir}/package.json" <<'EOF'
{
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "typescript": "latest",
    "react": "latest",
    "react-dom": "latest",
    "serve": "latest"
  },
  "devDependencies": {}
}
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-index-html-file',
          `cat > "${baseDir}/index.html" <<'EOF'
<!doctype html>
<html>
  <head>
    <title>React Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-main-tsx-file',
          `cat > "${baseDir}/src/main.tsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
<React.StrictMode>
  <App />
</React.StrictMode>
);
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-app-tsx-file',
          `cat > "${baseDir}/src/App.tsx" <<'EOF'
${appTsx}
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-css-file',
          `cat > "${baseDir}/src/style.css" <<'EOF'
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #111827;
  color: white;
}

.page {
  min-height: 100vh;
  display: grid;
  place-content: center;
  text-align: center;
}
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'create-dockerfile',
          `cat > "${baseDir}/Dockerfile" <<'EOF'
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
EOF`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'verify-files',
          `ls -la "${baseDir}" && ls -la "${baseDir}/src" && test -f "${baseDir}/Dockerfile" && test -f "${baseDir}/package.json"`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'docker-build-image',
          `docker build -t "${imageName}" "${baseDir}"`,
        ),
      );

      //TODO: fix it this breaks
      steps.push(
        await this.runStep(
          sshNode,
          'remove-old-container',
          `docker rm -f "${containerName}" || true`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'run-preview-container',
          `docker run -d --name "${containerName}" -p 3000:3000 "${imageName}"`,
        ),
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

  /**
   *
   * @param appTsx
   * Connect to the instance
   * Update the file
   * Rebuild the image
   * Stop the container
   * Start the new build
   * Serve
   */

  async updateFile(appTsx: string) {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];
    const buildId = 'abc123';
    const baseDir = `/mnt/preview-data/preview-platform/builds/${buildId}`;

    try {
      //connect to the instance
      await sshNode.connect({
        host: process.env.SSH_HOST!,
        port: Number(process.env.SSH_PORT ?? 22),
        username: process.env.SSH_USERNAME!,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH!, 'utf8'),
      });

      //Update the file
      steps.push(
        await this.runStep(
          sshNode,
          'create-app-tsx-file',
          `cat > "${baseDir}/src/App.tsx" <<'EOF'
${appTsx}
EOF`,
        ),
      );

      //build
      const imageName = `preview-${buildId}`;

      steps.push(
        await this.runStep(
          sshNode,
          'docker-build-image',
          `docker build -t "${imageName}" "${baseDir}"`,
        ),
      );

      //Stop the container
      const containerName = `preview-${buildId}`;

      steps.push(
        await this.runStep(
          sshNode,
          'remove-old-container',
          `docker rm -f "${containerName}" || true`,
        ),
      );

      steps.push(
        await this.runStep(
          sshNode,
          'run-preview-container',
          `docker run -d --name "${containerName}" -p 3000:3000 "${imageName}"`,
        ),
      );

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
      );
      return result.stdout;
    } finally {
      sshNode.dispose();
    }
  }
}
