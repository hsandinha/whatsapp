/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL — JavaScript v5.0
   ═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = "https://piigfztyhymxrcrpavwq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTkzNzQsImV4cCI6MjA4ODU3NTM3NH0.-nxRKReeM8blNKqw5kIEIHqolxRdOx800zwsmREOq4Y";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let authToken = null;
let allUsers = [];
let currentUserId = null; // para o modal

// ═══════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
async function init() {
    // Verificar sessão
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = "/";
        return;
    }
    authToken = session.access_token;

    // Verificar se é admin
    try {
        const resp = await authFetch("/api/admin/check");
        const data = await resp.json();
        if (!data.isAdmin) {
            showAccessDenied();
            return;
        }
    } catch (err) {
        showAccessDenied();
        return;
    }

    // Buscar nome do admin
    try {
        const resp = await authFetch("/api/profile");
        const data = await resp.json();
        if (data.success && data.profile) {
            document.getElementById("adminName").textContent = data.profile.name || data.profile.email;
        }
    } catch (e) { }

    // Mostrar painel
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("adminPanel").style.display = "flex";

    // Carregar dados
    await Promise.all([loadStats(), loadUsers()]);
}

function showAccessDenied() {
    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("accessDenied").style.display = "flex";
}

// ═══════════════════════════════════════════════════════════════
// AUTH FETCH
// ═══════════════════════════════════════════════════════════════
async function authFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...(options.headers || {}),
        },
    });
}

// ═══════════════════════════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════════════════════════
function switchSection(section) {
    // Nav items
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add("active");

    // Sections
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    document.getElementById(`section-${section}`)?.classList.add("active");

    // Title
    const titles = { overview: "Visão Geral", users: "Usuários" };
    document.getElementById("sectionTitle").textContent = titles[section] || section;
}

function toggleSidebar() {
    document.querySelector(".sidebar").classList.toggle("open");
}

// ═══════════════════════════════════════════════════════════════
// CARREGAR ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════
async function loadStats() {
    try {
        const resp = await authFetch("/api/admin/stats");
        const data = await resp.json();
        if (!data.success) return;

        const s = data.stats;
        document.getElementById("statTotalUsers").textContent = formatNumber(s.totalUsers);
        document.getElementById("statRecentUsers").textContent = formatNumber(s.recentUsers);
        document.getElementById("statTotalMessages").textContent = formatNumber(s.totalMessages);
        document.getElementById("statTodayMessages").textContent = formatNumber(s.todayMessages);
        document.getElementById("statTotalCampaigns").textContent = formatNumber(s.totalCampaigns);

        // Plan chart
        renderBarChart("planChart", s.planCounts, "plan");

        // Status chart
        renderBarChart("statusChart", s.statusCounts, "status");
    } catch (err) {
        console.error("Erro ao carregar stats:", err);
    }
}

function renderBarChart(containerId, counts, prefix) {
    const el = document.getElementById(containerId);
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const items = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (items.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Sem dados</span>';
        return;
    }

    el.innerHTML = items.map(([key, count]) => `
    <div class="chart-bar-item">
      <span class="chart-bar-label">${key}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill ${prefix}-${key}" style="width:${Math.max(2, (count / total) * 100)}%"></div>
      </div>
      <span class="chart-bar-count">${count}</span>
    </div>
  `).join("");
}

// ═══════════════════════════════════════════════════════════════
// CARREGAR USUÁRIOS
// ═══════════════════════════════════════════════════════════════
async function loadUsers() {
    try {
        const resp = await authFetch("/api/admin/users");
        const data = await resp.json();
        if (!data.success) return;

        allUsers = data.users;
        renderUsers(allUsers);
        renderRecentUsers(allUsers.slice(0, 5));
    } catch (err) {
        console.error("Erro ao carregar usuários:", err);
    }
}

function renderUsers(users) {
    const tbody = document.getElementById("usersTableBody");
    document.getElementById("usersCountText").textContent = `${users.length} usuário${users.length !== 1 ? "s" : ""}`;

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">Nenhum usuário encontrado</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(u => {
        const initials = getInitials(u.name || u.email);
        const plan = u.plan || "free";
        const status = u.status || "active";
        const lastLogin = u.auth?.last_sign_in_at ? formatDate(u.auth.last_sign_in_at) : "—";
        const createdAt = formatDate(u.created_at);
        const sent = u.history_stats?.sent || 0;
        const campaigns = u.history_stats?.campaigns || 0;

        return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar">${initials}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">
                ${escapeHtml(u.name || "Sem nome")}
                ${u.is_admin ? '<span class="badge badge-admin" style="margin-left:4px;font-size:9px">Admin</span>' : ""}
              </span>
              <span class="user-cell-email">${escapeHtml(u.email)}</span>
            </div>
          </div>
        </td>
        <td><span class="badge badge-${plan}">${plan}</span></td>
        <td><span class="badge badge-${status}">${status}</span></td>
        <td>${formatNumber(sent)}</td>
        <td>${campaigns}</td>
        <td>${lastLogin}</td>
        <td>${createdAt}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon btn-view" title="Ver detalhes" onclick="openUserModal('${u.id}')">👁️</button>
            <button class="btn-icon btn-delete" title="Deletar" onclick="confirmDelete('${u.id}', '${escapeHtml(u.name || u.email)}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
    }).join("");
}

function renderRecentUsers(users) {
    const el = document.getElementById("recentUsersList");
    if (users.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Nenhum usuário</span>';
        return;
    }

    el.innerHTML = users.map(u => `
    <div class="recent-user" onclick="openUserModal('${u.id}')">
      <div class="recent-user-info">
        <div class="user-avatar">${getInitials(u.name || u.email)}</div>
        <div class="recent-user-details">
          <span class="recent-user-name">${escapeHtml(u.name || "Sem nome")}</span>
          <span class="recent-user-email">${escapeHtml(u.email)}</span>
        </div>
      </div>
      <span class="recent-user-date">${formatDate(u.created_at)}</span>
    </div>
  `).join("");
}

// ═══════════════════════════════════════════════════════════════
// FILTROS
// ═══════════════════════════════════════════════════════════════
function filterUsers() {
    const search = document.getElementById("searchInput").value.toLowerCase().trim();
    const plan = document.getElementById("filterPlan").value;
    const status = document.getElementById("filterStatus").value;

    let filtered = allUsers;

    if (search) {
        filtered = filtered.filter(u =>
            (u.name || "").toLowerCase().includes(search) ||
            (u.email || "").toLowerCase().includes(search)
        );
    }

    if (plan) {
        filtered = filtered.filter(u => (u.plan || "free") === plan);
    }

    if (status) {
        filtered = filtered.filter(u => (u.status || "active") === status);
    }

    renderUsers(filtered);
}

// ═══════════════════════════════════════════════════════════════
// MODAL DE DETALHES DO USUÁRIO
// ═══════════════════════════════════════════════════════════════
async function openUserModal(userId) {
    currentUserId = userId;
    document.getElementById("userModal").style.display = "flex";

    // Reset
    document.getElementById("modalUserName").textContent = "Carregando...";
    document.getElementById("detailDailyStats").innerHTML = "";
    document.getElementById("detailHistory").innerHTML = '<span style="color:var(--text-muted)">Carregando...</span>';

    try {
        const resp = await authFetch(`/api/admin/users/${userId}`);
        const data = await resp.json();
        if (!data.success) {
            showToast("Erro ao carregar usuário", "error");
            return;
        }

        const u = data.user;

        // Header
        document.getElementById("modalUserName").textContent = u.name || u.email || "Sem nome";

        // Profile info
        document.getElementById("detailId").textContent = u.id;
        document.getElementById("detailEmail").textContent = u.email;
        document.getElementById("detailName").textContent = u.name || "—";
        document.getElementById("detailProvider").textContent = u.auth?.provider || "email";
        document.getElementById("detailEmailConfirmed").textContent = u.auth?.email_confirmed_at ? formatDateTime(u.auth.email_confirmed_at) : "Não confirmado";
        document.getElementById("detailLastLogin").textContent = u.auth?.last_sign_in_at ? formatDateTime(u.auth.last_sign_in_at) : "—";
        document.getElementById("detailCreatedAt").textContent = formatDateTime(u.created_at);

        // Edit fields
        document.getElementById("editPlan").value = u.plan || "free";
        document.getElementById("editStatus").value = u.status || "active";
        document.getElementById("editDailyLimit").value = u.daily_limit || 50;
        document.getElementById("editIsAdmin").value = u.is_admin ? "true" : "false";

        // Usage stats
        let totalSent = 0, totalFailed = 0;
        (u.history || []).forEach(h => {
            totalSent += h.sent || 0;
            totalFailed += h.failed || 0;
        });
        document.getElementById("detailTotalMsgs").textContent = formatNumber(totalSent + totalFailed);
        document.getElementById("detailSentMsgs").textContent = formatNumber(totalSent);
        document.getElementById("detailFailedMsgs").textContent = formatNumber(totalFailed);
        document.getElementById("detailCampaigns").textContent = (u.history || []).length;
        document.getElementById("detailTemplates").textContent = (u.templates || []).length;
        document.getElementById("detailSchedules").textContent = (u.schedules || []).length;

        // Daily stats chart
        renderDailyStats(u.daily_stats || []);

        // History
        renderDetailHistory(u.history || []);

        // Show/hide delete button based on self
        const { data: { session } } = await sb.auth.getSession();
        const myId = session?.user?.id;
        document.getElementById("btnDeleteUser").style.display = userId === myId ? "none" : "inline-flex";

    } catch (err) {
        console.error("Erro ao abrir modal:", err);
        showToast("Erro ao carregar detalhes", "error");
    }
}

function closeUserModal() {
    document.getElementById("userModal").style.display = "none";
    currentUserId = null;
}

function renderDailyStats(stats) {
    const el = document.getElementById("detailDailyStats");
    if (stats.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Sem dados</span>';
        return;
    }

    const maxSent = Math.max(...stats.map(s => s.sent || 0), 1);
    el.innerHTML = stats.reverse().map(s => {
        const h = Math.max(4, ((s.sent || 0) / maxSent) * 60);
        return `<div class="daily-bar" style="height:${h}px" title="${s.date}: ${s.sent} msgs"></div>`;
    }).join("");
}

function renderDetailHistory(history) {
    const el = document.getElementById("detailHistory");
    if (history.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Nenhuma campanha</span>';
        return;
    }

    el.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="history-item-msg">${escapeHtml(h.message_preview || "—")}</span>
      <div class="history-item-stats">
        <span class="s">✓ ${h.sent || 0}</span>
        <span class="f">✗ ${h.failed || 0}</span>
        <span class="d">${formatDate(h.created_at)}</span>
      </div>
    </div>
  `).join("");
}

// ═══════════════════════════════════════════════════════════════
// SALVAR ALTERAÇÕES DO USUÁRIO
// ═══════════════════════════════════════════════════════════════
async function saveUserChanges() {
    if (!currentUserId) return;

    const body = {
        plan: document.getElementById("editPlan").value,
        status: document.getElementById("editStatus").value,
        daily_limit: parseInt(document.getElementById("editDailyLimit").value),
        is_admin: document.getElementById("editIsAdmin").value === "true",
    };

    try {
        const resp = await authFetch(`/api/admin/users/${currentUserId}`, {
            method: "PUT",
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (data.success) {
            showToast("Alterações salvas com sucesso!", "success");
            await loadUsers(); // Recarregar lista
        } else {
            showToast(data.error || "Erro ao salvar", "error");
        }
    } catch (err) {
        showToast("Erro ao salvar alterações", "error");
    }
}

// ═══════════════════════════════════════════════════════════════
// DELETAR USUÁRIO
// ═══════════════════════════════════════════════════════════════
function confirmDelete(userId, userName) {
    if (!confirm(`⚠️ Tem certeza que deseja deletar o usuário "${userName}"?\n\nEsta ação é IRREVERSÍVEL. Todos os dados serão apagados.`)) return;
    currentUserId = userId;
    deleteUser();
}

async function deleteUser() {
    if (!currentUserId) return;

    if (!confirm("⚠️ ÚLTIMA CONFIRMAÇÃO: Deletar este usuário permanentemente?")) return;

    try {
        const resp = await authFetch(`/api/admin/users/${currentUserId}`, {
            method: "DELETE",
        });
        const data = await resp.json();
        if (data.success) {
            showToast("Usuário deletado com sucesso", "success");
            closeUserModal();
            await Promise.all([loadUsers(), loadStats()]);
        } else {
            showToast(data.error || "Erro ao deletar", "error");
        }
    } catch (err) {
        showToast("Erro ao deletar usuário", "error");
    }
}

// ═══════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════
async function doLogout() {
    await sb.auth.signOut();
    window.location.href = "/";
}

// ═══════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════
function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatDateTime(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
    });
}

function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show " + type;
    setTimeout(() => el.className = "toast", 3000);
}

// Fechar sidebar em mobile ao clicar fora
document.addEventListener("click", (e) => {
    const sidebar = document.querySelector(".sidebar");
    const btn = document.querySelector(".mobile-menu-btn");
    if (sidebar?.classList.contains("open") && !sidebar.contains(e.target) && !btn?.contains(e.target)) {
        sidebar.classList.remove("open");
    }
});

// Fechar modal com Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeUserModal();
});

// Iniciar
init();
