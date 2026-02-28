async function ensureStockLevel(client, { workspaceId, warehouseId, itemId }) {
  const row = await client.query(
    `SELECT id, on_hand, reserved
     FROM public.stock_levels
     WHERE workspace_id=$1 AND warehouse_id=$2 AND item_id=$3
     LIMIT 1`,
    [workspaceId, warehouseId, itemId]
  );
  if (row.rowCount) return row.rows[0];

  const inserted = await client.query(
    `INSERT INTO public.stock_levels (workspace_id, warehouse_id, item_id, on_hand, reserved, updated_at)
     VALUES ($1,$2,$3,0,0,now())
     RETURNING id, on_hand, reserved`,
    [workspaceId, warehouseId, itemId]
  );
  return inserted.rows[0];
}

async function applyStockMovement(client, {
  workspaceId,
  warehouseId,
  itemId,
  movementType,
  quantity,
  reason = null,
  referenceType = null,
  referenceId = null,
  createdBy = null,
  sheetId = null,
  taskId = null,
  projectId = null,
}) {
  const qty = Number(quantity || 0);
  if (!Number.isFinite(qty) || qty === 0) {
    const err = new Error("quantity must be a non-zero number");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const type = String(movementType || "").trim().toLowerCase();
  const allowed = new Set(["in", "out", "reserve", "release", "adjustment"]);
  if (!allowed.has(type)) {
    const err = new Error("movement_type must be in|out|reserve|release|adjustment");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  await ensureStockLevel(client, { workspaceId, warehouseId, itemId });

  const lockRes = await client.query(
    `SELECT id, on_hand, reserved
     FROM public.stock_levels
     WHERE workspace_id=$1 AND warehouse_id=$2 AND item_id=$3
     FOR UPDATE`,
    [workspaceId, warehouseId, itemId]
  );
  const current = lockRes.rows[0];
  let onHand = Number(current.on_hand || 0);
  let reserved = Number(current.reserved || 0);

  if (type === "in") onHand += qty;
  if (type === "out") onHand -= qty;
  if (type === "reserve") reserved += qty;
  if (type === "release") reserved -= qty;
  if (type === "adjustment") onHand += qty;

  if (onHand < 0) {
    const err = new Error("Insufficient stock (on_hand)");
    err.code = "INSUFFICIENT_STOCK";
    throw err;
  }
  if (reserved < 0) {
    const err = new Error("Reserved stock cannot be negative");
    err.code = "INSUFFICIENT_RESERVED";
    throw err;
  }
  if (reserved > onHand) {
    const err = new Error("Reserved cannot exceed on_hand");
    err.code = "RESERVED_EXCEEDS_ON_HAND";
    throw err;
  }

  await client.query(
    `UPDATE public.stock_levels
     SET on_hand=$4, reserved=$5, updated_at=now()
     WHERE workspace_id=$1 AND warehouse_id=$2 AND item_id=$3`,
    [workspaceId, warehouseId, itemId, onHand, reserved]
  );

  await client.query(
    `INSERT INTO public.stock_movements
     (workspace_id, warehouse_id, item_id, movement_type, quantity, reason, reference_type, reference_id, created_by, sheet_id, task_id, project_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
    [workspaceId, warehouseId, itemId, type, qty, reason, referenceType, referenceId, createdBy, sheetId, taskId, projectId]
  );

  return {
    on_hand: onHand,
    reserved,
    available: onHand - reserved,
  };
}

module.exports = {
  applyStockMovement,
};
