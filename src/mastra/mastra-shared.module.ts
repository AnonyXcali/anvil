import { Global, Module } from '@nestjs/common';
import { MastraModule, type MastraModuleOptions } from '@mastra/nestjs';
import { createMastra } from './index';
import { AnvilAgentSearchModule } from 'src/anvil-agent/anvil-agent-search.module';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import { AnvilAgentEditModule } from 'src/anvil-agent-edit/anvil-agent-edit.module';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { AnvilEditStagingService } from 'src/anvil-agent-edit/anvil-edit-staging.service';
import { AnvilHistoryModule } from 'src/anvil-history/anvil-history.module';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from 'src/config/env.validation';
import { DbModule } from 'src/db/db.module';
import { AnvilRepairStateService } from 'src/anvil-agent-edit/anvil-repair-state.service';

@Global()
@Module({
  imports: [
    AnvilHistoryModule,
    DbModule,
    MastraModule.registerAsync({
      imports: [
        AnvilAgentSearchModule,
        AnvilAgentEditModule,
        AnvilHistoryModule,
      ],
      useFactory: async (
        anvilAgentSearchService: AnvilAgentSearchService,
        anvilAgentEditService: AnvilAgentEditService,
        anvilEditStagingService: AnvilEditStagingService,
        anvilHistoryService: AnvilHistoryService,
        anvilRepairStateService: AnvilRepairStateService,
        configService: ConfigService<AppEnv, true>,
      ): Promise<MastraModuleOptions> => ({
        prefix: '/api',
        mastra: await createMastra({
          anvilAgentSearchService,
          anvilAgentEditService,
          anvilEditStagingService,
          anvilHistoryService,
          anvilRepairStateService,
          env: {
            MASTRA_DATABASE_URL: configService.get('MASTRA_DATABASE_URL', {
              infer: true,
            }),
            EXA_KEY: configService.get('EXA_KEY', { infer: true }),
            FIRECRAWL_KEY: configService.get('FIRECRAWL_KEY', { infer: true }),
            LIGHTPANDA_KEY: configService.get('LIGHTPANDA_KEY', {
              infer: true,
            }),
            LIGHTPANDA_ENDPOINT: configService.get('LIGHTPANDA_ENDPOINT', {
              infer: true,
            }),
          },
        }),
      }),
      inject: [
        AnvilAgentSearchService,
        AnvilAgentEditService,
        AnvilEditStagingService,
        AnvilHistoryService,
        AnvilRepairStateService,
        ConfigService,
      ],
    }),
  ],
  exports: [MastraModule],
})
export class MastraSharedModule {}
