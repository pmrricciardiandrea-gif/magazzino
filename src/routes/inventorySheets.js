"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const {
  inventorySheetsEnabled,
  ensureSheetTables,
  createInventorySheetDraft,
  addInventorySheetRow,
  lockInventorySheet,
  assertSheetDraft,
  ensureItemExists,
  makeError,
  normalizeText,
  normalizeQty,
} = require("../services/inventorySheetsService");

const router = express.Router();

function ensureFeatureEnabled(req, res, next) {
  if (inventorySheetsEnabled()) return next();
  return res.status(404).json({
    ok: false,
    error: "FEATURE_DISABLED",
    details: "Inventory sheets disabled (INVENTORY_SHEETS_V1=false)",
  });
}

router.get("/meta", (_req, res) => {
  return res.json({ ok: true, enabled: inventorySheetsEnabled() });
});

router.use(ensureFeatureEnabled);

router.get("/", async (req, res) => {
  const { db, workspaceId } = req;
  try {
    await ensureSheetTables(db);

    const status = String(req.query.status || "").trim().toUpperCase();
    const taskId = String(req.query.taskId || "").trim();
    const projectId = String(req.query.projectId || "").trim();
    const dateFrom = String(req.query.dateFrom || "").trim();
    const dateTo = String(req.query.dateTo || "").trim();

    const params = [workspaceId];
    let where = "WHERE s.workspace_id=$1";

    if (["DRAFT", "LOCKED"].includes(status)) {
      params.push(status);
      where += ` AND s.status=$${params.length}`;
    }
    if (taskId) {
      params.push(taskId);
      where += ` AND s.task_id=$${params.length}`;
    }
    if (projectId) {
      params.push(projectId);
      where += ` AND s.project_id=$${params.length}`;
    }
    if (dateFrom) {
      params.push(dateFrom);
      where += ` AND s.created_at >= $${params.length}::timestamptz`;
    }
    if (dateTo) {
      params.push(dateTo);
      where += ` AND s.created_at <= $${params.length}::timestamptz`;
    }

    const rows = await db.query(
      `SELECT s.*,
              COALESCE(r.rows_count, 0) AS rows_count
       FROM public.inventory_sheets s
       LEFT JOIN (
         SELECT sheet_id, count(*)::int AS rows_count
         FROM public.inventory_sheet_rows
         WHERE workspace_id=$1
         GROUP BY sheet_id
       ) r ON r.sheet_id=s.id
       ${where}
       ORDER BY s.updated_at DESC`,
      params
    );
    return res.json({ ok: true, sheets: rows.rows || [] });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEETS_LIST_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.post("/", async (req, res) => {
  const { db, workspaceId } = req;
  try {
    await ensureSheetTables(db);
    const out = await createInventorySheetDraft(db, {
      workspaceId,
      userId: req.header("x-user-id") || null,
      title: req.body?.title,
      notes: normalizeText(req.body?.notes),
      taskId: normalizeText(req.body?.task_id),
      projectId: normalizeText(req.body?.project_id),
    });
    return res.json({ ok: true, sheet_id: out.id, status: "DRAFT" });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_CREATE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.get("/:id", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    const sheetRes = await db.query(
      `SELECT *
       FROM public.inventory_sheets
       WHERE workspace_id=$1 AND id=$2
       LIMIT 1`,
      [workspaceId, sheetId]
    );
    if (!sheetRes.rowCount) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const sheet = sheetRes.rows[0];

    const rowsRes = await db.query(
      `SELECT r.*, i.name AS item_name, i.sku AS item_sku
       FROM public.inventory_sheet_rows r
       JOIN public.items i ON i.id=r.item_id AND i.workspace_id=r.workspace_id
       WHERE r.workspace_id=$1 AND r.sheet_id=$2
       ORDER BY r.created_at ASC`,
      [workspaceId, sheetId]
    );

    const movementsRes = await db.query(
      `SELECT sm.*, i.name AS item_name, w.name AS warehouse_name
       FROM public.stock_movements sm
       LEFT JOIN public.items i ON i.id=sm.item_id
       LEFT JOIN public.warehouses w ON w.id=sm.warehouse_id
       WHERE sm.workspace_id=$1 AND sm.sheet_id=$2
       ORDER BY sm.created_at DESC
       LIMIT 300`,
      [workspaceId, sheetId]
    );

    return res.json({
      ok: true,
      sheet,
      rows: rowsRes.rows || [],
      movements: movementsRes.rows || [],
      readonly: String(sheet.status || "").toUpperCase() !== "DRAFT",
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_GET_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.patch("/:id", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await assertSheetDraft(db, workspaceId, sheetId);

    const title = normalizeText(req.body?.title);
    const notes = normalizeText(req.body?.notes);
    const taskId = normalizeText(req.body?.task_id);
    const projectId = normalizeText(req.body?.project_id);

    await db.query(
      `UPDATE public.inventory_sheets
       SET title=COALESCE($3, title),
           notes=$4,
           task_id=$5,
           project_id=$6,
           updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, sheetId, title, notes, taskId, projectId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_PATCH_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.post("/:id/rows", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    const row = await addInventorySheetRow(db, {
      workspaceId,
      sheetId,
      itemId: req.body?.item_id,
      qty: req.body?.qty,
      unit: req.body?.unit,
    });
    return res.json({ ok: true, row });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_CREATE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.patch("/:id/rows/:rowId", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  const rowId = String(req.params.rowId || "").trim();
  if (!sheetId || !rowId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await assertSheetDraft(db, workspaceId, sheetId);
    const qty = normalizeQty(req.body?.qty);
    const unit = normalizeText(req.body?.unit);
    const itemId = normalizeText(req.body?.item_id);
    if (qty == null) throw makeError("VALIDATION_ERROR", "qty must be > 0", 400);
    if (itemId) await ensureItemExists(db, workspaceId, itemId);

    const result = await db.query(
      `UPDATE public.inventory_sheet_rows
       SET qty=$4,
           unit=COALESCE($5, unit),
           item_id=COALESCE($6, item_id),
           updated_at=now()
       WHERE workspace_id=$1 AND sheet_id=$2 AND id=$3
       RETURNING *`,
      [workspaceId, sheetId, rowId, qty, unit, itemId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "ROW_NOT_FOUND" });
    await db.query(`UPDATE public.inventory_sheets SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, sheetId]);
    return res.json({ ok: true, row: result.rows[0] });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_PATCH_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.delete("/:id/rows/:rowId", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  const rowId = String(req.params.rowId || "").trim();
  if (!sheetId || !rowId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await assertSheetDraft(db, workspaceId, sheetId);
    const result = await db.query(
      `DELETE FROM public.inventory_sheet_rows
       WHERE workspace_id=$1 AND sheet_id=$2 AND id=$3`,
      [workspaceId, sheetId, rowId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "ROW_NOT_FOUND" });
    await db.query(`UPDATE public.inventory_sheets SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, sheetId]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_DELETE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.post("/:id/lock", async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    const summary = await lockInventorySheet(db, {
      workspaceId,
      sheetId,
      userId: req.header("x-user-id") || null,
    });
    return res.json({ ok: true, summary });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_LOCK_FAILED",
      details: err?.message || String(err),
      insufficiencies: err?.insufficiencies || null,
    });
  }
});

module.exports = router;
