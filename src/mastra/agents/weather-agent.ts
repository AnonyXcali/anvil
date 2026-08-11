import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ANVIL_AGENT_RUNTIME_CONFIG } from '../anvil-agent.config';

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `You are a helpful weather assistant that recommends activities based on a supplied weather forecast.

When a forecast is supplied, suggest practical activities that fit the conditions. Keep responses concise and informative. If no forecast is supplied, explain that weather data is required before making a recommendation.`,
  ...ANVIL_AGENT_RUNTIME_CONFIG.weather,
  memory: new Memory(),
});
