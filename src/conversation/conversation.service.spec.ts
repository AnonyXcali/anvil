jest.mock('kysely', () => ({ Kysely: class Kysely {} }));
jest.mock('@mastra/nestjs', () => ({ MastraService: class MastraService {} }));
jest.mock('src/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { getQueueToken } from '@nestjs/bullmq';
import { KYSELY_DB } from 'src/tokens';
import { MastraService } from '@mastra/nestjs';
import { ChannelsService } from 'src/channels/channels.service';
import { ProjectService } from 'src/project/project.service';

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: getQueueToken('conversation-processor'), useValue: {} },
        { provide: KYSELY_DB, useValue: {} },
        { provide: MastraService, useValue: {} },
        { provide: ChannelsService, useValue: {} },
        {
          provide: ProjectService,
          useValue: { getPreviewUrl: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('relays only non-empty text deltas and preserves their order', async () => {
    const publishAndStoreChunk = jest.fn().mockResolvedValue(undefined);
    const stream = {
      fullStream: (function* () {
        yield { type: 'tool-call', payload: { toolName: 'hidden-tool' } };
        yield { type: 'text-delta', payload: { text: 'Hello ' } };
        yield { type: 'text-delta', payload: { text: '' } };
        yield { type: 'reasoning-delta', payload: { text: 'hidden' } };
        yield { type: 'text-delta', payload: { text: 'world' } };
      })(),
    };
    let streamOptions: Record<string, unknown> | undefined;
    let streamMessages: unknown;
    const streamAgent = {
      stream: jest.fn((messages: unknown, options: Record<string, unknown>) => {
        streamMessages = messages;
        streamOptions = options;
        return Promise.resolve(stream);
      }),
    };
    const mastraService = {
      getAgent: jest.fn().mockReturnValue(streamAgent),
    };

    const testModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: getQueueToken('conversation-processor'),
          useValue: {},
        },
        { provide: KYSELY_DB, useValue: {} },
        { provide: MastraService, useValue: mastraService },
        { provide: ChannelsService, useValue: { publishAndStoreChunk } },
        {
          provide: ProjectService,
          useValue: {
            getPreviewUrl: jest.fn().mockResolvedValue('http://preview.local/'),
          },
        },
      ],
    }).compile();
    const testService = testModule.get(ConversationService);

    await expect(
      testService.streamConversation(
        [],
        'conversation-1',
        'project-1',
        'job-1',
        'stream-1',
      ),
    ).resolves.toBe('Hello world');

    expect(publishAndStoreChunk).toHaveBeenCalledTimes(3);
    const publishedTexts = (publishAndStoreChunk.mock.calls as unknown[][]).map(
      ([text]) => text,
    );
    expect(publishedTexts).toEqual([
      JSON.stringify({
        type: 'text-delta',
        payload: { toolText: 'hidden-tool' },
      }),
      JSON.stringify({ type: 'text-delta', payload: { text: 'Hello ' } }),
      JSON.stringify({ type: 'text-delta', payload: { text: 'world' } }),
    ]);
    expect(
      (publishAndStoreChunk.mock.calls as unknown[][]).map((args) => args[5]),
    ).toEqual([
      { streamId: 'stream-1' },
      { streamId: 'stream-1' },
      { streamId: 'stream-1' },
    ]);
    expect(mastraService.getAgent).toHaveBeenCalledWith('anvil-convo');
    expect(streamOptions).toEqual(expect.objectContaining({ maxSteps: 4 }));
    expect(streamOptions).not.toHaveProperty('structuredOutput');
    const streamedMessages = streamMessages as Array<{
      role: string;
      content: string;
    }>;
    expect(streamedMessages[0]?.role).toBe('system');
    expect(streamedMessages[0]?.content).toContain('http://preview.local/');
  });
});
