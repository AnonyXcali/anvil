import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
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
import { createAnvilAgent } from './agents/anvil-system-agent';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import { createAnvilSupervisorAgent } from './agents/anvil-supervisor-agent';
import { anvilPlanningAgent } from './agents/anvil-planning-agent';
import { createFrontendEngineeringWorkflow } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.workflow';
import { createEditWorkflow } from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { createAnvilEditingAgent } from './agents/anvil-editing-agent';
import { createAnvilVerifyAgent } from './agents/anvil-verify-agent';

export async function createMastra(dep: {
  anvilAgentSearchService: AnvilAgentSearchService;
  anvilAgentEditService: AnvilAgentEditService;
}): Promise<Mastra> {
  const frontendEngineeringWorkflow = createFrontendEngineeringWorkflow();
  const editWorkflow = createEditWorkflow({
    anvilAgentEditService: dep.anvilAgentEditService,
  });

  return new Mastra({
    workflows: { weatherWorkflow, frontendEngineeringWorkflow, editWorkflow },
    agents: {
      weatherAgent,
      [AGENT_DIRECTORY.anvilSearchAgent]: createAnvilAgent(dep),
      [AGENT_DIRECTORY.anvilSupervisorAgent]: createAnvilSupervisorAgent({
        frontendEngineeringWorkflow,
      }),
      [AGENT_DIRECTORY.anvilPlanningAgent]: anvilPlanningAgent,
      [AGENT_DIRECTORY.anvilEditingAgent]: createAnvilEditingAgent({
        anvilAgentEditService: dep.anvilAgentEditService,
        editWorkflow,
      }),
      [AGENT_DIRECTORY.anvilVerifyAgent]: createAnvilVerifyAgent({
        anvilAgentEditService: dep.anvilAgentEditService,
      }),
    },
    storage: new MastraCompositeStore({
      id: 'composite-storage',
      default: new LibSQLStore({
        id: 'mastra-storage',
        url: 'file:./mastra.db',
      }),
      domains: {
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
