import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppEnv } from './config/env.validation';
import { join } from 'node:path';
import { registerTestingUiViewHelpers } from './testing-ui/testing-ui-view.helpers';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'log', 'warn'],
    // The library will re-add the default body parsers for non-auth routes.
    // TODO: SECURITY - add integration tests for request parsing limits and webhook raw-body behavior.
    bodyParser: false,
  });
  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');
  registerTestingUiViewHelpers();
  const port = getPort(app.get(ConfigService<AppEnv, true>));
  await app.listen(port);
}
void bootstrap();
