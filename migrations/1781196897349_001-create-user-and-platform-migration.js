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
    CREATE SCHEMA IF NOT EXISTS preview_platform;

    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS preview_platform.project (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      active_port INTEGER,
      preview_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS preview_platform.project_file (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL
        REFERENCES preview_platform.project(id)
        ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, path)
    );

    CREATE TABLE IF NOT EXISTS preview_platform.project_build (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL
        REFERENCES preview_platform.project(id)
        ON DELETE CASCADE,
      job_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      host_port INTEGER NOT NULL,
      artifact_url TEXT,
      container_name TEXT,
      image_name TEXT,
      logs JSONB,
      error TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS preview_platform."user" (
      "id" text not null primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null,
      "image" text,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
    );

    CREATE TABLE IF NOT EXISTS preview_platform."session" (
      "id" text not null primary key,
      "expiresAt" timestamptz not null,
      "token" text not null unique,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz not null,
      "ipAddress" text,
      "userAgent" text,
      "userId" text not null references preview_platform."user" ("id") on delete cascade
    );

    CREATE TABLE IF NOT EXISTS preview_platform."account" (
      "id" text not null primary key,
      "accountId" text not null,
      "providerId" text not null,
      "userId" text not null references preview_platform."user" ("id") on delete cascade,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz not null
    );

    CREATE TABLE IF NOT EXISTS preview_platform."verification" (
      "id" text not null primary key,
      "identifier" text not null,
      "value" text not null,
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
    );

    CREATE INDEX IF NOT EXISTS "session_userId_idx"
      ON preview_platform."session" ("userId");

    CREATE INDEX IF NOT EXISTS "account_userId_idx"
      ON preview_platform."account" ("userId");

    CREATE INDEX IF NOT EXISTS "verification_identifier_idx"
      ON preview_platform."verification" ("identifier");
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS preview_platform."verification_identifier_idx";
    DROP INDEX IF EXISTS preview_platform."account_userId_idx";
    DROP INDEX IF EXISTS preview_platform."session_userId_idx";

    DROP TABLE IF EXISTS preview_platform."verification";
    DROP TABLE IF EXISTS preview_platform."account";
    DROP TABLE IF EXISTS preview_platform."session";
    DROP TABLE IF EXISTS preview_platform."user";

    DROP TABLE IF EXISTS preview_platform.project_build;
    DROP TABLE IF EXISTS preview_platform.project_file;
    DROP TABLE IF EXISTS preview_platform.project;

    DROP SCHEMA IF EXISTS preview_platform;
  `);
};
