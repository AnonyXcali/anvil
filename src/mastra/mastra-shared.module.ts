import { Global, Module } from '@nestjs/common';
import { MastraModule, type MastraModuleOptions } from '@mastra/nestjs';
import { createMastra } from './index';
import { AnvilAgentSearchModule } from 'src/anvil-agent/anvil-agent-search.module';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import { AnvilAgentEditModule } from 'src/anvil-agent-edit/anvil-agent-edit.module';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { AnvilHistoryModule } from 'src/anvil-history/anvil-history.module';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from 'src/config/env.validation';

@Global()
@Module({
  imports: [
    AnvilHistoryModule,
    MastraModule.registerAsync({
      imports: [
        AnvilAgentSearchModule,
        AnvilAgentEditModule,
        AnvilHistoryModule,
      ],
      useFactory: async (
        anvilAgentSearchService: AnvilAgentSearchService,
        anvilAgentEditService: AnvilAgentEditService,
        anvilHistoryService: AnvilHistoryService,
        configService: ConfigService<AppEnv, true>,
      ): Promise<MastraModuleOptions> => ({
        prefix: '/api',
        mastra: await createMastra({
          anvilAgentSearchService,
          anvilAgentEditService,
          anvilHistoryService,
          env: {
            EXA_KEY: configService.get('EXA_KEY', { infer: true }),
            FIRECRAWL_KEY: configService.get('FIRECRAWL_KEY', { infer: true }),
            LIGHTPANDA_KEY: configService.get('LIGHTPANDA_KEY', {
              infer: true,
            }),
            LIGHTPANDA_ENDPOINT: configService.get('LIGHTPANDA_ENDPOINT', {
              infer: true,
            }),
          },
          conversationModel: `openai/${configService.getOrThrow(
            'OPENAI_MODEL',
            {
              infer: true,
            },
          )}`,
        }),
      }),
      inject: [
        AnvilAgentSearchService,
        AnvilAgentEditService,
        AnvilHistoryService,
        ConfigService,
      ],
    }),
  ],
  exports: [MastraModule],
})
export class MastraSharedModule {}
