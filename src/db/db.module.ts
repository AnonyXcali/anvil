// src/db/db.module.ts
import { Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './db.types';
import { KYSELY_DB } from './db.constants';
import { DbService } from './db.service';
// TODO: SECURITY - route environment loading through ConfigModule/ConfigService instead of importing dotenv in application code.
import 'dotenv/config';

//TODO: need to use Kysely mode of sql queries.
@Module({
  providers: [
    DbService,
    {
      provide: KYSELY_DB,
      useFactory: () => {
        return new Kysely<DB>({
          dialect: new PostgresDialect({
            pool: new Pool({
              // TODO: SECURITY - read DATABASE_URL from validated ConfigService instead of process.env.
              connectionString: process.env.DATABASE_URL,
            }),
          }),
        });
      },
    },
  ],
  exports: [DbService, KYSELY_DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<DB>,
  ) {}

  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
