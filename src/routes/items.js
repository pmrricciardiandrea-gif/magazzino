const express = require("express");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeItemType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["service", "servizio"].includes(raw)) return "service";
  return "item";
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

  const row = await db.query(
    `INSERT INTO public.items
     (id, workspace_id, sku, name, description, unit_label, item_type, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
     RETURNING *`,
    [
      uuidv4(),
      workspaceId,
      String(req.body?.sku || "").trim() || null,
      name,
      String(req.body?.description || "").trim() || null,
      String(req.body?.unit_label || "pz").trim() || "pz",
      String(req.body?.item_type || "item").trim() || "item",
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active),
    ]
  );

  return res.json({ ok: true, item: row.rows?.[0] || null });
});

router.post("/import", async (req, res) => {
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
    error_rows: [],
  };

  await db.query("BEGIN");
  try {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const sku = normalizeText(row.sku);
      const name = normalizeText(row.name);
      const description = normalizeText(row.description);
      const unitLabel = normalizeText(row.unit_label) || "pz";
      const itemType = normalizeItemType(row.item_type);

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
        await db.query(
          `UPDATE public.items
           SET sku=COALESCE($3, sku),
               name=COALESCE($4, name),
               description=COALESCE($5, description),
               unit_label=COALESCE($6, unit_label),
               item_type=COALESCE($7, item_type),
               updated_at=now()
           WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, existing.id, sku, name, description, unitLabel, itemType]
        );
        stats.updated += 1;
        continue;
      }

      await db.query(
        `INSERT INTO public.items
         (id, workspace_id, sku, name, description, unit_label, item_type, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,now(),now())`,
        [uuidv4(), workspaceId, sku, name || sku, description, unitLabel, itemType]
      );
      stats.inserted += 1;
    }
    await db.query("COMMIT");
    return res.json({ ok: true, stats });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ ok: false, error: "IMPORT_FAILED", details: err?.message || String(err) });
  }
});

module.exports = router;
