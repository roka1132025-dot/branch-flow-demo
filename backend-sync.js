(() => {
  const cfg = window.BRANCH_FLOW_BACKEND || {};
  let applying = false, timer = null, lastUpdated = null;

  const ok = () => cfg.supabaseUrl && cfg.anonKey;
  const headers = (extra={}) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "Content-Type": "application/json",
    ...extra
  });
  const base = () => cfg.supabaseUrl.replace(/\/+$/,"");
  const stateId = () => cfg.stateId || "branch-flow";

  async function req(path, options={}) {
    const r = await fetch(base()+path, {...options, headers: headers(options.headers||{})});
    if (!r.ok) throw new Error(await r.text());
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  function snapshot() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      products: Array.isArray(window.products) ? window.products : [],
      reservations: Array.isArray(window.reservations) ? window.reservations : [],
      transfers: Array.isArray(window.transfers) ? window.transfers : [],
      operations: Array.isArray(window.operations) ? window.operations : [],
      employee: document.getElementById("employee")?.value || ""
    };
  }

  function persistLocal() {
    try {
      localStorage.setItem("branchFlowProducts", JSON.stringify(window.products || []));
      localStorage.setItem("hudaProReservations", JSON.stringify(window.reservations || []));
      localStorage.setItem("hudaProTransfers", JSON.stringify(window.transfers || []));
      localStorage.setItem("branchFlowOperations", JSON.stringify(window.operations || []));
    } catch {}
  }

  function applyState(s) {
    if (!s || typeof s !== "object") return;
    applying = true;
    try {
      if (Array.isArray(s.products)) window.products = s.products;
      if (Array.isArray(s.reservations)) window.reservations = s.reservations;
      if (Array.isArray(s.transfers)) window.transfers = s.transfers;
      if (Array.isArray(s.operations)) window.operations = s.operations;
      const emp = document.getElementById("employee");
      if (emp && s.employee) emp.value = s.employee;
      persistLocal();
      if (typeof window.refresh === "function") window.refresh();
    } finally { applying = false; }
  }

  async function loadRemote() {
    const rows = await req(`/rest/v1/branch_flow_state?id=eq.${encodeURIComponent(stateId())}&select=data,updated_at`, {method:"GET"});
    if (rows?.[0]) {
      lastUpdated = rows[0].updated_at || null;
      if (rows[0].data && Object.keys(rows[0].data).length) {
        applyState(rows[0].data);
        return true;
      }
    }
    return false;
  }

  async function saveNow() {
    if (!ok() || applying) return;
    const payload = {id: stateId(), data: snapshot(), updated_at: new Date().toISOString()};
    const rows = await req(`/rest/v1/branch_flow_state?on_conflict=id`, {
      method:"POST",
      headers: {"Prefer":"resolution=merge-duplicates,return=representation"},
      body: JSON.stringify(payload)
    });
    if (rows?.[0]) lastUpdated = rows[0].updated_at || null;
  }

  function queueSave() {
    if (!ok() || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveNow().catch(console.warn), 500);
  }

  function wrap(name) {
    const fn = window[name];
    if (typeof fn !== "function" || fn.__bfSyncWrapped) return;
    const w = function(...args) {
      const result = fn.apply(this,args);
      queueSave();
      return result;
    };
    w.__bfSyncWrapped = true;
    window[name] = w;
  }

  async function poll() {
    if (!ok() || applying) return;
    const rows = await req(`/rest/v1/branch_flow_state?id=eq.${encodeURIComponent(stateId())}&select=data,updated_at`, {method:"GET"});
    if (rows?.[0]?.updated_at && rows[0].updated_at !== lastUpdated) {
      lastUpdated = rows[0].updated_at;
      applyState(rows[0].data || {});
    }
  }

  async function start() {
    if (!ok()) return console.warn("Branch Flow backend config missing");
    [
      "saveAll","saveProducts","saveProductEditor","deleteProduct",
      "adjustStock","adjustStockDirect","quickStock",
      "confirmReservation","completeReservation","cancelReservation",
      "createTransfer","saveTransfer","completeTransfer","finishTransfer",
      "resetDemoData"
    ].forEach(wrap);

    try {
      const hadRemote = await loadRemote();
      if (!hadRemote) await saveNow();
      console.info("Branch Flow backend connected");
    } catch (e) {
      console.error("Branch Flow backend initial sync failed", e);
    }

    setInterval(() => poll().catch(console.warn), Math.max(5000, Number(cfg.syncIntervalMs||10000)));
  }

  window.BranchFlowBackend = {start, saveNow, loadRemote, queueSave};
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start,0));
  } else setTimeout(start,0);
})();
