import { Global, Module } from '@nestjs/common';
import { MastraModule, type MastraModuleOptions } from '@mastra/nestjs';
import { createMastra } from './index';
import { AnvilAgentSearchModule } from 'src/anvil-agent/anvil-agent-search.module';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';

@Global()
@Module({
  imports: [
    MastraModule.registerAsync({
      imports: [AnvilAgentSearchModule],
      useFactory: async (
        anvilAgentSearchService: AnvilAgentSearchService,
      ): Promise<MastraModuleOptions> => ({
        mastra: await createMastra({
          anvilAgentSearchService,
        }),
      }),
      inject: [AnvilAgentSearchService],
    }),
  ],
  exports: [MastraModule],
})
export class MastraSharedModule {}
