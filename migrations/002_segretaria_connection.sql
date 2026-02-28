BEGIN;

CREATE TABLE IF NOT EXISTS public.segretaria_connections (
  workspace_id uuid PRIMARY KEY,
  segretaria_base_url text NOT NULL,
  api_key text NOT NULL,
  hmac_secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL
);

ALTER TABLE IF EXISTS public.segretaria_connections
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS segretaria_base_url text,
  ADD COLUMN IF NOT EXISTS api_key text,
  ADD COLUMN IF NOT EXISTS hmac_secret text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text NULL;

CREATE INDEX IF NOT EXISTS idx_segretaria_connections_active
  ON public.segretaria_connections (is_active, updated_at DESC);

COMMIT;
