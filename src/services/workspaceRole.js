"use strict";

function normalizeWorkspaceRole(value) {
  const role = String(value || "")
    .trim()
    .toUpperCase();
  if (["ADMIN", "OWNER", "SUPERADMIN"].includes(role)) return "ADMIN";
  if (["AMMINISTRAZIONE", "ADMINISTRAZIONE", "FINANCE", "ACCOUNTING"].includes(role)) return "AMMINISTRAZIONE";
  if (["COMMERCIALE", "SALES"].includes(role)) return "COMMERCIALE";
  if (["VIEWER", "READONLY", "READ_ONLY"].includes(role)) return "VIEWER";
  return role || "MEMBER";
}

function canAccessQuotesRole(value) {
  const role = normalizeWorkspaceRole(value);
  return role === "ADMIN" || role === "AMMINISTRAZIONE" || role === "COMMERCIALE";
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
  if (!canAccessQuotesRole(role)) {
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
  canAccessQuotesRole,
  resolveWorkspaceRole,
  requireQuotesAccess,
};

