import { Injectable, Logger } from '@nestjs/common';
import { SshService } from 'src/ssh/ssh.service';
import {
  RgEvent,
  SEARCH_TOOL_RESPONSE,
  TOOL_REQUEST_SHAPE,
} from './anvil-agent.types';
import { ToolExecutionContext } from '@mastra/core/tools';
import { StreamEventType } from './anvil-agent-chunk.dictionary';
import { assertValidSearchToolRequest } from './anvil-agent-search.validation';

@Injectable()
export class AnvilAgentSearchService {
  private readonly logger = new Logger(AnvilAgentSearchService.name);

  constructor(private readonly sshService: SshService) {}

  async searchRouter(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    count: number,
    context: ToolExecutionContext,
  ): Promise<SEARCH_TOOL_RESPONSE> {
    assertValidSearchToolRequest(request);

    switch (request.type) {
      case 'file_search':
        await context?.writer?.custom({
          type: StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG,
          data: { line: 'Initiating file search..' },
          transient: true,
        });
        return await this.searchToolForFiles(
          request,
          projectId,
          count,
          context,
        );
      case 'content_search':
        await context?.writer?.custom({
          type: StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG,
          data: { line: 'Initiating content search..' },
          transient: true,
        });
        return await this.searchToolForContent(
          request,
          projectId,
          count,
          context,
        );
      case 'expand_context':
        await context?.writer?.custom({
          type: StreamEventType.SEARCH_TOOL_EXPANSIVE_SEARCH_LOG,
          data: { line: 'Initiating expand context..' },
          transient: true,
        });
        return await this.searchToolForFileExpansion(
          request,
          projectId,
          count,
          context,
        );
      default:
        throw new Error('invalid search tool type');
    }
  }

  private async searchToolForFiles(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    count: number,
    context: ToolExecutionContext,
  ): Promise<SEARCH_TOOL_RESPONSE> {
    const response = await this.sshService.searchFile(
      request,
      projectId,
      context,
    );
    const files = response
      .find((item) => item.step === 'search-tool-search-files')
      ?.stdout.trim()
      .split('\n')
      .filter(Boolean);

    const responsePayload: SEARCH_TOOL_RESPONSE = {
      search_type: 'file_search',
      results: [],
      length: 0,
      calls: count,
      intent_history: [...request.history],
    };

    if (!files?.length) {
      await context?.writer?.custom({
        type: StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG,
        data: { line: 'No relevant files found.' },
        transient: true,
      });
      return responsePayload;
    }

    await context?.writer?.custom({
      type: StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG,
      data: { line: `Files found... ${files.length} ${files.join(',')}` },
      transient: true,
    });

    for (const file of files) {
      responsePayload.results.push({
        file_path: file,
        line_number: null,
        column_number: null,
        relevant_text: null,
      });

      responsePayload.length += 1;
    }

    await context?.writer?.custom({
      type: StreamEventType.SEARCH_TOOL_FILE_SEARCH_LOG,
      data: { line: 'Step completed: File search' },
      transient: true,
    });

    return responsePayload;
  }

  private async searchToolForContent(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    count: number,
    context: ToolExecutionContext,
  ): Promise<SEARCH_TOOL_RESPONSE> {
    if (!projectId) {
      throw new Error('Project ID not provided');
    }

    const response = await this.sshService.searchContent(
      request,
      projectId,
      context,
    );
    const files: RgEvent[] | undefined = response
      .find((item) => item.step === 'search-tool-content-search')
      ?.stdout.trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RgEvent);

    const responsePayload: SEARCH_TOOL_RESPONSE = {
      search_type: 'content_search',
      results: [],
      length: 0,
      calls: count,
      intent_history: [...request.history],
    };

    if (!files?.length) {
      await context?.writer?.custom({
        type: StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG,
        data: { line: 'No relevant files found.' },
        transient: true,
      });
      return responsePayload;
    }

    const matched = files.filter((item) => item.type === 'match');

    const fileCount = matched.map((match) => match.data.path.text).length;

    await context?.writer?.custom({
      type: StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG,
      data: {
        line: `Found ${matched.length} matches across ${fileCount} ${fileCount > 1 ? 'files' : 'file'}...`,
      },
      transient: true,
    });

    for (const match of matched) {
      responsePayload.results.push({
        file_path: match.data.path.text,
        line_number: match.data.line_number,
        column_number: match.data.submatches[0]?.start ?? null,
        relevant_text: match.data.lines.text,
      });

      responsePayload.length += 1;
    }

    await context?.writer?.custom({
      type: StreamEventType.SEARCH_TOOL_CONTENT_SEARCH_LOG,
      data: { line: `Step completed: Content Search.` },
      transient: true,
    });

    return responsePayload;
  }

  private async searchToolForFileExpansion(
    request: TOOL_REQUEST_SHAPE,
    projectId: string,
    count: number,
    context: ToolExecutionContext,
  ): Promise<SEARCH_TOOL_RESPONSE> {
    if (!request.query.files_path_for_expansion) {
      throw new Error('No provisions for expansion');
    }

    const response = await this.sshService.expandFiles(
      request,
      projectId,
      context,
    );

    const relevantText = response.find(
      (item) => item.step === 'search-tool-expansive-search',
    )?.stdout;

    if (!relevantText) {
      throw new Error('Something went wrong in expansion tool..');
    }

    const ranges = request.query.files_path_for_expansion.ranges;
    if (!ranges) {
      throw new Error('Invalid expansion ranges');
    }

    const startLine = ranges[0]?.startLine;
    const endLine = ranges[0]?.endLine;

    await context?.writer?.custom({
      type: StreamEventType.SEARCH_TOOL_EXPANSIVE_SEARCH_LOG,
      data: {
        line: `${relevantText.substring(1, 10)}.... in ${startLine}:${endLine}`,
      },
      transient: true,
    });

    const responsePayload: SEARCH_TOOL_RESPONSE = {
      search_type: 'expand_context',
      results: [
        {
          file_path: request.query.files_path_for_expansion.file_name,
          line_number: startLine,
          column_number: null,
          relevant_text: relevantText,
        },
      ],
      length: 0,
      calls: count,
      intent_history: [...request.history],
    };

    return responsePayload;
  }

  anvilAgentSearchToolLogger(message: string) {
    this.logger.log(message);
  }
}
