const test = require("node:test");
const assert = require("node:assert/strict");

const { PERMISSIONS, canAccessQuotesRole, hasPermission } = require("../src/services/workspaceRole");

test("quotes access is deny-by-default when role missing", () => {
  assert.equal(canAccessQuotesRole(null), false);
  assert.equal(canAccessQuotesRole(""), false);
  assert.equal(canAccessQuotesRole("member"), false);
});

test("privileged roles can access quotes", () => {
  assert.equal(canAccessQuotesRole("admin"), true);
  assert.equal(canAccessQuotesRole("commerciale"), true);
  assert.equal(canAccessQuotesRole("amministrazione"), true);
});

test("member can write worksheet and movements, but cannot read quotes", () => {
  assert.equal(hasPermission("member", PERMISSIONS.WORKSHEET_WRITE), true);
  assert.equal(hasPermission("member", PERMISSIONS.MOVEMENTS_WRITE), true);
  assert.equal(hasPermission("member", PERMISSIONS.QUOTES_READ), false);
});
