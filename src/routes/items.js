const express = require("express");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return null;
}

function normalizeItemType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["service", "servizio"].includes(raw)) return "service";
  return "item";
}

function normalizeDecimal(value, fallback = null) {
  if (value == null) return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=.*\.)/g, "")
    .replace(",", ".");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function normalizeInteger(value, fallback = null) {
  const num = normalizeDecimal(value, null);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num);
}

function normalizeCents(value, fallback = null) {
  const num = normalizeDecimal(value, null);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num * 100);
}

function normalizeVatRate(value, fallback = 22) {
  const num = normalizeDecimal(value, null);
  if (!Number.isFinite(num)) return fallback;
  if (num < 0) return 0;
  if (num > 100) return 100;
  return num;
}

async function loadTableColumns(db, tableName) {
  const q = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  return new Set((q.rows || []).map((row) => String(row.column_name || "").trim()));
}

async function ensureDefaultPricebook(db, workspaceId) {
  const existing = await db.query(
    `SELECT id
     FROM public.pricebooks
     WHERE workspace_id=$1 AND is_default=true AND is_active=true
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [workspaceId]
  );
  if (existing.rowCount) return existing.rows[0].id;

  const fallback = await db.query(
    `SELECT id
     FROM public.pricebooks
     WHERE workspace_id=$1 AND is_active=true
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [workspaceId]
  );
  if (fallback.rowCount) {
    const pricebookId = fallback.rows[0].id;
    await db.query(
      `UPDATE public.pricebooks
       SET is_default=true, updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, pricebookId]
    );
    return pricebookId;
  }

  const createdId = uuidv4();
  await db.query(
    `INSERT INTO public.pricebooks
     (id, workspace_id, name, currency, is_default, is_active, created_at, updated_at)
     VALUES ($1,$2,'Listino base','EUR',true,true,now(),now())`,
    [createdId, workspaceId]
  );
  return createdId;
}

async function upsertPricebookItem(db, workspaceId, itemId, unitPriceCents, vatRate) {
  const hasPrice = Number.isFinite(Number(unitPriceCents));
  const hasVat = Number.isFinite(Number(vatRate));
  if (!hasPrice && !hasVat) return;
  const pricebookId = await ensureDefaultPricebook(db, workspaceId);
  await db.query(
    `INSERT INTO public.pricebook_items
     (id, workspace_id, pricebook_id, item_id, unit_price_cents, vat_rate, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (workspace_id, pricebook_id, item_id)
     DO UPDATE SET
       unit_price_cents=COALESCE($5, public.pricebook_items.unit_price_cents),
       vat_rate=COALESCE($6, public.pricebook_items.vat_rate),
       updated_at=now()`,
    [uuidv4(), workspaceId, pricebookId, itemId, hasPrice ? unitPriceCents : null, hasVat ? vatRate : null]
  );
}

router.get("/", async (req, res) => {
  const { db, workspaceId } = req;
  const q = String(req.query.q || "").trim().toLowerCase();
  const includeInactive = String(req.query.include_inactive || "false").toLowerCase() === "true";

  const params = [workspaceId];
  let where = "WHERE workspace_id=$1";
  if (!includeInactive) where += " AND is_active=true";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (lower(name) LIKE $${params.length} OR lower(coalesce(sku,'')) LIKE $${params.length})`;
  }

  const rows = await db.query(
    `SELECT *
     FROM public.items
     ${where}
     ORDER BY created_at DESC`,
    params
  );

  return res.json({ ok: true, items: rows.rows || [] });
});

router.post("/", async (req, res) => {
  const { db, workspaceId } = req;
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "name required" });
  const itemCols = await loadTableColumns(db, "items");
  const hasImageUrl = itemCols.has("image_url");
  const hasImageThumbUrl = itemCols.has("image_thumb_url");
  const imageUrl = normalizeImageUrl(req.body?.image_url ?? req.body?.imageUrl);
  const imageThumbUrl = normalizeImageUrl(req.body?.image_thumb_url ?? req.body?.imageThumbUrl) || imageUrl;

  const cols = ["id", "workspace_id", "sku", "name", "description", "unit_label", "item_type", "is_active", "created_at", "updated_at"];
  const values = ["$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "now()", "now()"];
  const params = [
    uuidv4(),
    workspaceId,
    String(req.body?.sku || "").trim() || null,
    name,
    String(req.body?.description || "").trim() || null,
    String(req.body?.unit_label || "pz").trim() || "pz",
    String(req.body?.item_type || "item").trim() || "item",
    req.body?.is_active === undefined ? true : Boolean(req.body.is_active),
  ];
  let idx = 9;
  if (hasImageUrl) {
    cols.push("image_url");
    values.push(`$${idx}`);
    params.push(imageUrl);
    idx += 1;
  }
  if (hasImageThumbUrl) {
    cols.push("image_thumb_url");
    values.push(`$${idx}`);
    params.push(imageThumbUrl);
    idx += 1;
  }

  const row = await db.query(
    `INSERT INTO public.items
     (${cols.join(", ")})
     VALUES (${values.join(", ")})
     RETURNING *`,
    params
  );

  return res.json({ ok: true, item: row.rows?.[0] || null });
});

async function importItemsHandler(req, res) {
  const { db, workspaceId } = req;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const maxRows = Math.max(1, Number(process.env.ITEMS_IMPORT_MAX_ROWS || 500));
  if (!rows.length) {
    return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "rows required" });
  }
  if (rows.length > maxRows) {
    return res
      .status(400)
      .json({ ok: false, error: "VALIDATION_ERROR", details: `rows limit exceeded (max ${maxRows})` });
  }

  const stats = {
    total: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    priced: 0,
    error_rows: [],
  };

  await db.query("BEGIN");
  try {
    const itemColumns = await loadTableColumns(db, "items");
    const hasCategory = itemColumns.has("category");
    const hasBarcode = itemColumns.has("barcode");
    const hasCostCents = itemColumns.has("cost_cents");
    const hasCost = itemColumns.has("cost");
    const hasVatRate = itemColumns.has("vat_rate");
    const hasImageUrl = itemColumns.has("image_url");
    const hasImageThumbUrl = itemColumns.has("image_thumb_url");

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const sku = normalizeText(row.sku);
      const name = normalizeText(row.name);
      const description = normalizeText(row.description);
      const unitLabel = normalizeText(row.unit_label) || "pz";
      const itemType = normalizeItemType(row.item_type);
      const category = normalizeText(row.category);
      const barcode = normalizeText(row.barcode);
      const unitPriceCents = normalizeCents(row.unit_price_cents ?? row.unit_price ?? row.prezzo_vendita ?? row.price);
      const costCents = normalizeCents(row.cost_cents ?? row.costo ?? row.cost);
      const vatRate = normalizeVatRate(row.vat_rate ?? row.iva_percentuale ?? row.vat ?? row.iva, 22);
      const imageUrl = normalizeImageUrl(row.image_url ?? row.image ?? row.immagine_url ?? row.foto ?? row.photo_url);
      const imageThumbUrl = normalizeImageUrl(row.image_thumb_url ?? row.thumb_url ?? row.thumbnail_url) || imageUrl;

      if (!name && !sku) {
        stats.skipped += 1;
        stats.errors += 1;
        if (stats.error_rows.length < 25) {
          stats.error_rows.push({ row_index: index + 1, reason: "missing_name_and_sku" });
        }
        continue;
      }

      let existing = null;
      if (sku) {
        const bySku = await db.query(
          `SELECT id
           FROM public.items
           WHERE workspace_id=$1 AND sku=$2
           LIMIT 1`,
          [workspaceId, sku]
        );
        existing = bySku.rows?.[0] || null;
      }
      if (!existing && name) {
        const byName = await db.query(
          `SELECT id
           FROM public.items
           WHERE workspace_id=$1 AND lower(name)=lower($2)
           ORDER BY created_at ASC
           LIMIT 1`,
          [workspaceId, name]
        );
        existing = byName.rows?.[0] || null;
      }

      if (existing?.id) {
        const setParts = [
          "sku=COALESCE($3, sku)",
          "name=COALESCE($4, name)",
          "description=COALESCE($5, description)",
          "unit_label=COALESCE($6, unit_label)",
          "item_type=COALESCE($7, item_type)",
          "updated_at=now()",
        ];
        const params = [workspaceId, existing.id, sku, name, description, unitLabel, itemType];
        let nextIdx = 8;
        if (hasCategory) {
          setParts.push(`category=COALESCE($${nextIdx}, category)`);
          params.push(category);
          nextIdx += 1;
        }
        if (hasBarcode) {
          setParts.push(`barcode=COALESCE($${nextIdx}, barcode)`);
          params.push(barcode);
          nextIdx += 1;
        }
        if (hasCostCents) {
          setParts.push(`cost_cents=COALESCE($${nextIdx}, cost_cents)`);
          params.push(costCents);
          nextIdx += 1;
        } else if (hasCost) {
          setParts.push(`cost=COALESCE($${nextIdx}, cost)`);
          params.push(normalizeDecimal(row.costo ?? row.cost, null));
          nextIdx += 1;
        }
        if (hasVatRate) {
          setParts.push(`vat_rate=COALESCE($${nextIdx}, vat_rate)`);
          params.push(vatRate);
          nextIdx += 1;
        }
        if (hasImageUrl) {
          setParts.push(`image_url=COALESCE($${nextIdx}, image_url)`);
          params.push(imageUrl);
          nextIdx += 1;
        }
        if (hasImageThumbUrl) {
          setParts.push(`image_thumb_url=COALESCE($${nextIdx}, image_thumb_url)`);
          params.push(imageThumbUrl);
          nextIdx += 1;
        }
        await db.query(
          `UPDATE public.items
           SET ${setParts.join(", ")}
           WHERE workspace_id=$1 AND id=$2`,
          params
        );
        await upsertPricebookItem(db, workspaceId, existing.id, unitPriceCents, vatRate);
        if (Number.isFinite(Number(unitPriceCents)) || Number.isFinite(Number(vatRate))) stats.priced += 1;
        stats.updated += 1;
        continue;
      }

      const insertCols = ["id", "workspace_id", "sku", "name", "description", "unit_label", "item_type", "is_active", "created_at", "updated_at"];
      const insertValues = ["$1", "$2", "$3", "$4", "$5", "$6", "$7", "true", "now()", "now()"];
      const params = [uuidv4(), workspaceId, sku, name || sku, description, unitLabel, itemType];
      let nextIdx = 8;
      if (hasCategory) {
        insertCols.push("category");
        insertValues.push(`$${nextIdx}`);
        params.push(category);
        nextIdx += 1;
      }
      if (hasBarcode) {
        insertCols.push("barcode");
        insertValues.push(`$${nextIdx}`);
        params.push(barcode);
        nextIdx += 1;
      }
      if (hasCostCents) {
        insertCols.push("cost_cents");
        insertValues.push(`$${nextIdx}`);
        params.push(costCents);
        nextIdx += 1;
      } else if (hasCost) {
        insertCols.push("cost");
        insertValues.push(`$${nextIdx}`);
        params.push(normalizeDecimal(row.costo ?? row.cost, null));
        nextIdx += 1;
      }
      if (hasVatRate) {
        insertCols.push("vat_rate");
        insertValues.push(`$${nextIdx}`);
        params.push(vatRate);
        nextIdx += 1;
      }
      if (hasImageUrl) {
        insertCols.push("image_url");
        insertValues.push(`$${nextIdx}`);
        params.push(imageUrl);
        nextIdx += 1;
      }
      if (hasImageThumbUrl) {
        insertCols.push("image_thumb_url");
        insertValues.push(`$${nextIdx}`);
        params.push(imageThumbUrl);
        nextIdx += 1;
      }

      await db.query(
        `INSERT INTO public.items
         (${insertCols.join(", ")})
         VALUES (${insertValues.join(", ")})`,
        params
      );
      await upsertPricebookItem(db, workspaceId, params[0], unitPriceCents, vatRate);
      if (Number.isFinite(Number(unitPriceCents)) || Number.isFinite(Number(vatRate))) stats.priced += 1;
      stats.inserted += 1;
    }
    await db.query("COMMIT");
    return res.json({ ok: true, stats });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ ok: false, error: "IMPORT_FAILED", details: err?.message || String(err) });
  }
}

router.post("/import", importItemsHandler);
router.post("/import/execute", importItemsHandler);
router.post("/bulk-import", importItemsHandler);

module.exports = router;
