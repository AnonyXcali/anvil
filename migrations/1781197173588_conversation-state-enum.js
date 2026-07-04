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
      user_id text NOT NULL,
      project_id UUID NOT NULL,
      state preview_platform.conversation_state default 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      FOREIGN KEY ("user_id")
          REFERENCES "preview_platform"."user"("id")
          ON UPDATE restrict
          ON DELETE restrict,

      FOREIGN KEY ("project_id")
        REFERENCES "preview_platform"."project"("id")
        ON UPDATE restrict
        ON DELETE cascade
    );

    CREATE TABLE preview_platform.jobs (
        id text PRIMARY KEY NOT NULL,
        conversation_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        retries integer default 0,
        error text,
        state preview_platform.job_status NOT NULL default 'queued' ,
        type text NOT NULL,

        FOREIGN KEY ("conversation_id")
            REFERENCES "preview_platform"."conversation"("id")
            ON UPDATE restrict
            ON DELETE cascade
    );

    CREATE TABLE preview_platform.project_jobs (
        id text PRIMARY KEY NOT NULL,
        project_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        retries integer default 0,
        error text,
        state preview_platform.job_status NOT NULL default 'queued' ,
        type text NOT NULL,

        FOREIGN KEY ("project_id")
            REFERENCES "preview_platform"."project"("id")
            ON UPDATE restrict
            ON DELETE cascade
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
          ON DELETE cascade
    );

    -- conversation updated_at trigger
    CREATE TRIGGER "set_preview_platform_conversation_updated_at"
    BEFORE UPDATE ON "preview_platform"."conversation"
    FOR EACH ROW
    EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
    COMMENT ON TRIGGER "set_preview_platform_conversation_updated_at" ON "preview_platform"."conversation"
    IS 'trigger to set value of column "updated_at" to current timestamp on row update';

    -- jobs updated_at trigger
    CREATE TRIGGER "set_preview_platform_jobs_updated_at"
    BEFORE UPDATE ON "preview_platform"."jobs"
    FOR EACH ROW
    EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
    COMMENT ON TRIGGER "set_preview_platform_jobs_updated_at" ON "preview_platform"."jobs"
    IS 'trigger to set value of column "updated_at" to current timestamp on row update';

    -- project_jobs updated_at trigger
    CREATE TRIGGER "set_preview_platform_project_jobs_updated_at"
    BEFORE UPDATE ON "preview_platform"."project_jobs"
    FOR EACH ROW
    EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
    COMMENT ON TRIGGER "set_preview_platform_project_jobs_updated_at" ON "preview_platform"."project_jobs"
    IS 'trigger to set value of column "updated_at" to current timestamp on row update';

    -- messages updated_at trigger
    CREATE TRIGGER "set_preview_platform_messages_updated_at"
    BEFORE UPDATE ON "preview_platform"."message"
    FOR EACH ROW
    EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
    COMMENT ON TRIGGER "set_preview_platform_messages_updated_at" ON "preview_platform"."message"
    IS 'trigger to set value of column "updated_at" to current timestamp on row update';

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
    DROP TABLE IF EXISTS preview_platform.project_jobs;

    DROP TYPE IF EXISTS preview_platform.job_type;
    DROP TYPE IF EXISTS preview_platform.job_status;
    DROP TYPE IF EXISTS preview_platform.role;
    DROP TYPE IF EXISTS preview_platform.conversation_state;
  `);
};
