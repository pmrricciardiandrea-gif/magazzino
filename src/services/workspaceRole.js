"use strict";

function normalizeWorkspaceRole(value) {
  const role = String(value || "").trim().toUpperCase();
  if (!role) return null;
  if (["ADMIN", "OWNER", "SUPERADMIN"].includes(role)) return "ADMIN";
  if (["AMMINISTRAZIONE", "ADMINISTRAZIONE", "FINANCE", "ACCOUNTING"].includes(role)) return "AMMINISTRAZIONE";
  if (["COMMERCIALE", "SALES"].includes(role)) return "COMMERCIALE";
  if (["VIEWER", "READONLY", "READ_ONLY"].includes(role)) return "VIEWER";
  if (["MEMBER", "TEAM_MEMBER", "OPERATIVE", "OPERATIVO"].includes(role)) return "MEMBER";
  return role;
}

const PERMISSIONS = Object.freeze({
  QUOTES_READ: "QUOTES_READ",
  QUOTES_WRITE: "QUOTES_WRITE",
  QUOTES_PDF: "QUOTES_PDF",
  WORKSHEET_READ: "WORKSHEET_READ",
  WORKSHEET_WRITE: "WORKSHEET_WRITE",
  WORKSHEET_DELETE: "WORKSHEET_DELETE",
  WORKSHEET_COMMENT_READ: "WORKSHEET_COMMENT_READ",
  WORKSHEET_COMMENT_WRITE: "WORKSHEET_COMMENT_WRITE",
  WORKSHEET_COMMENT_DELETE: "WORKSHEET_COMMENT_DELETE",
  WORKSHEET_TIMELINE_READ: "WORKSHEET_TIMELINE_READ",
  STOCK_READ: "STOCK_READ",
  STOCK_WRITE: "STOCK_WRITE",
  MOVEMENTS_READ: "MOVEMENTS_READ",
  MOVEMENTS_WRITE: "MOVEMENTS_WRITE",
});

const ALL_PERMISSIONS = new Set(Object.values(PERMISSIONS));

function defaultRoleForPermissions(value) {
  return normalizeWorkspaceRole(value) || "MEMBER";
}

function buildRolePermissions(base = false, overrides = {}) {
  const out = {};
  for (const key of ALL_PERMISSIONS) out[key] = Boolean(base);
  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (ALL_PERMISSIONS.has(key)) out[key] = Boolean(value);
  });
  return out;
}

const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: buildRolePermissions(true),
  AMMINISTRAZIONE: buildRolePermissions(true),
  COMMERCIALE: buildRolePermissions(true),
  MEMBER: buildRolePermissions(false, {
    WORKSHEET_READ: true,
    WORKSHEET_WRITE: true,
    WORKSHEET_DELETE: false,
    WORKSHEET_COMMENT_READ: true,
    WORKSHEET_COMMENT_WRITE: true,
    WORKSHEET_COMMENT_DELETE: false,
    WORKSHEET_TIMELINE_READ: true,
    STOCK_READ: true,
    STOCK_WRITE: true,
    MOVEMENTS_READ: true,
    MOVEMENTS_WRITE: true,
  }),
  VIEWER: buildRolePermissions(false, {
    WORKSHEET_READ: true,
    WORKSHEET_WRITE: false,
    WORKSHEET_DELETE: false,
    WORKSHEET_COMMENT_READ: true,
    WORKSHEET_COMMENT_WRITE: false,
    WORKSHEET_COMMENT_DELETE: false,
    WORKSHEET_TIMELINE_READ: true,
    STOCK_READ: true,
    STOCK_WRITE: false,
    MOVEMENTS_READ: true,
    MOVEMENTS_WRITE: false,
  }),
});

function rolePermissions(value) {
  const role = defaultRoleForPermissions(value);
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER;
}

function hasPermission(value, permission) {
  const permKey = String(permission || "").trim().toUpperCase();
  if (!ALL_PERMISSIONS.has(permKey)) return false;
  const perms = rolePermissions(value);
  return perms[permKey] === true;
}

function requirePermission(permission, { message = null } = {}) {
  const permKey = String(permission || "").trim().toUpperCase();
  return function permissionMiddleware(req, res, next) {
    const role = req?.workspaceRole || resolveWorkspaceRole(req) || defaultRoleForPermissions();
    req.workspaceRole = role;
    if (hasPermission(role, permKey)) return next();
    return res.status(403).json({
      ok: false,
      error: "FORBIDDEN_ROLE",
      details: message || `Permesso richiesto: ${permKey}`,
    });
  };
}

function canAccessQuotesRole(value) {
  return hasPermission(value, PERMISSIONS.QUOTES_READ);
}

function resolveWorkspaceRole(req) {
  const fromHeader =
    req?.header?.("x-workspace-role") ||
    req?.header?.("x-user-role") ||
    req?.headers?.["x-workspace-role"] ||
    req?.headers?.["x-user-role"];
  const fromQuery = req?.query?.workspace_role || req?.query?.role;
  return normalizeWorkspaceRole(fromHeader || fromQuery || "");
}

function requireQuotesAccess(req, res, next) {
  const role = req?.workspaceRole || resolveWorkspaceRole(req);
  req.workspaceRole = role;
  if (!hasPermission(role, PERMISSIONS.QUOTES_READ)) {
    return res.status(403).json({
      ok: false,
      error: "FORBIDDEN_ROLE",
      details: "Preventivi disponibili solo per ruoli admin, amministrazione o commerciale",
    });
  }
  return next();
}

module.exports = {
  normalizeWorkspaceRole,
  PERMISSIONS,
  hasPermission,
  requirePermission,
  canAccessQuotesRole,
  resolveWorkspaceRole,
  requireQuotesAccess,
};
