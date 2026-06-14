import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { LlmModule } from './llm/llm.module';
import { SshModule } from './ssh/ssh.module';
import { CodeGenModule } from './code-gen/code-gen.module';
import { BullModule } from '@nestjs/bullmq';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { CoreModule } from './core/core.module';

/**
 * Fix update flow [DONE]
 * Need to work on statuses for the preview flow, build flow
 * Need to work on the code loop generation.
 * Multi folder generation.
 * A user can:
 * 1. Create a project from a prompt.
 * 2. Receive projectId/buildId/jobId.
 * 3. Poll build status.
 * 4. Open dynamic preview URL.
 * 5. Send edit request using projectId.
 * 6. System loads App.tsx from DB.
 * 7. LLM updates App.tsx.
 * 8. System rebuilds preview on dynamic port.
 * 9. Build logs/status/preview URL are stored in DB.
 **/
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 0,
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LlmModule,
    SshModule,
    CodeGenModule,
    DbModule,
    AuthModule,
    UserModule,
    CoreModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
