/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TYPE preview_platform.conversation_state AS ENUM ('active', 'awaiting_response', 'errored');

    CREATE TYPE preview_platform.role as ENUM ('user', 'assistant', 'system', 'tool');

    CREATE TYPE preview_platform.job_status as ENUM ('queued', 'active', 'completed', 'failed');

    CREATE TYPE preview_platform.job_type as ENUM ('instant', 'offload');

    CREATE TABLE preview_platform.conversation (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state preview_platform.conversation_state default 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE preview_platform.jobs (
        id uuid PRIMARY KEY default gen_random_uuid(),
        conversation_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
    retries integer default 0,
    error text,
        state preview_platform.job_status NOT NULL default 'queued' ,
        type preview_platform.job_type NOT NULL,

        FOREIGN KEY ("conversation_id")
            REFERENCES "preview_platform"."conversation"("id")
            ON UPDATE restrict
            ON DELETE restrict
    );

    CREATE TABLE preview_platform.message (
      id uuid PRIMARY KEY NOT NULL default gen_random_uuid(),
      role preview_platform.role NOT NULL,
      message text NOT NULL,
      conversation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      sequence_number BIGSERIAL,

      FOREIGN KEY ("conversation_id")
          REFERENCES "preview_platform"."conversation"("id")
          ON UPDATE restrict
          ON DELETE restrict
    );

    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS preview_platform.message;
    DROP TABLE IF EXISTS preview_platform.jobs;
    DROP TABLE IF EXISTS preview_platform.conversation;

    DROP TYPE IF EXISTS preview_platform.job_type;
    DROP TYPE IF EXISTS preview_platform.job_status;
    DROP TYPE IF EXISTS preview_platform.role;
    DROP TYPE IF EXISTS preview_platform.conversation_state;
  `);
};
