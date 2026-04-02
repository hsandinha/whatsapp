// ═══════════════════════════════════════════════════════════════
// WhatsApp Sender Pro v5.0 — Frontend (Supabase Auth)
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://piigfztyhymxrcrpavwq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTkzNzQsImV4cCI6MjA4ODU3NTM3NH0.-nxRKReeM8blNKqw5kIEIHqolxRdOx800zwsmREOq4Y";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let customers = [];
let headers = [];
let uploadedImages = [];
let uploadedVideos = [];
let uploadedDocs = [];
let eventSource = null;
let authToken = null;
let currentUser = null;
let jobStats = { sent: 0, failed: 0, total: 0 };
let lastHistoryId = null;
let isApplyingDraft = false;
let activeJobReconnectInFlight = false;
const SEND_DRAFT_VERSION = 1;
const SESSION_STATUS_POLL_INTERVAL_MS = 3000;
let sessionStatusPollTimer = null;
let sessionStatusPollInFlight = false;
let lastSessionStatus = "disconnected";

function getDraftStorageKey() {
  return currentUser?.id ? `whatsapp_sender_draft:${currentUser.id}` : null;
}

function readSendDraft() {
  const key = getDraftStorageKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;
    return draft;
  } catch {
    return null;
  }
}

function updateScheduleVisibility() {
  const checked = !!document.getElementById("scheduleCheck")?.checked;
  document.getElementById("scheduleSection").style.display = checked ? "grid" : "none";
}

function updateMediaOptionsVisibility() {
  const checked = !!document.getElementById("sendImageCheck")?.checked;
  document.getElementById("sendOrderSection").style.display = checked ? "block" : "none";
}

function applySendOrderSelection(order, clickedEl) {
  document.querySelectorAll(".send-order-option").forEach((option) => {
    const radio = option.querySelector('input[name="sendOrder"]');
    const active = clickedEl ? option === clickedEl : radio?.value === order;
    option.classList.toggle("active", active);
    if (radio) radio.checked = active;
  });
}

function getActiveMediaTab() {
  const activePanel = document.querySelector(".media-panel.active");
  return activePanel?.id?.replace("media-", "") || "images";
}

function activateMediaTab(tab) {
  document.querySelectorAll(".media-tab").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".media-panel").forEach((panel) => panel.classList.remove("active"));
  const panel = document.getElementById(`media-${tab}`);
  if (panel) panel.classList.add("active");
  const button = Array.from(document.querySelectorAll(".media-tab")).find((el) =>
    el.getAttribute("onclick")?.includes(`'${tab}'`)
  );
  if (button) button.classList.add("active");
}

function collectSendDraft() {
  return {
    version: SEND_DRAFT_VERSION,
    messageTemplate: document.getElementById("messageTemplate")?.value || "",
    intervalMin: document.getElementById("intervalMin")?.value || "5",
    intervalMax: document.getElementById("intervalMax")?.value || "15",
    dailyLimit: document.getElementById("dailyLimit")?.value || "200",
    scheduleCheck: !!document.getElementById("scheduleCheck")?.checked,
    scheduleStart: document.getElementById("scheduleStart")?.value || "08:00",
    scheduleEnd: document.getElementById("scheduleEnd")?.value || "18:00",
    sendImageCheck: !!document.getElementById("sendImageCheck")?.checked,
    sendOrder: getSendOrder(),
    enableButtons: !!document.getElementById("enableButtons")?.checked,
    buttonType: document.getElementById("buttonType")?.value || "buttons",
    btnFooter: document.getElementById("btnFooter")?.value || "",
    listButtonText: document.getElementById("listButtonText")?.value || "Ver opções",
    listSectionTitle: document.getElementById("listSectionTitle")?.value || "Opções",
    buttonItems: getButtonItems(),
    buttonDescriptions: getButtonDescriptions(),
    uploadedImages,
    uploadedVideos,
    uploadedDocs,
    activeMediaTab: getActiveMediaTab(),
  };
}

function saveSendDraft() {
  if (isApplyingDraft) return;
  const key = getDraftStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(collectSendDraft()));
  } catch (err) {
    console.warn("Erro ao salvar rascunho local:", err.message);
  }
}

function renderDraftButtonItems(items = [], descriptions = []) {
  const container = document.getElementById("buttonItems");
  if (!container) return;
  container.innerHTML = "";

  if (!items.length) {
    addButtonItem();
    addButtonItem();
    return;
  }

  items.forEach((item, index) => {
    addButtonItem(item, descriptions[index] || "");
  });
}

function applyInteractiveBuilderState(config = {}) {
  const builder = document.getElementById("buttonsBuilder");
  const items = Array.isArray(config.items) ? config.items : [];
  const descriptions = Array.isArray(config.descriptions) ? config.descriptions : [];
  const enabled = !!config.enabled && items.length > 0;

  document.getElementById("enableButtons").checked = enabled;
  document.getElementById("buttonType").value = config.type || "buttons";
  document.getElementById("btnFooter").value = config.footer || "";
  document.getElementById("listButtonText").value = config.buttonText || "Ver opções";
  document.getElementById("listSectionTitle").value = config.sectionTitle || "Opções";

  if (enabled) {
    builder.style.display = "block";
    renderDraftButtonItems(items, descriptions);
    updateButtonsUI();
    return;
  }

  builder.style.display = "none";
  document.getElementById("buttonItems").innerHTML = "";
}

function normalizeIntervalForInput(value, fallback = "") {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return String(num >= 1000 ? Math.round(num / 1000) : Math.round(num));
}

function getPreferredMediaTab() {
  if (uploadedImages.length > 0) return "images";
  if (uploadedVideos.length > 0) return "videos";
  if (uploadedDocs.length > 0) return "documents";
  return "images";
}

function hasUploadedMedia() {
  return uploadedImages.length > 0 || uploadedVideos.length > 0 || uploadedDocs.length > 0;
}

function restoreSendDraft() {
  const draft = readSendDraft();
  if (!draft) return;

  isApplyingDraft = true;
  try {
    if (typeof draft.messageTemplate === "string") {
      document.getElementById("messageTemplate").value = draft.messageTemplate;
      document.getElementById("charCount").textContent = draft.messageTemplate.length;
    }
    if (draft.intervalMin) document.getElementById("intervalMin").value = draft.intervalMin;
    if (draft.intervalMax) document.getElementById("intervalMax").value = draft.intervalMax;
    if (draft.dailyLimit) document.getElementById("dailyLimit").value = draft.dailyLimit;

    document.getElementById("scheduleCheck").checked = !!draft.scheduleCheck;
    if (draft.scheduleStart) document.getElementById("scheduleStart").value = draft.scheduleStart;
    if (draft.scheduleEnd) document.getElementById("scheduleEnd").value = draft.scheduleEnd;
    updateScheduleVisibility();

    document.getElementById("sendImageCheck").checked = !!draft.sendImageCheck;
    updateMediaOptionsVisibility();
    applySendOrderSelection(draft.sendOrder || "text_first");

    document.getElementById("enableButtons").checked = !!draft.enableButtons;
    document.getElementById("buttonType").value = draft.buttonType || "buttons";
    document.getElementById("btnFooter").value = draft.btnFooter || "";
    document.getElementById("listButtonText").value = draft.listButtonText || "Ver opções";
    document.getElementById("listSectionTitle").value = draft.listSectionTitle || "Opções";

    applyInteractiveBuilderState({
      enabled: !!draft.enableButtons,
      type: draft.buttonType || "buttons",
      footer: draft.btnFooter || "",
      buttonText: draft.listButtonText || "Ver opções",
      sectionTitle: draft.listSectionTitle || "Opções",
      items: Array.isArray(draft.buttonItems) ? draft.buttonItems : [],
      descriptions: Array.isArray(draft.buttonDescriptions) ? draft.buttonDescriptions : [],
    });

    uploadedImages = Array.isArray(draft.uploadedImages) ? draft.uploadedImages : [];
    uploadedVideos = Array.isArray(draft.uploadedVideos) ? draft.uploadedVideos : [];
    uploadedDocs = Array.isArray(draft.uploadedDocs) ? draft.uploadedDocs : [];
    renderImagePreview();
    renderVideoPreview();
    renderDocPreview();
    activateMediaTab(draft.activeMediaTab || getPreferredMediaTab());
    updatePreviewContent();
  } finally {
    isApplyingDraft = false;
  }
}

function setupDraftPersistence() {
  const selectors = [
    "#messageTemplate",
    "#intervalMin",
    "#intervalMax",
    "#dailyLimit",
    "#scheduleStart",
    "#scheduleEnd",
    "#btnFooter",
    "#listButtonText",
    "#listSectionTitle",
    ".btn-item-title",
    ".btn-item-desc",
  ];

  document.addEventListener("input", (event) => {
    if (selectors.some((selector) => event.target.matches(selector))) {
      saveSendDraft();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  // Dark mode
  if (localStorage.getItem("darkMode") === "true") {
    document.documentElement.setAttribute("data-theme", "dark");
    document.getElementById("themeIcon").className = "fas fa-sun";
  }

  // Supabase auth check — tenta renovar sessão para garantir token válido
  let { data: { session } } = await sb.auth.getSession();
  if (session) {
    // Força refresh para obter token atualizado
    const { data: refreshData } = await sb.auth.refreshSession();
    if (refreshData.session) {
      session = refreshData.session;
    }
  }
  if (!session) {
    // Não logado — redireciona para landing
    window.location.href = "/";
    return;
  }

  authToken = session.access_token;
  currentUser = session.user;

  // Preenche info do usuário
  updateUserInfo();

  // Listener para mudança de sessão (refresh token, logout)
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      window.location.href = "/";
      return;
    }
    authToken = session.access_token;
  });

  setupEventSource();
  setupImageUpload();
  setupVideoUpload();
  setupDocUpload();
  setupMessageEditor();
  setupDraftPersistence();
  checkSessionStatus();
  await loadDailyStats();
  await loadTemplateList();
  await loadSavedCustomers();
  restoreSendDraft();
  await restoreRunningJob();

  document.getElementById("xlsxInput").addEventListener("change", handleFile);

  // Show/hide send order when media checkbox changes
  document.getElementById("sendImageCheck").addEventListener("change", () => {
    updateMediaOptionsVisibility();
    updatePreviewContent();
    saveSendDraft();
  });
  document.getElementById("scheduleCheck").addEventListener("change", () => {
    updateScheduleVisibility();
    saveSendDraft();
  });

  // Fecha dropdown ao clicar fora
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("userDropdown");
    const btn = document.getElementById("userMenuBtn");
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = "none";
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AUTH (Supabase)
// ═══════════════════════════════════════════════════════════════
async function updateUserInfo() {
  const nameEl = document.getElementById("userName");
  const emailEl = document.getElementById("userEmail");
  if (currentUser) {
    emailEl.textContent = currentUser.email || "";
    nameEl.textContent = currentUser.user_metadata?.name || currentUser.email?.split("@")[0] || "Usuário";
  }
  // Tenta buscar perfil completo do backend
  try {
    const res = await authFetch("/api/profile");
    if (res.ok) {
      const data = await res.json();
      if (data.profile?.name) nameEl.textContent = data.profile.name;
    }
  } catch { }
  // Verifica se é admin e mostra link (silencioso — 403 é esperado para não-admins)
  try {
    const adminRes = await authFetch("/api/check-admin");
    if (adminRes.ok) {
      const adminData = await adminRes.json();
      const adminLink = document.getElementById("adminLink");
      if (adminLink && adminData.isAdmin) adminLink.style.display = "flex";
    }
    // 403 = não é admin, ignora silenciosamente
  } catch { }
}

function toggleUserMenu() {
  const dd = document.getElementById("userDropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
}

async function doLogout() {
  await sb.auth.signOut();
  clearSessionStatusPolling();
  if (eventSource) eventSource.close();
  authToken = null;
  currentUser = null;
  window.location.href = "/";
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

async function authFetch(url, opts = {}) {
  opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
  let res = await fetch(url, opts);

  // Se receber 401, tenta renovar o token e refazer a requisição
  if (res.status === 401) {
    const { data: refreshData } = await sb.auth.refreshSession();
    if (refreshData.session) {
      authToken = refreshData.session.access_token;
      opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
      res = await fetch(url, opts);
    } else {
      // Refresh falhou — sessão expirada, redireciona
      window.location.href = "/";
      return res;
    }
  }
  return res;
}

// ═══════════════════════════════════════════════════════════════
// SSE
// ═══════════════════════════════════════════════════════════════
let sseReconnectTimer = null;
let sseReconnectDelay = 1000;

function clearSessionStatusPolling() {
  if (!sessionStatusPollTimer) return;
  clearTimeout(sessionStatusPollTimer);
  sessionStatusPollTimer = null;
}

function shouldPollSessionStatus(status) {
  return ["connecting", "authenticated", "loading", "reconnecting", "qr"].includes(status);
}

function scheduleSessionStatusPolling(delay = SESSION_STATUS_POLL_INTERVAL_MS) {
  clearSessionStatusPolling();

  if (!authToken || !shouldPollSessionStatus(lastSessionStatus) || sessionStatusPollInFlight) {
    return;
  }

  sessionStatusPollTimer = setTimeout(async () => {
    sessionStatusPollTimer = null;

    if (!authToken || !shouldPollSessionStatus(lastSessionStatus)) return;

    sessionStatusPollInFlight = true;
    try {
      const res = await authFetch("/api/session/status");
      const data = await res.json();
      updateSessionUI(data);
    } catch (err) {
      console.warn("Erro ao atualizar status da sessão:", err.message);
    } finally {
      sessionStatusPollInFlight = false;
      if (shouldPollSessionStatus(lastSessionStatus)) {
        scheduleSessionStatusPolling();
      }
    }
  }, delay);
}

function setupEventSource() {
  if (eventSource) eventSource.close();
  if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }

  const tokenParam = authToken ? `?token=${authToken}` : "";
  eventSource = new EventSource(`/events${tokenParam}`);

  eventSource.addEventListener("session", (e) => {
    updateSessionUI(JSON.parse(e.data));
  });

  eventSource.addEventListener("job", (e) => {
    handleJobEvent(JSON.parse(e.data));
  });

  eventSource.onopen = async () => {
    sseReconnectDelay = 1000; // reset backoff ao conectar
    await restoreRunningJob(true);
  };

  eventSource.onerror = () => {
    console.warn("SSE desconectado. Reconectando em", sseReconnectDelay / 1000, "s...");
    eventSource.close();
    sseReconnectTimer = setTimeout(async () => {
      // Renova token antes de reconectar
      const { data: refreshData } = await sb.auth.refreshSession();
      if (refreshData.session) {
        authToken = refreshData.session.access_token;
      }
      setupEventSource();
    }, sseReconnectDelay);
    sseReconnectDelay = Math.min(sseReconnectDelay * 2, 30000); // backoff até 30s
  };
}

function handleJobEvent(data) {
  const log = document.getElementById("logContainer");
  const now = new Date().toLocaleTimeString("pt-BR");

  switch (data.type) {
    case "progress":
      setSendingUiActive();
      syncJobStats(data);
      addLog(log, "info", `[${now}] Enviando para ${data.customer} (${data.phone}) — ${data.current}/${data.total}`);
      break;
    case "sent":
      setSendingUiActive();
      syncJobStats(data);
      updateTableStatus(data.index, "ok");
      addLog(log, "success", `[${now}] ✅ ${data.nome} (${data.phone})`);
      updateDailySent();
      break;
    case "error":
      setSendingUiActive();
      syncJobStats(data);
      updateTableStatus(data.index, "error", data.error);
      addLog(log, "error", `[${now}] ❌ ${data.nome}: ${data.error}`);
      break;
    case "waiting":
      setSendingUiActive();
      addLog(log, "wait", `[${now}] ⏳ Aguardando ${(data.waitTime / 1000).toFixed(1)}s...`);
      break;
    case "paused_schedule":
      setSendingUiActive();
      addLog(log, "warn", `[${now}] ⏸️ ${data.message}`);
      break;
    case "paused_limit":
      setSendingUiActive();
      addLog(log, "warn", `[${now}] 🛡️ ${data.message}`);
      break;
    case "schedule_resumed":
      setSendingUiActive();
      addLog(log, "success", `[${now}] ▶️ ${data.message}`);
      break;
    case "resuming":
      setSendingUiActive();
      syncJobStats(data);
      addLog(log, "warn", `[${now}] 📋 ${data.message}`);
      break;
    case "schedule_started":
      setSendingUiActive();
      syncJobStats(data);
      addLog(log, "info", `[${now}] ⏰ Agendamento "${data.name}" iniciado (${data.total} contatos)`);
      break;
    case "completed":
      lastHistoryId = data.historyId;
      addLog(log, "success", `[${now}] 🏁 Finalizado! ✅ ${data.sent} | ❌ ${data.failed} | Total: ${data.total}`);
      finishSending();
      break;
    case "cancelled":
      addLog(log, "warn", `[${now}] 🛑 Cancelado.`);
      finishSending();
      break;
  }
}

function addLog(container, type, message) {
  const div = document.createElement("div");
  div.className = `log-entry log-${type}`;
  div.textContent = message;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function setSendingUiActive() {
  document.getElementById("progressSection").style.display = "block";
  document.getElementById("btnSend").style.display = "none";
  document.getElementById("btnSchedule").style.display = "none";
  document.getElementById("btnCancel").style.display = "inline-flex";
}

function syncJobStats(data = {}) {
  jobStats = {
    sent: typeof data.sent === "number" ? data.sent : jobStats.sent,
    failed: typeof data.failed === "number" ? data.failed : jobStats.failed,
    total: typeof data.total === "number" ? data.total : jobStats.total,
  };

  if (!jobStats.total) {
    jobStats.total = jobStats.sent + jobStats.failed;
  }

  updateProgressUI();
}

function applyRunningJobConfig(data = {}) {
  isApplyingDraft = true;
  try {
    if (typeof data.messageTemplate === "string") {
      document.getElementById("messageTemplate").value = data.messageTemplate;
      document.getElementById("charCount").textContent = data.messageTemplate.length;
    }

    const intervalMin = normalizeIntervalForInput(data.intervalMin, document.getElementById("intervalMin").value || "5");
    const intervalMax = normalizeIntervalForInput(data.intervalMax, document.getElementById("intervalMax").value || "15");
    if (intervalMin) document.getElementById("intervalMin").value = intervalMin;
    if (intervalMax) document.getElementById("intervalMax").value = intervalMax;

    if (data.dailyLimit !== undefined && data.dailyLimit !== null) {
      document.getElementById("dailyLimit").value = data.dailyLimit;
    }

    const hasSchedule = !!(data.scheduleStart && data.scheduleEnd);
    document.getElementById("scheduleCheck").checked = hasSchedule;
    document.getElementById("scheduleStart").value = data.scheduleStart || "08:00";
    document.getElementById("scheduleEnd").value = data.scheduleEnd || "18:00";
    updateScheduleVisibility();

    document.getElementById("sendImageCheck").checked = !!data.sendImage;
    updateMediaOptionsVisibility();
    applySendOrderSelection(data.sendOrder || "text_first");

    const interactiveData = data.interactiveData || null;
    applyInteractiveBuilderState({
      enabled: !!interactiveData?.enabled,
      type: interactiveData?.type || "buttons",
      footer: interactiveData?.footer || "",
      buttonText: interactiveData?.buttonText || "Ver opções",
      sectionTitle: interactiveData?.sectionTitle || "Opções",
      items: interactiveData?.items || [],
      descriptions: interactiveData?.descriptions || [],
    });

    uploadedImages = Array.isArray(data.images) ? data.images : [];
    uploadedVideos = Array.isArray(data.videos) ? data.videos : [];
    uploadedDocs = Array.isArray(data.documents) ? data.documents : [];
    renderImagePreview();
    renderVideoPreview();
    renderDocPreview();
    activateMediaTab(getPreferredMediaTab());

    updatePreviewContent();
  } finally {
    isApplyingDraft = false;
  }

  saveSendDraft();
}

function restoreJobLog(data, silent = false) {
  if (silent) return;

  const log = document.getElementById("logContainer");
  if (!log || log.children.length > 0) return;

  const now = new Date().toLocaleTimeString("pt-BR");
  const sent = Number(data.sent) || 0;
  const failed = Number(data.failed) || 0;
  const remaining =
    typeof data.remaining === "number"
      ? data.remaining
      : Math.max((data.total || 0) - sent - failed, 0);

  if (sent > 0 || failed > 0) {
    addLog(log, "info", `[${now}] Histórico restaurado. ✅ ${sent} | ❌ ${failed}`);
  }

  addLog(log, "warn", `[${now}] 📋 Envio em andamento restaurado. ${remaining} pendentes.`);
}

function isSessionOperational(status) {
  return ["connected", "connecting", "authenticated", "loading", "reconnecting", "qr"].includes(status);
}

async function ensureSessionForRunningJob() {
  if (activeJobReconnectInFlight) return;

  try {
    const statusRes = await authFetch("/api/session/status");
    if (!statusRes.ok) return;

    const sessionData = await statusRes.json();
    updateSessionUI(sessionData);

    if (isSessionOperational(sessionData.status)) return;

    activeJobReconnectInFlight = true;
    const log = document.getElementById("logContainer");
    const now = new Date().toLocaleTimeString("pt-BR");
    if (log && log.children.length === 0) {
      addLog(log, "warn", `[${now}] Reconectando a sessão do WhatsApp para retomar o envio...`);
    }

    await authFetch("/api/session/start", { method: "POST" });
  } catch (err) {
    console.warn("Erro ao reativar sessão para envio em andamento:", err.message);
  } finally {
    activeJobReconnectInFlight = false;
  }
}

function resolveCustomerIndex(result) {
  if (typeof result.index === "number") return result.index;
  return customers.findIndex((c) =>
    c.whatsapp === result.phone && (!result.nome || c.nome === result.nome)
  );
}

function applyJobResult(result) {
  const index = resolveCustomerIndex(result);
  if (index < 0) return;
  updateTableStatus(index, result.status === "ok" ? "ok" : "error", result.error);
}

async function restoreRunningJob(silent = false) {
  try {
    const res = await authFetch("/api/send/status");
    if (!res.ok) return;

    const data = await res.json();
    if (!data.running) return;

    applyRunningJobConfig(data);
    setSendingUiActive();
    syncJobStats(data);

    if (Array.isArray(data.results)) {
      data.results.forEach(applyJobResult);
    }

    restoreJobLog(data, silent);
    await ensureSessionForRunningJob();
  } catch (err) {
    console.warn("Erro ao restaurar envio em andamento:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSÃO
// ═══════════════════════════════════════════════════════════════
async function checkSessionStatus() {
  try {
    const res = await authFetch("/api/session/status");
    const data = await res.json();
    updateSessionUI(data);
  } catch {
    updateSessionUI({ status: "disconnected" });
  }
}

async function startSession() {
  const btn = document.getElementById("btnConnect");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
  try {
    const res = await authFetch("/api/session/start", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    updateSessionUI({ status: "connecting" });
  } catch (err) {
    alert("Erro: " + err.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plug"></i> Conectar';
  }
}

async function restartSession() {
  if (!confirm("Reconectar?")) return;
  try {
    const res = await authFetch("/api/session/restart", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    updateSessionUI({ status: "connecting" });
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

async function closeSession() {
  if (!confirm("Desconectar e remover sessão?")) return;
  try {
    const res = await authFetch("/api/session/close", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    updateSessionUI({ status: "disconnected" });
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

function formatSessionReason(data) {
  const reason = data.reason || data.waState;
  switch (reason) {
    case "CONFLICT":
      return "Conflito de sessão: outro WhatsApp Web assumiu a conexão.";
    case "TIMEOUT":
      return "A conexão expirou. O sistema vai tentar reconectar automaticamente.";
    case "UNPAIRED":
    case "UNPAIRED_IDLE":
      return "Aparelho desvinculado. Será necessário escanear o QR novamente.";
    case "LOGOUT":
      return "Sessão encerrada no WhatsApp. Será necessário escanear o QR novamente.";
    case "DEPRECATED_VERSION":
      return "A versão do WhatsApp Web foi recusada. O cliente precisa ser atualizado.";
    default:
      return reason ? `Último motivo: ${reason}` : "Sessão salva automaticamente.";
  }
}

function updateSessionUI(data) {
  lastSessionStatus = data.status || "disconnected";

  const badge = document.getElementById("sessionStatus");
  const btnConnect = document.getElementById("btnConnect");
  const btnRestart = document.getElementById("btnRestart");
  const btnDisconnect = document.getElementById("btnDisconnect");
  const btnSend = document.getElementById("btnSend");
  const btnSchedule = document.getElementById("btnSchedule");
  const qrContainer = document.getElementById("qrContainer");
  const qrImage = document.getElementById("qrImage");
  const loadingContainer = document.getElementById("loadingContainer");
  const loadingText = document.getElementById("loadingText");
  const sessionReason = document.getElementById("sessionReason");

  badge.className = "status-badge";
  qrContainer.style.display = "none";
  loadingContainer.style.display = "none";
  if (sessionReason) sessionReason.textContent = "Sessão salva automaticamente.";

  const hasContacts = customers.filter((c) => c.active).length > 0;

  switch (data.status) {
    case "connected":
      badge.classList.add("connected");
      if (data.phoneNumber) {
        const formatted = data.phoneNumber.replace(/(\d{2})(\d{2})(\d{4,5})(\d{4})/, "+$1 ($2) $3-$4");
        badge.innerHTML = `<i class="fas fa-circle"></i> <span>${formatted}</span>`;
      } else {
        badge.innerHTML = '<i class="fas fa-circle"></i> <span>Conectado</span>';
      }
      btnConnect.style.display = "none";
      btnRestart.style.display = "inline-flex";
      btnDisconnect.disabled = false;
      btnSend.disabled = !hasContacts;
      btnSchedule.disabled = !hasContacts;
      if (sessionReason) sessionReason.textContent = "Sessão conectada e salva automaticamente.";
      break;
    case "qr":
      badge.classList.add("waiting");
      badge.innerHTML = '<i class="fas fa-qrcode"></i> <span>Escaneie o QR</span>';
      if (data.qr) {
        qrContainer.style.display = "block";
        qrImage.src = data.qr;
      }
      btnConnect.disabled = true;
      btnConnect.innerHTML = '<i class="fas fa-qrcode"></i> Aguardando QR...';
      btnRestart.style.display = "none";
      btnDisconnect.disabled = false;
      btnSend.disabled = true;
      btnSchedule.disabled = true;
      if (sessionReason) sessionReason.textContent = "Escaneie o QR com o celular conectado à internet.";
      break;
    case "connecting":
    case "authenticated":
    case "loading":
    case "reconnecting":
      badge.classList.add("waiting");
      const msg =
        data.percent
          ? `Carregando ${data.percent}%...`
          : data.status === "reconnecting"
            ? "Reconectando..."
            : "Conectando...";
      badge.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${msg}</span>`;
      loadingContainer.style.display = "flex";
      loadingText.textContent = data.message || msg;
      btnConnect.disabled = true;
      btnConnect.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
      btnRestart.style.display = "none";
      btnDisconnect.disabled = false;
      btnSend.disabled = true;
      btnSchedule.disabled = true;
      if (sessionReason) {
        sessionReason.textContent =
          data.status === "reconnecting"
            ? formatSessionReason(data)
            : "Aguardando sincronização do WhatsApp Web.";
      }
      break;
    default:
      badge.classList.add("disconnected");
      badge.innerHTML = '<i class="fas fa-circle"></i> <span>Desconectado</span>';
      btnConnect.style.display = "inline-flex";
      btnConnect.disabled = false;
      btnConnect.innerHTML = '<i class="fas fa-plug"></i> Conectar';
      btnRestart.style.display = "none";
      btnDisconnect.disabled = true;
      btnSend.disabled = true;
      btnSchedule.disabled = true;
      if (sessionReason) sessionReason.textContent = formatSessionReason(data);
      break;
  }

  if (shouldPollSessionStatus(lastSessionStatus)) {
    const delay = lastSessionStatus === "connecting" ? 1000 : SESSION_STATUS_POLL_INTERVAL_MS;
    scheduleSessionStatusPolling(delay);
  } else {
    clearSessionStatusPolling();
  }
}

// ═══════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add("active");
  document.getElementById(`tab-${tabName}`).classList.add("active");

  if (tabName === "history") loadHistory();
  if (tabName === "schedules") loadSchedules();
  if (tabName === "analytics") loadAnalytics();
}

function switchImportTab(name, btn) {
  document.querySelectorAll(".import-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".import-panel").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`import-${name}`).classList.add("active");
}

// ═══════════════════════════════════════════════════════════════
// DARK MODE
// ═══════════════════════════════════════════════════════════════
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    document.getElementById("themeIcon").className = "fas fa-moon";
    localStorage.setItem("darkMode", "false");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    document.getElementById("themeIcon").className = "fas fa-sun";
    localStorage.setItem("darkMode", "true");
  }
}

// ═══════════════════════════════════════════════════════════════
// EDITOR DE MENSAGEM
// ═══════════════════════════════════════════════════════════════
function setupMessageEditor() {
  const ta = document.getElementById("messageTemplate");
  const counter = document.getElementById("charCount");
  ta.addEventListener("input", () => {
    counter.textContent = ta.value.length;
    updatePreviewContent();
    saveSendDraft();
  });
}

// ═══════════════════════════════════════════════════════════════
// FORMATTING TOOLBAR
// ═══════════════════════════════════════════════════════════════
function insertFormatting(type) {
  const ta = document.getElementById("messageTemplate");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  let before = ta.value.substring(0, start);
  let after = ta.value.substring(end);
  let insert = "";

  switch (type) {
    case "bold":
      insert = selected ? `*${selected}*` : "*texto*";
      break;
    case "italic":
      insert = selected ? `_${selected}_` : "_texto_";
      break;
    case "strike":
      insert = selected ? `~${selected}~` : "~texto~";
      break;
    case "mono":
      insert = selected ? "```" + selected + "```" : "```código```";
      break;
    case "list":
      if (selected) {
        insert = selected.split("\n").map(l => `• ${l}`).join("\n");
      } else {
        insert = "• Item 1\n• Item 2\n• Item 3";
      }
      break;
    case "number":
      if (selected) {
        insert = selected.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n");
      } else {
        insert = "1. Item 1\n2. Item 2\n3. Item 3";
      }
      break;
  }

  ta.value = before + insert + after;
  ta.focus();
  // Place cursor after inserted text
  const cursorPos = start + insert.length;
  ta.setSelectionRange(cursorPos, cursorPos);
  document.getElementById("charCount").textContent = ta.value.length;
  updatePreviewContent();
  saveSendDraft();
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE PREVIEW
// ═══════════════════════════════════════════════════════════════
let previewVisible = false;

function togglePreview() {
  previewVisible = !previewVisible;
  const panel = document.getElementById("messagePreview");
  const btn = document.getElementById("btnPreview");
  panel.style.display = previewVisible ? "block" : "none";
  if (btn) btn.classList.toggle("active", previewVisible);
  if (previewVisible) updatePreviewContent();
}

function updatePreviewContent() {
  if (!previewVisible) return;
  const bubble = document.getElementById("previewBubble");
  const msg = document.getElementById("messageTemplate").value;

  if (!msg.trim()) {
    bubble.innerHTML = '<p class="preview-placeholder">Escreva uma mensagem para ver o preview...</p>';
    return;
  }

  // Variable substitution from first contact
  let preview = msg;
  if (customers.length > 0) {
    const c = customers[0];
    for (const key of Object.keys(c)) {
      if (key === "active" || key === "_idx") continue;
      preview = preview.replace(new RegExp(`\\{${key}\\}`, "gi"), c[key] || "");
    }
  }

  // WhatsApp formatting to HTML
  let html = escapeHTML(preview);
  // Bold: *text*
  html = html.replace(/\*(.*?)\*/g, "<b>$1</b>");
  // Italic: _text_
  html = html.replace(/_(.*?)_/g, "<i>$1</i>");
  // Strikethrough: ~text~
  html = html.replace(/~(.*?)~/g, "<s>$1</s>");
  // Monospace: ```text```
  html = html.replace(/```(.*?)```/gs, "<code>$1</code>");
  // Line breaks
  html = html.replace(/\n/g, "<br>");

  let mediaHtml = "";

  // Show image previews
  if (document.getElementById("sendImageCheck").checked && uploadedImages.length > 0) {
    mediaHtml += '<div class="preview-media">';
    uploadedImages.forEach(img => {
      mediaHtml += `<img src="${img.path}" class="preview-media-item" alt="${escapeHTML(img.name)}" />`;
    });
    mediaHtml += "</div>";
  }

  if (document.getElementById("sendImageCheck").checked && uploadedVideos.length > 0) {
    mediaHtml += '<div class="preview-media">';
    uploadedVideos.forEach(video => {
      mediaHtml += `<video src="${video.path}" class="preview-media-item" preload="metadata" muted playsinline controls></video>`;
    });
    mediaHtml += "</div>";
  }

  // Show document previews
  if (document.getElementById("sendImageCheck").checked && uploadedDocs.length > 0) {
    mediaHtml += '<div class="preview-media">';
    uploadedDocs.forEach(doc => {
      const icon = getDocIcon(doc.name);
      mediaHtml += `<div class="preview-doc-item"><i class="fas ${icon}"></i> ${escapeHTML(doc.name)}</div>`;
    });
    mediaHtml += "</div>";
  }

  // Show buttons/list preview (native WhatsApp style)
  let buttonsHtml = "";
  const iData = getInteractiveData();
  if (iData) {
    if (iData.footer) {
      buttonsHtml += `<div class="preview-footer">${escapeHTML(iData.footer)}</div>`;
    }
    buttonsHtml += '<div class="preview-buttons-container">';
    if (iData.type === "buttons") {
      iData.items.slice(0, 3).forEach(item => {
        buttonsHtml += `<div class="preview-wa-button"><i class="fas fa-reply"></i> ${escapeHTML(item)}</div>`;
      });
    } else {
      buttonsHtml += `<div class="preview-wa-list-btn"><i class="fas fa-bars"></i> ${escapeHTML(iData.buttonText || "Ver opções")}</div>`;
      buttonsHtml += '<div class="preview-wa-list-items">';
      iData.items.forEach(item => {
        const descIdx = iData.items.indexOf(item);
        const desc = iData.descriptions && iData.descriptions[descIdx] ? iData.descriptions[descIdx] : "";
        buttonsHtml += `<div class="preview-wa-list-item">
          <div class="preview-wa-list-item-title">${escapeHTML(item)}</div>
          ${desc ? `<div class="preview-wa-list-item-desc">${escapeHTML(desc)}</div>` : ""}
        </div>`;
      });
      buttonsHtml += "</div>";
    }
    buttonsHtml += "</div>";
  }

  bubble.innerHTML = html + mediaHtml + buttonsHtml;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE BUTTONS / LISTS BUILDER
// ═══════════════════════════════════════════════════════════════
function toggleButtonsBuilder() {
  const enabled = document.getElementById("enableButtons").checked;
  const builder = document.getElementById("buttonsBuilder");
  builder.style.display = enabled ? "block" : "none";
  if (enabled && document.getElementById("buttonItems").children.length === 0) {
    addButtonItem();
    addButtonItem();
  }
  updateButtonsUI();
  updatePreviewContent();
  saveSendDraft();
}

function updateButtonsUI() {
  const btype = document.getElementById("buttonType").value;
  const listFields = document.getElementById("listExtraFields");
  if (listFields) listFields.style.display = btype === "list" ? "flex" : "none";

  // Update placeholders and limit
  const items = document.querySelectorAll("#buttonItems .button-item");
  const maxItems = btype === "buttons" ? 3 : 10;
  items.forEach((item, i) => {
    const titleInput = item.querySelector(".btn-item-title");
    if (titleInput) {
      titleInput.placeholder = btype === "buttons" ? "Texto do botão..." : "Título da opção...";
    }
    const descInput = item.querySelector(".btn-item-desc");
    if (descInput) {
      descInput.style.display = btype === "list" ? "block" : "none";
    }
    // Hide items beyond the limit
    item.style.display = i < maxItems ? "flex" : "none";
  });

  updatePreviewContent();
  saveSendDraft();
}

function addButtonItem(initialTitle = "", initialDescription = "") {
  const container = document.getElementById("buttonItems");
  const btype = document.getElementById("buttonType").value;
  const maxItems = btype === "buttons" ? 3 : 10;
  const idx = container.children.length;
  if (idx >= maxItems) return alert(`Máximo de ${maxItems} opções para ${btype === "buttons" ? "botões" : "lista"}.`);

  const div = document.createElement("div");
  div.className = "button-item";
  div.innerHTML = `
    <span class="btn-item-num" style="font-weight:600;font-size:0.82rem;color:var(--text-secondary);min-width:22px;">${idx + 1}.</span>
    <div class="btn-item-fields">
      <input type="text" class="btn-item-title" placeholder="${btype === "buttons" ? "Texto do botão..." : "Título da opção..."}" oninput="updatePreviewContent()" />
      <input type="text" class="btn-item-desc" placeholder="Descrição (opcional)..." style="display:${btype === "list" ? "block" : "none"}" oninput="updatePreviewContent()" />
    </div>
    <button type="button" class="btn-remove-item" onclick="removeButtonItem(this)" title="Remover">
      <i class="fas fa-times"></i>
    </button>
  `;
  container.appendChild(div);
  div.querySelector(".btn-item-title").value = initialTitle;
  div.querySelector(".btn-item-desc").value = initialDescription;
  saveSendDraft();
}

function removeButtonItem(btn) {
  btn.closest(".button-item").remove();
  renumberButtonItems();
  updatePreviewContent();
  saveSendDraft();
}

function renumberButtonItems() {
  document.querySelectorAll("#buttonItems .button-item").forEach((item, i) => {
    item.querySelector(".btn-item-num").textContent = `${i + 1}.`;
  });
}

function getButtonItems() {
  const items = [];
  document.querySelectorAll("#buttonItems .button-item .btn-item-title").forEach(inp => {
    const val = inp.value.trim();
    if (val) items.push(val);
  });
  return items;
}

function getButtonDescriptions() {
  const descs = [];
  document.querySelectorAll("#buttonItems .button-item .btn-item-desc").forEach(inp => {
    descs.push((inp.value || "").trim());
  });
  return descs;
}

function getInteractiveData() {
  if (!document.getElementById("enableButtons") || !document.getElementById("enableButtons").checked) return null;
  const items = getButtonItems();
  if (items.length === 0) return null;

  const btype = document.getElementById("buttonType").value;
  const footer = (document.getElementById("btnFooter").value || "").trim();

  const data = {
    enabled: true,
    type: btype,
    items,
    footer: footer || "Responda com o número da opção",
  };

  if (btype === "list") {
    data.descriptions = getButtonDescriptions();
    data.buttonText = (document.getElementById("listButtonText").value || "").trim() || "Ver opções";
    data.sectionTitle = (document.getElementById("listSectionTitle").value || "").trim() || "Opções";
  }

  return data;
}

// Legacy compatibility — no longer appends text, interactive is handled natively
function getButtonsText() {
  return "";
}

// ═══════════════════════════════════════════════════════════════
// SEND ORDER SELECTOR\n// ═══════════════════════════════════════════════════════════════
function setSendOrder(order, el) {
  applySendOrderSelection(order, el);
  updatePreviewContent();
  saveSendDraft();
}

function getSendOrder() {
  const checked = document.querySelector('input[name=\"sendOrder\"]:checked');
  return checked ? checked.value : "text_first";
}

// ═══════════════════════════════════════════════════════════════
// MEDIA TABS (Images / Videos / Documents)
// ═══════════════════════════════════════════════════════════════

function switchMediaTab(tab, btn) {
  activateMediaTab(tab);
  if (btn) btn.classList.add("active");
  saveSendDraft();
}

function setupVideoUpload() {
  const area = document.getElementById("videoUploadArea");
  const input = document.getElementById("videoInput");
  if (!area || !input) return;
  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) uploadVideos(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    if (input.files.length > 0) { uploadVideos(input.files); input.value = ""; }
  });
}

async function uploadVideos(files) {
  await uploadMediaFiles(files, {
    expectedKind: "video",
    successMessagePrefix: "video",
    targetList: uploadedVideos,
    render: renderVideoPreview,
  });
}

function setupDocUpload() {
  const area = document.getElementById("docUploadArea");
  const input = document.getElementById("docInput");
  if (!area || !input) return;
  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) uploadDocs(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    if (input.files.length > 0) { uploadDocs(input.files); input.value = ""; }
  });
}

async function uploadDocs(files) {
  await uploadMediaFiles(files, {
    expectedKind: "document",
    successMessagePrefix: "documento",
    targetList: uploadedDocs,
    render: renderDocPreview,
  });
}

function renderVideoPreview() {
  const container = document.getElementById("videoPreview");
  if (!container) return;
  container.innerHTML = "";
  uploadedVideos.forEach((video, i) => {
    const div = document.createElement("div");
    div.className = "image-item";
    div.innerHTML = `
      <video src="${video.path}" muted playsinline preload="metadata" controls></video>
      <button class="btn-remove" onclick="removeVideo(${i})" title="Remover"><i class="fas fa-times"></i></button>
      <input type="text" class="caption-input" placeholder="Legenda..." value="${video.caption || ""}"
        onchange="updateVideoCaption(${i}, this.value)" />
    `;
    container.appendChild(div);
  });
}

function renderDocPreview() {
  const container = document.getElementById("docPreview");
  if (!container) return;
  container.innerHTML = "";
  uploadedDocs.forEach((doc, i) => {
    const ext = doc.name.split(".").pop().toLowerCase();
    const iconClass = getDocIcon(doc.name);
    const colorClass = getDocColorClass(ext);
    const div = document.createElement("div");
    div.className = "doc-item";
    div.innerHTML = `
      <div class="doc-item-icon ${colorClass}"><i class="fas ${iconClass}"></i></div>
      <div class="doc-item-info">
        <div class="doc-item-name">${doc.name}</div>
        <div class="doc-item-size">${ext.toUpperCase()}</div>
      </div>
      <button class="btn-remove-item" onclick="removeDoc(${i})" title="Remover">
        <i class="fas fa-times"></i>
      </button>
    `;
    container.appendChild(div);
  });
}

function getDocIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "pdf") return "fa-file-pdf";
  if (["doc", "docx"].includes(ext)) return "fa-file-word";
  if (["xls", "xlsx"].includes(ext)) return "fa-file-excel";
  if (["ppt", "pptx"].includes(ext)) return "fa-file-powerpoint";
  if (ext === "txt") return "fa-file-alt";
  if (ext === "zip") return "fa-file-archive";
  return "fa-file";
}

function getDocColorClass(ext) {
  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "doc";
  if (["xls", "xlsx"].includes(ext)) return "xls";
  return "other";
}

async function removeDoc(index) {
  const doc = uploadedDocs[index];
  try { await authFetch(`/api/images/${doc.id}`, { method: "DELETE" }); } catch { }
  uploadedDocs.splice(index, 1);
  renderDocPreview();
  updatePreviewContent();
  saveSendDraft();
}

function updateVideoCaption(index, value) {
  uploadedVideos[index].caption = value;
  saveSendDraft();
}

async function removeVideo(index) {
  const video = uploadedVideos[index];
  try { await authFetch(`/api/images/${video.id}`, { method: "DELETE" }); } catch { }
  uploadedVideos.splice(index, 1);
  renderVideoPreview();
  updatePreviewContent();
  saveSendDraft();
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════
async function loadTemplateList() {
  try {
    const res = await authFetch("/api/templates");
    const data = await res.json();
    const sel = document.getElementById("templateSelect");
    sel.innerHTML = '<option value="">-- Templates salvos --</option>';
    (data.templates || []).forEach((t) => {
      sel.innerHTML += `<option value="${t.id}" data-msg="${encodeURIComponent(t.message)}">${t.name}</option>`;
    });
  } catch { }
}

function loadTemplate() {
  const sel = document.getElementById("templateSelect");
  const opt = sel.options[sel.selectedIndex];
  if (!opt.value) return;
  document.getElementById("messageTemplate").value = decodeURIComponent(opt.dataset.msg || "");
  document.getElementById("charCount").textContent = document.getElementById("messageTemplate").value.length;
  updatePreviewContent();
  saveSendDraft();
}

async function saveTemplate() {
  const msg = document.getElementById("messageTemplate").value.trim();
  if (!msg) return alert("Escreva uma mensagem antes de salvar.");
  const name = prompt("Nome do template:");
  if (!name) return;

  const sel = document.getElementById("templateSelect");
  const selectedId = sel.value || undefined;

  await authFetch("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name, message: msg, id: selectedId }),
  });
  await loadTemplateList();
}

async function deleteCurrentTemplate() {
  const sel = document.getElementById("templateSelect");
  if (!sel.value) return alert("Selecione um template primeiro.");
  if (!confirm("Excluir este template?")) return;
  await authFetch(`/api/templates/${sel.value}`, { method: "DELETE" });
  await loadTemplateList();
  document.getElementById("messageTemplate").value = "";
  document.getElementById("charCount").textContent = 0;
  updatePreviewContent();
  saveSendDraft();
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD DE IMAGENS
// ═══════════════════════════════════════════════════════════════
function setupImageUpload() {
  const area = document.getElementById("uploadArea");
  const input = document.getElementById("imageInput");
  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) uploadImages(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    if (input.files.length > 0) { uploadImages(input.files); input.value = ""; }
  });
}

async function uploadImages(files) {
  await uploadMediaFiles(files, {
    expectedKind: "image",
    successMessagePrefix: "imagem",
    targetList: uploadedImages,
    render: renderImagePreview,
  });
}

async function uploadMediaFiles(files, { expectedKind, successMessagePrefix, targetList, render }) {
  const fd = new FormData();
  for (const f of files) fd.append("images", f);

  try {
    const res = await fetch("/api/images/upload", {
      method: "POST",
      body: fd,
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const receivedFiles = Array.isArray(data.files)
      ? data.files.filter((file) => file.kind === expectedKind)
      : [];

    if (receivedFiles.length === 0) {
      throw new Error(`Nenhum ${successMessagePrefix} valido foi recebido.`);
    }

    targetList.push(...receivedFiles);
    render();
    updatePreviewContent();
    saveSendDraft();
  } catch (err) {
    alert(`Erro ao enviar ${successMessagePrefix}: ` + err.message);
  }
}

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("File too large")) {
      throw new Error("Arquivo acima do limite permitido.");
    }
    throw new Error(`Resposta invalida do servidor (HTTP ${res.status}).`);
  }
}

function renderImagePreview() {
  const container = document.getElementById("imagePreview");
  container.innerHTML = "";
  uploadedImages.forEach((img, i) => {
    const div = document.createElement("div");
    div.className = "image-item";
    div.innerHTML = `
      <img src="${img.path}" alt="${img.name}" />
      <button class="btn-remove" onclick="removeImage(${i})" title="Remover"><i class="fas fa-times"></i></button>
      <input type="text" class="caption-input" placeholder="Legenda..." value="${img.caption || ""}"
        onchange="updateCaption(${i}, this.value)" />
    `;
    container.appendChild(div);
  });
}

function updateCaption(index, value) {
  uploadedImages[index].caption = value;
  saveSendDraft();
}

async function removeImage(index) {
  const img = uploadedImages[index];
  try { await authFetch(`/api/images/${img.id}`, { method: "DELETE" }); } catch { }
  uploadedImages.splice(index, 1);
  renderImagePreview();
  updatePreviewContent();
  saveSendDraft();
}

// ═══════════════════════════════════════════════════════════════
// IMPORTAÇÃO DE CONTATOS
// ═══════════════════════════════════════════════════════════════
function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById("fileName").textContent = file.name;

  if (file.name.endsWith(".csv")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSVText(e.target.result);
      processImportedData(rows);
    };
    reader.readAsText(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        processImportedData(rows);
      } catch (err) {
        alert("Erro: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }
}

async function importGoogleSheets() {
  const url = document.getElementById("sheetsUrl").value.trim();
  if (!url) return alert("Cole o link do Google Sheets.");
  const btn = event.target.closest("button");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';
  try {
    const res = await authFetch("/api/import/sheets", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!data.success) { alert("Erro: " + data.error); return; }
    processImportedData(data.data);
  } catch (err) {
    alert("Erro: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-link"></i> Importar';
  }
}

function importFromPaste() {
  const text = document.getElementById("pasteArea").value.trim();
  if (!text) return alert("Cole os dados no campo acima.");
  const rows = parseCSVText(text);
  processImportedData(rows);
}

function parseCSVText(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    // Tenta tab primeiro, depois vírgula, depois ponto-e-vírgula
    if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
    if (line.includes(";")) return line.split(";").map((c) => c.trim());
    // CSV com vírgula (respeitar aspas)
    const row = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { row.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    row.push(cur.trim());
    return row;
  });
}

function processImportedData(rows) {
  if (!rows || rows.length === 0) return alert("Nenhum dado encontrado.");

  // Detectar cabeçalho
  headers = [];
  let startIdx = 0;
  const firstRow = (rows[0] || []).map((c) => (c || "").toString().trim());
  const headerKeywords = ["nome", "name", "whatsapp", "telefone", "phone", "cel", "dados", "data", "endereco", "endereço"];
  if (firstRow.some((h) => headerKeywords.includes(h.toLowerCase()))) {
    headers = firstRow;
    startIdx = 1;
  } else {
    // Gera headers padrão
    headers = ["nome", "whatsapp"];
    for (let i = 2; i < (rows[0] || []).length; i++) headers.push(`col${i + 1}`);
  }

  // Normaliza headers
  headers = headers.map((h) => h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_àáãâéêíóôõúç]/gi, ""));
  if (headers.length < 2) {
    headers = ["nome", "whatsapp"];
  }

  // Mostra variáveis disponíveis
  const varsEl = document.getElementById("availableVars");
  const extraVars = headers.filter((h) => h !== "nome" && h !== "whatsapp");
  if (extraVars.length > 0) {
    varsEl.innerHTML = "<br>Extras disponíveis: " + extraVars.map((v) => `<code>{${v}}</code>`).join(", ");
  } else {
    varsEl.innerHTML = "";
  }

  // Parse contatos
  customers = [];
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c)) continue;
    const entry = { active: true };
    headers.forEach((h, idx) => {
      entry[h] = (row[idx] || "").toString().trim();
    });
    // Precisa ter pelo menos nome e whatsapp
    if (!entry[headers[0]] || !entry[headers[1]]) continue;
    // Mapeia para nome/whatsapp se headers são diferentes
    if (!entry.nome) entry.nome = entry[headers[0]];
    if (!entry.whatsapp) entry.whatsapp = entry[headers[1]];
    customers.push(entry);
  }

  renderContactsTable();
  checkDuplicates();
  checkSessionStatus();
  // Salva contatos no servidor para persistir
  saveCustomersToServer();
}

// ─── Persistência de contatos ────────────────────────
async function saveCustomersToServer() {
  try {
    await authFetch("/api/customers", {
      method: "POST",
      body: JSON.stringify({ headers, customers }),
    });
  } catch (err) {
    console.warn("Erro ao salvar contatos:", err.message);
  }
}

async function loadSavedCustomers() {
  try {
    const res = await authFetch("/api/customers");
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.customers && data.customers.length > 0) {
      headers = data.headers || [];
      customers = data.customers || [];
      renderContactsTable();
      checkDuplicates();
      checkSessionStatus();
      console.log(`📋 ${customers.length} contatos carregados do servidor`);
    }
  } catch (err) {
    console.warn("Erro ao carregar contatos:", err.message);
  }
}

function renderContactsTable() {
  const extraCols = headers.filter((h) => h !== "nome" && h !== "whatsapp");
  let html = '<table class="data-table"><thead><tr><th>#</th><th>Nome</th><th>WhatsApp</th>';
  extraCols.forEach((c) => (html += `<th>${c}</th>`));
  html += '<th>Ativo</th><th>Status</th></tr></thead><tbody>';

  customers.forEach((c, i) => {
    const extraTds = extraCols.map((col) => `<td class="dados-cell" title="${c[col] || ""}">${c[col] || ""}</td>`).join("");
    let statusBadge;
    if (c._validated === true) {
      statusBadge = '<span class="badge badge-valid">✅ Válido</span>';
    } else if (c._validated === false) {
      statusBadge = '<span class="badge badge-no-whatsapp">⚠ Sem WhatsApp</span>';
    } else if (c._status) {
      statusBadge = `<span class="badge badge-${c._status === 'ok' ? 'success' : c._status === 'error' ? 'error' : 'pending'}">${c._statusText || 'Pendente'}</span>`;
    } else {
      statusBadge = '<span class="badge badge-pending">Pendente</span>';
    }
    html += `<tr data-index="${i}" class="${c.active ? "" : "row-inactive"}">
      <td>${i + 1}</td>
      <td>${c.nome}</td>
      <td>${c.whatsapp}</td>
      ${extraTds}
      <td class="toggle-cell"><label class="toggle"><input type="checkbox" ${c.active ? "checked" : ""} onchange="toggleContact(${i})" /><span class="toggle-slider"></span></label></td>
      <td class="status-cell">${statusBadge}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  document.getElementById("contactsTable").innerHTML = html;
  document.getElementById("contactsInfo").style.display = customers.length > 0 ? "flex" : "none";
  updateContactCount();
}

// ═══════════════════════════════════════════════════════════════
// DUPLICADOS
// ═══════════════════════════════════════════════════════════════
function checkDuplicates() {
  const phones = {};
  let dupes = 0;
  customers.forEach((c) => {
    const num = c.whatsapp.replace(/\D/g, "");
    phones[num] = (phones[num] || 0) + 1;
    if (phones[num] === 2) dupes++; // conta cada duplicata uma vez
  });
  const el = document.getElementById("duplicateWarning");
  if (dupes > 0) {
    document.getElementById("duplicateCount").textContent = dupes;
    el.style.display = "flex";
  } else {
    el.style.display = "none";
  }
}

function removeDuplicates() {
  const seen = new Set();
  customers = customers.filter((c) => {
    const num = c.whatsapp.replace(/\D/g, "");
    if (seen.has(num)) return false;
    seen.add(num);
    return true;
  });
  renderContactsTable();
  checkDuplicates();
  saveCustomersToServer();
}

// ═══════════════════════════════════════════════════════════════
// VALIDAÇÃO DE WHATSAPP EM MASSA
// ═══════════════════════════════════════════════════════════════
async function validateWhatsAppNumbers() {
  if (customers.length === 0) return alert("Nenhum contato para validar.");

  const btn = document.getElementById("btnValidate");
  const progressEl = document.getElementById("validateProgress");
  const barFill = document.getElementById("validateBarFill");
  const statusEl = document.getElementById("validateStatus");

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validando...';
  progressEl.style.display = "flex";

  const phones = customers.map((c) => c.whatsapp);
  let validated = 0;
  let noWhatsApp = 0;

  // Validar em lotes de 10 para dar feedback em tempo real
  const batchSize = 10;
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);

    try {
      const res = await authFetch("/api/validate-numbers", {
        method: "POST",
        body: JSON.stringify({ phones: batch }),
      });
      const data = await res.json();

      if (!data.success) {
        alert("Erro: " + data.error);
        break;
      }

      // Atualizar status dos contatos
      data.results.forEach((result, batchIdx) => {
        const globalIdx = i + batchIdx;
        if (globalIdx < customers.length) {
          customers[globalIdx]._validated = result.registered;
          if (!result.registered) {
            customers[globalIdx].active = false;
            noWhatsApp++;
          }
        }
      });
    } catch (err) {
      console.error("Erro na validação:", err);
      // Marcar batch como não validado em caso de erro
      for (let j = i; j < Math.min(i + batchSize, customers.length); j++) {
        if (customers[j]._validated === undefined) {
          customers[j]._validated = undefined; // mantém como não validado
        }
      }
    }

    validated += batch.length;
    const pct = Math.min(100, Math.round((validated / phones.length) * 100));
    barFill.style.width = pct + "%";
    statusEl.textContent = `${validated}/${phones.length} verificados (${noWhatsApp} sem WhatsApp)`;

    // Atualizar tabela a cada lote
    renderContactsTable();
  }

  // Finalizar
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-search"></i> Validar WhatsApp';

  const withWA = customers.filter((c) => c._validated === true).length;
  statusEl.textContent = `✅ Concluído! ${withWA} com WhatsApp, ${noWhatsApp} sem WhatsApp`;

  // Salva estado da validação
  saveCustomersToServer();

  // Esconde a barra depois de 8 segundos
  setTimeout(() => {
    progressEl.style.display = "none";
    barFill.style.width = "0%";
  }, 8000);

  updateContactCount();
}

// ═══════════════════════════════════════════════════════════════
// TOGGLE CONTATOS
// ═══════════════════════════════════════════════════════════════
function toggleContact(index) {
  customers[index].active = !customers[index].active;
  const row = document.querySelector(`tr[data-index="${index}"]`);
  if (row) row.classList.toggle("row-inactive", !customers[index].active);
  updateContactCount();
  saveCustomersToServer();
}

function toggleAllContacts(checked) {
  customers.forEach((c, i) => {
    c.active = checked;
    const row = document.querySelector(`tr[data-index="${i}"]`);
    if (row) {
      row.classList.toggle("row-inactive", !checked);
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
    }
  });
  updateContactCount();
  saveCustomersToServer();
}

function updateContactCount() {
  const active = customers.filter((c) => c.active).length;
  document.getElementById("contactCount").textContent = `${active} de ${customers.length}`;
}

// ═══════════════════════════════════════════════════════════════
// ENVIAR MENSAGENS
// ═══════════════════════════════════════════════════════════════
async function sendMessages() {
  const activeCustomers = customers
    .map((c, i) => ({ ...c, _idx: i }))
    .filter((c) => c.active);
  if (activeCustomers.length === 0) return alert("Nenhum contato ativo.");

  const messageTemplate = document.getElementById("messageTemplate").value.trim();
  if (!messageTemplate) return alert("Escreva uma mensagem.");

  const intervalMin = parseInt(document.getElementById("intervalMin").value) * 1000;
  const intervalMax = parseInt(document.getElementById("intervalMax").value) * 1000;
  if (intervalMin > intervalMax) return alert("Intervalo mínimo > máximo.");

  const sendImage = document.getElementById("sendImageCheck").checked;
  if (sendImage && !hasUploadedMedia()) return alert("Nenhuma mídia carregada.");

  const dailyLimit = parseInt(document.getElementById("dailyLimit").value) || 0;
  const useSchedule = document.getElementById("scheduleCheck").checked;
  const scheduleStart = document.getElementById("scheduleStart").value;
  const scheduleEnd = document.getElementById("scheduleEnd").value;

  // Get interactive buttons/list data
  const interactiveData = getInteractiveData();
  const sendOrder = sendImage ? getSendOrder() : "text_first";

  if (!confirm(`Enviar para ${activeCustomers.length} contatos ativos?`)) return;

  // Reset UI
  jobStats = { sent: 0, failed: 0, total: activeCustomers.length };
  lastHistoryId = null;
  document.getElementById("logContainer").innerHTML = "";
  setSendingUiActive();
  updateProgressUI();

  document.querySelectorAll(".status-cell").forEach((cell) => {
    cell.innerHTML = '<span class="badge badge-pending">Pendente</span>';
  });

  try {
    const res = await authFetch("/api/send", {
      method: "POST",
      body: JSON.stringify({
        customers: activeCustomers,
        messageTemplate,
        images: uploadedImages,
        videos: uploadedVideos,
        documents: uploadedDocs,
        interactiveData,
        sendOrder,
        intervalMin,
        intervalMax,
        sendImage,
        dailyLimit,
        useSchedule,
        scheduleStart,
        scheduleEnd,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      alert("Erro: " + data.error);
      finishSending();
    }
  } catch (err) {
    alert("Erro: " + err.message);
    finishSending();
  }
}

async function cancelSend() {
  if (!confirm("Cancelar o envio?")) return;
  await authFetch("/api/send/cancel", { method: "POST" });
}

function finishSending() {
  document.getElementById("btnSend").style.display = "inline-flex";
  document.getElementById("btnSchedule").style.display = "inline-flex";
  document.getElementById("btnCancel").style.display = "none";
}

function updateProgressUI() {
  const done = jobStats.sent + jobStats.failed;
  const pct = jobStats.total > 0 ? Math.min(Math.round((done / jobStats.total) * 100), 100) : 0;
  const bar = document.getElementById("progressBar");
  bar.style.width = pct + "%";
  bar.textContent = pct + "%";
  document.getElementById("statSent").textContent = jobStats.sent;
  document.getElementById("statFailed").textContent = jobStats.failed;
  document.getElementById("statRemaining").textContent = Math.max(jobStats.total - done, 0);
}

function updateTableStatus(index, status, error) {
  if (typeof index === "number" && customers[index]) {
    customers[index]._status = status;
    customers[index]._statusText = status === "ok" ? "Enviado ✅" : "Erro ❌";
  }
  const row = document.querySelector(`tr[data-index="${index}"]`);
  if (!row) return;
  const cell = row.querySelector(".status-cell");
  if (status === "ok") {
    cell.innerHTML = '<span class="badge badge-success">Enviado ✅</span>';
  } else {
    cell.innerHTML = `<span class="badge badge-error" title="${error || ""}">Erro ❌</span>`;
  }
}

function exportCurrentResults() {
  if (lastHistoryId) {
    window.open(`/api/history/${lastHistoryId}/export?token=${authToken || ""}`, "_blank");
  } else {
    alert("Aguarde o envio finalizar para exportar.");
  }
}

// ═══════════════════════════════════════════════════════════════
// DAILY STATS
// ═══════════════════════════════════════════════════════════════
async function loadDailyStats() {
  try {
    const res = await authFetch("/api/daily-stats");
    const data = await res.json();
    document.getElementById("dailySentCount").textContent = data.sent || 0;
    document.getElementById("dailyLimit").value = data.limit || 200;
  } catch { }
}

function updateDailySent() {
  const el = document.getElementById("dailySentCount");
  el.textContent = parseInt(el.textContent || 0) + 1;
}

function updateDailySent() {
  const el = document.getElementById("dailySentCount");
  el.textContent = parseInt(el.textContent || 0) + 1;
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS / RELATÓRIOS
// ═══════════════════════════════════════════════════════════════
let chartTimeline = null;
let chartSuccessRate = null;
let chartHourly = null;
let analyticsData = null;
let currentChartView = "daily";

async function loadAnalytics() {
  const period = document.getElementById("analyticsPeriod")?.value || "30";
  try {
    const res = await authFetch(`/api/analytics?period=${period}`);
    const data = await res.json();
    if (!data.success) return;
    analyticsData = data;
    renderAnalyticsSummary(data.summary);
    renderTimelineChart(data);
    renderSuccessRateChart(data.summary);
    renderHourlyChart(data.hourly);
    renderRecentCampaigns(data.recentCampaigns);
  } catch (err) {
    console.error("Erro ao carregar analytics:", err);
  }
}

function renderAnalyticsSummary(summary) {
  document.getElementById("analyticsTotalSent").textContent = summary.totalSent.toLocaleString("pt-BR");
  document.getElementById("analyticsTotalFailed").textContent = summary.totalFailed.toLocaleString("pt-BR");
  document.getElementById("analyticsSuccessRate").textContent = summary.successRate + "%";
  document.getElementById("analyticsTotalCampaigns").textContent = summary.totalCampaigns;
  document.getElementById("analyticsAvgPerCampaign").textContent = summary.avgPerCampaign;
}

function renderTimelineChart(data) {
  const ctx = document.getElementById("chartTimeline");
  if (!ctx) return;

  if (chartTimeline) chartTimeline.destroy();

  let labels, sentData, failedData;

  if (currentChartView === "daily") {
    labels = data.daily.map((d) => {
      const dt = new Date(d.date + "T12:00:00");
      return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    });
    sentData = data.daily.map((d) => d.sent);
    failedData = data.daily.map((d) => d.failed);
  } else if (currentChartView === "weekly") {
    labels = data.weekly.map((w) => w.week);
    sentData = data.weekly.map((w) => w.sent);
    failedData = data.weekly.map((w) => w.failed);
  } else {
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    labels = data.monthly.map((m) => {
      const [y, mo] = m.month.split("-");
      return `${monthNames[parseInt(mo) - 1]}/${y.slice(2)}`;
    });
    sentData = data.monthly.map((m) => m.sent);
    failedData = data.monthly.map((m) => m.failed);
  }

  chartTimeline = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Enviadas",
          data: sentData,
          backgroundColor: "rgba(37, 211, 102, 0.7)",
          borderColor: "#25d366",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Falhas",
          data: failedData,
          backgroundColor: "rgba(239, 68, 68, 0.7)",
          borderColor: "#ef4444",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, padding: 15 } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const total = items.reduce((s, i) => s + i.raw, 0);
              return `Total: ${total}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderSuccessRateChart(summary) {
  const ctx = document.getElementById("chartSuccessRate");
  if (!ctx) return;

  if (chartSuccessRate) chartSuccessRate.destroy();

  chartSuccessRate = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Enviadas", "Falhas"],
      datasets: [
        {
          data: [summary.totalSent, summary.totalFailed],
          backgroundColor: ["rgba(37, 211, 102, 0.8)", "rgba(239, 68, 68, 0.8)"],
          borderColor: ["#25d366", "#ef4444"],
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, padding: 12 } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = item.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((item.raw / total) * 100) : 0;
              return ` ${item.label}: ${item.raw.toLocaleString("pt-BR")} (${pct}%)`;
            },
          },
        },
      },
    },
    plugins: [
      {
        id: "centerText",
        beforeDraw(chart) {
          const { ctx: c, width, height } = chart;
          c.save();
          c.font = "bold 1.6rem sans-serif";
          c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#333";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(summary.successRate + "%", width / 2, height / 2 - 5);
          c.font = "0.7rem sans-serif";
          c.fillStyle = "#999";
          c.fillText("sucesso", width / 2, height / 2 + 18);
          c.restore();
        },
      },
    ],
  });
}

function renderHourlyChart(hourly) {
  const ctx = document.getElementById("chartHourly");
  if (!ctx) return;

  if (chartHourly) chartHourly.destroy();

  chartHourly = new Chart(ctx, {
    type: "line",
    data: {
      labels: hourly.map((h) => h.hour),
      datasets: [
        {
          label: "Mensagens",
          data: hourly.map((h) => h.sent),
          fill: true,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderColor: "#3b82f6",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: "#3b82f6",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Horário: ${items[0].label}`,
            label: (item) => ` ${item.raw.toLocaleString("pt-BR")} mensagens`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 12, font: { size: 10 } },
        },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderRecentCampaigns(campaigns) {
  const el = document.getElementById("analyticsRecentCampaigns");
  if (!campaigns || campaigns.length === 0) {
    el.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i><br>Nenhuma campanha no período.</p>';
    return;
  }

  let html = `<table>
    <thead><tr>
      <th>Data</th>
      <th>Mensagem</th>
      <th>Total</th>
      <th>Enviadas</th>
      <th>Falhas</th>
      <th>Taxa</th>
      <th></th>
    </tr></thead>
    <tbody>`;

  campaigns.forEach((c) => {
    const dt = new Date(c.date);
    const dateStr = dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const rateClass = c.successRate >= 90 ? "rate-good" : c.successRate >= 70 ? "rate-ok" : "rate-bad";
    html += `<tr>
      <td>${dateStr}</td>
      <td class="campaign-preview" title="${(c.messagePreview || "").replace(/"/g, "&quot;")}">${c.messagePreview}</td>
      <td>${c.total}</td>
      <td>${c.sent}</td>
      <td>${c.failed}</td>
      <td><span class="rate-badge ${rateClass}">${c.successRate}%</span></td>
      <td><button class="btn-small btn-small-success" onclick="window.open('/api/history/${c.id}/export?token=${authToken}','_blank')" title="Exportar"><i class="fas fa-download"></i></button></td>
    </tr>`;
  });

  html += "</tbody></table>";
  el.innerHTML = html;
}

function setChartView(view, btn) {
  currentChartView = view;
  document.querySelectorAll(".chart-toggle").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  if (analyticsData) renderTimelineChart(analyticsData);
}

function toggleExportMenu() {
  const menu = document.getElementById("exportMenu");
  menu.style.display = menu.style.display === "none" ? "block" : "none";
}

function exportAnalytics(type) {
  document.getElementById("exportMenu").style.display = "none";
  if (type === "summary") {
    window.open(`/api/analytics/export?token=${authToken}`, "_blank");
  } else {
    window.open(`/api/analytics/export-detailed?token=${authToken}`, "_blank");
  }
}

// Fecha menu export ao clicar fora
document.addEventListener("click", (e) => {
  const menu = document.getElementById("exportMenu");
  const dropdown = e.target.closest(".export-dropdown");
  if (menu && !dropdown) menu.style.display = "none";
});

// ═══════════════════════════════════════════════════════════════
// HISTÓRICO
// ═══════════════════════════════════════════════════════════════
async function loadHistory() {
  try {
    const res = await authFetch("/api/history");
    const data = await res.json();
    const list = document.getElementById("historyList");

    if (!data.history || data.history.length === 0) {
      list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i><br>Nenhum envio registrado.</p>';
      return;
    }

    list.innerHTML = data.history
      .map(
        (h) => `
      <div class="history-card">
        <div class="history-header">
          <div>
            <strong>${new Date(h.date).toLocaleDateString("pt-BR")} ${new Date(h.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
            <p class="history-preview">${h.messagePreview || "—"}</p>
          </div>
          <div class="history-stats">
            <span class="badge badge-success">✅ ${h.sent}</span>
            <span class="badge badge-error">❌ ${h.failed}</span>
            <span class="badge">${h.total} total</span>
          </div>
        </div>
        <div class="history-actions">
          <button class="btn-small btn-small-success" onclick="window.open('/api/history/${h.id}/export?token=${authToken || ""}','_blank')">
            <i class="fas fa-download"></i> Exportar CSV
          </button>
        </div>
      </div>`
      )
      .join("");
  } catch (err) {
    console.error("Erro ao carregar histórico:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// AGENDAMENTOS
// ═══════════════════════════════════════════════════════════════
function openScheduleModal() {
  const activeCustomers = customers.filter((c) => c.active);
  if (activeCustomers.length === 0) return alert("Nenhum contato ativo.");
  const msg = document.getElementById("messageTemplate").value.trim();
  if (!msg) return alert("Escreva uma mensagem.");

  // Pre-fill datetime para próxima hora
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  document.getElementById("scheduleDateTime").value = now.toISOString().slice(0, 16);
  document.getElementById("scheduleName").value = "";
  document.getElementById("scheduleModal").style.display = "flex";
}

async function confirmSchedule() {
  const dt = document.getElementById("scheduleDateTime").value;
  if (!dt) return alert("Selecione data e hora.");
  if (new Date(dt) <= new Date()) return alert("A data deve ser no futuro.");

  const activeCustomers = customers.map((c, i) => ({ ...c, _idx: i })).filter((c) => c.active);
  const interactiveData = getInteractiveData();
  const sendImage = document.getElementById("sendImageCheck").checked;
  if (sendImage && !hasUploadedMedia()) return alert("Nenhuma mídia carregada.");

  try {
    const res = await authFetch("/api/schedules", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("scheduleName").value || undefined,
        scheduledAt: new Date(dt).toISOString(),
        customers: activeCustomers,
        messageTemplate: document.getElementById("messageTemplate").value,
        images: uploadedImages,
        videos: uploadedVideos,
        documents: uploadedDocs,
        interactiveData,
        sendOrder: sendImage ? getSendOrder() : "text_first",
        sendImage,
        intervalMin: parseInt(document.getElementById("intervalMin").value) * 1000,
        intervalMax: parseInt(document.getElementById("intervalMax").value) * 1000,
      }),
    });
    const data = await res.json();
    if (data.success) {
      closeModal("scheduleModal");
      alert("Agendamento criado! Veja a aba 'Agendamentos'.");
      loadSchedules();
    } else {
      alert("Erro: " + data.error);
    }
  } catch (err) {
    alert("Erro: " + err.message);
  }
}

async function loadSchedules() {
  try {
    const res = await authFetch("/api/schedules");
    const data = await res.json();
    const list = document.getElementById("schedulesList");

    if (!data.schedules || data.schedules.length === 0) {
      list.innerHTML = '<p class="empty-state"><i class="fas fa-calendar-times"></i><br>Nenhum agendamento.</p>';
      return;
    }

    list.innerHTML = data.schedules
      .map((s) => {
        const dt = new Date(s.scheduledAt);
        const statusBadge =
          s.status === "completed"
            ? '<span class="badge badge-success">Concluído</span>'
            : s.status === "running"
              ? '<span class="badge badge-warning">Executando</span>'
              : '<span class="badge badge-pending">Pendente</span>';
        return `
        <div class="schedule-card">
          <div class="schedule-header">
            <div>
              <strong>${s.name}</strong>
              <p class="hint">${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} — ${s.customers?.length || 0} contatos</p>
            </div>
            ${statusBadge}
          </div>
          ${s.status === "pending" ? `<button class="btn-small btn-small-danger" onclick="deleteSchedule('${s.id}')"><i class="fas fa-trash"></i> Excluir</button>` : ""}
        </div>`;
      })
      .join("");
  } catch (err) {
    console.error("Erro ao carregar agendamentos:", err);
  }
}

async function deleteSchedule(id) {
  if (!confirm("Excluir este agendamento?")) return;
  await authFetch(`/api/schedules/${id}`, { method: "DELETE" });
  loadSchedules();
}

// ═══════════════════════════════════════════════════════════════
// MODAIS
// ═══════════════════════════════════════════════════════════════
function closeModal(id) {
  document.getElementById(id).style.display = "none";
}
