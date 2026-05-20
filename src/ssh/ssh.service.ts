import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'fs';
import { AppEnv } from '../config/env.validation';

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

      if (result.stderr) {
        throw new Error(result.stderr);
      }

      return result.stdout;
    } catch (e: unknown) {
      console.error('SSH command failed:', e);
      throw e;
    } finally {
      ssh.dispose();
    }
  }
}
