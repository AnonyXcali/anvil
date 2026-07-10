import { Body, Controller, Post } from '@nestjs/common';
import { AnvilAgentService } from './anvil-agent.service';

@Controller('anvil-agent')
export class AnvilAgentController {
  constructor(private readonly anvilAgentService: AnvilAgentService) {}

  @Post('weather')
  async askWeatherAgent(@Body() body: { message: string }) {
    return this.anvilAgentService.askWeatherAgent(body.message);
  }
}
