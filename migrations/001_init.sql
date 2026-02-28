BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  sku text NULL,
  name text NOT NULL,
  description text NULL,
  unit_label text NOT NULL DEFAULT 'pz',
  item_type text NOT NULL DEFAULT 'item',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sku)
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  on_hand numeric(14,3) NOT NULL DEFAULT 0,
  reserved numeric(14,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  movement_type text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  reason text NULL,
  reference_type text NULL,
  reference_id text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pricebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.pricebook_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  pricebook_id uuid NOT NULL,
  item_id uuid NOT NULL,
  unit_price_cents bigint NOT NULL DEFAULT 0,
  vat_rate numeric(6,3) NOT NULL DEFAULT 22.0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, pricebook_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  draft_number text NULL,
  status text NOT NULL DEFAULT 'draft',
  client_ref text NULL,
  notes text NULL,
  currency text NOT NULL DEFAULT 'EUR',
  subtotal_cents bigint NOT NULL DEFAULT 0,
  vat_total_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL DEFAULT 0,
  reserve_stock boolean NOT NULL DEFAULT false,
  segretaria_quote_id uuid NULL,
  segretaria_finalize_url text NULL,
  pushed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.draft_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  line_type text NOT NULL DEFAULT 'item',
  item_id uuid NULL,
  title text NULL,
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit_label text NULL,
  unit_price_cents bigint NOT NULL DEFAULT 0,
  vat_rate numeric(6,3) NOT NULL DEFAULT 22.0,
  line_total_cents bigint NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_levels
  ADD CONSTRAINT stock_levels_wh_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE,
  ADD CONSTRAINT stock_levels_item_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_wh_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE,
  ADD CONSTRAINT stock_movements_item_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

ALTER TABLE public.pricebook_items
  ADD CONSTRAINT pricebook_items_pricebook_fkey FOREIGN KEY (pricebook_id) REFERENCES public.pricebooks(id) ON DELETE CASCADE,
  ADD CONSTRAINT pricebook_items_item_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

ALTER TABLE public.draft_lines
  ADD CONSTRAINT draft_lines_draft_fkey FOREIGN KEY (draft_id) REFERENCES public.drafts(id) ON DELETE CASCADE,
  ADD CONSTRAINT draft_lines_item_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_ws_active ON public.items(workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_stock_levels_ws ON public.stock_levels(workspace_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ws ON public.stock_movements(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricebook_items_ws ON public.pricebook_items(workspace_id, pricebook_id);
CREATE INDEX IF NOT EXISTS idx_drafts_ws ON public.drafts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_lines_ws ON public.draft_lines(workspace_id, draft_id, sort_order);

COMMIT;
