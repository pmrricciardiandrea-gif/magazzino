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

async function ensureSheetTables(db) {
  const check = await db.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('inventory_sheets', 'inventory_sheet_rows')`
  );
  const names = new Set((check.rows || []).map((row) => String(row.table_name || "").trim()));
  if (!names.has("inventory_sheets") || !names.has("inventory_sheet_rows")) {
    throw makeError(
      "DB_NOT_MIGRATED",
      "inventory sheets tables missing. Run migration 004_inventory_sheets_v1.sql",
      500
    );
  }
}

async function assertSheetDraft(db, workspaceId, sheetId, { lock = false } = {}) {
  const query = `
    SELECT *
    FROM public.inventory_sheets
    WHERE workspace_id=$1 AND id=$2
    ${lock ? "FOR UPDATE" : ""}
  `;
  const result = await db.query(query, [workspaceId, sheetId]);
  const sheet = result.rows?.[0] || null;
  if (!sheet) throw makeError("NOT_FOUND", "Sheet not found", 404);
  if (String(sheet.status || "").toUpperCase() !== "DRAFT") {
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

async function pickWarehouseForSheet(db, workspaceId) {
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

async function collectInsufficientStock(db, workspaceId, warehouseId, rows) {
  const insuff = [];
  for (const row of rows) {
    const levelRes = await db.query(
      `SELECT on_hand, reserved
       FROM public.stock_levels
       WHERE workspace_id=$1 AND warehouse_id=$2 AND item_id=$3
       LIMIT 1`,
      [workspaceId, warehouseId, row.item_id]
    );
    const level = levelRes.rows?.[0] || null;
    const onHand = Number(level?.on_hand || 0);
    const reserved = Number(level?.reserved || 0);
    const available = onHand - reserved;
    const requested = Number(row.qty || 0);
    if (requested > available) {
      insuff.push({
        item_id: row.item_id,
        item_name: row.item_name || null,
        requested_qty: requested,
        available_qty: available,
      });
    }
  }
  return insuff;
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
  return { id: sheetId };
}

async function addInventorySheetRow(db, { workspaceId, sheetId, itemId, qty, unit = null }) {
  const cleanItemId = normalizeText(itemId);
  const cleanQty = normalizeQty(qty);
  if (!cleanItemId || cleanQty == null) throw makeError("VALIDATION_ERROR", "item_id and qty>0 required", 400);
  await assertSheetDraft(db, workspaceId, sheetId);
  await ensureItemExists(db, workspaceId, cleanItemId);

  const inserted = await db.query(
    `INSERT INTO public.inventory_sheet_rows
     (id, sheet_id, workspace_id, item_id, qty, unit, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())
     RETURNING *`,
    [uuidv4(), sheetId, workspaceId, cleanItemId, cleanQty, normalizeText(unit)]
  );
  return inserted.rows?.[0] || null;
}

async function lockInventorySheet(db, { workspaceId, sheetId, userId }) {
  const actor = normalizeText(userId) || "api";
  await db.query("BEGIN");
  try {
    const sheet = await assertSheetDraft(db, workspaceId, sheetId, { lock: true });
    const rows = await fetchRowsForLock(db, workspaceId, sheetId);
    if (!rows.length) throw makeError("EMPTY_SHEET", "Cannot lock an empty sheet", 400);

    const invalidQty = rows.find((row) => normalizeQty(row.qty) == null);
    if (invalidQty) throw makeError("INVALID_ROW_QTY", "All rows must have qty > 0", 400);

    const warehouse = await pickWarehouseForSheet(db, workspaceId);
    const insuff = await collectInsufficientStock(db, workspaceId, warehouse.id, rows);
    if (insuff.length) {
      throw makeError("INSUFFICIENT_STOCK", "Insufficient stock for one or more items", 409, { insufficiencies: insuff });
    }

    let movementsCount = 0;
    let totalQty = 0;
    for (const row of rows) {
      const qty = Number(row.qty || 0);
      await applyStockMovement(db, {
        workspaceId,
        warehouseId: warehouse.id,
        itemId: row.item_id,
        movementType: "out",
        quantity: qty,
        reason: `Scheda Articoli: ${sheet.title}`,
        referenceType: "inventory_sheet",
        referenceId: sheet.id,
        createdBy: actor,
        sheetId: sheet.id,
        taskId: sheet.task_id || null,
        projectId: sheet.project_id || null,
      });
      movementsCount += 1;
      totalQty += qty;
    }

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

    await db.query("COMMIT");
    return {
      sheet_id: sheetId,
      status: "LOCKED",
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      movements_created: movementsCount,
      total_qty: totalQty,
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
  createInventorySheetDraft,
  addInventorySheetRow,
  lockInventorySheet,
  assertSheetDraft,
  ensureItemExists,
  makeError,
  normalizeText,
  normalizeQty,
  normalizeUuid,
};
