CREATE SCHEMA IF NOT EXISTS preview_platform;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS preview_platform.project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    active_port INTEGER,
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

      preview_url TEXT,
      container_name TEXT,
      image_name TEXT,

      logs JSONB,
      error TEXT,

      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
