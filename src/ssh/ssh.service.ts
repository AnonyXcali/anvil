import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
import { AppEnv } from '../config/env.validation';

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

  async runPreviewBuild(): Promise<RemoteStepResult[]> {
    const sshNode = new NodeSSH();
    const steps: RemoteStepResult[] = [];

    //need to store the run in database

    //need to dynamically generate uuid for each build
    const buildId = 'abc123';

    //pass build id here
    const baseDir = `/mnt/preview-data/preview-platform/builds/${buildId}`;

    //pass build id here
    const imageName = `preview-${buildId}`;

    //pass build id here
    const containerName = `preview-${buildId}`;

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

function App() {
  return (
    <main className="page">
      <h1>Hello from automated preview</h1>
      <p>This was built by the BullMQ worker.</p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
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

      steps.push(
        await this.runStep(
          sshNode,
          'health-check-preview',
          `curl -f http://127.0.0.1:3000`,
        ),
      );

      return steps;
    } finally {
      sshNode.dispose();
    }
  }
}
