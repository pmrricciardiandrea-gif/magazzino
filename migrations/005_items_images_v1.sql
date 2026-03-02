BEGIN;

ALTER TABLE IF EXISTS public.items
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_thumb_url text;

CREATE INDEX IF NOT EXISTS idx_items_ws_active_updated
  ON public.items(workspace_id, is_active, updated_at DESC);

COMMIT;

