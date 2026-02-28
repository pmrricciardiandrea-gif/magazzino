const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { applyStockMovement } = require("../services/stockService");

const router = express.Router();

router.get("/warehouses", async (req, res) => {
  const { db, workspaceId } = req;
  const includeInactive = String(req.query.include_inactive || "false").toLowerCase() === "true";
  const params = [workspaceId];
  let where = "WHERE workspace_id=$1";
  if (!includeInactive) where += " AND is_active=true";

  const rows = await db.query(
    `SELECT *
     FROM public.warehouses
     ${where}
     ORDER BY is_default DESC, name ASC`,
    params
  );
  return res.json({ ok: true, warehouses: rows.rows || [] });
});

router.post("/warehouses", async (req, res) => {
  const { db, workspaceId } = req;
  const name = String(req.body?.name || "").trim();
  const isDefault = Boolean(req.body?.is_default);
  if (!name) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "name required" });

  try {
    await db.query("BEGIN");
    if (isDefault) {
      await db.query(
        `UPDATE public.warehouses
         SET is_default=false, updated_at=now()
         WHERE workspace_id=$1`,
        [workspaceId]
      );
    }

    const created = await db.query(
      `INSERT INTO public.warehouses
       (id, workspace_id, name, is_default, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,now(),now())
       RETURNING *`,
      [uuidv4(), workspaceId, name, isDefault]
    );
    await db.query("COMMIT");
    return res.json({ ok: true, warehouse: created.rows?.[0] || null });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(400).json({
      ok: false,
      error: "WAREHOUSE_CREATE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.get("/levels", async (req, res) => {
  const { db, workspaceId } = req;
  const rows = await db.query(
    `SELECT sl.*, i.name AS item_name, w.name AS warehouse_name,
            (sl.on_hand - sl.reserved) AS available
     FROM public.stock_levels sl
     LEFT JOIN public.items i ON i.id=sl.item_id
     LEFT JOIN public.warehouses w ON w.id=sl.warehouse_id
     WHERE sl.workspace_id=$1
     ORDER BY sl.updated_at DESC`,
    [workspaceId]
  );
  return res.json({ ok: true, levels: rows.rows || [] });
});

router.get("/movements", async (req, res) => {
  const { db, workspaceId } = req;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50) || 50));
  const sheetId = String(req.query.sheet_id || "").trim();
  const taskId = String(req.query.task_id || "").trim();
  const projectId = String(req.query.project_id || "").trim();
  const params = [workspaceId];
  let where = "WHERE sm.workspace_id=$1";
  if (sheetId) {
    params.push(sheetId);
    where += ` AND sm.sheet_id=$${params.length}`;
  }
  if (taskId) {
    params.push(taskId);
    where += ` AND sm.task_id=$${params.length}`;
  }
  if (projectId) {
    params.push(projectId);
    where += ` AND sm.project_id=$${params.length}`;
  }
  params.push(limit);

  const rows = await db.query(
    `SELECT sm.*, i.name AS item_name, w.name AS warehouse_name
     FROM public.stock_movements sm
     LEFT JOIN public.items i ON i.id=sm.item_id
     LEFT JOIN public.warehouses w ON w.id=sm.warehouse_id
     ${where}
     ORDER BY sm.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return res.json({ ok: true, movements: rows.rows || [] });
});

router.post("/movements", async (req, res) => {
  const { db, workspaceId } = req;
  const warehouseId = String(req.body?.warehouse_id || "").trim();
  const itemId = String(req.body?.item_id || "").trim();
  const movementType = String(req.body?.movement_type || "").trim();
  const quantity = Number(req.body?.quantity || 0);

  if (!warehouseId || !itemId || !movementType || !Number.isFinite(quantity) || quantity === 0) {
    return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "warehouse_id, item_id, movement_type, quantity required" });
  }

  try {
    await db.query("BEGIN");
    const stock = await applyStockMovement(db, {
      workspaceId,
      warehouseId,
      itemId,
      movementType,
      quantity,
      reason: req.body?.reason || null,
      referenceType: req.body?.reference_type || null,
      referenceId: req.body?.reference_id || null,
      createdBy: req.header("x-user-id") || "api",
    });
    await db.query("COMMIT");
    return res.json({ ok: true, stock });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.code?.startsWith("VALIDATION") ? 400 : 409).json({
      ok: false,
      error: err?.code || "STOCK_MOVEMENT_FAILED",
      details: err?.message || String(err),
    });
  }
});

module.exports = router;
