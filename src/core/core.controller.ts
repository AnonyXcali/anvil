import { Controller, Post, Body, Sse, Param } from '@nestjs/common';
import { CoreService } from './core.service';

@Controller('core')
export class CoreController {
  constructor(private readonly coreService: CoreService) {}
  @Post()
  async Initiate(@Body() body: { query: string }) {
    return this.coreService.handleFlowInitiation(body.query);
  }

  @Sse()
  CoreListener(@Param() params: { conversation_id: string }) {
    return this.coreService.handleRelay(params.conversation_id);
  }
}
