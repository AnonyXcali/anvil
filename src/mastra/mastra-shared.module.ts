import { Global, Module } from '@nestjs/common';
import { MastraModule, type MastraModuleOptions } from '@mastra/nestjs';
import { createMastra } from './index';
import { AnvilAgentSearchModule } from 'src/anvil-agent/anvil-agent-search.module';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import { AnvilAgentEditModule } from 'src/anvil-agent-edit/anvil-agent-edit.module';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';

@Global()
@Module({
  imports: [
    MastraModule.registerAsync({
      imports: [AnvilAgentSearchModule, AnvilAgentEditModule],
      useFactory: async (
        anvilAgentSearchService: AnvilAgentSearchService,
        anvilAgentEditService: AnvilAgentEditService,
      ): Promise<MastraModuleOptions> => ({
        prefix: '/api',
        mastra: await createMastra({
          anvilAgentSearchService,
          anvilAgentEditService,
        }),
      }),
      inject: [AnvilAgentSearchService, AnvilAgentEditService],
    }),
  ],
  exports: [MastraModule],
})
export class MastraSharedModule {}
