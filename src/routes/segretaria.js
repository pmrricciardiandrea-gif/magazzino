const express = require("express");
const { buildSignature, randomNonce } = require("../services/hmac");
const {
  loadBestSegretariaConnection,
  resolveSegretariaConfig,
  setSegretariaConnectionError,
} = require("../services/segretariaConnectionService");
const { canAccessQuotesRole } = require("../services/workspaceRole");

const router = express.Router();

router.post("/snapshot", async (req, res) => {
  const { db, workspaceId } = req;
  const canAccessQuotes = canAccessQuotesRole(req.workspaceRole);
  const q = String(req.body?.q || "").trim();
  const limitRaw = Number(req.body?.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

  try {
    const connectionRow = await loadBestSegretariaConnection(db, workspaceId).catch(() => null);
    const config = resolveSegretariaConfig({ dbConnection: connectionRow, env: process.env });
    const workspaceForSegretaria = String(connectionRow?.workspace_id || workspaceId || "").trim();
    const segretariaBaseUrl = String(config.segretaria_base_url || "").trim();
    const apiKey = String(config.api_key || "").trim();
    const hmacSecret = String(config.hmac_secret || "").trim();
    if (!segretariaBaseUrl || !apiKey || !hmacSecret) {
      return res.status(500).json({
        ok: false,
        error: "SEGRETARIA_CONFIG_MISSING",
        details: "Connessione Segretaria non configurata (DB o env).",
      });
    }

    const payload = { q, limit };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomNonce();
    const signature = buildSignature(hmacSecret, timestamp, nonce, rawBody);

    const upstreamRes = await fetch(`${segretariaBaseUrl}/api/integrations/magazzino/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Provider": "magazzino",
        "X-Workspace-Id": workspaceForSegretaria,
        "X-Api-Key": apiKey,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": `sha256=${signature}`,
      },
      body: rawBody,
    });

    const body = await upstreamRes.json().catch(() => null);
    if (!upstreamRes.ok || !body?.ok) {
      const details = body?.details || body?.error || `HTTP ${upstreamRes.status}`;
      await setSegretariaConnectionError(db, workspaceForSegretaria, details).catch(() => {});
      return res.status(upstreamRes.status || 502).json({
        ok: false,
        error: "SEGRETARIA_SNAPSHOT_FAILED",
        details,
        upstream: body,
      });
    }

    await setSegretariaConnectionError(db, workspaceForSegretaria, null).catch(() => {});
    return res.json({
      ok: true,
      connection_source: config.source,
      workspace_id: body.workspace_id || workspaceForSegretaria,
      clients: Array.isArray(body.clients) ? body.clients : [],
      suppliers: Array.isArray(body.suppliers) ? body.suppliers : [],
      quotes: canAccessQuotes && Array.isArray(body.quotes) ? body.quotes : [],
      counts: body.counts || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "SEGRETARIA_PROXY_FAILED",
      details: err?.message || String(err),
    });
  }
});

module.exports = router;
