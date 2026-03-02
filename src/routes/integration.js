"use strict";

const express = require("express");
const path = require("path");
const {
  normalizeBaseUrl,
  loadBestSegretariaConnection,
  listActiveSegretariaConnections,
  saveSegretariaConnection,
  apiKeyPrefix,
} = require("../services/segretariaConnectionService");

const router = express.Router();

function resolveExchangeUrl({ body = {}, query = {} } = {}) {
  const direct = String(body.exchange_url || "").trim();
  if (direct) return normalizeExchangeUrl(direct);

  const baseFromQuery = normalizeBaseUrl(query.segretaria_base_url);
  if (baseFromQuery) return `${baseFromQuery}/api/integrations/magazzino/connect/exchange`;

  const envDirect = String(process.env.SEGRETARIA_CONNECT_EXCHANGE_URL || "").trim();
  if (envDirect) return normalizeExchangeUrl(envDirect);

  const envBase = normalizeBaseUrl(process.env.SEGRETARIA_BASE_URL);
  if (envBase) return `${envBase}/api/integrations/magazzino/connect/exchange`;
  return "";
}

function normalizeExchangeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (/\/api\/integrations\/magazzino\/connect\/exchange\/?$/.test(lower)) return value;
  if (/\/api\/integrations\/magazzino\/connect\/?$/.test(lower)) return value.replace(/\/?$/, "/exchange");
  if (/\/api\/admin\/integrations\/magazzino\/connect-url\/?$/.test(lower)) {
    return value.replace(/\/api\/admin\/integrations\/magazzino\/connect-url\/?$/i, "/api/integrations/magazzino/connect/exchange");
  }
  const normalizedBase = normalizeBaseUrl(value);
  if (normalizedBase) return `${normalizedBase}/api/integrations/magazzino/connect/exchange`;
  return value;
}

function deriveFallbackExchangeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower.includes("/api/integrations/magazzino/connect/exchange")) return "";
  if (lower.includes("/api/integrations/magazzino/connect")) {
    return value.replace(/\/?$/, "/exchange");
  }
  if (lower.includes("/api/admin/integrations/magazzino/connect-url")) {
    return value.replace(/\/api\/admin\/integrations\/magazzino\/connect-url\/?$/i, "/api/integrations/magazzino/connect/exchange");
  }
  return "";
}

async function exchangeConnectToken({ token, exchangeUrl, workspaceId = "" }) {
  const workspaceHeader = String(workspaceId || "").trim();
  const headers = { "Content-Type": "application/json" };
  if (workspaceHeader) headers["x-workspace-id"] = workspaceHeader;
  const response = await fetch(exchangeUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const fallbackUrl = deriveFallbackExchangeUrl(exchangeUrl);
    const missingWs = String(payload?.error || "").toUpperCase() === "MISSING_WORKSPACE_ID";
    if (fallbackUrl && fallbackUrl !== exchangeUrl && (response.status === 400 || response.status === 404 || missingWs)) {
      return exchangeConnectToken({ token, exchangeUrl: fallbackUrl, workspaceId });
    }
  }
  if (!response.ok) {
    const err = new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
    err.status = response.status;
    err.code = payload?.error || "CONNECT_EXCHANGE_FAILED";
    err.upstream = payload;
    throw err;
  }
  return payload || {};
}

async function handleConnect(db, { token, exchangeUrl, workspaceId = "" }) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    const err = new Error("token is required");
    err.status = 400;
    err.code = "MISSING_CONNECT_TOKEN";
    throw err;
  }
  if (!exchangeUrl) {
    const err = new Error("Missing SEGRETARIA_CONNECT_EXCHANGE_URL/SEGRETARIA_BASE_URL");
    err.status = 500;
    err.code = "SEGRETARIA_CONNECT_URL_MISSING";
    throw err;
  }

  const exchanged = await exchangeConnectToken({
    token: cleanToken,
    exchangeUrl,
    workspaceId,
  });
  const connectedWorkspaceId = String(exchanged.workspace_id || "").trim();
  const segretariaBaseUrl = normalizeBaseUrl(exchanged.segretaria_base_url || "");
  const apiKey = String(exchanged.credentials?.api_key || "").trim();
  const hmacSecret = String(exchanged.credentials?.hmac_secret || "").trim();
  if (!connectedWorkspaceId || !segretariaBaseUrl || !apiKey || !hmacSecret) {
    const err = new Error("Incomplete connect payload from Segretaria");
    err.status = 502;
    err.code = "CONNECT_PAYLOAD_INVALID";
    throw err;
  }

  const saved = await saveSegretariaConnection(db, {
    workspaceId: connectedWorkspaceId,
    segretariaBaseUrl,
    apiKey,
    hmacSecret,
    active: true,
  });
  return {
    workspace_id: connectedWorkspaceId,
    segretaria_base_url: saved.segretaria_base_url,
    api_key_prefix: apiKeyPrefix(saved.api_key),
    connected_at: saved.connected_at,
    workspace_role: exchanged.workspace_role || null,
  };
}

router.post("/api/integration/connect", async (req, res) => {
  const exchangeUrl = resolveExchangeUrl({ body: req.body, query: req.query });
  const workspaceId = String(req.workspaceId || req.body?.workspace_id || req.query?.workspace_id || "").trim();
  try {
    const result = await handleConnect(req.db, {
      token: req.body?.token,
      exchangeUrl,
      workspaceId,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const status = Number(err?.status || 500);
    return res.status(status).json({
      ok: false,
      error: err?.code || "CONNECT_FAILED",
      details: err?.message || String(err),
      upstream: err?.upstream || null,
    });
  }
});

router.get("/api/integration/status", async (req, res) => {
  const workspaceId = String(req.workspaceId || "").trim();
  try {
    if (!workspaceId) {
      const available = await listActiveSegretariaConnections(req.db, 25);
      return res.json({
        ok: true,
        connected: false,
        workspace_required: true,
        workspace_role: req.workspaceRole || null,
        quotes_access: req.canAccessQuotes === true,
        integration: null,
        available_workspaces: available.map((row) => ({
          workspace_id: row.workspace_id,
          updated_at: row.updated_at || null,
          connected_at: row.connected_at || null,
          has_error: !!row.last_error,
        })),
      });
    }

    const row = await loadBestSegretariaConnection(req.db, workspaceId);
    return res.json({
      ok: true,
      connected: !!row && row.is_active === true,
      workspace_required: false,
      workspace_role: req.workspaceRole || null,
      quotes_access: req.canAccessQuotes === true,
      integration: row
        ? {
            workspace_id: row.workspace_id,
            segretaria_base_url: row.segretaria_base_url,
            is_active: row.is_active === true,
            api_key_prefix: apiKeyPrefix(row.api_key),
            connected_at: row.connected_at || null,
            updated_at: row.updated_at || null,
            last_error: row.last_error || null,
            requested_workspace_id: workspaceId,
          }
        : null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "CONNECT_STATUS_FAILED",
      details: err?.message || String(err),
    });
  }
});

router.get("/connect", async (req, res) => {
  const token = String(req.query?.token || "").trim();
  const exchangeUrl = resolveExchangeUrl({ query: req.query });
  const workspaceId = String(req.query?.workspace_id || req.query?.workspaceId || "").trim();
  const workspaceRole = String(req.query?.workspace_role || req.query?.role || "").trim();
  if (!token) {
    return res.status(400).send(
      "<html><body style='font-family:sans-serif;padding:24px'><h2>Token mancante</h2><p>Apri il link completo generato da Segretaria AI.</p></body></html>"
    );
  }

  const query = new URLSearchParams({
    token,
    exchange_url: exchangeUrl,
  });
  if (workspaceId) query.set("workspace_id", workspaceId);
  if (workspaceRole) query.set("workspace_role", workspaceRole);
  return res.redirect(302, `/app?${query.toString()}`);
});

// Backward-compatible alias in case upstream still builds /app/connect.
router.get("/app/connect", async (req, res) => {
  const qs = new URLSearchParams(req.query || {});
  const encoded = qs.toString();
  return res.redirect(302, encoded ? `/connect?${encoded}` : "/connect");
});

router.get("/app", (_req, res) => {
  return res.sendFile(path.join(__dirname, "..", "..", "public", "app", "index.html"));
});

module.exports = router;
