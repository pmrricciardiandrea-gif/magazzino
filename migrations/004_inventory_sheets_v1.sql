BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.inventory_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  task_id uuid NULL,
  project_id uuid NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  locked_by uuid NULL,
  notes text NULL,
  CONSTRAINT inventory_sheets_status_check CHECK (status IN ('DRAFT','LOCKED'))
);

CREATE TABLE IF NOT EXISTS public.inventory_sheet_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.inventory_sheets(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  qty numeric(14,3) NOT NULL,
  unit text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_sheet_rows_qty_positive CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_sheets_ws_created
  ON public.inventory_sheets(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_sheets_ws_status
  ON public.inventory_sheets(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_sheets_ws_task
  ON public.inventory_sheets(workspace_id, task_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_sheets_ws_project
  ON public.inventory_sheets(workspace_id, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_sheet_rows_ws_sheet
  ON public.inventory_sheet_rows(workspace_id, sheet_id, created_at ASC);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS sheet_id uuid NULL,
  ADD COLUMN IF NOT EXISTS task_id uuid NULL,
  ADD COLUMN IF NOT EXISTS project_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_ws_sheet
  ON public.stock_movements(workspace_id, sheet_id, created_at DESC);

COMMIT;
