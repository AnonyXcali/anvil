/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TYPE preview_platform.workflow_job_status
      ADD VALUE IF NOT EXISTS 'completed_with_issues';
    ALTER TYPE preview_platform.workflow_job_status
      ADD VALUE IF NOT EXISTS 'repair_pending';
    ALTER TYPE preview_platform.workflow_job_status
      ADD VALUE IF NOT EXISTS 'repairing';

    CREATE TYPE preview_platform.edit_transaction_status AS ENUM (
      'running',
      'completed_with_issues',
      'repair_pending',
      'repairing',
      'completed',
      'failed'
    );

    CREATE TYPE preview_platform.edit_milestone_status AS ENUM (
      'pending',
      'running',
      'committed',
      'blocked',
      'repair_pending',
      'failed'
    );

    CREATE TYPE preview_platform.edit_bug_status AS ENUM (
      'open',
      'repairing',
      'resolved'
    );

    CREATE TABLE preview_platform.edit_transaction (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES preview_platform.project(id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES preview_platform.conversation(id) ON DELETE CASCADE,
      originating_run_id text NOT NULL REFERENCES preview_platform.workflow_run(run_id) ON DELETE RESTRICT,
      status preview_platform.edit_transaction_status NOT NULL DEFAULT 'running',
      staging_root text NOT NULL,
      manifest_path text NOT NULL,
      repair_budget integer NOT NULL DEFAULT 20 CHECK (repair_budget > 0),
      repair_attempt_count integer NOT NULL DEFAULT 0 CHECK (repair_attempt_count >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );

    CREATE TABLE preview_platform.edit_milestone (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL REFERENCES preview_platform.edit_transaction(id) ON DELETE CASCADE,
      milestone_key text NOT NULL,
      sequence integer NOT NULL CHECK (sequence >= 0),
      status preview_platform.edit_milestone_status NOT NULL DEFAULT 'pending',
      affected_files jsonb NOT NULL DEFAULT '[]'::jsonb,
      validation_status text NOT NULL DEFAULT 'pending',
      commit_status text NOT NULL DEFAULT 'pending',
      originating_run_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (transaction_id, milestone_key),
      UNIQUE (transaction_id, sequence)
    );

    CREATE TABLE preview_platform.edit_bug (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL REFERENCES preview_platform.edit_transaction(id) ON DELETE CASCADE,
      milestone_id uuid REFERENCES preview_platform.edit_milestone(id) ON DELETE SET NULL,
      bug_key text NOT NULL,
      status preview_platform.edit_bug_status NOT NULL DEFAULT 'open',
      severity text NOT NULL,
      category text NOT NULL,
      validator text NOT NULL,
      diagnostic text NOT NULL,
      affected_files jsonb NOT NULL DEFAULT '[]'::jsonb,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      originating_run_id text NOT NULL,
      repair_run_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      UNIQUE (transaction_id, bug_key)
    );

    CREATE INDEX edit_transaction_project_status_idx
      ON preview_platform.edit_transaction(project_id, status);
    CREATE INDEX edit_transaction_originating_run_idx
      ON preview_platform.edit_transaction(originating_run_id);
    CREATE INDEX edit_milestone_transaction_status_idx
      ON preview_platform.edit_milestone(transaction_id, status);
    CREATE INDEX edit_bug_transaction_status_idx
      ON preview_platform.edit_bug(transaction_id, status);
    CREATE INDEX edit_bug_originating_run_idx
      ON preview_platform.edit_bug(originating_run_id);

    CREATE TRIGGER set_edit_transaction_updated_at
      BEFORE UPDATE ON preview_platform.edit_transaction
      FOR EACH ROW EXECUTE PROCEDURE preview_platform.set_current_timestamp_updated_at();
    CREATE TRIGGER set_edit_milestone_updated_at
      BEFORE UPDATE ON preview_platform.edit_milestone
      FOR EACH ROW EXECUTE PROCEDURE preview_platform.set_current_timestamp_updated_at();
    CREATE TRIGGER set_edit_bug_updated_at
      BEFORE UPDATE ON preview_platform.edit_bug
      FOR EACH ROW EXECUTE PROCEDURE preview_platform.set_current_timestamp_updated_at();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS set_edit_bug_updated_at ON preview_platform.edit_bug;
    DROP TRIGGER IF EXISTS set_edit_milestone_updated_at ON preview_platform.edit_milestone;
    DROP TRIGGER IF EXISTS set_edit_transaction_updated_at ON preview_platform.edit_transaction;
    DROP TABLE IF EXISTS preview_platform.edit_bug;
    DROP TABLE IF EXISTS preview_platform.edit_milestone;
    DROP TABLE IF EXISTS preview_platform.edit_transaction;
    DROP TYPE IF EXISTS preview_platform.edit_bug_status;
    DROP TYPE IF EXISTS preview_platform.edit_milestone_status;
    DROP TYPE IF EXISTS preview_platform.edit_transaction_status;
  `);
};
