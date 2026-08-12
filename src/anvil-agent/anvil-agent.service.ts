import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { Queue } from 'bullmq';
import { KYSELY_DB } from 'src/tokens';
import { Kysely } from 'kysely';
import { DB } from 'src/db/db.types';
import {
  AnvilAgentContext,
  SEARCH_STRUCTURED_OUTPUT,
} from './anvil-agent.types';
import {
  extractSearchPhaseEvidence,
  finalizeSearchPlan,
} from './anvil-agent-search-phases';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { ChannelsService } from 'src/channels/channels.service';
import { RequestContext } from '@mastra/core/request-context';
import { MessageListInput } from '@mastra/core/agent/message-list';
import { generateKeys } from 'src/utils';
import { StreamEventType } from './anvil-agent-chunk.dictionary';
import {
  ANVIL_SEARCH_EXECUTION_POLICIES,
  ANVIL_SEARCH_MODE,
} from 'src/mastra/anvil-agent.config';

@Injectable()
export class AnvilAgentService {
  private readonly logger = new Logger(AnvilAgentService.name);
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @InjectQueue('anvil-agent-processor')
    private readonly anvilTaskQueueProcessor: Queue<{
      conversation_id: string;
      query: string;
      messages: Array<Record<string, string>>;
      project_id: string;
    }>,
    private readonly mastraService: MastraService,
    private readonly channelService: ChannelsService,
  ) {}

  async askWeatherAgent(message: MessageListInput) {
    const agent = this.mastraService.getAgent('weatherAgent');
    const result = await agent.stream(message, {
      maxSteps: 5,
    });

    return {
      text: result.text,
      finishReason: result.finishReason,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
    };
  }

  async askAnvilAgent(
    messages: MessageListInput,
    conversationId: string,
    jobId: string,
    projectId: string,
  ) {
    this.logger.log('=========ANVIL INSIDE SERVICE==========');
    const requestContext = new RequestContext<AnvilAgentContext>();
    requestContext.set('projectId', projectId);
    requestContext.set('callCount', 0);
    const searchPolicy = ANVIL_SEARCH_EXECUTION_POLICIES[ANVIL_SEARCH_MODE];
    requestContext.set('maxSearchCalls', searchPolicy.maxSearchCalls);
    const agent = this.mastraService.getAgent(AGENT_DIRECTORY.anvilSearchAgent);
    const resultStream = await agent.stream(messages, {
      maxSteps: searchPolicy.maxSteps,
      requestContext,
      // providerOptions: {
      //   openai: ANVIL_AGENT_CONFIGURATION,
      // },
    });

    const { seqKey, listKey, metaKey, channelKey } = generateKeys(
      conversationId,
      jobId,
    );

    let finalInstructionsPublished = false;
    let searchStreamError: unknown;

    const publishFinalInstructions = async (
      output: SEARCH_STRUCTURED_OUTPUT,
    ) => {
      if (finalInstructionsPublished || !output.is_final) {
        return;
      }

      if (output.final?.files_that_require_change) {
        for (const res of output.final.files_that_require_change) {
          this.logger.log('=========DO I EVEN COME HERE?===========');
          this.logger.log(res.precise_instruction);
          await this.channelService.publishAndStoreChunk(
            res.precise_instruction,
            seqKey,
            listKey,
            metaKey,
            channelKey,
          );
        }
      }

      finalInstructionsPublished = true;
    };

    for await (const chunk of resultStream.fullStream) {
      switch (chunk.type) {
        //https://mastra.ai/docs/agents/using-tools
        case 'tool-call-delta':
          /**
           * Using a partial JSON parser on the accumulated argsTextDelta fragments lets you
           * extract usable argument values before the JSON is complete.
           * This enables features like live diff previews for edit tools, streaming
           * file content for write tools, and instant display of search patterns
           * or file paths.
           */
          await this.channelService.publishAndStoreChunk(
            `ArgsTextDelta: ${chunk.payload.argsTextDelta}`,
            seqKey,
            listKey,
            metaKey,
            channelKey,
          );
          continue;
        case 'tool-call':
          await this.channelService.publishAndStoreChunk(
            `Tool Call: ${chunk.payload.toolName}`,
            seqKey,
            listKey,
            metaKey,
            channelKey,
          );
          continue;
        case 'reasoning-delta':
          await this.channelService.publishAndStoreChunk(
            `Reasoning: ${chunk.payload.text}`,
            seqKey,
            listKey,
            metaKey,
            channelKey,
          );
          continue;
        case 'text-delta':
          // await this.channelService.publishAndStoreChunk(channe
          //   `Text-Delta: ${chunk.payload.text}`,
          //   seqKey,
          //   listKey,
          //   metaKey,
          //   channelKey,
          // );
          this.logger.log(chunk.payload.text);
          continue;
        case StreamEventType.SEARCH_ROUTER_LOG:
        case StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG:
        case StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG:
        case StreamEventType.SEARCH_TOOL_EXPANSIVE_SEARCH_LOG: {
          const chunkedData = chunk.data as { line: string };
          this.logger.log(`LLM response: ${chunkedData.line}`);
          continue;
        }
        case 'finish': {
          this.logger.log(
            `
                        =========FINISH STATS=======
            Reasoning Tokens: ${chunk.payload.output.usage.reasoningTokens}
            Input Tokens: ${chunk.payload.output.usage.inputTokens}
            Output Tokens: ${chunk.payload.output.usage.outputTokens}
            `,
          );

          const stepArray = chunk.payload.output.steps;

          if (stepArray) {
            for (const [index, step] of stepArray.entries()) {
              this.logger.log(`
                STEP: ${index}
                CONTENT: ${step.reasoningText}
                `);

              for (const [toolIndex, tool] of step.toolCalls.entries()) {
                this.logger.log(`
                  TOOL: ${toolIndex} ${tool.toolName}
                  ${step.toolResults[toolIndex].output}
                `);
              }

              for (const [
                messageIndex,
                message,
              ] of step.response.messages.entries()) {
                this.logger.log(`
                  MESSAGE: ${messageIndex}
                  CONTENT: ${JSON.stringify(message.content)}
                  ROLE: ${message.role}
                `);
              }
            }
          }

          continue;
        }
        case 'error':
          this.logger.fatal('=========ERROR OCCURED=======');
          this.logger.error(chunk.payload.error);
          searchStreamError = chunk.payload.error;
          continue;
        default:
          continue;
      }
    }

    if (searchStreamError) {
      throw searchStreamError instanceof Error
        ? searchStreamError
        : new Error(JSON.stringify(searchStreamError));
    }

    const evidence = extractSearchPhaseEvidence({
      toolCalls: await resultStream.toolCalls,
      toolResults: await resultStream.toolResults,
      policy: searchPolicy,
    });
    const finalizerAgent = this.mastraService.getAgent(
      AGENT_DIRECTORY.anvilSearchFinalizerAgent,
    );
    const finalOutput: SEARCH_STRUCTURED_OUTPUT = await finalizeSearchPlan({
      finalizerAgent,
      request: JSON.stringify(messages),
      evidence,
    });
    await publishFinalInstructions(finalOutput);

    return finalOutput;
  }

  /**
   * This method is for queueing the search job.
   */
  async anvilAgentQueue(
    conversationId: string,
    query: string,
    projectId: string,
  ) {
    this.logger.log('Queueing offload query to conversation worker');

    const messages = (await this.retrieveMessages(conversationId)).map(
      (item) => ({ role: item.role, content: item.message }),
    );

    const job = await this.anvilTaskQueueProcessor.add(
      'process-offload-query',
      {
        conversation_id: conversationId,
        query,
        messages,
        project_id: projectId,
      },
      {
        attempts: 1,
        removeOnComplete: {
          age: 60 * 60,
          count: 100,
        },
        removeOnFail: {
          age: 24 * 60 * 60,
          count: 100,
        },
      },
    );

    if (!job.id) {
      throw new Error('Job id is null');
    }

    const jobId = String(job.id) + ':' + 'offload';

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: jobId,
        conversation_id: conversationId,
        type: 'offload',
      })
      .execute();
  }

  async storeConstructedMessageToDb(message: string, conversationId: string) {
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message,
        role: 'assistant',
        conversation_id: conversationId,
      })
      .execute();
  }

  async retrieveMessages(conversationId: string) {
    this.logger.log('Retreiving existing messages');
    return await this.db
      .selectFrom('preview_platform.message')
      .select(['role', 'message'])
      .where('conversation_id', '=', conversationId)
      .orderBy('sequence_number', 'asc')
      .execute();
  }
}
