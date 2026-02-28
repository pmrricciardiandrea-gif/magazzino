BEGIN;

DO $$
BEGIN
  IF to_regclass('public.segreteria_connections') IS NOT NULL
     AND to_regclass('public.segretaria_connections') IS NULL THEN
    EXECUTE 'ALTER TABLE public.segreteria_connections RENAME TO segretaria_connections';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='segretaria_connections'
      AND column_name='segreteria_base_url'
  ) THEN
    EXECUTE 'ALTER TABLE public.segretaria_connections RENAME COLUMN segreteria_base_url TO segretaria_base_url';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.segretaria_connections
  ADD COLUMN IF NOT EXISTS segretaria_base_url text,
  ADD COLUMN IF NOT EXISTS last_error text NULL;

CREATE INDEX IF NOT EXISTS idx_segretaria_connections_active
  ON public.segretaria_connections (is_active, updated_at DESC);

COMMIT;
