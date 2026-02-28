"use strict";

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

async function loadSegretariaConnection(client, workspaceId) {
  const ws = String(workspaceId || "").trim();
  if (!ws) return null;
  const q = await client.query(
    `SELECT workspace_id, segretaria_base_url, api_key, hmac_secret, is_active, connected_at, updated_at, last_error
     FROM public.segretaria_connections
     WHERE workspace_id=$1
     LIMIT 1`,
    [ws]
  );
  return q.rowCount ? q.rows[0] : null;
}

async function loadLatestActiveSegretariaConnection(client) {
  const q = await client.query(
    `SELECT workspace_id, segretaria_base_url, api_key, hmac_secret, is_active, connected_at, updated_at, last_error
     FROM public.segretaria_connections
     WHERE is_active=true
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return q.rowCount ? q.rows[0] : null;
}

async function loadBestSegretariaConnection(client, workspaceId) {
  const direct = await loadSegretariaConnection(client, workspaceId);
  if (direct) return direct;
  return loadLatestActiveSegretariaConnection(client);
}

async function saveSegretariaConnection(client, { workspaceId, segretariaBaseUrl, apiKey, hmacSecret, active = true }) {
  const ws = String(workspaceId || "").trim();
  if (!ws) throw new Error("workspace_id is required");
  const baseUrl = normalizeBaseUrl(segretariaBaseUrl);
  if (!baseUrl) throw new Error("segretaria_base_url is required");
  const api = String(apiKey || "").trim();
  const secret = String(hmacSecret || "").trim();
  if (!api || !secret) throw new Error("api_key and hmac_secret are required");

  const q = await client.query(
    `INSERT INTO public.segretaria_connections
     (workspace_id, segretaria_base_url, api_key, hmac_secret, is_active, connected_at, updated_at, last_error)
     VALUES ($1,$2,$3,$4,$5,now(),now(),NULL)
     ON CONFLICT (workspace_id)
     DO UPDATE SET
       segretaria_base_url=EXCLUDED.segretaria_base_url,
       api_key=EXCLUDED.api_key,
       hmac_secret=EXCLUDED.hmac_secret,
       is_active=EXCLUDED.is_active,
       connected_at=now(),
       updated_at=now(),
       last_error=NULL
     RETURNING workspace_id, segretaria_base_url, api_key, hmac_secret, is_active, connected_at, updated_at, last_error`,
    [ws, baseUrl, api, secret, active === true]
  );
  return q.rows[0];
}

function resolveSegretariaConfig({ dbConnection, env = process.env }) {
  const row = dbConnection && dbConnection.is_active === true ? dbConnection : null;
  if (row) {
    return {
      source: "db",
      segretaria_base_url: normalizeBaseUrl(row.segretaria_base_url),
      api_key: String(row.api_key || "").trim(),
      hmac_secret: String(row.hmac_secret || "").trim(),
    };
  }

  return {
    source: "env",
    segretaria_base_url: normalizeBaseUrl(env.SEGRETARIA_BASE_URL),
    api_key: String(env.SEGRETARIA_API_KEY || "").trim(),
    hmac_secret: String(env.SEGRETARIA_HMAC_SECRET || "").trim(),
  };
}

async function setSegretariaConnectionError(client, workspaceId, errorMessage) {
  const ws = String(workspaceId || "").trim();
  if (!ws) return;
  await client.query(
    `UPDATE public.segretaria_connections
     SET last_error=$2, updated_at=now()
     WHERE workspace_id=$1`,
    [ws, String(errorMessage || "").trim() || null]
  );
}

function apiKeyPrefix(apiKey) {
  const raw = String(apiKey || "").trim();
  return raw ? raw.slice(0, 10) : null;
}

module.exports = {
  normalizeBaseUrl,
  loadSegretariaConnection,
  loadLatestActiveSegretariaConnection,
  loadBestSegretariaConnection,
  saveSegretariaConnection,
  resolveSegretariaConfig,
  setSegretariaConnectionError,
  apiKeyPrefix,
};
