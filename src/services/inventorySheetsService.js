"use strict";

const { v4: uuidv4 } = require("uuid");
const { applyStockMovement } = require("./stockService");

function inventorySheetsEnabled() {
  const raw = String(process.env.INVENTORY_SHEETS_V1 || "true")
    .trim()
    .toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function makeError(code, message, status = 400, extras = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (extras && typeof extras === "object") {
    Object.assign(err, extras);
  }
  return err;
}

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeQty(value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

function normalizeUuid(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return raw;
  }
  return null;
}

function isDraftSheet(sheet) {
  return String(sheet?.status || "").toUpperCase() === "DRAFT";
}

function isLockedSheet(sheet) {
  return String(sheet?.status || "").toUpperCase() === "LOCKED";
}

function actorLabel(userId) {
  return normalizeText(userId) || "api";
}

async function ensureSheetTables(db) {
  const check = await db.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('inventory_sheets', 'inventory_sheet_rows', 'worksheet_comments', 'worksheet_audit_log')`
  );
  const names = new Set((check.rows || []).map((row) => String(row.table_name || "").trim()));
  const required = ["inventory_sheets", "inventory_sheet_rows", "worksheet_comments", "worksheet_audit_log"];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) {
    throw makeError(
      "DB_NOT_MIGRATED",
      `inventory sheets tables missing (${missing.join(", ")}). Run migration 006_inventory_sheets_hardening_v1.sql`,
      500
    );
  }
}

async function fetchSheetById(db, workspaceId, sheetId, { lock = false } = {}) {
  const query = `
    SELECT *
    FROM public.inventory_sheets
    WHERE workspace_id=$1 AND id=$2
    ${lock ? "FOR UPDATE" : ""}
  `;
  const result = await db.query(query, [workspaceId, sheetId]);
  const sheet = result.rows?.[0] || null;
  if (!sheet) throw makeError("NOT_FOUND", "Sheet not found", 404);
  return sheet;
}

async function assertSheetDraft(db, workspaceId, sheetId, { lock = false } = {}) {
  const sheet = await fetchSheetById(db, workspaceId, sheetId, { lock });
  if (!isDraftSheet(sheet)) {
    throw makeError("SHEET_LOCKED", "Sheet is locked and read-only", 409);
  }
  return sheet;
}

async function ensureItemExists(db, workspaceId, itemId) {
  const itemRes = await db.query(
    `SELECT id
     FROM public.items
     WHERE workspace_id=$1 AND id=$2
     LIMIT 1`,
    [workspaceId, itemId]
  );
  if (!itemRes.rowCount) {
    throw makeError("ITEM_NOT_FOUND", "Item not found in this workspace", 404);
  }
}

async function pickWarehouseForSheet(db, workspaceId, sheetId = null) {
  if (sheetId) {
    const existing = await db.query(
      `SELECT warehouse_id
       FROM public.stock_movements
       WHERE workspace_id=$1
         AND sheet_id=$2
         AND reference_type='inventory_sheet'
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId, sheetId]
    );
    const warehouseId = String(existing.rows?.[0]?.warehouse_id || "").trim();
    if (warehouseId) {
      const wh = await db.query(
        `SELECT id, name, is_default
         FROM public.warehouses
         WHERE workspace_id=$1 AND id=$2
         LIMIT 1`,
        [workspaceId, warehouseId]
      );
      if (wh.rowCount) return wh.rows[0];
    }
  }

  const res = await db.query(
    `SELECT id, name, is_default
     FROM public.warehouses
     WHERE workspace_id=$1 AND is_active=true
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [workspaceId]
  );
  const warehouse = res.rows?.[0] || null;
  if (!warehouse) {
    throw makeError("WAREHOUSE_NOT_FOUND", "No active warehouse found", 409);
  }
  return warehouse;
}

async function fetchRowsForLock(db, workspaceId, sheetId) {
  const rowsRes = await db.query(
    `SELECT r.id, r.item_id, r.qty, r.unit, i.name AS item_name
     FROM public.inventory_sheet_rows r
     JOIN public.items i ON i.id=r.item_id AND i.workspace_id=r.workspace_id
     WHERE r.workspace_id=$1 AND r.sheet_id=$2
     ORDER BY r.created_at ASC`,
    [workspaceId, sheetId]
  );
  return rowsRes.rows || [];
}

async function aggregateSheetRowsByItem(db, workspaceId, sheetId) {
  const rows = await db.query(
    `SELECT r.item_id,
            SUM(r.qty)::numeric AS qty,
            MAX(i.name) AS item_name
     FROM public.inventory_sheet_rows r
     JOIN public.items i ON i.id=r.item_id AND i.workspace_id=r.workspace_id
     WHERE r.workspace_id=$1 AND r.sheet_id=$2
     GROUP BY r.item_id`,
    [workspaceId, sheetId]
  );
  const out = new Map();
  for (const row of rows.rows || []) {
    out.set(String(row.item_id), {
      item_id: String(row.item_id),
      qty: Number(row.qty || 0),
      item_name: row.item_name || null,
    });
  }
  return out;
}

async function currentAppliedByItem(db, workspaceId, sheetId) {
  const rows = await db.query(
    `SELECT item_id,
            SUM(
              CASE
                WHEN movement_type='out' THEN quantity
                WHEN movement_type='in' THEN -quantity
                ELSE 0
              END
            )::numeric AS applied_qty
     FROM public.stock_movements
     WHERE workspace_id=$1
       AND sheet_id=$2
       AND reference_type='inventory_sheet'
       AND movement_type IN ('out', 'in')
     GROUP BY item_id`,
    [workspaceId, sheetId]
  );
  const out = new Map();
  for (const row of rows.rows || []) {
    out.set(String(row.item_id), Number(row.applied_qty || 0));
  }
  return out;
}

async function collectInsufficientStock(db, workspaceId, warehouseId, deltasByItem, desiredByItem) {
  const insuff = [];
  for (const [itemId, delta] of deltasByItem.entries()) {
    if (delta <= 0) continue;
    const levelRes = await db.query(
      `SELECT on_hand, reserved
       FROM public.stock_levels
       WHERE workspace_id=$1 AND warehouse_id=$2 AND item_id=$3
       LIMIT 1`,
      [workspaceId, warehouseId, itemId]
    );
    const level = levelRes.rows?.[0] || null;
    const onHand = Number(level?.on_hand || 0);
    const reserved = Number(level?.reserved || 0);
    const available = onHand - reserved;
    if (delta > available) {
      insuff.push({
        item_id: itemId,
        item_name: desiredByItem.get(itemId)?.item_name || null,
        requested_delta_qty: delta,
        available_qty: available,
      });
    }
  }
  return insuff;
}

async function appendSheetAuditEvent(
  db,
  {
    workspaceId,
    sheetId,
    actorUserId = null,
    action,
    changes = null,
  }
) {
  const cleanAction = normalizeText(action);
  if (!workspaceId || !sheetId || !cleanAction) return;
  const payload = changes && typeof changes === "object" ? changes : null;
  await db.query(
    `INSERT INTO public.worksheet_audit_log
     (id, workspace_id, worksheet_id, actor_user_id, action, changes_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())`,
    [
      uuidv4(),
      workspaceId,
      sheetId,
      normalizeUuid(actorUserId),
      cleanAction,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

async function listSheetComments(db, { workspaceId, sheetId, limit = 100, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 100) || 100));
  const safeOffset = Math.max(0, Number(offset || 0) || 0);
  const rows = await db.query(
    `SELECT *
     FROM public.worksheet_comments
     WHERE workspace_id=$1
       AND worksheet_id=$2
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [workspaceId, sheetId, safeLimit, safeOffset]
  );
  return rows.rows || [];
}

async function addSheetComment(db, { workspaceId, sheetId, authorUserId = null, bodyText }) {
  const body = normalizeText(bodyText);
  if (!body) throw makeError("VALIDATION_ERROR", "body_text required", 400);
  const row = await db.query(
    `INSERT INTO public.worksheet_comments
     (id, workspace_id, worksheet_id, author_user_id, body_text, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,now(),NULL,NULL)
     RETURNING *`,
    [uuidv4(), workspaceId, sheetId, normalizeUuid(authorUserId), body]
  );
  return row.rows?.[0] || null;
}

async function softDeleteSheetComment(db, { workspaceId, sheetId, commentId }) {
  const result = await db.query(
    `UPDATE public.worksheet_comments
     SET deleted_at=now(), updated_at=now()
     WHERE workspace_id=$1
       AND worksheet_id=$2
       AND id=$3
       AND deleted_at IS NULL`,
    [workspaceId, sheetId, commentId]
  );
  if (!result.rowCount) throw makeError("NOT_FOUND", "Comment not found", 404);
}

async function listSheetTimeline(db, { workspaceId, sheetId, limit = 100, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 100) || 100));
  const safeOffset = Math.max(0, Number(offset || 0) || 0);
  const rows = await db.query(
    `SELECT *
     FROM public.worksheet_audit_log
     WHERE workspace_id=$1
       AND worksheet_id=$2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [workspaceId, sheetId, safeLimit, safeOffset]
  );
  return rows.rows || [];
}

async function syncSheetStockMovements(db, { workspaceId, sheetId, userId = null, sheet = null }) {
  const lockedSheet = sheet || (await fetchSheetById(db, workspaceId, sheetId, { lock: true }));
  const desiredByItem = await aggregateSheetRowsByItem(db, workspaceId, sheetId);
  const appliedByItem = await currentAppliedByItem(db, workspaceId, sheetId);
  const allItemIds = new Set([...desiredByItem.keys(), ...appliedByItem.keys()]);

  const deltasByItem = new Map();
  for (const itemId of allItemIds) {
    const desired = Number(desiredByItem.get(itemId)?.qty || 0);
    const applied = Number(appliedByItem.get(itemId) || 0);
    const delta = desired - applied;
    if (Math.abs(delta) > 0.0000001) deltasByItem.set(itemId, delta);
  }

  const warehouse = await pickWarehouseForSheet(db, workspaceId, sheetId);
  const insuff = await collectInsufficientStock(db, workspaceId, warehouse.id, deltasByItem, desiredByItem);
  if (insuff.length) {
    throw makeError("INSUFFICIENT_STOCK", "Insufficient stock for one or more items", 409, { insufficiencies: insuff });
  }

  let movementsCount = 0;
  let totalOutDelta = 0;
  const actor = actorLabel(userId);
  for (const [itemId, delta] of deltasByItem.entries()) {
    const absQty = Math.abs(delta);
    await applyStockMovement(db, {
      workspaceId,
      warehouseId: warehouse.id,
      itemId,
      movementType: delta > 0 ? "out" : "in",
      quantity: absQty,
      reason: `Scheda Articoli: ${lockedSheet.title || "worksheet"} (sync)`,
      referenceType: "inventory_sheet",
      referenceId: lockedSheet.id,
      createdBy: actor,
      sheetId: lockedSheet.id,
      taskId: lockedSheet.task_id || null,
      projectId: lockedSheet.project_id || null,
    });
    movementsCount += 1;
    totalOutDelta += delta;
  }

  return {
    warehouse_id: warehouse.id,
    warehouse_name: warehouse.name,
    movements_created: movementsCount,
    qty_delta: totalOutDelta,
    desired_items: desiredByItem.size,
  };
}

async function createInventorySheetDraft(db, { workspaceId, userId, title, notes = null, taskId = null, projectId = null }) {
  const cleanTitle = normalizeText(title);
  if (!cleanTitle) throw makeError("VALIDATION_ERROR", "title required", 400);
  const sheetId = uuidv4();
  const createdBy = normalizeUuid(userId) || "00000000-0000-0000-0000-000000000000";

  await db.query(
    `INSERT INTO public.inventory_sheets
     (id, workspace_id, title, status, task_id, project_id, created_by, created_at, updated_at, notes)
     VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,now(),now(),$7)`,
    [sheetId, workspaceId, cleanTitle, taskId || null, projectId || null, createdBy, notes]
  );
  await appendSheetAuditEvent(db, {
    workspaceId,
    sheetId,
    actorUserId: userId,
    action: "worksheet.created",
    changes: { title: cleanTitle, task_id: taskId || null, project_id: projectId || null },
  });
  return { id: sheetId };
}

async function addInventorySheetRow(db, { workspaceId, sheetId, itemId, qty, unit = null }) {
  const cleanItemId = normalizeText(itemId);
  const cleanQty = normalizeQty(qty);
  if (!cleanItemId || cleanQty == null) throw makeError("VALIDATION_ERROR", "item_id and qty>0 required", 400);
  const sheet = await fetchSheetById(db, workspaceId, sheetId, { lock: true });
  await ensureItemExists(db, workspaceId, cleanItemId);

  const inserted = await db.query(
    `INSERT INTO public.inventory_sheet_rows
     (id, sheet_id, workspace_id, item_id, qty, unit, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())
     RETURNING *`,
    [uuidv4(), sheetId, workspaceId, cleanItemId, cleanQty, normalizeText(unit)]
  );
  await db.query(`UPDATE public.inventory_sheets SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, sheetId]);
  return { row: inserted.rows?.[0] || null, sheet };
}

async function lockInventorySheet(db, { workspaceId, sheetId, userId }) {
  await db.query("BEGIN");
  try {
    const sheet = await assertSheetDraft(db, workspaceId, sheetId, { lock: true });
    const rows = await fetchRowsForLock(db, workspaceId, sheetId);
    if (!rows.length) throw makeError("EMPTY_SHEET", "Cannot lock an empty sheet", 400);

    const invalidQty = rows.find((row) => normalizeQty(row.qty) == null);
    if (invalidQty) throw makeError("INVALID_ROW_QTY", "All rows must have qty > 0", 400);

    const sync = await syncSheetStockMovements(db, {
      workspaceId,
      sheetId,
      userId,
      sheet,
    });

    const lockedBy = normalizeUuid(userId);
    await db.query(
      `UPDATE public.inventory_sheets
       SET status='LOCKED',
           locked_at=now(),
           locked_by=$3,
           updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, sheetId, lockedBy]
    );

    await appendSheetAuditEvent(db, {
      workspaceId,
      sheetId,
      actorUserId: userId,
      action: "worksheet.locked",
      changes: { movements_created: sync.movements_created, qty_delta: sync.qty_delta },
    });

    await db.query("COMMIT");
    return {
      sheet_id: sheetId,
      status: "LOCKED",
      warehouse_id: sync.warehouse_id,
      warehouse_name: sync.warehouse_name,
      movements_created: sync.movements_created,
      total_qty: sync.qty_delta,
      warnings: [],
    };
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

module.exports = {
  inventorySheetsEnabled,
  ensureSheetTables,
  fetchSheetById,
  createInventorySheetDraft,
  addInventorySheetRow,
  lockInventorySheet,
  syncSheetStockMovements,
  assertSheetDraft,
  ensureItemExists,
  appendSheetAuditEvent,
  listSheetComments,
  addSheetComment,
  softDeleteSheetComment,
  listSheetTimeline,
  makeError,
  normalizeText,
  normalizeQty,
  normalizeUuid,
  isDraftSheet,
  isLockedSheet,
};
