(() => {
  const cfg = window.BRANCH_FLOW_BACKEND || {};
  let applying = false, timer = null, lastUpdated = null;Object.defineProperty(window,"products",{get:()=>products,set:v=>products=v});
Object.defineProperty(window,"reservations",{get:()=>reservations,set:v=>reservations=v});
Object.defineProperty(window,"transfers",{get:()=>transfers,set:v=>transfers=v});
Object.defineProperty(window,"operations",{get:()=>operations,set:v=>operations=v});

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
    document.addEventListener("DOMContentLoaded", () => setTimeout(start,0));/* Branch Flow Auth */
(() => {
  const cfg = window.BRANCH_FLOW_BACKEND || {};
  const AUTH_KEY = "branchFlowAuthSession";

  const authHeaders = (token) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token || cfg.anonKey}`,
    "Content-Type": "application/json"
  });

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(AUTH_KEY);
  }

  async function authRequest(path, options = {}) {
    const r = await fetch(cfg.supabaseUrl + path, {
      ...options,
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || data.message || data.error_description || "فشل تسجيل الدخول");
    return data;
  }

  async function signIn(email, password) {
    return authRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  }

  async function signUp(email, password, displayName) {
    return authRequest("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        data: { display_name: displayName || email.split("@")[0] }
      })
    });
  }

  async function loadProfile(session) {
    if (!session?.access_token || !session?.user?.id) return null;

    const r = await fetch(
      `${cfg.supabaseUrl}/rest/v1/employee_profiles?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id,display_name,role,branch_id,is_active`,
      { headers: authHeaders(session.access_token) }
    );

    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] || null;
  }

  function setEmployee(profile) {
    const employee = document.getElementById("employee");
    if (!employee || !profile?.display_name) return;

    let option = [...employee.options].find(o => o.value === profile.display_name);
    if (!option) {
      option = document.createElement("option");
      option.value = profile.display_name;
      option.textContent = `👤 ${profile.display_name}`;
      employee.appendChild(option);
    }

    employee.value = profile.display_name;
    employee.disabled = true;
  }

  function removeAuthScreen() {
    document.getElementById("branchFlowAuthScreen")?.remove();
  }

  function showAuthScreen(message = "") {
    removeAuthScreen();

    const box = document.createElement("div");
    box.id = "branchFlowAuthScreen";
    box.innerHTML = `
      <div style="
        position:fixed;inset:0;z-index:99999;background:#f7f4f1;
        display:flex;align-items:center;justify-content:center;padding:20px;
        direction:rtl;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,Arial
      ">
        <div style="
          width:min(420px,100%);background:white;border:1px solid #e9e4df;
          border-radius:24px;padding:22px;box-shadow:0 20px 60px #0002
        ">
          <h2 style="margin:0 0 6px">BRANCH FLOW</h2>
          <p style="font-size:13px;color:#777;margin:0 0 18px">
            تسجيل دخول الموظفات
          </p>

          <input id="bfAuthName" placeholder="الاسم" style="width:100%;padding:12px;margin-bottom:8px;border:1px solid #ddd;border-radius:12px">
          <input id="bfAuthEmail" type="email" placeholder="البريد الإلكتروني" style="width:100%;padding:12px;margin-bottom:8px;border:1px solid #ddd;border-radius:12px">
          <input id="bfAuthPassword" type="password" placeholder="كلمة المرور" style="width:100%;padding:12px;margin-bottom:10px;border:1px solid #ddd;border-radius:12px">

          <div id="bfAuthMessage" style="font-size:12px;color:#b42318;min-height:20px;margin-bottom:8px">${message}</div>

          <button id="bfLoginBtn" style="width:100%;padding:12px;border:0;border-radius:12px;background:#111;color:white;font-weight:800;margin-bottom:8px">
            تسجيل الدخول
          </button>

          <button id="bfSignupBtn" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:12px;background:white;font-weight:800">
            إنشاء حساب
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(box);

    const msg = box.querySelector("#bfAuthMessage");

    box.querySelector("#bfLoginBtn").onclick = async () => {
      try {
        msg.textContent = "جاري تسجيل الدخول...";
        const email = box.querySelector("#bfAuthEmail").value.trim();
        const password = box.querySelector("#bfAuthPassword").value;

        const session = await signIn(email, password);
        saveSession(session);
        await activateSession(session);
      } catch (e) {
        msg.textContent = e.message;
      }
    };

    box.querySelector("#bfSignupBtn").onclick = async () => {
      try {
        msg.textContent = "جاري إنشاء الحساب...";
        const name = box.querySelector("#bfAuthName").value.trim();
        const email = box.querySelector("#bfAuthEmail").value.trim();
        const password = box.querySelector("#bfAuthPassword").value;

        const result = await signUp(email, password, name);

        if (result.access_token) {
          saveSession(result);
          await activateSession(result);
        } else {
          msg.style.color = "#147a4d";
          msg.textContent = "تم إنشاء الحساب. إذا طلب Supabase تأكيد البريد، افتح رسالة التأكيد ثم سجّل الدخول.";
        }
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  async function activateSession(session) {
    const profile = await loadProfile(session);

    if (!profile) {
      showAuthScreen("تعذر تحميل ملف الموظفة.");
      return;
    }

    if (!profile.is_active) {
      showAuthScreen("الحساب بانتظار تفعيل المدير.");
      return;
    }

    setEmployee(profile);
    removeAuthScreen();

    window.BranchFlowAuth = {
      session,
      profile,
      token: session.access_token,
      headers: () => authHeaders(session.access_token),
      signOut() {
        clearSession();
        location.reload();
      }
    };

    console.info("Branch Flow authenticated:", profile.display_name, profile.role);
  }

  async function startAuth() {
    const session = getSession();

    if (!session?.access_token) {
      showAuthScreen();
      return;
    }

    try {
      await activateSession(session);
    } catch {
      clearSession();
      showAuthScreen("انتهت الجلسة. سجّل الدخول من جديد.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAuth);
  } else {
    startAuth();
  }
})();
  } else setTimeout(start,0);
})();
