(function () {
  const WORKSPACE_STORAGE_KEY = "magazzino.active_workspace_id";
  const WORKSPACE_ROLE_STORAGE_KEY = "magazzino.active_workspace_role";

  const TAB_META = {
    overview: { title: "Panoramica", subtitle: "Vista operativa in tempo reale" },
    settings: { title: "Settings", subtitle: "Connessione e accesso integrazione" },
    quotes: { title: "Preventivi", subtitle: "Bozze locali e preventivi sincronizzati" },
    clients: { title: "Clienti", subtitle: "Anagrafica clienti da Segretaria" },
    suppliers: { title: "Fornitori", subtitle: "Anagrafica fornitori da Segretaria" },
    items: { title: "Articoli", subtitle: "Catalogo articoli e servizi di Magazzino" },
    stock: { title: "Stock", subtitle: "Magazzini, livelli e movimenti" },
    sheets: { title: "Schede Articoli", subtitle: "Draft, lock e movimenti OUT automatici" },
  };

  const state = {
    workspaceRole: null,
    connection: null,
    items: [],
    warehouses: [],
    levels: [],
    movements: [],
    drafts: [],
    selectedDraft: null,
    segretariaClients: [],
    segretariaSuppliers: [],
    segretariaQuotes: [],
    activeWorkspaceId: null,
    availableWorkspaces: [],
    inventorySheetsEnabled: true,
    sheets: [],
    currentSheetId: null,
    currentSheetDetail: null,
    sheetFilters: {
      status: "",
      taskId: "",
      projectId: "",
      dateFrom: "",
      dateTo: "",
    },
    importWizard: {
      headers: [],
      rows: [],
      mapping: {},
      previewRows: [],
      confirmToken1: null,
      stats: { total: 0, insert: 0, update: 0, invalid: 0 },
      showManualMapping: false,
    },
  };

  const qs = new URLSearchParams(window.location.search || "");
  let draftLineCounter = 0;
  let deferredInstallPrompt = null;

  const dom = {
    tabsNav: document.getElementById("tabsNav"),
    quotesTabButton: document.querySelector('.tab[data-tab="quotes"]'),
    quotesPanel: document.querySelector('.tab-panel[data-panel="quotes"]'),
    sheetsTabButton: document.querySelector('.tab[data-tab="sheets"]'),
    sheetsPanel: document.querySelector('.tab-panel[data-panel="sheets"]'),
    kpiDraftsCard: document.getElementById("kpiDraftsCard"),
    kpiSegretariaQuotesCard: document.getElementById("kpiSegretariaQuotesCard"),
    sectionTitle: document.getElementById("sectionTitle"),
    sectionSubtitle: document.getElementById("sectionSubtitle"),
    pwaInstallBtn: document.getElementById("pwaInstallBtn"),
    globalRefreshBtn: document.getElementById("globalRefreshBtn"),
    kpiConnection: document.getElementById("kpiConnection"),
    kpiItems: document.getElementById("kpiItems"),
    kpiClients: document.getElementById("kpiClients"),
    kpiSuppliers: document.getElementById("kpiSuppliers"),
    kpiDrafts: document.getElementById("kpiDrafts"),
    kpiSegretariaQuotes: document.getElementById("kpiSegretariaQuotes"),
    overviewDrafts: document.getElementById("overviewDrafts"),
    statusBadge: document.getElementById("statusBadge"),
    statusText: document.getElementById("statusText"),
    statusLastError: document.getElementById("statusLastError"),
    accessWorkspace: document.getElementById("accessWorkspace"),
    accessApiKeyPrefix: document.getElementById("accessApiKeyPrefix"),
    accessBaseUrl: document.getElementById("accessBaseUrl"),
    accessConnectedAt: document.getElementById("accessConnectedAt"),
    tokenInput: document.getElementById("tokenInput"),
    exchangeInput: document.getElementById("exchangeInput"),
    tokenMasked: document.getElementById("tokenMasked"),
    exchangeMasked: document.getElementById("exchangeMasked"),
    confirmBtn: document.getElementById("confirmBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    connectMessage: document.getElementById("connectMessage"),
    refreshSegretariaDataBtn: document.getElementById("refreshSegretariaDataBtn"),
    segretariaDataMessage: document.getElementById("segretariaDataMessage"),
    quoteClientRefInput: document.getElementById("quoteClientRefInput"),
    quoteClientSuggestionsList: document.getElementById("quoteClientSuggestionsList"),
    quoteClientQuickSuggestions: document.getElementById("quoteClientQuickSuggestions"),
    clientsSearchInput: document.getElementById("clientsSearchInput"),
    clientsSearchBtn: document.getElementById("clientsSearchBtn"),
    suppliersSearchInput: document.getElementById("suppliersSearchInput"),
    suppliersSearchBtn: document.getElementById("suppliersSearchBtn"),
    clientsTableBody: document.getElementById("clientsTableBody"),
    suppliersTableBody: document.getElementById("suppliersTableBody"),
    segretariaQuotesTableBody: document.getElementById("segretariaQuotesTableBody"),
    newItemForm: document.getElementById("newItemForm"),
    newItemMessage: document.getElementById("newItemMessage"),
    itemsSearchInput: document.getElementById("itemsSearchInput"),
    itemsSearchBtn: document.getElementById("itemsSearchBtn"),
    itemsTableBody: document.getElementById("itemsTableBody"),
    newWarehouseForm: document.getElementById("newWarehouseForm"),
    newWarehouseMessage: document.getElementById("newWarehouseMessage"),
    newMovementForm: document.getElementById("newMovementForm"),
    newMovementMessage: document.getElementById("newMovementMessage"),
    movementWarehouseSelect: document.getElementById("movementWarehouseSelect"),
    movementItemSelect: document.getElementById("movementItemSelect"),
    levelsTableBody: document.getElementById("levelsTableBody"),
    movementsTableBody: document.getElementById("movementsTableBody"),
    openItemsImportBtn: document.getElementById("openItemsImportBtn"),
    newDraftForm: document.getElementById("newDraftForm"),
    newDraftMessage: document.getElementById("newDraftMessage"),
    draftLinesContainer: document.getElementById("draftLinesContainer"),
    addDraftLineBtn: document.getElementById("addDraftLineBtn"),
    draftsList: document.getElementById("draftsList"),
    draftDetailCard: document.getElementById("draftDetailCard"),
    draftDetailContent: document.getElementById("draftDetailContent"),
    itemsImportModal: document.getElementById("itemsImportModal"),
    itemsImportFile: document.getElementById("itemsImportFile"),
    itemsImportAnalyzeBtn: document.getElementById("itemsImportAnalyzeBtn"),
    itemsImportConfirm1Btn: document.getElementById("itemsImportConfirm1Btn"),
    itemsImportConfirm2Btn: document.getElementById("itemsImportConfirm2Btn"),
    itemsImportMessage: document.getElementById("itemsImportMessage"),
    itemsImportAutoInfo: document.getElementById("itemsImportAutoInfo"),
    itemsImportToggleMappingBtn: document.getElementById("itemsImportToggleMappingBtn"),
    itemsImportStats: document.getElementById("itemsImportStats"),
    itemsImportMappingWrap: document.getElementById("itemsImportMappingWrap"),
    itemsImportMapping: document.getElementById("itemsImportMapping"),
    itemsImportPreviewBody: document.getElementById("itemsImportPreviewBody"),
    importStepUpload: document.getElementById("importStepUpload"),
    importStepPreview: document.getElementById("importStepPreview"),
    importStepConfirm: document.getElementById("importStepConfirm"),
    itemsImportDropzone: document.getElementById("itemsImportDropzone"),
    itemsImportFileName: document.getElementById("itemsImportFileName"),
    refreshSheetsBtn: document.getElementById("refreshSheetsBtn"),
    sheetsFilterForm: document.getElementById("sheetsFilterForm"),
    sheetFilterStatus: document.getElementById("sheetFilterStatus"),
    sheetFilterTaskId: document.getElementById("sheetFilterTaskId"),
    sheetFilterProjectId: document.getElementById("sheetFilterProjectId"),
    sheetFilterDateFrom: document.getElementById("sheetFilterDateFrom"),
    sheetFilterDateTo: document.getElementById("sheetFilterDateTo"),
    newSheetForm: document.getElementById("newSheetForm"),
    newSheetMessage: document.getElementById("newSheetMessage"),
    sheetsList: document.getElementById("sheetsList"),
    sheetDetailCard: document.getElementById("sheetDetailCard"),
    sheetDetailMeta: document.getElementById("sheetDetailMeta"),
    sheetDetailMessage: document.getElementById("sheetDetailMessage"),
    sheetLockBtn: document.getElementById("sheetLockBtn"),
    sheetRefreshBtn: document.getElementById("sheetRefreshBtn"),
    sheetRowForm: document.getElementById("sheetRowForm"),
    sheetRowItemSelect: document.getElementById("sheetRowItemSelect"),
    sheetRowsBody: document.getElementById("sheetRowsBody"),
    sheetMovementsBody: document.getElementById("sheetMovementsBody"),
  };

  function esc(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

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

  function formatDateTime(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleString("it-IT");
  }

  function formatCents(cents) {
    const value = Number(cents || 0) / 100;
    return value.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  }

  function setText(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("err-text", Boolean(isError));
  }

  function isStandaloneMode() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    return window.navigator.standalone === true;
  }

  function isIosDevice() {
    const ua = String(window.navigator.userAgent || "").toLowerCase();
    return /iphone|ipad|ipod/.test(ua);
  }

  function setInstallButtonVisible(visible) {
    if (!dom.pwaInstallBtn) return;
    dom.pwaInstallBtn.classList.toggle("hidden", !visible);
  }

  async function registerPwa() {
    if (typeof window === "undefined") return;
    if (isStandaloneMode()) {
      setInstallButtonVisible(false);
      return;
    }

    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
      } catch (_) {}
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      setInstallButtonVisible(true);
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      setInstallButtonVisible(false);
    });

    if (isIosDevice()) {
      setInstallButtonVisible(true);
    }
  }

  async function promptInstallPwa() {
    if (isStandaloneMode()) {
      setInstallButtonVisible(false);
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } catch (_) {}
      deferredInstallPrompt = null;
      setInstallButtonVisible(false);
      return;
    }
    if (isIosDevice()) {
      alert('Su iPhone/iPad: apri il menu Condividi in Safari e tocca "Aggiungi a schermata Home".');
      return;
    }
    alert("Installazione non disponibile in questo browser.");
  }

  function setStatus(kind, text, details, lastError) {
    if (!dom.statusBadge) return;
    dom.statusBadge.className = "badge " + (kind === "ok" ? "badge-ok" : kind === "error" ? "badge-err" : "badge-muted");
    dom.statusBadge.textContent = text;
    dom.statusText.textContent = details || "";
    if (!dom.statusLastError) return;
    if (lastError) {
      dom.statusLastError.classList.remove("hidden");
      dom.statusLastError.textContent = "Ultimo errore: " + lastError;
    } else {
      dom.statusLastError.classList.add("hidden");
      dom.statusLastError.textContent = "";
    }
  }

  function normalizeWorkspaceId(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    return raw;
  }

  function setActiveWorkspaceId(value) {
    const ws = normalizeWorkspaceId(value);
    state.activeWorkspaceId = ws;
    try {
      if (ws) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, ws);
      else window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } catch (_) {}
  }

  function loadActiveWorkspaceIdFromStorage() {
    try {
      const ws = normalizeWorkspaceId(window.localStorage.getItem(WORKSPACE_STORAGE_KEY));
      if (ws) state.activeWorkspaceId = ws;
    } catch (_) {}
  }

  function setWorkspaceRole(value) {
    const role = normalizeWorkspaceRole(value);
    state.workspaceRole = role;
    try {
      if (role) window.localStorage.setItem(WORKSPACE_ROLE_STORAGE_KEY, role);
      else window.localStorage.removeItem(WORKSPACE_ROLE_STORAGE_KEY);
    } catch (_) {}
  }

  function loadWorkspaceRoleFromStorage() {
    try {
      const role = normalizeWorkspaceRole(window.localStorage.getItem(WORKSPACE_ROLE_STORAGE_KEY));
      if (role) state.workspaceRole = role;
    } catch (_) {}
  }

  function canAccessQuotes() {
    return canAccessQuotesRole(state.workspaceRole);
  }

  function canUseInventorySheets() {
    return state.inventorySheetsEnabled !== false;
  }

  function fmtSheetLink(taskId, projectId) {
    if (taskId) return `Task: ${taskId}`;
    if (projectId) return `Progetto: ${projectId}`;
    return "Nessun collegamento";
  }

  function renderAccess() {
    const conn = state.connection || {};
    if (dom.accessWorkspace) dom.accessWorkspace.textContent = conn.workspace_id || state.activeWorkspaceId || "-";
    if (dom.accessApiKeyPrefix) dom.accessApiKeyPrefix.textContent = conn.api_key_prefix ? "******" : "-";
    if (dom.accessBaseUrl) dom.accessBaseUrl.textContent = conn.segretaria_base_url ? "******" : "-";
    if (dom.accessConnectedAt) dom.accessConnectedAt.textContent = formatDateTime(conn.connected_at) || "-";
  }

  function renderManualParamsMask() {
    const token = String(dom.tokenInput?.value || "").trim();
    const exchange = String(dom.exchangeInput?.value || "").trim();
    if (dom.tokenMasked) dom.tokenMasked.textContent = token ? "******" : "-";
    if (dom.exchangeMasked) dom.exchangeMasked.textContent = exchange ? "******" : "-";
  }

  function clientRefLabel(client) {
    if (!client || typeof client !== "object") return "";
    const name = String(client.name || "").trim();
    const company = String(client.company || "").trim();
    const email = String(client.email || "").trim();
    if (name && company) return `${name} · ${company}`;
    if (name && email) return `${name} · ${email}`;
    return name || company || email || "";
  }

  function renderQuoteClientSuggestions() {
    if (!dom.quoteClientSuggestionsList || !dom.quoteClientQuickSuggestions) return;
    const options = (state.segretariaClients || [])
      .map((client) => clientRefLabel(client))
      .filter(Boolean);
    const uniqueOptions = Array.from(new Set(options));

    dom.quoteClientSuggestionsList.innerHTML = uniqueOptions
      .map((label) => `<option value="${esc(label)}"></option>`)
      .join("");

    const quick = uniqueOptions.slice(0, 8);
    if (!quick.length) {
      dom.quoteClientQuickSuggestions.innerHTML = '<span class="muted">Nessun cliente suggerito.</span>';
      return;
    }
    dom.quoteClientQuickSuggestions.innerHTML = quick
      .map(
        (label) =>
          `<button type="button" class="btn btn-sm" data-action="pick-quote-client" data-value="${esc(label)}">${esc(label)}</button>`
      )
      .join("");
  }

  function buildApiHeaders(inputHeaders) {
    const merged = { ...(inputHeaders || {}) };
    if (state.activeWorkspaceId && !merged["x-workspace-id"] && !merged["X-Workspace-Id"]) {
      merged["x-workspace-id"] = state.activeWorkspaceId;
    }
    if (state.workspaceRole && !merged["x-workspace-role"] && !merged["X-Workspace-Role"]) {
      merged["x-workspace-role"] = state.workspaceRole;
    }
    return merged;
  }

  async function api(path, options) {
    const opts = options ? { ...options } : {};
    opts.headers = buildApiHeaders(opts.headers);
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const err = new Error(body.details || body.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function toCents(value) {
    const normalized = String(value || "")
      .trim()
      .replace(",", ".");
    const num = Number(normalized);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100);
  }

  function normalizeItemType(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["service", "servizio"].includes(raw)) return "service";
    return "item";
  }

  function normalizeHeader(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function parseCsvLine(line, delimiter) {
    const out = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        out.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    out.push(current);
    return out.map((v) => String(v || "").trim());
  }

  function parseCsvContent(text) {
    const lines = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    if (!lines.length) return { headers: [], rows: [] };

    const first = lines[0] || "";
    const delimiter = [";", ",", "\t"].sort((a, b) => (first.split(b).length > first.split(a).length ? 1 : -1))[0];
    const headers = parseCsvLine(first, delimiter);
    const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
    return { headers, rows };
  }

  function autoMapItemHeaders(headers) {
    const synonyms = {
      sku: ["sku", "codice", "code", "codice articolo"],
      name: ["name", "nome", "articolo", "item", "prodotto"],
      description: ["descrizione", "description", "dettagli"],
      unit_label: ["unita", "unit", "u m", "misura", "unit label"],
      item_type: ["tipo", "type", "categoria"],
    };
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));
    const mapping = {};
    Object.entries(synonyms).forEach(([field, keys]) => {
      const idx = normalizedHeaders.findIndex((header) =>
        keys.some((key) => header.includes(normalizeHeader(key)))
      );
      if (idx >= 0) mapping[field] = idx;
    });
    return mapping;
  }

  function updateImportStep(step) {
    if (dom.importStepUpload) dom.importStepUpload.classList.toggle("is-active", step === "upload");
    if (dom.importStepPreview) dom.importStepPreview.classList.toggle("is-active", step === "preview");
    if (dom.importStepConfirm) dom.importStepConfirm.classList.toggle("is-active", step === "confirm");
  }

  function setImportMessage(text, isError) {
    setText(dom.itemsImportMessage, text, isError);
  }

  function resetImportWizard() {
    state.importWizard = {
      headers: [],
      rows: [],
      mapping: {},
      previewRows: [],
      confirmToken1: null,
      stats: { total: 0, insert: 0, update: 0, invalid: 0 },
      selectedFile: null,
      showManualMapping: false,
    };
    if (dom.itemsImportMappingWrap) dom.itemsImportMappingWrap.classList.add("hidden");
    if (dom.itemsImportMapping) dom.itemsImportMapping.innerHTML = "";
    if (dom.itemsImportToggleMappingBtn) {
      dom.itemsImportToggleMappingBtn.classList.add("hidden");
      dom.itemsImportToggleMappingBtn.textContent = "Modifica mapping (avanzato)";
    }
    if (dom.itemsImportAutoInfo) dom.itemsImportAutoInfo.textContent = "";
    if (dom.itemsImportPreviewBody) {
      dom.itemsImportPreviewBody.innerHTML = '<tr><td colspan="5" class="muted">Nessuna preview.</td></tr>';
    }
    if (dom.itemsImportStats) dom.itemsImportStats.textContent = "";
    if (dom.itemsImportFile) dom.itemsImportFile.value = "";
    if (dom.itemsImportFileName) dom.itemsImportFileName.textContent = "Nessun file selezionato.";
    if (dom.itemsImportDropzone) dom.itemsImportDropzone.classList.remove("is-dragover");
    if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
    updateImportStep("upload");
  }

  function setImportSelectedFile(file) {
    if (!file) {
      state.importWizard.selectedFile = null;
      if (dom.itemsImportFileName) dom.itemsImportFileName.textContent = "Nessun file selezionato.";
      return;
    }
    state.importWizard.selectedFile = file;
    if (dom.itemsImportFileName) dom.itemsImportFileName.textContent = `File: ${file.name}`;
  }

  function getImportSelectedFile() {
    if (state.importWizard?.selectedFile) return state.importWizard.selectedFile;
    return dom.itemsImportFile?.files?.[0] || null;
  }

  function renderImportMappingControls() {
    if (!dom.itemsImportMapping || !dom.itemsImportMappingWrap) return;
    if (!state.importWizard.showManualMapping) {
      dom.itemsImportMappingWrap.classList.add("hidden");
      dom.itemsImportMapping.innerHTML = "";
      return;
    }
    const headers = state.importWizard.headers || [];
    if (!headers.length) {
      dom.itemsImportMappingWrap.classList.add("hidden");
      dom.itemsImportMapping.innerHTML = "";
      return;
    }
    const mapping = state.importWizard.mapping || {};
    const fields = [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Nome articolo" },
      { key: "description", label: "Descrizione" },
      { key: "unit_label", label: "Unità" },
      { key: "item_type", label: "Tipo" },
    ];
    dom.itemsImportMappingWrap.classList.remove("hidden");
    dom.itemsImportMapping.innerHTML = fields
      .map(({ key, label }) => {
        const current = Number.isInteger(mapping[key]) ? Number(mapping[key]) : -1;
        const options = ['<option value="-1">- non mappato -</option>'].concat(
          headers.map((header, index) => `<option value="${index}" ${current === index ? "selected" : ""}>${esc(header)}</option>`)
        );
        return `
          <label>
            <span class="label">${esc(label)}</span>
            <select class="input" data-import-map="${esc(key)}">
              ${options.join("")}
            </select>
          </label>
        `;
      })
      .join("");
  }

  function renderImportAutoInfo() {
    if (!dom.itemsImportAutoInfo) return;
    const headers = state.importWizard.headers || [];
    const mapping = state.importWizard.mapping || {};
    const mappedCount = ["sku", "name", "description", "unit_label", "item_type"].reduce((acc, key) => {
      const idx = Number(mapping[key]);
      return Number.isInteger(idx) && idx >= 0 ? acc + 1 : acc;
    }, 0);
    if (!headers.length) {
      dom.itemsImportAutoInfo.textContent = "";
      return;
    }
    dom.itemsImportAutoInfo.textContent = `Auto-mapping attivo: ${mappedCount}/5 campi mappati automaticamente.`;
  }

  function rebuildImportPreview() {
    const headers = state.importWizard.headers || [];
    const rows = state.importWizard.rows || [];
    const mapping = state.importWizard.mapping || {};
    const existingBySku = new Map();
    const existingByName = new Map();
    state.items.forEach((item) => {
      const sku = String(item.sku || "").trim().toLowerCase();
      const name = String(item.name || "").trim().toLowerCase();
      if (sku) existingBySku.set(sku, item);
      if (name) existingByName.set(name, item);
    });

    const preview = [];
    const stats = { total: rows.length, insert: 0, update: 0, invalid: 0 };
    const seenKeys = new Set();

    rows.forEach((row, index) => {
      const pick = (field) => {
        const colIndex = Number(mapping[field]);
        if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= headers.length) return "";
        return String(row[colIndex] || "").trim();
      };
      const sku = pick("sku");
      const name = pick("name");
      const description = pick("description");
      const unit_label = pick("unit_label") || "pz";
      const item_type = normalizeItemType(pick("item_type"));

      if (!sku && !name) {
        preview.push({ row_index: index + 1, decision: "invalid", sku, name, unit_label, item_type });
        stats.invalid += 1;
        return;
      }

      const dedupeKey = sku ? `sku:${sku.toLowerCase()}` : `name:${name.toLowerCase()}`;
      if (seenKeys.has(dedupeKey)) {
        preview.push({ row_index: index + 1, decision: "invalid", sku, name, unit_label, item_type });
        stats.invalid += 1;
        return;
      }
      seenKeys.add(dedupeKey);

      const matched = (sku && existingBySku.get(sku.toLowerCase())) || (name && existingByName.get(name.toLowerCase())) || null;
      const decision = matched ? "update" : "insert";
      if (decision === "insert") stats.insert += 1;
      if (decision === "update") stats.update += 1;
      preview.push({ row_index: index + 1, decision, sku, name, description, unit_label, item_type });
    });

    state.importWizard.previewRows = preview;
    state.importWizard.stats = stats;

    if (dom.itemsImportStats) {
      dom.itemsImportStats.textContent = `Righe: ${stats.total} · Nuovi: ${stats.insert} · Aggiornamenti: ${stats.update} · Invalidi: ${stats.invalid}`;
    }
    if (dom.itemsImportPreviewBody) {
      const visible = preview.slice(0, 80);
      dom.itemsImportPreviewBody.innerHTML = visible.length
        ? visible
            .map(
              (row) => `
                <tr>
                  <td><span class="pill ${row.decision === "insert" ? "pill-ok" : row.decision === "update" ? "pill-slate" : "pill-rose"}">${esc(row.decision)}</span></td>
                  <td>${esc(row.sku || "-")}</td>
                  <td>${esc(row.name || "-")}</td>
                  <td>${esc(row.unit_label || "-")}</td>
                  <td>${esc(row.item_type || "-")}</td>
                </tr>
              `
            )
            .join("")
        : '<tr><td colspan="5" class="muted">Nessuna riga valida.</td></tr>';
    }
    updateImportStep("preview");
  }

  async function analyzeImportFile() {
    const file = getImportSelectedFile();
    if (!file) {
      setImportMessage("Seleziona un file da analizzare.", true);
      return;
    }
    setImportMessage("Un secondo che controllo il file...", false);
    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".csv")) {
      setImportMessage("V1 supporta import diretto da CSV. Esporta il file in CSV e riprova.", true);
      return;
    }
    const text = await file.text();
    const parsed = parseCsvContent(text);
    if (!parsed.headers.length || !parsed.rows.length) {
      setImportMessage("File CSV vuoto o non leggibile.", true);
      return;
    }
    state.importWizard.headers = parsed.headers;
    state.importWizard.rows = parsed.rows;
    state.importWizard.mapping = autoMapItemHeaders(parsed.headers);
    state.importWizard.confirmToken1 = null;
    state.importWizard.showManualMapping = false;
    if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
    if (dom.itemsImportToggleMappingBtn) dom.itemsImportToggleMappingBtn.classList.remove("hidden");
    renderImportAutoInfo();
    renderImportMappingControls();
    rebuildImportPreview();
    setImportMessage(`Analisi completata: ${parsed.rows.length} righe lette. Mapping automatico pronto.`, false);
  }

  function openImportModal() {
    if (!dom.itemsImportModal) return;
    dom.itemsImportModal.classList.remove("hidden");
    dom.itemsImportModal.setAttribute("aria-hidden", "false");
    resetImportWizard();
    setImportMessage("Carica CSV/XLSX/PDF/Numbers. V1 supporta import diretto da CSV.", false);
  }

  function closeImportModal() {
    if (!dom.itemsImportModal) return;
    dom.itemsImportModal.classList.add("hidden");
    dom.itemsImportModal.setAttribute("aria-hidden", "true");
  }

  function confirmImportStep1() {
    const validRows = (state.importWizard.previewRows || []).filter((row) => row.decision === "insert" || row.decision === "update");
    if (!validRows.length) {
      setImportMessage("Nessuna riga valida da importare.", true);
      return;
    }
    state.importWizard.confirmToken1 = Math.random().toString(36).slice(2, 12);
    if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = false;
    updateImportStep("confirm");
    setImportMessage("Ultimo step: conferma esecuzione import (2/2).", false);
  }

  async function executeImportStep2() {
    if (!state.importWizard.confirmToken1) {
      setImportMessage("Conferma step 1 richiesta.", true);
      return;
    }
    const rows = (state.importWizard.previewRows || [])
      .filter((row) => row.decision === "insert" || row.decision === "update")
      .map((row) => ({
        sku: row.sku || null,
        name: row.name || null,
        description: row.description || null,
        unit_label: row.unit_label || "pz",
        item_type: row.item_type || "item",
      }));
    if (!rows.length) {
      setImportMessage("Nessuna riga da inviare.", true);
      return;
    }
    if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
    try {
      const body = await api("/api/items/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      await Promise.allSettled([loadItems(dom.itemsSearchInput?.value || ""), loadLevels(), loadMovements()]);
      const stats = body.stats || {};
      setImportMessage(
        `Import completato: ${Number(stats.inserted || 0)} inseriti, ${Number(stats.updated || 0)} aggiornati, ${Number(stats.errors || 0)} errori.`,
        false
      );
      updateImportStep("preview");
      state.importWizard.confirmToken1 = null;
    } catch (err) {
      setImportMessage("Import fallito: " + String(err.message || err), true);
    } finally {
      if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
    }
  }

  function activeTab(tabName) {
    if (tabName === "quotes" && !canAccessQuotes()) tabName = "overview";
    if (tabName === "sheets" && !canUseInventorySheets()) tabName = "overview";
    document.querySelectorAll(".tab").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.panel === tabName);
    });
    const meta = TAB_META[tabName] || { title: "Magazzino", subtitle: "" };
    if (dom.sectionTitle) dom.sectionTitle.textContent = meta.title;
    if (dom.sectionSubtitle) dom.sectionSubtitle.textContent = meta.subtitle;
  }

  function applyRoleGates() {
    const allowed = canAccessQuotes();
    if (dom.quotesTabButton) dom.quotesTabButton.classList.toggle("hidden", !allowed);
    if (dom.quotesPanel) dom.quotesPanel.classList.toggle("hidden", !allowed);
    if (dom.kpiDraftsCard) dom.kpiDraftsCard.classList.toggle("hidden", !allowed);
    if (dom.kpiSegretariaQuotesCard) dom.kpiSegretariaQuotesCard.classList.toggle("hidden", !allowed);
    if (dom.sheetsTabButton) dom.sheetsTabButton.classList.toggle("hidden", !canUseInventorySheets());
    if (dom.sheetsPanel) dom.sheetsPanel.classList.toggle("hidden", !canUseInventorySheets());
    if (!allowed && document.querySelector('.tab[data-tab="quotes"].is-active')) {
      activeTab("overview");
    }
    if (!canUseInventorySheets() && document.querySelector('.tab[data-tab="sheets"].is-active')) {
      activeTab("overview");
    }
  }

  async function loadSheetsMeta() {
    try {
      const body = await api("/api/inventory/sheets/meta");
      state.inventorySheetsEnabled = body.enabled !== false;
    } catch (err) {
      state.inventorySheetsEnabled = false;
      if (String(err.message || "").includes("FEATURE_DISABLED")) {
        state.inventorySheetsEnabled = false;
      }
    }
    applyRoleGates();
  }

  async function loadConnection() {
    try {
      const body = await api("/api/integration/status");
      state.availableWorkspaces = Array.isArray(body.available_workspaces) ? body.available_workspaces : [];
      if (body.workspace_role) setWorkspaceRole(body.workspace_role);
      if (body.workspace_required === true && !state.activeWorkspaceId) {
        state.connection = null;
        const count = state.availableWorkspaces.length;
        setStatus(
          "idle",
          "Workspace richiesto",
          count
            ? `Sono disponibili ${count} workspace: apri Magazzino da Segretaria per impostare il contesto utente.`
            : "Completa prima il collegamento da Segretaria."
        );
        renderAccess();
        renderOverview();
        return;
      }
      state.connection = body.integration || null;
      setActiveWorkspaceId(body.integration?.workspace_id || state.activeWorkspaceId || null);
      if (body.connected) {
        setStatus("ok", "Connessione stabilita", "Integrazione attiva", body.integration?.last_error || null);
      } else {
        setStatus("idle", "Non collegato", "In attesa di collegamento");
      }
    } catch (err) {
      state.connection = null;
      setStatus("error", "Errore stato", String(err.message || err));
    }
    applyRoleGates();
    renderAccess();
    renderOverview();
  }

  async function loadSegretariaSnapshot(query) {
    try {
      const body = await api("/api/segretaria/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: String(query || "").trim(), limit: 100 }),
      });
      state.segretariaClients = Array.isArray(body.clients) ? body.clients : [];
      state.segretariaSuppliers = Array.isArray(body.suppliers) ? body.suppliers : [];
      state.segretariaQuotes = Array.isArray(body.quotes) ? body.quotes : [];
      renderClients();
      renderSuppliers();
      renderSegretariaQuotes();
      renderQuoteClientSuggestions();
      renderOverview();
      setText(
        dom.segretariaDataMessage,
        `Dati aggiornati: ${state.segretariaClients.length} clienti, ${state.segretariaSuppliers.length} fornitori, ${state.segretariaQuotes.length} preventivi.`,
        false
      );
    } catch (err) {
      state.segretariaClients = [];
      state.segretariaSuppliers = [];
      state.segretariaQuotes = [];
      renderClients();
      renderSuppliers();
      renderSegretariaQuotes();
      renderQuoteClientSuggestions();
      renderOverview();
      setText(dom.segretariaDataMessage, `Sync Segretaria non disponibile: ${String(err.message || err)}`, true);
    }
  }

  async function loadItems(query) {
    const q = String(query || "").trim();
    const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
    const body = await api(`/api/items${suffix}`);
    state.items = body.items || [];
    renderItems();
    renderStockSelectors();
    renderDraftLinesItemOptions();
    renderOverview();
  }

  async function loadWarehouses() {
    const body = await api("/api/stock/warehouses");
    state.warehouses = body.warehouses || [];
    renderStockSelectors();
  }

  async function loadLevels() {
    const body = await api("/api/stock/levels");
    state.levels = body.levels || [];
    renderLevels();
  }

  async function loadMovements() {
    const body = await api("/api/stock/movements?limit=50");
    state.movements = body.movements || [];
    renderMovements();
  }

  async function loadDrafts() {
    if (!canAccessQuotes()) {
      state.drafts = [];
      renderDrafts();
      renderOverview();
      return;
    }
    const body = await api("/api/drafts");
    state.drafts = body.drafts || [];
    renderDrafts();
    renderOverview();
  }

  function buildSheetsQuery() {
    const params = new URLSearchParams();
    if (state.sheetFilters.status) params.set("status", state.sheetFilters.status);
    if (state.sheetFilters.taskId) params.set("taskId", state.sheetFilters.taskId);
    if (state.sheetFilters.projectId) params.set("projectId", state.sheetFilters.projectId);
    if (state.sheetFilters.dateFrom) params.set("dateFrom", state.sheetFilters.dateFrom);
    if (state.sheetFilters.dateTo) params.set("dateTo", state.sheetFilters.dateTo);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  async function loadSheets() {
    if (!canUseInventorySheets()) {
      state.sheets = [];
      renderSheetsList();
      return;
    }
    try {
      const body = await api(`/api/inventory/sheets${buildSheetsQuery()}`);
      state.sheets = Array.isArray(body.sheets) ? body.sheets : [];
      renderSheetsList();
    } catch (err) {
      if (String(err.message || "").includes("FEATURE_DISABLED")) {
        state.inventorySheetsEnabled = false;
        applyRoleGates();
      }
      setText(dom.newSheetMessage, `Errore caricamento schede: ${String(err.message || err)}`, true);
      state.sheets = [];
      renderSheetsList();
    }
  }

  async function loadSheetDetail(sheetId) {
    if (!sheetId) return;
    const body = await api(`/api/inventory/sheets/${encodeURIComponent(sheetId)}`);
    state.currentSheetId = sheetId;
    state.currentSheetDetail = body;
    renderSheetDetail();
  }

  async function loadAll() {
    dom.globalRefreshBtn.disabled = true;
    try {
      await loadSheetsMeta();
      await loadConnection();
      const hasWorkspaceContext = Boolean(state.activeWorkspaceId || state.connection?.workspace_id);
      if (!hasWorkspaceContext) return;
      await Promise.allSettled([
        loadItems(""),
        loadWarehouses(),
        loadLevels(),
        loadMovements(),
        canAccessQuotes() ? loadDrafts() : Promise.resolve(),
        loadSegretariaSnapshot(""),
        canUseInventorySheets() ? loadSheets() : Promise.resolve(),
      ]);
    } finally {
      dom.globalRefreshBtn.disabled = false;
    }
  }

  function renderOverview() {
    const quotesAllowed = canAccessQuotes();
    dom.kpiConnection.textContent = state.connection?.is_active ? "Attiva" : "Non attiva";
    dom.kpiItems.textContent = String(state.items.length);
    dom.kpiClients.textContent = String(state.segretariaClients.length);
    dom.kpiSuppliers.textContent = String(state.segretariaSuppliers.length);
    dom.kpiDrafts.textContent = quotesAllowed ? String(state.drafts.length) : "-";
    dom.kpiSegretariaQuotes.textContent = quotesAllowed ? String(state.segretariaQuotes.length) : "-";

    const latest = state.drafts.slice(0, 5);
    if (!latest.length) {
      dom.overviewDrafts.innerHTML = '<p class="muted">Nessuna bozza disponibile.</p>';
      return;
    }
    dom.overviewDrafts.innerHTML = latest
      .map((draft) => {
        return `
          <article class="mini-card">
            <div>
              <p class="mini-title">${esc(draft.draft_number || draft.id)}</p>
              <p class="mini-sub">Stato: ${esc(draft.status)} · Totale: ${esc(formatCents(draft.total_cents))}</p>
            </div>
            <button class="btn btn-sm" data-action="open-draft" data-id="${esc(draft.id)}">Apri</button>
          </article>
        `;
      })
      .join("");
  }

  function renderClients() {
    if (!state.segretariaClients.length) {
      dom.clientsTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun cliente disponibile.</td></tr>';
      return;
    }
    dom.clientsTableBody.innerHTML = state.segretariaClients
      .map((row) => {
        return `
          <tr>
            <td>${esc(row.name || "-")}</td>
            <td>${esc(row.company || "-")}</td>
            <td>${esc(row.email || "-")}</td>
            <td>${esc(row.phone || "-")}</td>
            <td>${esc([row.address, row.city].filter(Boolean).join(", ") || "-")}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSuppliers() {
    if (!state.segretariaSuppliers.length) {
      dom.suppliersTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun fornitore disponibile.</td></tr>';
      return;
    }
    dom.suppliersTableBody.innerHTML = state.segretariaSuppliers
      .map((row) => {
        return `
          <tr>
            <td>${esc(row.name || "-")}</td>
            <td>${esc(row.company || "-")}</td>
            <td>${esc(row.email || "-")}</td>
            <td>${esc(row.phone || "-")}</td>
            <td>${esc(row.status || "-")}</td>
          </tr>
        `;
      })
      .join("");
  }

  function quoteOpenUrl(quote) {
    const base = String(state.connection?.segretaria_base_url || "").trim().replace(/\/+$/, "");
    const quoteId = String(quote?.id || "").trim();
    if (!base || !quoteId) return null;
    return `${base}/dashboard/quotes/${quoteId}`;
  }

  function renderSegretariaQuotes() {
    if (!canAccessQuotes()) {
      dom.segretariaQuotesTableBody.innerHTML =
        '<tr><td colspan="5" class="muted">Accesso preventivi riservato a admin, amministrazione o commerciale.</td></tr>';
      return;
    }
    if (!state.segretariaQuotes.length) {
      dom.segretariaQuotesTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun preventivo trovato.</td></tr>';
      return;
    }
    dom.segretariaQuotesTableBody.innerHTML = state.segretariaQuotes
      .map((row) => {
        const openUrl = quoteOpenUrl(row);
        return `
          <tr>
            <td>${esc(row.number || row.id)}</td>
            <td>${esc(row.status || "-")}</td>
            <td>${esc(row.source || "-")}</td>
            <td>${esc(formatCents(row.total_cents))}</td>
            <td>
              ${
                openUrl
                  ? `<a class="btn btn-sm" target="_blank" rel="noreferrer" href="${esc(openUrl)}">Apri</a>`
                  : `<span class="muted">-</span>`
              }
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderItems() {
    if (!state.items.length) {
      dom.itemsTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun articolo.</td></tr>';
      return;
    }
    dom.itemsTableBody.innerHTML = state.items
      .map((item) => {
        return `
          <tr>
            <td>${esc(item.name)}</td>
            <td>${esc(item.sku || "-")}</td>
            <td>${esc(item.item_type || "-")}</td>
            <td>${esc(item.unit_label || "-")}</td>
            <td><span class="pill ${item.is_active ? "pill-ok" : "pill-off"}">${item.is_active ? "Attivo" : "Disattivo"}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStockSelectors() {
    if (dom.movementWarehouseSelect) {
      dom.movementWarehouseSelect.innerHTML = state.warehouses.length
        ? state.warehouses
            .map((w) => `<option value="${esc(w.id)}">${esc(w.name)}${w.is_default ? " (default)" : ""}</option>`)
            .join("")
        : '<option value="">Nessun magazzino</option>';
    }
    if (dom.movementItemSelect) {
      dom.movementItemSelect.innerHTML = state.items.length
        ? state.items.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join("")
        : '<option value="">Nessun articolo</option>';
    }
    if (dom.sheetRowItemSelect) {
      dom.sheetRowItemSelect.innerHTML = state.items.length
        ? state.items.map((it) => `<option value="${esc(it.id)}">${esc(it.name)}${it.sku ? ` (${esc(it.sku)})` : ""}</option>`).join("")
        : '<option value="">Nessun articolo</option>';
    }
  }

  function renderLevels() {
    if (!state.levels.length) {
      dom.levelsTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun livello stock.</td></tr>';
      return;
    }
    dom.levelsTableBody.innerHTML = state.levels
      .map((lvl) => {
        return `
          <tr>
            <td>${esc(lvl.warehouse_name || "-")}</td>
            <td>${esc(lvl.item_name || "-")}</td>
            <td><b>${esc(lvl.available)}</b></td>
            <td>${esc(lvl.on_hand)}</td>
            <td>${esc(lvl.reserved)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderMovements() {
    if (!state.movements.length) {
      dom.movementsTableBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun movimento.</td></tr>';
      return;
    }
    dom.movementsTableBody.innerHTML = state.movements
      .map((mv) => {
        return `
          <tr>
            <td>${esc(formatDateTime(mv.created_at))}</td>
            <td>${esc(mv.movement_type)}</td>
            <td>${esc(mv.warehouse_name || "-")}</td>
            <td>${esc(mv.item_name || "-")}</td>
            <td>${esc(mv.quantity)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSheetsList() {
    if (!dom.sheetsList) return;
    if (!canUseInventorySheets()) {
      dom.sheetsList.innerHTML = '<p class="muted">Feature disabilitata (INVENTORY_SHEETS_V1=false).</p>';
      return;
    }
    if (!state.sheets.length) {
      dom.sheetsList.innerHTML = '<p class="muted">Nessuna scheda trovata.</p>';
      return;
    }
    dom.sheetsList.innerHTML = state.sheets
      .map((sheet) => {
        const isLocked = String(sheet.status || "").toUpperCase() === "LOCKED";
        return `
          <article class="mini-card">
            <div>
              <p class="mini-title">${esc(sheet.title || "Scheda")}</p>
              <p class="mini-sub">${esc(fmtSheetLink(sheet.task_id, sheet.project_id))}</p>
              <p class="muted">Stato: <span class="pill ${isLocked ? "pill-off" : "pill-ok"}">${esc(sheet.status || "-")}</span> · Righe: ${esc(sheet.rows_count || 0)}</p>
              <p class="muted">Aggiornata: ${esc(formatDateTime(sheet.updated_at))}</p>
            </div>
            <div class="actions">
              <button class="btn btn-sm" data-action="open-sheet" data-id="${esc(sheet.id)}">Apri</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderSheetDetail() {
    if (!dom.sheetDetailCard || !dom.sheetDetailMeta) return;
    const detail = state.currentSheetDetail || null;
    const sheet = detail?.sheet || null;
    if (!sheet) {
      dom.sheetDetailCard.classList.add("hidden");
      return;
    }

    const isLocked = String(sheet.status || "").toUpperCase() === "LOCKED";
    dom.sheetDetailCard.classList.remove("hidden");
    dom.sheetDetailMeta.innerHTML = `
      <p><b>ID:</b> ${esc(sheet.id)}</p>
      <p><b>Titolo:</b> ${esc(sheet.title || "-")}</p>
      <p><b>Stato:</b> <span class="pill ${isLocked ? "pill-off" : "pill-ok"}">${esc(sheet.status || "-")}</span></p>
      <p><b>Collegamento:</b> ${esc(fmtSheetLink(sheet.task_id, sheet.project_id))}</p>
      <p><b>Note:</b> ${esc(sheet.notes || "-")}</p>
      <p><b>Creata:</b> ${esc(formatDateTime(sheet.created_at))} · <b>Aggiornata:</b> ${esc(formatDateTime(sheet.updated_at))}</p>
    `;
    if (dom.sheetLockBtn) dom.sheetLockBtn.disabled = isLocked;
    if (dom.sheetRowForm) {
      const controls = dom.sheetRowForm.querySelectorAll("input,select,button");
      controls.forEach((el) => {
        el.disabled = isLocked;
      });
    }

    const rows = Array.isArray(detail?.rows) ? detail.rows : [];
    if (!rows.length) {
      dom.sheetRowsBody.innerHTML = '<tr><td colspan="5" class="muted">Nessuna riga.</td></tr>';
    } else {
      dom.sheetRowsBody.innerHTML = rows
        .map((row) => {
          return `
            <tr>
              <td>${esc(row.item_name || "-")}</td>
              <td>${esc(row.item_sku || "-")}</td>
              <td>${esc(row.qty)}</td>
              <td>${esc(row.unit || "-")}</td>
              <td>
                ${
                  isLocked
                    ? '<span class="muted">Read-only</span>'
                    : `<div class="actions">
                         <button class="btn btn-sm" data-action="sheet-row-edit" data-row-id="${esc(row.id)}">Modifica qtà</button>
                         <button class="btn btn-sm btn-danger-soft" data-action="sheet-row-delete" data-row-id="${esc(row.id)}">Elimina</button>
                       </div>`
                }
              </td>
            </tr>
          `;
        })
        .join("");
    }

    const movements = Array.isArray(detail?.movements) ? detail.movements : [];
    if (!movements.length) {
      dom.sheetMovementsBody.innerHTML = '<tr><td colspan="5" class="muted">Nessun movimento collegato.</td></tr>';
    } else {
      dom.sheetMovementsBody.innerHTML = movements
        .map(
          (mv) => `
            <tr>
              <td>${esc(formatDateTime(mv.created_at))}</td>
              <td>${esc(mv.item_name || "-")}</td>
              <td>${esc(mv.warehouse_name || "-")}</td>
              <td>${esc(mv.movement_type || "-")}</td>
              <td>${esc(mv.quantity || "-")}</td>
            </tr>
          `
        )
        .join("");
    }
  }

  function newDraftLineTemplate(id) {
    const itemOptions = state.items
      .map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
      .join("");

    return `
      <article class="line-card" data-line-id="${esc(id)}">
        <div class="row-between">
          <h4>Riga</h4>
          <button type="button" class="btn btn-sm btn-danger-soft" data-action="remove-line" data-line-id="${esc(id)}">Rimuovi</button>
        </div>
        <div class="grid grid-3">
          <label>
            <span class="label">Tipo</span>
            <select class="input" name="line_type">
              <option value="item">Articolo</option>
              <option value="custom">Custom</option>
              <option value="service">Servizio</option>
            </select>
          </label>
          <label>
            <span class="label">Articolo (opz.)</span>
            <select class="input" name="item_id">
              <option value="">Nessuno</option>
              ${itemOptions}
            </select>
          </label>
          <label>
            <span class="label">Titolo</span>
            <input class="input" name="title" />
          </label>
          <label class="full">
            <span class="label">Descrizione *</span>
            <input class="input" name="description" required />
          </label>
          <label>
            <span class="label">Quantità</span>
            <input class="input" name="quantity" type="number" step="0.001" value="1" />
          </label>
          <label>
            <span class="label">Unità</span>
            <input class="input" name="unit_label" value="pz" />
          </label>
          <label>
            <span class="label">Prezzo unitario (€)</span>
            <input class="input" name="unit_price_eur" type="number" step="0.01" value="0" />
          </label>
          <label>
            <span class="label">IVA %</span>
            <input class="input" name="vat_rate" type="number" step="0.001" value="22" />
          </label>
        </div>
      </article>
    `;
  }

  function addDraftLine() {
    draftLineCounter += 1;
    const id = "line-" + draftLineCounter;
    dom.draftLinesContainer.insertAdjacentHTML("beforeend", newDraftLineTemplate(id));
  }

  function renderDraftLinesItemOptions() {
    const options = ['<option value="">Nessuno</option>'].concat(
      state.items.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
    );
    dom.draftLinesContainer.querySelectorAll('select[name="item_id"]').forEach((selectEl) => {
      const current = String(selectEl.value || "");
      selectEl.innerHTML = options.join("");
      if (current) selectEl.value = current;
    });
  }

  function collectDraftLines() {
    const rows = [];
    dom.draftLinesContainer.querySelectorAll(".line-card").forEach((lineEl, idx) => {
      const get = (name) => lineEl.querySelector(`[name="${name}"]`);
      const description = String(get("description")?.value || "").trim();
      if (!description) return;
      rows.push({
        line_type: String(get("line_type")?.value || "item").trim(),
        item_id: String(get("item_id")?.value || "").trim() || null,
        title: String(get("title")?.value || "").trim() || null,
        description,
        quantity: Number(get("quantity")?.value || 1),
        unit_label: String(get("unit_label")?.value || "pz").trim() || "pz",
        unit_price_cents: toCents(get("unit_price_eur")?.value),
        vat_rate: Number(get("vat_rate")?.value || 22),
        sort_order: idx,
      });
    });
    return rows;
  }

  function renderDrafts() {
    if (!canAccessQuotes()) {
      dom.draftsList.innerHTML = '<p class="muted">Accesso preventivi riservato a admin, amministrazione o commerciale.</p>';
      return;
    }
    if (!state.drafts.length) {
      dom.draftsList.innerHTML = '<p class="muted">Nessuna bozza disponibile.</p>';
      return;
    }

    const canPush = Boolean(state.connection?.is_active);
    dom.draftsList.innerHTML = state.drafts
      .map((draft) => {
        return `
          <article class="mini-card">
            <div>
              <p class="mini-title">${esc(draft.draft_number || draft.id)}</p>
              <p class="mini-sub">Stato: ${esc(draft.status)} · Totale: ${esc(formatCents(draft.total_cents))}</p>
              <p class="muted">Creata: ${esc(formatDateTime(draft.created_at))}</p>
            </div>
            <div class="actions">
              <button class="btn btn-sm" data-action="draft-detail" data-id="${esc(draft.id)}">Dettagli</button>
              <button class="btn btn-sm btn-primary" data-action="draft-push" data-id="${esc(draft.id)}" ${canPush ? "" : "disabled"}>
                Push preventivo
              </button>
              ${
                draft.segretaria_finalize_url
                  ? `<a class="btn btn-sm" href="${esc(draft.segretaria_finalize_url)}" target="_blank" rel="noreferrer">Apri in Segretaria</a>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadDraftDetail(draftId) {
    const body = await api(`/api/drafts/${encodeURIComponent(draftId)}`);
    state.selectedDraft = body;
    const draft = body.draft || {};
    const lines = body.lines || [];

    dom.draftDetailCard.classList.remove("hidden");
    dom.draftDetailContent.innerHTML = `
      <div class="stack">
        <p><b>ID:</b> ${esc(draft.id)}</p>
        <p><b>Numero:</b> ${esc(draft.draft_number || "-")}</p>
        <p><b>Cliente:</b> ${esc(draft.client_ref || "-")}</p>
        <p><b>Stato:</b> ${esc(draft.status || "-")}</p>
        <p><b>Totale:</b> ${esc(formatCents(draft.total_cents))}</p>
        <p><b>Note:</b> ${esc(draft.notes || "-")}</p>
        <h4>Righe</h4>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Descrizione</th>
                <th>Qtà</th>
                <th>Unità</th>
                <th>Prezzo</th>
                <th>IVA</th>
                <th>Totale</th>
              </tr>
            </thead>
            <tbody>
              ${
                lines.length
                  ? lines
                      .map((line) => {
                        return `
                          <tr>
                            <td>${esc(line.description)}</td>
                            <td>${esc(line.quantity)}</td>
                            <td>${esc(line.unit_label || "-")}</td>
                            <td>${esc(formatCents(line.unit_price_cents))}</td>
                            <td>${esc(line.vat_rate)}%</td>
                            <td>${esc(formatCents(line.line_total_cents))}</td>
                          </tr>
                        `;
                      })
                      .join("")
                  : '<tr><td colspan="6" class="muted">Nessuna riga.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function connectNow() {
    const token = String(dom.tokenInput.value || "").trim();
    const exchangeUrl = String(dom.exchangeInput.value || "").trim();
    if (!token) {
      setText(dom.connectMessage, "Token non disponibile. Avvia il collegamento da Segretaria.", true);
      return;
    }
    dom.confirmBtn.disabled = true;
    setText(dom.connectMessage, "Connessione in corso...", false);
    try {
      const body = await api("/api/integration/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, exchange_url: exchangeUrl || undefined }),
      });
      setActiveWorkspaceId(body.workspace_id || null);
      if (body.workspace_role) setWorkspaceRole(body.workspace_role);
      state.connection = {
        workspace_id: body.workspace_id || null,
        segretaria_base_url: body.segretaria_base_url || null,
        api_key_prefix: body.api_key_prefix || null,
        is_active: true,
        connected_at: body.connected_at || new Date().toISOString(),
      };
      applyRoleGates();
      setText(dom.connectMessage, "Connessione stabilita", false);
      setStatus("ok", "Connessione stabilita", "Integrazione attiva");
      renderAccess();
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: "MAGAZZINO_CONNECTED", workspace_id: body.workspace_id || null }, "*");
        }
      } catch (_) {}
      await Promise.allSettled([loadConnection(), loadDrafts(), loadSegretariaSnapshot("")]);
    } catch (err) {
      const msg = String(err.message || err);
      setText(dom.connectMessage, "Connessione fallita: " + msg, true);
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: "MAGAZZINO_CONNECT_ERROR", message: msg }, "*");
        }
      } catch (_) {}
    } finally {
      dom.confirmBtn.disabled = false;
    }
  }

  function bindEvents() {
    dom.tabsNav?.addEventListener("click", (event) => {
      const target = event.target.closest(".tab");
      if (!target) return;
      activeTab(target.dataset.tab);
    });

    dom.pwaInstallBtn?.addEventListener("click", () => {
      promptInstallPwa().catch(() => {});
    });

    dom.globalRefreshBtn?.addEventListener("click", loadAll);
    dom.confirmBtn?.addEventListener("click", connectNow);
    dom.refreshBtn?.addEventListener("click", loadConnection);
    dom.refreshSegretariaDataBtn?.addEventListener("click", () => loadSegretariaSnapshot(""));
    dom.openItemsImportBtn?.addEventListener("click", openImportModal);
    dom.itemsImportAnalyzeBtn?.addEventListener("click", () => {
      analyzeImportFile().catch((err) => setImportMessage("Analisi fallita: " + String(err.message || err), true));
    });
    dom.itemsImportConfirm1Btn?.addEventListener("click", confirmImportStep1);
    dom.itemsImportConfirm2Btn?.addEventListener("click", () => {
      executeImportStep2().catch((err) => setImportMessage("Import fallito: " + String(err.message || err), true));
    });
    dom.itemsImportToggleMappingBtn?.addEventListener("click", () => {
      state.importWizard.showManualMapping = !state.importWizard.showManualMapping;
      if (dom.itemsImportToggleMappingBtn) {
        dom.itemsImportToggleMappingBtn.textContent = state.importWizard.showManualMapping
          ? "Nascondi mapping avanzato"
          : "Modifica mapping (avanzato)";
      }
      renderImportMappingControls();
    });
    dom.itemsImportModal?.addEventListener("click", (event) => {
      const closeTarget = event.target.closest('[data-action="close-import-modal"]');
      if (closeTarget) closeImportModal();
    });
    dom.itemsImportDropzone?.addEventListener("click", () => {
      dom.itemsImportFile?.click();
    });
    dom.itemsImportDropzone?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dom.itemsImportFile?.click();
      }
    });
    dom.itemsImportDropzone?.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dom.itemsImportDropzone.classList.add("is-dragover");
    });
    dom.itemsImportDropzone?.addEventListener("dragover", (event) => {
      event.preventDefault();
      dom.itemsImportDropzone.classList.add("is-dragover");
    });
    dom.itemsImportDropzone?.addEventListener("dragleave", (event) => {
      event.preventDefault();
      if (!dom.itemsImportDropzone.contains(event.relatedTarget)) {
        dom.itemsImportDropzone.classList.remove("is-dragover");
      }
    });
    dom.itemsImportDropzone?.addEventListener("drop", (event) => {
      event.preventDefault();
      dom.itemsImportDropzone.classList.remove("is-dragover");
      const files = event.dataTransfer?.files;
      if (!files || !files.length) return;
      setImportSelectedFile(files[0]);
      state.importWizard.confirmToken1 = null;
      if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
      setImportMessage("File caricato via trascinamento. Ora clicca Analizza file.", false);
    });
    dom.itemsImportMapping?.addEventListener("change", (event) => {
      const select = event.target.closest("select[data-import-map]");
      if (!select) return;
      const field = String(select.dataset.importMap || "").trim();
      if (!field) return;
      const idx = Number(select.value);
      if (!Number.isInteger(idx) || idx < 0) {
        delete state.importWizard.mapping[field];
      } else {
      state.importWizard.mapping[field] = idx;
      }
      state.importWizard.confirmToken1 = null;
      if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
      renderImportAutoInfo();
      rebuildImportPreview();
    });
    dom.itemsImportFile?.addEventListener("change", () => {
      const file = dom.itemsImportFile?.files?.[0] || null;
      setImportSelectedFile(file);
      state.importWizard.confirmToken1 = null;
      if (dom.itemsImportConfirm2Btn) dom.itemsImportConfirm2Btn.disabled = true;
    });

    dom.clientsSearchBtn?.addEventListener("click", () => loadSegretariaSnapshot(dom.clientsSearchInput.value));
    dom.clientsSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadSegretariaSnapshot(dom.clientsSearchInput.value);
      }
    });

    dom.suppliersSearchBtn?.addEventListener("click", () => loadSegretariaSnapshot(dom.suppliersSearchInput.value));
    dom.suppliersSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadSegretariaSnapshot(dom.suppliersSearchInput.value);
      }
    });

    dom.itemsSearchBtn?.addEventListener("click", () => loadItems(dom.itemsSearchInput.value));
    dom.itemsSearchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadItems(dom.itemsSearchInput.value);
      }
    });

    dom.refreshSheetsBtn?.addEventListener("click", () => {
      loadSheets().catch((err) => setText(dom.newSheetMessage, String(err.message || err), true));
    });

    dom.sheetsFilterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.sheetFilters.status = String(dom.sheetFilterStatus?.value || "").trim().toUpperCase();
      state.sheetFilters.taskId = String(dom.sheetFilterTaskId?.value || "").trim();
      state.sheetFilters.projectId = String(dom.sheetFilterProjectId?.value || "").trim();
      state.sheetFilters.dateFrom = String(dom.sheetFilterDateFrom?.value || "").trim();
      state.sheetFilters.dateTo = String(dom.sheetFilterDateTo?.value || "").trim();
      loadSheets().catch((err) => setText(dom.newSheetMessage, String(err.message || err), true));
    });

    dom.newSheetForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dom.newSheetForm);
      const payload = {
        title: String(fd.get("title") || "").trim(),
        notes: String(fd.get("notes") || "").trim() || null,
        task_id: String(fd.get("task_id") || "").trim() || null,
        project_id: String(fd.get("project_id") || "").trim() || null,
      };
      try {
        const body = await api("/api/inventory/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.newSheetForm.reset();
        setText(dom.newSheetMessage, "Scheda creata in DRAFT", false);
        await loadSheets();
        if (body?.sheet_id) {
          await loadSheetDetail(String(body.sheet_id));
          activeTab("sheets");
        }
      } catch (err) {
        setText(dom.newSheetMessage, String(err.message || err), true);
      }
    });

    dom.newItemForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dom.newItemForm);
      const payload = {
        name: String(fd.get("name") || "").trim(),
        sku: String(fd.get("sku") || "").trim() || null,
        description: String(fd.get("description") || "").trim() || null,
        unit_label: String(fd.get("unit_label") || "pz").trim() || "pz",
        item_type: String(fd.get("item_type") || "item").trim() || "item",
      };
      try {
        await api("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.newItemForm.reset();
        dom.newItemForm.querySelector('[name="unit_label"]').value = "pz";
        setText(dom.newItemMessage, "Articolo creato", false);
        await loadItems(dom.itemsSearchInput.value);
      } catch (err) {
        setText(dom.newItemMessage, String(err.message || err), true);
      }
    });

    dom.newWarehouseForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dom.newWarehouseForm);
      const payload = {
        name: String(fd.get("name") || "").trim(),
        is_default: fd.get("is_default") === "on",
      };
      try {
        await api("/api/stock/warehouses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.newWarehouseForm.reset();
        setText(dom.newWarehouseMessage, "Magazzino creato", false);
        await loadWarehouses();
      } catch (err) {
        setText(dom.newWarehouseMessage, String(err.message || err), true);
      }
    });

    dom.newMovementForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dom.newMovementForm);
      const payload = {
        warehouse_id: String(fd.get("warehouse_id") || "").trim(),
        item_id: String(fd.get("item_id") || "").trim(),
        movement_type: String(fd.get("movement_type") || "").trim(),
        quantity: Number(fd.get("quantity") || 0),
        reason: String(fd.get("reason") || "").trim() || null,
      };
      try {
        await api("/api/stock/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.newMovementForm.reset();
        setText(dom.newMovementMessage, "Movimento registrato", false);
        await Promise.all([loadLevels(), loadMovements()]);
      } catch (err) {
        setText(dom.newMovementMessage, String(err.message || err), true);
      }
    });

    dom.addDraftLineBtn?.addEventListener("click", addDraftLine);

    dom.draftLinesContainer?.addEventListener("click", (event) => {
      const btn = event.target.closest('button[data-action="remove-line"]');
      if (!btn) return;
      const lineId = btn.dataset.lineId;
      const lineEl = dom.draftLinesContainer.querySelector(`[data-line-id="${lineId}"]`);
      if (lineEl) lineEl.remove();
      if (!dom.draftLinesContainer.querySelector(".line-card")) addDraftLine();
    });

    dom.newDraftForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(dom.newDraftForm);
      const lines = collectDraftLines();
      if (!lines.length) {
        setText(dom.newDraftMessage, "Aggiungi almeno una riga con descrizione", true);
        return;
      }
      const payload = {
        draft_number: String(fd.get("draft_number") || "").trim() || null,
        client_ref: String(fd.get("client_ref") || "").trim() || null,
        notes: String(fd.get("notes") || "").trim() || null,
        reserve_stock: fd.get("reserve_stock") === "on",
        lines,
      };
      try {
        await api("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.newDraftForm.reset();
        dom.draftLinesContainer.innerHTML = "";
        addDraftLine();
        setText(dom.newDraftMessage, "Bozza salvata", false);
        await loadDrafts();
      } catch (err) {
        setText(dom.newDraftMessage, String(err.message || err), true);
      }
    });

    dom.quoteClientQuickSuggestions?.addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="pick-quote-client"]');
      if (!button || !dom.quoteClientRefInput) return;
      dom.quoteClientRefInput.value = String(button.dataset.value || "");
      dom.quoteClientRefInput.focus();
    });

    dom.sheetsList?.addEventListener("click", async (event) => {
      const button = event.target.closest('button[data-action="open-sheet"]');
      if (!button) return;
      const sheetId = String(button.dataset.id || "").trim();
      if (!sheetId) return;
      try {
        await loadSheetDetail(sheetId);
      } catch (err) {
        setText(dom.sheetDetailMessage, `Dettaglio non disponibile: ${String(err.message || err)}`, true);
      }
    });

    dom.sheetRefreshBtn?.addEventListener("click", async () => {
      if (!state.currentSheetId) return;
      try {
        await loadSheetDetail(state.currentSheetId);
        setText(dom.sheetDetailMessage, "Dettaglio aggiornato", false);
      } catch (err) {
        setText(dom.sheetDetailMessage, String(err.message || err), true);
      }
    });

    dom.sheetRowForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.currentSheetId) {
        setText(dom.sheetDetailMessage, "Apri prima una scheda.", true);
        return;
      }
      const fd = new FormData(dom.sheetRowForm);
      const payload = {
        item_id: String(fd.get("item_id") || "").trim(),
        qty: Number(fd.get("qty") || 0),
        unit: String(fd.get("unit") || "").trim() || null,
      };
      try {
        await api(`/api/inventory/sheets/${encodeURIComponent(state.currentSheetId)}/rows`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        dom.sheetRowForm.reset();
        setText(dom.sheetDetailMessage, "Riga aggiunta", false);
        await loadSheetDetail(state.currentSheetId);
        await loadSheets();
      } catch (err) {
        setText(dom.sheetDetailMessage, String(err.message || err), true);
      }
    });

    dom.sheetRowsBody?.addEventListener("click", async (event) => {
      if (!state.currentSheetId) return;
      const editBtn = event.target.closest('button[data-action="sheet-row-edit"]');
      const delBtn = event.target.closest('button[data-action="sheet-row-delete"]');
      if (!editBtn && !delBtn) return;
      const rowId = String((editBtn || delBtn)?.dataset.rowId || "").trim();
      if (!rowId) return;

      if (editBtn) {
        const qtyRaw = window.prompt("Nuova quantità:", "1");
        if (qtyRaw == null) return;
        const qty = Number(String(qtyRaw).replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          setText(dom.sheetDetailMessage, "Quantità non valida", true);
          return;
        }
        try {
          await api(`/api/inventory/sheets/${encodeURIComponent(state.currentSheetId)}/rows/${encodeURIComponent(rowId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qty }),
          });
          setText(dom.sheetDetailMessage, "Riga aggiornata", false);
          await loadSheetDetail(state.currentSheetId);
          await loadSheets();
        } catch (err) {
          setText(dom.sheetDetailMessage, String(err.message || err), true);
        }
        return;
      }

      if (delBtn) {
        if (!window.confirm("Eliminare questa riga?")) return;
        try {
          await api(`/api/inventory/sheets/${encodeURIComponent(state.currentSheetId)}/rows/${encodeURIComponent(rowId)}`, {
            method: "DELETE",
          });
          setText(dom.sheetDetailMessage, "Riga eliminata", false);
          await loadSheetDetail(state.currentSheetId);
          await loadSheets();
        } catch (err) {
          setText(dom.sheetDetailMessage, String(err.message || err), true);
        }
      }
    });

    dom.sheetLockBtn?.addEventListener("click", async () => {
      if (!state.currentSheetId) return;
      if (!window.confirm("Confermare LOCK della scheda? Verranno creati movimenti OUT.")) return;
      dom.sheetLockBtn.disabled = true;
      try {
        const body = await api(`/api/inventory/sheets/${encodeURIComponent(state.currentSheetId)}/lock`, {
          method: "POST",
        });
        const summary = body.summary || {};
        setText(
          dom.sheetDetailMessage,
          `Scheda LOCKED. Movimenti creati: ${Number(summary.movements_created || 0)} · Qty totale: ${Number(summary.total_qty || 0)}`,
          false
        );
        await Promise.all([loadSheetDetail(state.currentSheetId), loadSheets(), loadLevels(), loadMovements()]);
      } catch (err) {
        setText(dom.sheetDetailMessage, String(err.message || err), true);
      } finally {
        dom.sheetLockBtn.disabled = false;
      }
    });

    dom.draftsList?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      const draftId = String(button.dataset.id || "").trim();
      if (!draftId) return;

      if (action === "draft-detail") {
        try {
          await loadDraftDetail(draftId);
        } catch (err) {
          alert("Dettaglio non disponibile: " + String(err.message || err));
        }
        return;
      }

      if (action === "draft-push") {
        if (!confirm("Inviare questa bozza a Segretaria come preventivo?")) return;
        button.disabled = true;
        try {
          const body = await api(`/api/drafts/${encodeURIComponent(draftId)}/push-to-segretaria`, { method: "POST" });
          await Promise.all([loadDrafts(), loadConnection(), loadSegretariaSnapshot("")]);
          alert("Push completato. Quote: " + (body.segretaria_quote_id || "-"));
        } catch (err) {
          alert("Push fallito: " + String(err.message || err));
        } finally {
          button.disabled = false;
        }
      }
    });

    dom.overviewDrafts?.addEventListener("click", async (event) => {
      const button = event.target.closest('button[data-action="open-draft"]');
      if (!button) return;
      const draftId = String(button.dataset.id || "").trim();
      if (!draftId) return;
      activeTab("quotes");
      try {
        await loadDraftDetail(draftId);
      } catch (err) {
        alert("Dettaglio non disponibile: " + String(err.message || err));
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dom.itemsImportModal && !dom.itemsImportModal.classList.contains("hidden")) {
        closeImportModal();
      }
    });
  }

  function initConnectionFromQuery() {
    const queryTab = String(qs.get("tab") || "").trim();
    const queryToken = String(qs.get("token") || "").trim();
    const queryExchange = String(qs.get("exchange_url") || "").trim();
    const queryWorkspaceId = String(qs.get("workspace_id") || qs.get("workspaceId") || "").trim();
    const queryRole = String(qs.get("workspace_role") || qs.get("role") || "").trim();
    const queryTaskId = String(qs.get("taskId") || qs.get("task_id") || "").trim();
    const queryProjectId = String(qs.get("projectId") || qs.get("project_id") || "").trim();
    if (queryToken) dom.tokenInput.value = queryToken;
    if (queryExchange) dom.exchangeInput.value = queryExchange;
    if (queryWorkspaceId) setActiveWorkspaceId(queryWorkspaceId);
    if (queryRole) setWorkspaceRole(queryRole);
    if (queryTaskId) {
      state.sheetFilters.taskId = queryTaskId;
      if (dom.sheetFilterTaskId) dom.sheetFilterTaskId.value = queryTaskId;
      if (dom.newSheetForm) {
        const el = dom.newSheetForm.querySelector('[name="task_id"]');
        if (el) el.value = queryTaskId;
      }
    }
    if (queryProjectId) {
      state.sheetFilters.projectId = queryProjectId;
      if (dom.sheetFilterProjectId) dom.sheetFilterProjectId.value = queryProjectId;
      if (dom.newSheetForm) {
        const el = dom.newSheetForm.querySelector('[name="project_id"]');
        if (el) el.value = queryProjectId;
      }
    }
    renderManualParamsMask();
    if (queryTab) activeTab(queryTab);
    if (queryToken) activeTab("settings");
    if (queryTaskId || queryProjectId) activeTab("sheets");
  }

  async function init() {
    loadActiveWorkspaceIdFromStorage();
    loadWorkspaceRoleFromStorage();
    await registerPwa();
    bindEvents();
    initConnectionFromQuery();
    applyRoleGates();
    addDraftLine();
    renderQuoteClientSuggestions();
    renderManualParamsMask();
    await loadAll();
  }

  init().catch((err) => {
    alert("Errore inizializzazione: " + String(err.message || err));
  });
})();
