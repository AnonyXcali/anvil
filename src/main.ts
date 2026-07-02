import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppEnv } from './config/env.validation';

function getPort(configService: ConfigService<AppEnv, true>): number {
  return configService.getOrThrow('PORT', { infer: true });
}

/**
 * NOTE :
 * Side Effect: Since we disable NestJS's built-in body parser, the rawBody: true option in NestFactory.create() has no effect.
 * If you need access to req.rawBody (e.g., for webhook signature verification), use bodyParser.rawBody
 * in AuthModule.forRoot() instead. See Module Options for details.
 */

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'log', 'warn'],
    // The library will re-add the default body parsers for non-auth routes.
    // TODO: SECURITY - add integration tests for request parsing limits and webhook raw-body behavior.
    bodyParser: false,
  });
  const port = getPort(app.get(ConfigService<AppEnv, true>));
  await app.listen(port);
}
void bootstrap();
