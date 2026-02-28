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

app.use(async (req, res, next) => {
  const path = String(req.path || "");
  const workspaceNotRequired = path === "/connect" || path === "/connect/" || path.startsWith("/api/integration/connect");
  const workspaceId = String(req.header("x-workspace-id") || process.env.WORKSPACE_ID || "").trim();
  if (!workspaceId && !workspaceNotRequired) {
    return res.status(400).json({ ok: false, error: "MISSING_WORKSPACE_ID", details: "Set x-workspace-id or WORKSPACE_ID" });
  }
  req.workspaceId = workspaceId || null;
  req.workspaceRole = resolveWorkspaceRole(req);
  req.canAccessQuotes = canAccessQuotesRole(req.workspaceRole);

  try {
    const client = await pool.connect();
    req.db = client;
    await client.query("SELECT 1");
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
