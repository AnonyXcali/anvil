import { Controller, Post, Body, Sse, Param, Get } from '@nestjs/common';
import { CoreService } from './core.service';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

@Controller('core')
export class CoreController {
  constructor(private readonly coreService: CoreService) {}
  @Post()
  async Initiate(
    @Body() body: { query: string; user_id: string; project_id: string },
    @Session() session: UserSession,
  ) {
    return this.coreService.handleFlowInitiation(
      body.query,
      session.user.id,
      body.project_id,
    );
  }

  @Post('/talk')
  async Converse(
    @Body()
    body: {
      query: string;
      conversation_id: string;
      project_id: string;
    },
  ) {
    return this.coreService.talk(
      body.query,
      body.conversation_id,
      body.project_id,
    );
  }

  @Sse(':conversation_id')
  CoreListener(@Param() params: { conversation_id: string }) {
    return this.coreService.handleRelay(params.conversation_id);
  }

  @Get('/test/:conversation_id')
  async TestSSE(@Param() params: { conversation_id: string }) {
    await this.coreService.test(params.conversation_id);
  }
}
