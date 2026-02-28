const test = require("node:test");
const assert = require("node:assert/strict");

const { applyStockMovement } = require("../src/services/stockService");

function fakeDb(initial = { on_hand: 10, reserved: 2 }) {
  const state = { ...initial };
  return {
    async query(sql) {
      const q = String(sql || "").toLowerCase();
      if (q.includes("select id, on_hand, reserved") && q.includes("for update")) {
        return { rows: [{ id: "1", on_hand: state.on_hand, reserved: state.reserved }] };
      }
      if (q.includes("select id, on_hand, reserved") && q.includes("limit 1")) {
        return { rowCount: 1, rows: [{ id: "1", on_hand: state.on_hand, reserved: state.reserved }] };
      }
      if (q.includes("update public.stock_levels")) {
        const args = arguments[1] || [];
        state.on_hand = Number(args[3]);
        state.reserved = Number(args[4]);
        return { rowCount: 1, rows: [] };
      }
      if (q.includes("insert into public.stock_movements")) {
        return { rowCount: 1, rows: [] };
      }
      if (q.includes("insert into public.stock_levels")) {
        return { rowCount: 1, rows: [{ id: "1", on_hand: 0, reserved: 0 }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

test("applyStockMovement computes available", async () => {
  const db = fakeDb({ on_hand: 10, reserved: 2 });
  const out = await applyStockMovement(db, {
    workspaceId: "ws",
    warehouseId: "wh",
    itemId: "it",
    movementType: "in",
    quantity: 5,
  });
  assert.equal(out.on_hand, 15);
  assert.equal(out.reserved, 2);
  assert.equal(out.available, 13);
});

test("applyStockMovement rejects negative stock", async () => {
  const db = fakeDb({ on_hand: 3, reserved: 0 });
  await assert.rejects(
    () =>
      applyStockMovement(db, {
        workspaceId: "ws",
        warehouseId: "wh",
        itemId: "it",
        movementType: "out",
        quantity: 5,
      }),
    /Insufficient stock/
  );
});
