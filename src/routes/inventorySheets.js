"use strict";

const express = require("express");
const {
  inventorySheetsEnabled,
  ensureSheetTables,
  createInventorySheetDraft,
  addInventorySheetRow,
  lockInventorySheet,
  fetchSheetById,
  syncSheetStockMovements,
  ensureItemExists,
  makeError,
  normalizeText,
  normalizeQty,
  appendSheetAuditEvent,
  listSheetComments,
  addSheetComment,
  softDeleteSheetComment,
  listSheetTimeline,
  isLockedSheet,
} = require("../services/inventorySheetsService");
const { PERMISSIONS, requirePermission } = require("../services/workspaceRole");

const router = express.Router();

function ensureFeatureEnabled(req, res, next) {
  if (inventorySheetsEnabled()) return next();
  return res.status(404).json({
    ok: false,
    error: "FEATURE_DISABLED",
    details: "Inventory sheets disabled (INVENTORY_SHEETS_V1=false)",
  });
}

function asLimit(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

router.get("/meta", async (req, res) => {
  const enabled = inventorySheetsEnabled();
  if (!enabled) {
    return res.json({
      ok: true,
      enabled: false,
      known_tasks: [],
      known_projects: [],
    });
  }

  const { db, workspaceId } = req;
  try {
    await ensureSheetTables(db);
    const [taskRows, projectRows] = await Promise.all([
      db.query(
        `SELECT DISTINCT task_id
         FROM public.inventory_sheets
         WHERE workspace_id=$1
           AND task_id IS NOT NULL
           AND btrim(task_id::text) <> ''
         ORDER BY task_id ASC
         LIMIT 300`,
        [workspaceId]
      ),
      db.query(
        `SELECT DISTINCT project_id
         FROM public.inventory_sheets
         WHERE workspace_id=$1
           AND project_id IS NOT NULL
           AND btrim(project_id::text) <> ''
         ORDER BY project_id ASC
         LIMIT 300`,
        [workspaceId]
      ),
    ]);

    return res.json({
      ok: true,
      enabled: true,
      known_tasks: (taskRows.rows || []).map((row) => row.task_id).filter(Boolean),
      known_projects: (projectRows.rows || []).map((row) => row.project_id).filter(Boolean),
    });
  } catch (_) {
    return res.json({
      ok: true,
      enabled: true,
      known_tasks: [],
      known_projects: [],
    });
  }
});

router.use(ensureFeatureEnabled);
router.use(requirePermission(PERMISSIONS.WORKSHEET_READ, { message: "Permesso richiesto: WORKSHEET_READ" }));

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

router.post("/", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
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
    const sheet = await fetchSheetById(db, workspaceId, sheetId);

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

    const [comments, timeline] = await Promise.all([
      listSheetComments(db, {
        workspaceId,
        sheetId,
        limit: asLimit(req.query.comments_limit, 30),
        offset: 0,
      }),
      listSheetTimeline(db, {
        workspaceId,
        sheetId,
        limit: asLimit(req.query.timeline_limit, 60),
        offset: 0,
      }),
    ]);

    return res.json({
      ok: true,
      sheet,
      rows: rowsRes.rows || [],
      movements: movementsRes.rows || [],
      comments,
      timeline,
      readonly: false,
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_GET_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.patch("/:id", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    const sheet = await fetchSheetById(db, workspaceId, sheetId, { lock: true });

    const title = normalizeText(req.body?.title);
    const notes = normalizeText(req.body?.notes);
    const taskId = normalizeText(req.body?.task_id);
    const projectId = normalizeText(req.body?.project_id);
    const patchHasTitle = Object.prototype.hasOwnProperty.call(req.body || {}, "title");
    const patchHasNotes = Object.prototype.hasOwnProperty.call(req.body || {}, "notes");

    const updates = [];
    const params = [workspaceId, sheetId];
    let idx = 3;

    if (patchHasTitle) {
      if (!title) throw makeError("VALIDATION_ERROR", "title non può essere vuoto", 400);
      if (title !== sheet.title) {
        updates.push(`title=$${idx}`);
        params.push(title);
        idx += 1;
      }
    }
    if (patchHasNotes && notes !== sheet.notes) {
      updates.push(`notes=$${idx}`);
      params.push(notes);
      idx += 1;
    }

    const patchHasTask = Object.prototype.hasOwnProperty.call(req.body || {}, "task_id");
    const patchHasProject = Object.prototype.hasOwnProperty.call(req.body || {}, "project_id");
    if ((patchHasTask || patchHasProject) && isLockedSheet(sheet)) {
      throw makeError("SHEET_LOCKED_LINKS", "Task/Project non modificabili su scheda LOCKED", 409);
    }
    if (patchHasTask && taskId !== sheet.task_id) {
      updates.push(`task_id=$${idx}`);
      params.push(taskId);
      idx += 1;
    }
    if (patchHasProject && projectId !== sheet.project_id) {
      updates.push(`project_id=$${idx}`);
      params.push(projectId);
      idx += 1;
    }

    const changes = {
      before: { title: sheet.title, notes: sheet.notes, task_id: sheet.task_id, project_id: sheet.project_id },
      after: { title: sheet.title, notes: sheet.notes, task_id: sheet.task_id, project_id: sheet.project_id },
    };
    if (updates.length) {
      updates.push("updated_at=now()");
      await db.query(
        `UPDATE public.inventory_sheets
         SET ${updates.join(", ")}
         WHERE workspace_id=$1 AND id=$2`,
        params
      );

      if (patchHasTitle) changes.after.title = title;
      if (patchHasNotes) changes.after.notes = notes;
      if (patchHasTask) changes.after.task_id = taskId;
      if (patchHasProject) changes.after.project_id = projectId;
      await appendSheetAuditEvent(db, {
        workspaceId,
        sheetId,
        actorUserId: req.header("x-user-id") || null,
        action: "worksheet.updated",
        changes,
      });
    }
    await db.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_PATCH_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.post("/:id/rows", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    const result = await addInventorySheetRow(db, {
      workspaceId,
      sheetId,
      itemId: req.body?.item_id,
      qty: req.body?.qty,
      unit: req.body?.unit,
    });
    const sync = isLockedSheet(result.sheet)
      ? await syncSheetStockMovements(db, {
          workspaceId,
          sheetId,
          userId: req.header("x-user-id") || null,
          sheet: result.sheet,
        })
      : null;
    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: req.header("x-user-id") || null,
      action: "worksheet.items.updated",
      changes: {
        op: "add_row",
        row_id: result.row?.id || null,
        item_id: result.row?.item_id || null,
        qty: result.row?.qty || null,
        lock_sync: sync ? { movements_created: sync.movements_created, qty_delta: sync.qty_delta } : null,
      },
    });
    await db.query("COMMIT");
    return res.json({ ok: true, row: result.row, lock_sync: sync });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_CREATE_FAILED",
      details: err?.message || String(err),
      insufficiencies: err?.insufficiencies || null,
    });
  }
});

router.patch("/:id/rows/:rowId", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  const rowId = String(req.params.rowId || "").trim();
  if (!sheetId || !rowId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    const sheet = await fetchSheetById(db, workspaceId, sheetId, { lock: true });
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
    if (!result.rowCount) throw makeError("ROW_NOT_FOUND", "Row not found", 404);
    await db.query(`UPDATE public.inventory_sheets SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, sheetId]);

    const sync = isLockedSheet(sheet)
      ? await syncSheetStockMovements(db, {
          workspaceId,
          sheetId,
          userId: req.header("x-user-id") || null,
          sheet,
        })
      : null;
    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: req.header("x-user-id") || null,
      action: "worksheet.items.updated",
      changes: {
        op: "patch_row",
        row_id: rowId,
        item_id: result.rows[0]?.item_id || null,
        qty: result.rows[0]?.qty || null,
        lock_sync: sync ? { movements_created: sync.movements_created, qty_delta: sync.qty_delta } : null,
      },
    });
    await db.query("COMMIT");
    return res.json({ ok: true, row: result.rows[0], lock_sync: sync });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_PATCH_FAILED",
      details: err?.message || String(err),
      insufficiencies: err?.insufficiencies || null,
    });
  }
});

router.delete("/:id/rows/:rowId", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  const rowId = String(req.params.rowId || "").trim();
  if (!sheetId || !rowId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    const sheet = await fetchSheetById(db, workspaceId, sheetId, { lock: true });
    const result = await db.query(
      `DELETE FROM public.inventory_sheet_rows
       WHERE workspace_id=$1 AND sheet_id=$2 AND id=$3`,
      [workspaceId, sheetId, rowId]
    );
    if (!result.rowCount) throw makeError("ROW_NOT_FOUND", "Row not found", 404);
    await db.query(`UPDATE public.inventory_sheets SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, sheetId]);

    const sync = isLockedSheet(sheet)
      ? await syncSheetStockMovements(db, {
          workspaceId,
          sheetId,
          userId: req.header("x-user-id") || null,
          sheet,
        })
      : null;
    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: req.header("x-user-id") || null,
      action: "worksheet.items.updated",
      changes: {
        op: "delete_row",
        row_id: rowId,
        lock_sync: sync ? { movements_created: sync.movements_created, qty_delta: sync.qty_delta } : null,
      },
    });
    await db.query("COMMIT");
    return res.json({ ok: true, lock_sync: sync });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_ROW_DELETE_FAILED",
      details: err?.message || String(err),
      insufficiencies: err?.insufficiencies || null,
    });
  }
});

router.post("/:id/lock", requirePermission(PERMISSIONS.WORKSHEET_WRITE, { message: "Permesso richiesto: WORKSHEET_WRITE" }), async (req, res) => {
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

router.get("/:id/comments", requirePermission(PERMISSIONS.WORKSHEET_COMMENT_READ, { message: "Permesso richiesto: WORKSHEET_COMMENT_READ" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await fetchSheetById(db, workspaceId, sheetId);
    const comments = await listSheetComments(db, {
      workspaceId,
      sheetId,
      limit: asLimit(req.query.limit, 100),
      offset: Math.max(0, Number(req.query.offset || 0) || 0),
    });
    return res.json({ ok: true, comments });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_COMMENTS_LIST_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.post("/:id/comments", requirePermission(PERMISSIONS.WORKSHEET_COMMENT_WRITE, { message: "Permesso richiesto: WORKSHEET_COMMENT_WRITE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    await fetchSheetById(db, workspaceId, sheetId, { lock: true });
    const comment = await addSheetComment(db, {
      workspaceId,
      sheetId,
      authorUserId: req.header("x-user-id") || null,
      bodyText: req.body?.body_text,
    });
    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: req.header("x-user-id") || null,
      action: "worksheet.comment.created",
      changes: { comment_id: comment?.id || null },
    });
    await db.query("COMMIT");
    return res.json({ ok: true, comment });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_COMMENT_CREATE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.delete("/:id/comments/:commentId", requirePermission(PERMISSIONS.WORKSHEET_COMMENT_DELETE, { message: "Permesso richiesto: WORKSHEET_COMMENT_DELETE" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  const commentId = String(req.params.commentId || "").trim();
  if (!sheetId || !commentId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await db.query("BEGIN");
    await fetchSheetById(db, workspaceId, sheetId, { lock: true });
    await softDeleteSheetComment(db, {
      workspaceId,
      sheetId,
      commentId,
    });
    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: req.header("x-user-id") || null,
      action: "worksheet.comment.deleted",
      changes: { comment_id: commentId },
    });
    await db.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_COMMENT_DELETE_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.get("/:id/timeline", requirePermission(PERMISSIONS.WORKSHEET_TIMELINE_READ, { message: "Permesso richiesto: WORKSHEET_TIMELINE_READ" }), async (req, res) => {
  const { db, workspaceId } = req;
  const sheetId = String(req.params.id || "").trim();
  if (!sheetId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "id required" });
  try {
    await ensureSheetTables(db);
    await fetchSheetById(db, workspaceId, sheetId);
    const timeline = await listSheetTimeline(db, {
      workspaceId,
      sheetId,
      limit: asLimit(req.query.limit, 100),
      offset: Math.max(0, Number(req.query.offset || 0) || 0),
    });
    return res.json({ ok: true, timeline });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.code || "SHEET_TIMELINE_LIST_FAILED",
      details: err?.message || String(err),
    });
  }
});

module.exports = router;
