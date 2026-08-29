(() => {
  const cfg = window.BRANCH_FLOW_BACKEND || {};
  let saveTimer = null;
  let lastRemoteUpdatedAt = null;
  let applyingRemote = false;

  function ready() {
    return cfg.supabaseUrl &&
      cfg.anonKey &&
      !cfg.supabaseUrl.includes("PASTE_") &&
      !cfg.anonKey.includes("PASTE_");
  }

  function headers() {
    return {
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + cfg.anonKey,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
  }

  async function request(path, options = {}) {
    if (!ready()) throw new Error("Backend config is incomplete");
    const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, "") + path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Backend ${res.status}: ${txt}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function snapshot() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      products: Array.isArray(products) ? products : [],
      reservations: Array.isArray(reservations) ? reservations : [],
      transfers: Array.isArray(transfers) ? transfers : [],
      operations: Array.isArray(operations) ? operations : [],
      employee:
        document.getElementById("employee")?.value ||
        document.getElementById("role")?.value ||
        ""
    };
  }

  function persistLocal() {
    try {
      localStorage.setItem("branchFlowProducts", JSON.stringify(products || []));
      localStorage.setItem("hudaProReservations", JSON.stringify(reservations || []));
      localStorage.setItem("hudaProTransfers", JSON.stringify(transfers || []));
      localStorage.setItem("branchFlowOperations", JSON.stringify(operations || []));
    } catch (_) {}
  }

  function applyState(state) {
    if (!state || typeof state !== "object") return;
    applyingRemote = true;
    try {
      if (Array.isArray(state.products)) products = state.products;
      if (Array.isArray(state.reservations)) reservations = state.reservations;
      if (Array.isArray(state.transfers)) transfers = state.transfers;
      if (Array.isArray(state.operations)) operations = state.operations;

      const employeeEl = document.getElementById("employee") || document.getElementById("role");
      if (employeeEl && state.employee) employeeEl.value = state.employee;

      persistLocal();

      if (typeof refresh === "function") refresh();
      if (typeof renderProductManager === "function") renderProductManager();
      if (typeof dashboard === "function") dashboard();
    } finally {
      applyingRemote = false;
    }
  }

  async function load() {
    const id = encodeURIComponent(cfg.stateId || "branch-flow");
    const rows = await request(
      `/rest/v1/branch_flow_state?id=eq.${id}&select=id,data,updated_at`,
      { method: "GET" }
    );
    if (Array.isArray(rows) && rows[0]) {
      lastRemoteUpdatedAt = rows[0].updated_at || null;
      if (rows[0].data && Object.keys(rows[0].data).length) {
        applyState(rows[0].data);
        return rows[0].data;
      }
    }
    return null;
  }

  async function saveNow() {
    if (applyingRemote) return;
    const id = cfg.stateId || "branch-flow";
    const payload = { id, data: snapshot(), updated_at: new Date().toISOString() };
    const rows = await request(
      `/rest/v1/branch_flow_state?on_conflict=id`,
      {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload)
      }
    );
    if (Array.isArray(rows) && rows[0]) lastRemoteUpdatedAt = rows[0].updated_at || null;
  }

  function queueSave(delay = 450) {
    if (!ready() || applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow().catch(err => console.warn("[Branch Flow backend]", err));
    }, delay);
  }

  async function checkRemote() {
    if (!ready() || applyingRemote) return;
    const id = encodeURIComponent(cfg.stateId || "branch-flow");
    const rows = await request(
      `/rest/v1/branch_flow_state?id=eq.${id}&select=data,updated_at`,
      { method: "GET" }
    );
    if (!Array.isArray(rows) || !rows[0]) return;
    const remoteUpdatedAt = rows[0].updated_at || null;
    if (remoteUpdatedAt && remoteUpdatedAt !== lastRemoteUpdatedAt) {
      lastRemoteUpdatedAt = remoteUpdatedAt;
      if (rows[0].data && Object.keys(rows[0].data).length) applyState(rows[0].data);
    }
  }

  function wrap(name) {
    const fn = window[name];
    if (typeof fn !== "function" || fn.__bfWrapped) return;
    const wrapped = function(...args) {
      const out = fn.apply(this, args);
      queueSave();
      return out;
    };
    wrapped.__bfWrapped = true;
    window[name] = wrapped;
  }

  function wrapKnownMutations() {
    [
      "saveProducts",
      "saveProductEditor",
      "deleteProduct",
      "adjustStock",
      "adjustStockDirect",
      "quickStock",
      "confirmReservation",
      "completeReservation",
      "cancelReservation",
      "createTransfer",
      "completeTransfer",
      "finishTransfer",
      "deleteReservation",
      "resetDemoData"
    ].forEach(wrap);
  }

  async function start() {
    if (!ready()) {
      console.info("[Branch Flow backend] Add Supabase URL and anon key to backend-config.js");
      return;
    }

    wrapKnownMutations();

    try {
      const remote = await load();
      if (!remote) await saveNow();
      console.info("[Branch Flow backend] Connected");
    } catch (err) {
      console.error("[Branch Flow backend] Initial sync failed", err);
    }

    const interval = Math.max(5000, Number(cfg.syncIntervalMs || 10000));
    setInterval(() => checkRemote().catch(err => console.warn("[Branch Flow backend]", err)), interval);

    window.addEventListener("beforeunload", () => queueSave(0));
  }

  window.BranchFlowBackend = {
    ready,
    snapshot,
    load,
    saveNow,
    queueSave,
    checkRemote,
    start
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0));
  } else {
    setTimeout(start, 0);
  }
})();
