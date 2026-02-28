require("dotenv").config();

const express = require("express");
const path = require("path");
const { pool } = require("./db");

const itemsRoutes = require("./routes/items");
const stockRoutes = require("./routes/stock");
const draftsRoutes = require("./routes/drafts");
const inventorySheetsRoutes = require("./routes/inventorySheets");
const integrationRoutes = require("./routes/integration");
const segretariaRoutes = require("./routes/segretaria");
const { resolveWorkspaceRole, canAccessQuotesRole } = require("./services/workspaceRole");

const app = express();
const PORT = Number(process.env.PORT || 3055);

app.use(express.json());
app.use("/app", express.static(path.join(__dirname, "..", "public", "app")));

function normalizeWorkspaceId(value) {
  return String(value || "").trim();
}

function readWorkspaceIdFromRequest(req) {
  return normalizeWorkspaceId(
    req.header("x-workspace-id") ||
      req.header("X-Workspace-Id") ||
      req.query?.workspace_id ||
      req.query?.workspaceId ||
      req.headers?.["x-workspace-id"] ||
      req.headers?.["X-Workspace-Id"]
  );
}

async function inferSingleWorkspaceIdFromConnections(client) {
  try {
    const exists = await client.query("SELECT to_regclass('public.segretaria_connections') AS tbl");
    if (!exists?.rows?.[0]?.tbl) return { workspaceId: null, multiple: false };
    const q = await client.query(
      `SELECT workspace_id
       FROM public.segretaria_connections
       WHERE is_active=true
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 2`
    );
    if (!q.rowCount) return { workspaceId: null, multiple: false };
    if (q.rowCount > 1) return { workspaceId: null, multiple: true };
    return { workspaceId: normalizeWorkspaceId(q.rows[0].workspace_id), multiple: false };
  } catch (_) {
    return { workspaceId: null, multiple: false };
  }
}

app.use(async (req, res, next) => {
  const reqPath = String(req.path || "");
  const workspaceNotRequired =
    reqPath === "/connect" ||
    reqPath === "/connect/" ||
    reqPath === "/health" ||
    reqPath.startsWith("/api/integration/connect") ||
    reqPath.startsWith("/api/integration/status");
  try {
    const client = await pool.connect();
    req.db = client;
    await client.query("SELECT 1");

    let workspaceId = readWorkspaceIdFromRequest(req);
    if (!workspaceId) workspaceId = normalizeWorkspaceId(process.env.WORKSPACE_ID);

    if (!workspaceId && !workspaceNotRequired) {
      const inferred = await inferSingleWorkspaceIdFromConnections(client);
      if (inferred.multiple) {
        client.release();
        return res.status(409).json({
          ok: false,
          error: "MULTI_WORKSPACE_CONTEXT_REQUIRED",
          details: "Più workspace disponibili: invia x-workspace-id (o apri Magazzino da Segretaria con workspace_id).",
        });
      }
      workspaceId = inferred.workspaceId || "";
    }

    if (!workspaceId && !workspaceNotRequired) {
      client.release();
      return res.status(400).json({
        ok: false,
        error: "MISSING_WORKSPACE_ID",
        details: "Set x-workspace-id oppure completa il collegamento da Segretaria.",
      });
    }

    req.workspaceId = workspaceId || null;
    req.workspaceRole = resolveWorkspaceRole(req);
    req.canAccessQuotes = canAccessQuotesRole(req.workspaceRole);

    res.on("finish", () => {
      client.release();
    });
    return next();
  } catch (err) {
    return res.status(500).json({ ok: false, error: "DB_ERROR", details: err?.message || String(err) });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "ok" });
});

app.get("/", (_req, res) => {
  res.redirect(302, "/app");
});

app.get("/schede", (req, res) => {
  const qs = new URLSearchParams(req.query || {});
  qs.set("tab", "sheets");
  return res.redirect(302, `/app?${qs.toString()}`);
});

app.get("/schede/new", (req, res) => {
  const qs = new URLSearchParams(req.query || {});
  qs.set("tab", "sheets");
  qs.set("newSheet", "1");
  return res.redirect(302, `/app?${qs.toString()}`);
});

app.use("/", integrationRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/drafts", draftsRoutes);
app.use("/api/inventory/sheets", inventorySheetsRoutes);
app.use("/api/segretaria", segretariaRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND" });
});

app.listen(PORT, () => {
  console.log(`Magazzino running on http://localhost:${PORT}`);
});
