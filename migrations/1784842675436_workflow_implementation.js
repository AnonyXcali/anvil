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
    CREATE TYPE preview_platform.workflow_job_status AS ENUM (
      'running',
      'suspended',
      'completed',
      'failed',
      'cancelled',
      'pending'
    );

    CREATE TABLE preview_platform.workflow_run (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id text NOT NULL,
      run_id text NOT NULL UNIQUE,
      conversation_id uuid NOT NULL,
      project_id uuid NOT NULL,
      status preview_platform.workflow_job_status DEFAULT 'pending',
      suspended_step jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      FOREIGN KEY ("conversation_id")
        REFERENCES "preview_platform"."conversation"("id")
        ON UPDATE restrict
        ON DELETE cascade,

      FOREIGN KEY ("project_id")
        REFERENCES "preview_platform"."project"("id")
        ON UPDATE restrict
        ON DELETE cascade
    );

    COMMENT ON COLUMN "preview_platform"."workflow_run"."id"
    IS 'Frontend approvalId for human-in-the-loop decisions';

    COMMENT ON COLUMN "preview_platform"."workflow_run"."suspended_step"
    IS 'Mastra workflow snapshot captured when a workflow suspends';

    -- TODO: After this migration is run and DB types are regenerated, create a
    -- service method that updates workflow_run.status by workflow_run.id.

    CREATE TRIGGER "set_preview_platform_workflow_run_updated_at"
    BEFORE UPDATE ON "preview_platform"."workflow_run"
    FOR EACH ROW
    EXECUTE PROCEDURE "preview_platform"."set_current_timestamp_updated_at"();
    COMMENT ON TRIGGER "set_preview_platform_workflow_run_updated_at" ON "preview_platform"."workflow_run"
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
    DROP TRIGGER IF EXISTS "set_preview_platform_workflow_run_updated_at"
    ON "preview_platform"."workflow_run";

    DROP TABLE IF EXISTS preview_platform.workflow_run;

    DROP TYPE IF EXISTS preview_platform.workflow_job_status;
  `);
};
