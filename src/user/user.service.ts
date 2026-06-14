import { Injectable, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/db/db.constants';
import type { DB } from 'src/db/db.types';

@Injectable()
export class UserService {
  constructor(
    @Inject(KYSELY_DB)
    private readonly db: Kysely<DB>,
  ) {}

  async getUsers() {
    return this.db.selectFrom('preview_platform.user').selectAll().execute();
  }
}
