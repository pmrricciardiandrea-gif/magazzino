const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createInventorySheetDraft,
  addInventorySheetRow,
  lockInventorySheet,
} = require("../src/services/inventorySheetsService");

function createFakeDb(options = {}) {
  const state = {
    tables: new Set(["inventory_sheets", "inventory_sheet_rows", "worksheet_comments", "worksheet_audit_log"]),
    items: new Set(options.items || ["item-1", "item-2"]),
    sheets: [],
    rows: [],
    movements: [],
    levels: new Map(Object.entries(options.levels || { "wh-1:item-1": { on_hand: 20, reserved: 0 }, "wh-1:item-2": { on_hand: 10, reserved: 0 } })),
    warehouses: options.warehouses || [{ id: "wh-1", name: "Main", is_default: true }],
  };

  function findSheet(workspaceId, sheetId) {
    return state.sheets.find((sheet) => sheet.workspace_id === workspaceId && sheet.id === sheetId) || null;
  }

  return {
    state,
    async query(sql, params = []) {
      const q = String(sql || "").toLowerCase();

      if (q.startsWith("begin") || q.startsWith("commit") || q.startsWith("rollback")) {
        return { rows: [], rowCount: 0 };
      }

      if (q.includes("from information_schema.tables")) {
        return {
          rows: [...state.tables].map((name) => ({ table_name: name })),
          rowCount: state.tables.size,
        };
      }

      if (q.includes("insert into public.inventory_sheets")) {
        const row = {
          id: params[0],
          workspace_id: params[1],
          title: params[2],
          status: "DRAFT",
          task_id: params[3] || null,
          project_id: params[4] || null,
          created_by: params[5],
          notes: params[6] || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        };
        state.sheets.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (q.includes("select *") && q.includes("from public.inventory_sheets")) {
        const row = findSheet(params[0], params[1]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (q.includes("select id") && q.includes("from public.items")) {
        const exists = state.items.has(params[1]);
        return { rows: exists ? [{ id: params[1] }] : [], rowCount: exists ? 1 : 0 };
      }

      if (q.includes("insert into public.inventory_sheet_rows")) {
        const row = {
          id: params[0],
          sheet_id: params[1],
          workspace_id: params[2],
          item_id: params[3],
          qty: Number(params[4]),
          unit: params[5] || null,
        };
        state.rows.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (q.includes("select r.id") && q.includes("from public.inventory_sheet_rows")) {
        const rows = state.rows
          .filter((row) => row.workspace_id === params[0] && row.sheet_id === params[1])
          .map((row) => ({ ...row, item_name: row.item_id }));
        return { rows, rowCount: rows.length };
      }

      if (q.includes("select r.item_id") && q.includes("sum(r.qty)")) {
        const rows = state.rows.filter((row) => row.workspace_id === params[0] && row.sheet_id === params[1]);
        const map = new Map();
        rows.forEach((row) => {
          const key = String(row.item_id);
          map.set(key, (map.get(key) || 0) + Number(row.qty || 0));
        });
        const out = [...map.entries()].map(([item_id, qty]) => ({ item_id, qty, item_name: item_id }));
        return { rows: out, rowCount: out.length };
      }

      if (q.includes("select id, name, is_default") && q.includes("from public.warehouses")) {
        return { rows: state.warehouses, rowCount: state.warehouses.length };
      }

      if (q.includes("select warehouse_id") && q.includes("from public.stock_movements")) {
        const match = state.movements
          .filter((mv) => mv.workspace_id === params[0] && mv.sheet_id === params[1] && mv.reference_type === "inventory_sheet")
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return { rows: match ? [{ warehouse_id: match.warehouse_id }] : [], rowCount: match ? 1 : 0 };
      }

      if (q.includes("select on_hand, reserved") && q.includes("from public.stock_levels")) {
        const key = `${params[1]}:${params[2]}`;
        const lvl = state.levels.get(key);
        return { rows: lvl ? [lvl] : [], rowCount: lvl ? 1 : 0 };
      }

      if (q.includes("select id, on_hand, reserved") && q.includes("from public.stock_levels") && q.includes("limit 1")) {
        const key = `${params[1]}:${params[2]}`;
        const lvl = state.levels.get(key);
        return { rows: lvl ? [{ id: key, ...lvl }] : [], rowCount: lvl ? 1 : 0 };
      }

      if (q.includes("insert into public.stock_levels")) {
        const key = `${params[1]}:${params[2]}`;
        const lvl = { on_hand: 0, reserved: 0 };
        state.levels.set(key, lvl);
        return { rows: [{ id: key, ...lvl }], rowCount: 1 };
      }

      if (q.includes("for update") && q.includes("from public.stock_levels")) {
        const key = `${params[1]}:${params[2]}`;
        const lvl = state.levels.get(key) || { on_hand: 0, reserved: 0 };
        return { rows: [{ id: key, ...lvl }], rowCount: 1 };
      }

      if (q.includes("update public.stock_levels")) {
        const key = `${params[1]}:${params[2]}`;
        state.levels.set(key, { on_hand: Number(params[3]), reserved: Number(params[4]) });
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("insert into public.stock_movements")) {
        state.movements.push({
          workspace_id: params[0],
          warehouse_id: params[1],
          item_id: params[2],
          movement_type: params[3],
          quantity: Number(params[4]),
          reference_type: params[6],
          reference_id: params[7],
          sheet_id: params[9],
          created_at: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (q.includes("select item_id") && q.includes("sum(") && q.includes("from public.stock_movements")) {
        const rows = state.movements.filter((mv) => mv.workspace_id === params[0] && mv.sheet_id === params[1] && mv.reference_type === "inventory_sheet");
        const map = new Map();
        rows.forEach((mv) => {
          const key = String(mv.item_id);
          const sign = String(mv.movement_type || "").toLowerCase() === "out" ? 1 : String(mv.movement_type || "").toLowerCase() === "in" ? -1 : 0;
          map.set(key, (map.get(key) || 0) + sign * Number(mv.quantity || 0));
        });
        const out = [...map.entries()].map(([item_id, applied_qty]) => ({ item_id, applied_qty }));
        return { rows: out, rowCount: out.length };
      }

      if (q.includes("update public.inventory_sheets") && q.includes("set status='locked'")) {
        const row = findSheet(params[0], params[1]);
        if (row) {
          row.status = "LOCKED";
          row.locked_by = params[2] || null;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }

      if (q.includes("insert into public.worksheet_audit_log")) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

test("create sheet draft and add rows", async () => {
  const db = createFakeDb();
  const out = await createInventorySheetDraft(db, {
    workspaceId: "ws-1",
    userId: "00000000-0000-0000-0000-000000000001",
    title: "Scheda test",
    notes: "note",
  });
  assert.ok(out.id);

  const outRow = await addInventorySheetRow(db, {
    workspaceId: "ws-1",
    sheetId: out.id,
    itemId: "item-1",
    qty: 3,
    unit: "pz",
  });
  assert.equal(Number(outRow?.row?.qty), 3);
  assert.equal(db.state.rows.length, 1);
});

test("lock sheet creates out movements", async () => {
  const db = createFakeDb({
    levels: {
      "wh-1:item-1": { on_hand: 10, reserved: 0 },
      "wh-1:item-2": { on_hand: 7, reserved: 0 },
    },
  });
  const out = await createInventorySheetDraft(db, {
    workspaceId: "ws-1",
    userId: "00000000-0000-0000-0000-000000000001",
    title: "Scheda lock",
  });
  await addInventorySheetRow(db, { workspaceId: "ws-1", sheetId: out.id, itemId: "item-1", qty: 2 });
  await addInventorySheetRow(db, { workspaceId: "ws-1", sheetId: out.id, itemId: "item-2", qty: 1 });

  const summary = await lockInventorySheet(db, {
    workspaceId: "ws-1",
    sheetId: out.id,
    userId: "00000000-0000-0000-0000-000000000001",
  });
  assert.equal(summary.movements_created, 2);
  assert.equal(db.state.movements.length, 2);
  assert.equal(db.state.sheets[0].status, "LOCKED");
});

test("lock sheet sync is idempotent over repeated reconciliation", async () => {
  const db = createFakeDb({
    levels: {
      "wh-1:item-1": { on_hand: 10, reserved: 0 },
    },
  });
  const out = await createInventorySheetDraft(db, {
    workspaceId: "ws-1",
    userId: "00000000-0000-0000-0000-000000000001",
    title: "Scheda idempotente",
  });
  await addInventorySheetRow(db, { workspaceId: "ws-1", sheetId: out.id, itemId: "item-1", qty: 2 });
  await lockInventorySheet(db, {
    workspaceId: "ws-1",
    sheetId: out.id,
    userId: "00000000-0000-0000-0000-000000000001",
  });

  const beforeCount = db.state.movements.length;
  await lockInventorySheet(db, {
    workspaceId: "ws-1",
    sheetId: out.id,
    userId: "00000000-0000-0000-0000-000000000001",
  }).catch((err) => {
    assert.equal(err.code, "SHEET_LOCKED");
  });
  assert.equal(db.state.movements.length, beforeCount);
});

test("lock sheet fails when stock insufficient", async () => {
  const db = createFakeDb({
    levels: {
      "wh-1:item-1": { on_hand: 1, reserved: 0 },
    },
  });
  const out = await createInventorySheetDraft(db, {
    workspaceId: "ws-1",
    userId: "00000000-0000-0000-0000-000000000001",
    title: "Scheda insuff",
  });
  await addInventorySheetRow(db, { workspaceId: "ws-1", sheetId: out.id, itemId: "item-1", qty: 5 });

  await assert.rejects(
    () =>
      lockInventorySheet(db, {
        workspaceId: "ws-1",
        sheetId: out.id,
        userId: "00000000-0000-0000-0000-000000000001",
      }),
    (err) => err && err.code === "INSUFFICIENT_STOCK"
  );
  assert.equal(db.state.movements.length, 0);
});

test("workspace scoping enforced on add row", async () => {
  const db = createFakeDb();
  const out = await createInventorySheetDraft(db, {
    workspaceId: "ws-1",
    userId: "00000000-0000-0000-0000-000000000001",
    title: "Scheda scope",
  });
  await assert.rejects(
    () =>
      addInventorySheetRow(db, {
        workspaceId: "ws-2",
        sheetId: out.id,
        itemId: "item-1",
        qty: 1,
      }),
    (err) => err && err.code === "NOT_FOUND"
  );
});
