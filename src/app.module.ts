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
import { ChannelsModule } from './channels/channels.module';
import { SharedredisModule } from './sharedredis/sharedredis.module';
import { IntentModule } from './intent/intent.module';
import { ConversationModule } from './conversation/conversation.module';
import { JobModule } from './job/job.module';
import { ProjectModule } from './project/project.module';
import { AnvilAgentModule } from './anvil-agent/anvil-agent.module';
import { MastraSharedModule } from './mastra/mastra-shared.module';
import { AnvilAgentSupervisorModule } from './anvil-agent-supervisor/anvil-agent-supervisor.module';
import { AnvilAgentEditModule } from './anvil-agent-edit/anvil-agent-edit.module';
import { TestingUiModule } from './testing-ui/testing-ui.module';

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
    ChannelsModule,
    SharedredisModule,
    IntentModule,
    ConversationModule,
    JobModule,
    ProjectModule,
    AnvilAgentModule,
    AnvilAgentSupervisorModule,
    AnvilAgentEditModule,
    TestingUiModule,
    MastraSharedModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
