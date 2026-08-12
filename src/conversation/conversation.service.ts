import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Conversation } from './convesation.types';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { KYSELY_DB } from 'src/tokens';
import { Kysely } from 'kysely';
import type { DB } from 'src/db/db.types';
import { MastraService } from '@mastra/nestjs';
import { ChannelsService } from 'src/channels/channels.service';
import { RequestContext } from '@mastra/core/request-context';
import type { MessageListInput } from '@mastra/core/agent/message-list';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { generateKeys } from 'src/utils';
import { ProjectService } from 'src/project/project.service';
import { ConversationTranscriptService } from './conversation-transcript.service';

const CONVERSATION_TIMEOUT_MS = 30_000;
const CONVERSATION_TIMEOUT_MESSAGE =
  "I'm sorry, I couldn't complete that request. Please try again.";

@Injectable()
export class ConversationService implements Conversation {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectQueue('conversation-processor')
    private readonly conversationProcessor: Queue<{
      conversation_id: string;
      messages: Array<Record<string, string>>;
      query: string;
      project_id: string;
      stream_id: string;
    }>,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly mastraService: MastraService,
    private readonly channelService: ChannelsService,
    private readonly projectService: ProjectService,
    @Optional()
    private readonly transcriptService?: ConversationTranscriptService,
  ) {}

  async handleConversation(
    query: string,
    conversationId: string,
    projectId: string,
    streamId: string,
  ): Promise<void> {
    try {
      this.logger.log('Queueing instant query to conversation worker');

      const messages = (await this.retrieveMessages(conversationId)).map(
        (item) => ({ role: item.role, content: item.message }),
      );

      this.logger.log('============== MESSAGES =================');
      this.logger.log(messages.length);
      this.logger.log('============== MESSAGES =================');

      const job = await this.conversationProcessor.add(
        'process-query',
        {
          conversation_id: conversationId,
          query,
          messages,
          project_id: projectId,
          stream_id: streamId,
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

      const jobId = job.id + ':' + 'conversation';

      await this.db
        .insertInto('preview_platform.jobs')
        .values({
          id: jobId,
          conversation_id: conversationId,
          type: 'conversation',
        })
        .execute();
    } catch (e: unknown) {
      if (e instanceof Error) {
        this.logger.error(e.message);
      }
    }
  }

  async streamConversation(
    messages: Array<Record<string, string>>,
    conversationId: string,
    projectId: string,
    jobId: string,
    streamId: string,
  ): Promise<string> {
    const { seqKey, listKey, metaKey, channelKey } = generateKeys(
      conversationId,
      jobId,
    );
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      this.logger.error(
        `Conversation ${conversationId} job ${jobId} exceeded ${CONVERSATION_TIMEOUT_MS}ms; aborting agent stream`,
      );
      abortController.abort(
        new Error(`Conversation timed out after ${CONVERSATION_TIMEOUT_MS}ms`),
      );
    }, CONVERSATION_TIMEOUT_MS);

    try {
      const requestContext = new RequestContext<{
        projectId: string;
        previewUrl: string;
        callCount: 0;
      }>();
      requestContext.set('projectId', projectId);
      requestContext.set('callCount', 0);

      const previewUrl = await this.projectService.getPreviewUrl(projectId);

      if (!previewUrl) {
        throw new Error('No Preview URL provided');
      }

      requestContext.set('previewUrl', previewUrl);
      const previewContext = `The current project preview URL is ${previewUrl}. If you need to inspect the rendered application, pass this exact URL as previewUrl to anvil-preview-browser-tool.`;

      this.logger.log('=========== START ===========');
      const agent = this.mastraService.getAgent(
        AGENT_DIRECTORY.anvilConversationAgent,
      );
      const resultStream = await agent.stream(
        [
          { role: 'system', content: previewContext },
          ...messages,
        ] as unknown as MessageListInput,
        {
          maxSteps: 4,
          requestContext,
          abortSignal: abortController.signal,
          modelSettings: {
            reasoning: 'high',
          },
          providerOptions: {
            openai: {
              reasoningEffort: 'high',
            },
          },
        },
      );

      let constructedMessage = '';

      for await (const chunk of resultStream.fullStream) {
        switch (chunk.type) {
          case 'text-delta': {
            const text = chunk.payload.text;

            if (!text) {
              continue;
            }

            constructedMessage += text;
            await this.channelService.publishAndStoreChunk(
              JSON.stringify({
                type: 'text-delta',
                payload: { text },
              }),
              seqKey,
              listKey,
              metaKey,
              channelKey,
              { streamId },
            );
            continue;
          }
          case 'tool-call': {
            const toolText = chunk.payload.toolName;

            await this.channelService.publishAndStoreChunk(
              JSON.stringify({
                type: 'text-delta',
                payload: { toolText },
              }),
              seqKey,
              listKey,
              metaKey,
              channelKey,
              { streamId },
            );
            continue;
          }

          case 'reasoning-delta': {
            this.logger.log(chunk.payload.text);
            continue;
          }
          default:
            this.logger.log('========= OTHER =========');
            this.logger.log(chunk);
            this.logger.log('========= OTHER =========');
            continue;
        }
      }

      if (abortController.signal.aborted) {
        throw (
          abortController.signal.reason ??
          new Error(`Conversation timed out after ${CONVERSATION_TIMEOUT_MS}ms`)
        );
      }

      this.logger.log('=========== END ===========');
      this.logger.log(constructedMessage);
      this.logger.log('=========== END ===========');
      return constructedMessage;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const timedOut = abortController.signal.aborted;

      this.logger.error(
        `${timedOut ? 'Conversation timed out' : 'Conversation stream failed'} for ${conversationId} job ${jobId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.channelService.publishAndStoreChunk(
        JSON.stringify({
          type: 'text-delta',
          payload: { text: CONVERSATION_TIMEOUT_MESSAGE },
        }),
        seqKey,
        listKey,
        metaKey,
        channelKey,
        { streamId },
      );

      return CONVERSATION_TIMEOUT_MESSAGE;
    } finally {
      clearTimeout(timeout);
    }
  }

  async storeConstructedMessageToDb(
    message: string,
    conversationId: string,
    sourceId = `conversation:${conversationId}`,
  ) {
    if (this.transcriptService) {
      await this.transcriptService.storeAssistantMessage({
        message,
        conversationId,
        sourceId,
      });
      return;
    }
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message: message.trim(),
        role: 'assistant',
        conversation_id: conversationId,
        source_id: sourceId,
      })
      .onConflict((oc) =>
        oc.columns(['conversation_id', 'source_id']).doUpdateSet({
          message: message.trim(),
          updated_at: new Date(),
        }),
      )
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
