BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.worksheet_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  worksheet_id uuid NOT NULL REFERENCES public.inventory_sheets(id) ON DELETE CASCADE,
  author_user_id uuid NULL,
  body_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_worksheet_comments_ws_sheet_created
  ON public.worksheet_comments(workspace_id, worksheet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_worksheet_comments_ws_sheet_not_deleted
  ON public.worksheet_comments(workspace_id, worksheet_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.worksheet_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  worksheet_id uuid NOT NULL REFERENCES public.inventory_sheets(id) ON DELETE CASCADE,
  actor_user_id uuid NULL,
  action text NOT NULL,
  changes_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worksheet_audit_log_ws_sheet_created
  ON public.worksheet_audit_log(workspace_id, worksheet_id, created_at DESC);

COMMIT;
