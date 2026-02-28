const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { buildSignature, randomNonce } = require("../services/hmac");
const {
  loadBestSegretariaConnection,
  resolveSegretariaConfig,
  setSegretariaConnectionError,
} = require("../services/segretariaConnectionService");
const { requireQuotesAccess } = require("../services/workspaceRole");

const router = express.Router();
router.use(requireQuotesAccess);

function normalizeLine(line = {}, index = 0) {
  const qty = Math.max(0, Number(line.quantity || 0));
  const unitPrice = Math.max(0, Math.round(Number(line.unit_price_cents || 0)));
  const vatRate = Math.max(0, Number(line.vat_rate || 22));
  const subtotal = Math.round(qty * unitPrice);
  const vat = Math.round((subtotal * vatRate) / 100);
  return {
    line_type: String(line.line_type || (line.item_id ? "item" : "custom")).trim(),
    item_id: line.item_id || null,
    title: String(line.title || "").trim() || null,
    description: String(line.description || line.title || "Riga bozza").trim(),
    quantity: qty,
    unit_label: String(line.unit_label || "pz").trim() || "pz",
    unit_price_cents: unitPrice,
    vat_rate: vatRate,
    line_total_cents: subtotal + vat,
    sort_order: Number(line.sort_order ?? index) || index,
  };
}

function totals(lines = []) {
  let subtotal = 0;
  let vat = 0;
  let total = 0;
  for (const line of lines) {
    const rowSubtotal = Math.round(Number(line.quantity || 0) * Number(line.unit_price_cents || 0));
    const rowVat = Math.round((rowSubtotal * Number(line.vat_rate || 0)) / 100);
    subtotal += rowSubtotal;
    vat += rowVat;
    total += rowSubtotal + rowVat;
  }
  return {
    subtotal_cents: subtotal,
    vat_total_cents: vat,
    total_cents: total,
  };
}

function toAbsoluteUrl(baseUrl, maybeRelativePath) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const path = String(maybeRelativePath || "").trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

router.get("/", async (req, res) => {
  const { db, workspaceId } = req;
  const rows = await db.query(
    `SELECT *
     FROM public.drafts
     WHERE workspace_id=$1
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return res.json({ ok: true, drafts: rows.rows || [] });
});

router.get("/:id", async (req, res) => {
  const { db, workspaceId } = req;
  const draftId = String(req.params.id || "").trim();
  if (!draftId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "draft id required" });

  const draftRes = await db.query(
    `SELECT *
     FROM public.drafts
     WHERE workspace_id=$1 AND id=$2
     LIMIT 1`,
    [workspaceId, draftId]
  );
  if (!draftRes.rowCount) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const linesRes = await db.query(
    `SELECT *
     FROM public.draft_lines
     WHERE workspace_id=$1 AND draft_id=$2
     ORDER BY sort_order ASC, created_at ASC`,
    [workspaceId, draftId]
  );
  return res.json({ ok: true, draft: draftRes.rows[0], lines: linesRes.rows || [] });
});

router.post("/", async (req, res) => {
  const { db, workspaceId } = req;
  const linesInput = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!linesInput.length) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "lines required" });

  const normalizedLines = linesInput.map((line, idx) => normalizeLine(line, idx));
  const computed = totals(normalizedLines);
  const draftId = uuidv4();

  try {
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO public.drafts
       (id, workspace_id, draft_number, status, client_ref, notes, currency,
        subtotal_cents, vat_total_cents, total_cents, reserve_stock,
        created_at, updated_at)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,now(),now())`,
      [
        draftId,
        workspaceId,
        String(req.body?.draft_number || "").trim() || null,
        String(req.body?.client_ref || "").trim() || null,
        String(req.body?.notes || "").trim() || null,
        String(req.body?.currency || "EUR").trim() || "EUR",
        computed.subtotal_cents,
        computed.vat_total_cents,
        computed.total_cents,
        Boolean(req.body?.reserve_stock),
      ]
    );

    for (const line of normalizedLines) {
      await db.query(
        `INSERT INTO public.draft_lines
         (id, workspace_id, draft_id, line_type, item_id, title, description, quantity, unit_label, unit_price_cents, vat_rate, line_total_cents, sort_order, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
        [
          uuidv4(),
          workspaceId,
          draftId,
          line.line_type,
          line.item_id,
          line.title,
          line.description,
          line.quantity,
          line.unit_label,
          line.unit_price_cents,
          line.vat_rate,
          line.line_total_cents,
          line.sort_order,
        ]
      );
    }

    await db.query("COMMIT");
    return res.json({ ok: true, draft_id: draftId, totals: computed });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ ok: false, error: "DRAFT_CREATE_FAILED", details: err?.message || String(err) });
  }
});

router.post("/:id/push-to-segretaria", async (req, res) => {
  const { db, workspaceId } = req;
  const draftId = String(req.params.id || "").trim();
  if (!draftId) return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", details: "draft id required" });

  try {
    const draftRes = await db.query(
      `SELECT *
       FROM public.drafts
       WHERE workspace_id=$1 AND id=$2
       LIMIT 1`,
      [workspaceId, draftId]
    );
    if (!draftRes.rowCount) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const draft = draftRes.rows[0];

    const linesRes = await db.query(
      `SELECT *
       FROM public.draft_lines
       WHERE workspace_id=$1 AND draft_id=$2
       ORDER BY sort_order ASC, created_at ASC`,
      [workspaceId, draftId]
    );
    const lines = linesRes.rows || [];

    const payload = {
      draft_id: draft.id,
      source_draft_id: draft.draft_number || draft.id,
      currency: draft.currency || "EUR",
      issue_date: new Date().toISOString().slice(0, 10),
      notes_public: draft.notes || null,
      lines: lines.map((line) => ({
        line_type: line.line_type,
        item_id: line.item_id,
        external_item_id: line.item_id,
        title: line.title,
        description: line.description,
        quantity: Number(line.quantity || 0),
        unit_label: line.unit_label,
        unit_price_cents: Number(line.unit_price_cents || 0),
        vat_rate: Number(line.vat_rate || 22),
        sort_order: Number(line.sort_order || 0),
      })),
      totals: {
        subtotal_cents: Number(draft.subtotal_cents || 0),
        vat_total_cents: Number(draft.vat_total_cents || 0),
        total_cents: Number(draft.total_cents || 0),
        discount_total_cents: 0,
      },
    };

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

    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomNonce();
    const signature = buildSignature(hmacSecret, timestamp, nonce, rawBody);

    const pushRes = await fetch(`${segretariaBaseUrl}/api/integrations/magazzino/quotes/from-draft`, {
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

    const body = await pushRes.json().catch(() => null);
    if (!pushRes.ok) {
      await setSegretariaConnectionError(db, workspaceForSegretaria, body?.details || body?.error || `HTTP ${pushRes.status}`).catch(() => {});
      return res.status(pushRes.status).json({ ok: false, error: "SEGRETARIA_PUSH_FAILED", details: body?.details || body?.error || `HTTP ${pushRes.status}`, upstream: body });
    }
    await setSegretariaConnectionError(db, workspaceForSegretaria, null).catch(() => {});

    const absoluteFinalizeUrl = toAbsoluteUrl(segretariaBaseUrl, body?.finalize_url || null);

    await db.query(
      `UPDATE public.drafts
       SET segretaria_quote_id=$3,
           segretaria_finalize_url=$4,
           pushed_at=now(),
           status='pushed',
           updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, draftId, body?.quote_id || null, absoluteFinalizeUrl]
    );

    return res.json({
      ok: true,
      connection_source: config.source,
      segretaria_quote_id: body?.quote_id || null,
      finalize_url: absoluteFinalizeUrl,
      upstream: body,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "PUSH_FAILED", details: err?.message || String(err) });
  }
});

module.exports = router;
