import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { MemoryPG, WorkflowsPG } from '@mastra/pg';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import {
  createAnvilAgent,
  createAnvilSearchFinalizerAgent,
} from './agents/anvil-system-agent';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import { createAnvilSupervisorAgent } from './agents/anvil-supervisor-agent';
import { anvilPlanningAgent } from './agents/anvil-planning-agent';
import { createFrontendEngineeringWorkflow } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.workflow';
import {
  createEditWorkflow,
  createStagedEditWorkflow,
} from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { AnvilEditStagingService } from 'src/anvil-agent-edit/anvil-edit-staging.service';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { createAnvilEditingAgent } from './agents/anvil-editing-agent';
import { createAnvilVerifyAgent } from './agents/anvil-verify-agent';
import { createAnvilConversationAgent } from './agents/anvil-convo-agent';
import { createAnvilIntentAgent } from './agents/anvil-intent-agent';
import { createAnvilProjectNameAgent } from './agents/anvil-project-name-agent';
import type { AppEnv } from 'src/config/env.validation';
import { Logger } from '@nestjs/common';

export async function createMastra(dep: {
  anvilAgentSearchService: AnvilAgentSearchService;
  anvilAgentEditService: AnvilAgentEditService;
  anvilEditStagingService: AnvilEditStagingService;
  anvilHistoryService: AnvilHistoryService;
  env: Pick<
    AppEnv,
    | 'EXA_KEY'
    | 'FIRECRAWL_KEY'
    | 'LIGHTPANDA_KEY'
    | 'LIGHTPANDA_ENDPOINT'
    | 'MASTRA_DATABASE_URL'
  >;
}): Promise<Mastra> {
  const storageLogger = new Logger('MastraStorage');
  const workflowsStorage = new WorkflowsPG({
    connectionString: dep.env.MASTRA_DATABASE_URL,
    schemaName: 'mastra',
  });
  const memoryStorage = new MemoryPG({
    connectionString: dep.env.MASTRA_DATABASE_URL,
    schemaName: 'mastra',
  });

  await workflowsStorage.init();
  await memoryStorage.init();
  storageLogger.log(
    'Mastra workflow and memory storage initialized: PostgreSQL schema "mastra"',
  );

  const frontendEngineeringWorkflow = createFrontendEngineeringWorkflow();
  const editWorkflow = createEditWorkflow({
    anvilAgentEditService: dep.anvilAgentEditService,
    anvilEditStagingService: dep.anvilEditStagingService,
    anvilHistoryService: dep.anvilHistoryService,
  });
  const stagedEditWorkflow = createStagedEditWorkflow({
    anvilAgentEditService: dep.anvilAgentEditService,
    anvilEditStagingService: dep.anvilEditStagingService,
    anvilHistoryService: dep.anvilHistoryService,
  });

  return new Mastra({
    workflows: {
      weatherWorkflow,
      frontendEngineeringWorkflow,
      editWorkflow,
      stagedEditWorkflow,
    },
    agents: {
      weatherAgent,
      [AGENT_DIRECTORY.anvilIntentAgent]: createAnvilIntentAgent(),
      [AGENT_DIRECTORY.anvilProjectNameAgent]: createAnvilProjectNameAgent(),
      [AGENT_DIRECTORY.anvilSearchAgent]: createAnvilAgent(dep),
      [AGENT_DIRECTORY.anvilSearchFinalizerAgent]:
        createAnvilSearchFinalizerAgent(),
      [AGENT_DIRECTORY.anvilSupervisorAgent]: createAnvilSupervisorAgent({
        frontendEngineeringWorkflow,
      }),
      [AGENT_DIRECTORY.anvilPlanningAgent]: anvilPlanningAgent,
      [AGENT_DIRECTORY.anvilEditingAgent]: createAnvilEditingAgent({
        anvilAgentEditService: dep.anvilAgentEditService,
        anvilHistoryService: dep.anvilHistoryService,
        editWorkflow,
        stagedEditWorkflow,
      }),
      [AGENT_DIRECTORY.anvilVerifyAgent]: createAnvilVerifyAgent({
        anvilAgentEditService: dep.anvilAgentEditService,
        anvilHistoryService: dep.anvilHistoryService,
      }),
      [AGENT_DIRECTORY.anvilConversationAgent]: createAnvilConversationAgent({
        anvilAgentSearchService: dep.anvilAgentSearchService,
        env: dep.env,
      }),
    },
    storage: new MastraCompositeStore({
      id: 'composite-storage',
      default: new LibSQLStore({
        id: 'mastra-storage',
        url: 'file:./mastra.db',
      }),
      domains: {
        memory: memoryStorage,
        workflows: workflowsStorage,
        observability: await new DuckDBStore().getStore('observability'),
      },
    }),
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'mastra',
          exporters: [
            new MastraStorageExporter(), // Persists observability events to Mastra Storage
            new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
          ],
          spanOutputProcessors: [
            new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
          ],
        },
      },
    }),
  });
}
