// ═══════════════════════════════════════════════════════════════
// WhatsApp Sender Pro v5.0 — Multi-User SaaS
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");

// ═══════════════════════════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://piigfztyhymxrcrpavwq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTkzNzQsImV4cCI6MjA4ODU3NTM3NH0.-nxRKReeM8blNKqw5kIEIHqolxRdOx800zwsmREOq4Y";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaWdmenR5aHlteHJjcnBhdndxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk5OTM3NCwiZXhwIjoyMDg4NTc1Mzc0fQ.v5YY3v06aG9D7ggowdccqhg_fnYFerZ9vR53V1rr6so";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Emails que são admin mesmo sem tabela profiles (fallback)
const ADMIN_EMAILS = ["hebertsandinha@gmail.com"];

// Helper: verifica se usuário é admin (DB + fallback)
async function isAdmin(userId, userEmail) {
  // Fallback: email na lista hardcoded
  if (userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase())) return true;
  // Tenta verificar no banco
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single();
    if (profile?.is_admin === true) return true;
  } catch { }
  return false;
}

const app = express();
const port = 3001;

// ═══════════════════════════════════════════════════════════════
// DATABASE (JSON files em /data/<userId>)
// ═══════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Retorna um objeto db com escopo por userId
function userDb(userId) {
  const userDir = path.join(DATA_DIR, userId);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  return {
    _path(file) {
      return path.join(userDir, file);
    },
    _load(file, fallback) {
      const p = this._path(file);
      if (!fs.existsSync(p)) return typeof fallback === "function" ? fallback() : JSON.parse(JSON.stringify(fallback));
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        return typeof fallback === "function" ? fallback() : JSON.parse(JSON.stringify(fallback));
      }
    },
    _save(file, data) {
      fs.writeFileSync(this._path(file), JSON.stringify(data, null, 2));
    },

    // ─── Config ─────────────────────────────────────
    getConfig() {
      return this._load("config.json", {
        password: null,
        dailyLimit: 200,
        sentToday: 0,
        lastReset: new Date().toISOString().split("T")[0],
      });
    },
    saveConfig(c) {
      this._save("config.json", c);
    },

    // ─── Contatos importados ────────────────────────
    getCustomers() {
      return this._load("customers.json", { headers: [], customers: [] });
    },
    saveCustomers(data) {
      this._save("customers.json", data);
    },

    // ─── Templates ──────────────────────────────────
    getTemplates() {
      return this._load("templates.json", []);
    },
    saveTemplate(tpl) {
      const list = this.getTemplates();
      tpl.id = tpl.id || uuidv4();
      tpl.createdAt = tpl.createdAt || new Date().toISOString();
      const idx = list.findIndex((t) => t.id === tpl.id);
      if (idx >= 0) list[idx] = tpl;
      else list.push(tpl);
      this._save("templates.json", list);
      return tpl;
    },
    deleteTemplate(id) {
      this._save(
        "templates.json",
        this.getTemplates().filter((t) => t.id !== id)
      );
    },

    // ─── Histórico ──────────────────────────────────
    getHistory() {
      return this._load("history.json", []);
    },
    saveHistory(entry) {
      const list = this.getHistory();
      entry.id = entry.id || uuidv4();
      entry.date = entry.date || new Date().toISOString();
      list.unshift(entry);
      if (list.length > 200) list.length = 200;
      this._save("history.json", list);
      return entry;
    },

    // ─── Agendamentos ──────────────────────────────
    getSchedules() {
      return this._load("schedules.json", []);
    },
    saveSchedule(s) {
      const list = this.getSchedules();
      s.id = s.id || uuidv4();
      s.createdAt = s.createdAt || new Date().toISOString();
      s.status = s.status || "pending";
      const idx = list.findIndex((x) => x.id === s.id);
      if (idx >= 0) list[idx] = s;
      else list.push(s);
      this._save("schedules.json", list);
      return s;
    },
    deleteSchedule(id) {
      this._save(
        "schedules.json",
        this.getSchedules().filter((s) => s.id !== id)
      );
    },

    // ─── Fila (crash recovery) ─────────────────────
    getQueue() {
      return this._load("queue.json", null);
    },
    saveQueue(q) {
      this._save("queue.json", q);
    },
    clearQueue() {
      const p = this._path("queue.json");
      if (fs.existsSync(p)) fs.unlinkSync(p);
    },

    // ─── Stats diários ─────────────────────────────
    getDailyStats() {
      const config = this.getConfig();
      const today = new Date().toISOString().split("T")[0];
      if (config.lastReset !== today) {
        config.sentToday = 0;
        config.lastReset = today;
        this.saveConfig(config);
      }
      return { date: today, sent: config.sentToday, limit: config.dailyLimit };
    },
    incrementDaily() {
      const config = this.getConfig();
      const today = new Date().toISOString().split("T")[0];
      if (config.lastReset !== today) {
        config.sentToday = 0;
        config.lastReset = today;
      }
      config.sentToday++;
      this.saveConfig(config);
      return config.sentToday;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// ESTADO PER-USER (Multi-sessão WhatsApp)
// ═══════════════════════════════════════════════════════════════
const sessions = new Map(); // userId → { client, isReady, currentQR, currentJob, connectionState }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      client: null,
      isReady: false,
      currentQR: null,
      currentJob: null,
      connectionState: "disconnected",
      phoneNumber: null,
    });
  }
  return sessions.get(userId);
}

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// ─── Supabase Auth Middleware ─────────────────────
async function supabaseAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  if (!token) return res.status(401).json({ error: "Token não fornecido" });

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Token inválido" });
    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    res.status(401).json({ error: "Erro ao validar token" });
  }
}

// ─── Routing: Landing page vs App ─────────────────
// / → landing page (login.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// /app → dashboard (index.html) — servido como arquivo estático
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// /admin → admin panel
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Static files
app.use(express.static("public"));

// Protege todas as rotas /api com Supabase auth
app.use("/api", supabaseAuth);

// ─── Admin check (ANTES do middleware, acessível a todos autenticados) ─────
app.get("/api/check-admin", async (req, res) => {
  try {
    const admin = await isAdmin(req.userId, req.user?.email);
    res.json({ isAdmin: admin });
  } catch (err) {
    res.json({ isAdmin: false });
  }
});

// ─── Admin Middleware ─────────────────────
async function adminMiddleware(req, res, next) {
  try {
    const admin = await isAdmin(req.userId, req.user?.email);
    if (!admin) {
      return res.status(403).json({ error: "Acesso negado. Apenas administradores." });
    }
    next();
  } catch (err) {
    res.status(403).json({ error: "Erro ao verificar permissão de admin" });
  }
}

// Protege todas as rotas /api/admin com adminMiddleware
app.use("/api/admin", adminMiddleware);

// ═══════════════════════════════════════════════════════════════
// MULTER
// ═══════════════════════════════════════════════════════════════
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|mp4|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip/.test(
      path.extname(file.originalname).toLowerCase()
    );
    cb(null, ok);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ═══════════════════════════════════════════════════════════════
// SSE (Server-Sent Events) — Per-user
// ═══════════════════════════════════════════════════════════════
const sseClients = new Map(); // userId → Set<res>

app.get("/events", async (req, res) => {
  // Valida token Supabase via query param
  const token = req.query.token;
  let userId = null;
  if (token) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: "Token inválido" });
      userId = user.id;
    } catch {
      return res.status(401).json({ error: "Erro ao validar" });
    }
  }
  if (!userId) return res.status(401).json({ error: "Token obrigatório" });

  // Desabilita timeouts para manter a conexão SSE viva indefinidamente
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Desabilita buffering do Nagle para envio imediato
  if (req.socket) req.socket.setNoDelay(true);

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  // Heartbeat a cada 25s para manter a conexão viva
  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25000);

  // Envia estado atual da sessão do usuário
  const sess = getSession(userId);
  res.write(
    `event: session\ndata: ${JSON.stringify({ status: sess.connectionState, qr: sess.currentQR })}\n\n`
  );
  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(userId);
    }
  });
});

function broadcast(userId, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const clients = sseClients.get(userId);
  if (clients) for (const c of clients) c.write(msg);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomInterval = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function formatPhone(phone) {
  let num = phone.replace(/\D/g, "");
  if (!num.startsWith("55")) num = "55" + num;
  return num + "@c.us";
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const go = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return go(res.headers.location);
          }
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode}. Planilha precisa estar compartilhada.`));
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(d));
        })
        .on("error", reject);
    };
    go(url);
  });
}

function parseCSV(text) {
  const lines = text.split("\n");
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let cur = "",
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        row.push(cur.trim());
        cur = "";
      } else if (ch !== "\r") {
        cur += ch;
      }
    }
    row.push(cur.trim());
    result.push(row);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP CLIENT — Per-user
// ═══════════════════════════════════════════════════════════════
async function initializeClient(userId) {
  const sess = getSession(userId);

  if (sess.client) {
    try { await sess.client.destroy(); } catch (e) {
      console.warn(`[INIT] Erro ao destruir client anterior (${userId}):`, e.message);
    }
    sess.client = null;
    // Espera liberação do lock do browser
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Mata processos Chromium zumbis que usam a sessão deste usuário
  const sessionDir = path.join(__dirname, ".wwebjs_auth", `session-${userId}`);
  try {
    const { execSync } = require("child_process");
    if (process.platform === "win32") {
      // Windows: mata processos chrome que referenciam esta sessão
      execSync(`taskkill /F /FI "IMAGENAME eq chrome.exe" /FI "WINDOWTITLE eq *${userId}*" 2>nul & exit /b 0`, { timeout: 5000, shell: true });
    } else {
      // Linux/Mac
      execSync(`lsof -ti "${sessionDir}" 2>/dev/null | xargs kill -9 2>/dev/null || true`, { timeout: 5000 });
      execSync(`pkill -9 -f "session-${userId}" 2>/dev/null || true`, { timeout: 5000 });
    }
  } catch { }

  // Remove TODOS os lock files do Chromium (SingletonLock, SingletonSocket, SingletonCookie)
  const defaultDir = path.join(sessionDir, "Default");
  for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const lockFile = path.join(defaultDir, lockName);
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); console.log(`[INIT] Removido ${lockName} (${userId})`); } catch { }
    }
  }

  // Espera extra para garantir que processos morreram
  await new Promise((r) => setTimeout(r, 1000));

  sess.connectionState = "connecting";
  broadcast(userId, "session", { status: "connecting" });

  sess.client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: path.join(__dirname, ".wwebjs_auth"),
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/nicokant/nicokant.github.io/refs/heads/main/AltWWebVersions/",
    },
  });

  sess.client.on("qr", async (qr) => {
    sess.connectionState = "qr";
    try { sess.currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 }); } catch { sess.currentQR = null; }
    broadcast(userId, "session", { status: "qr", qr: sess.currentQR });
  });

  sess.client.on("loading_screen", (percent, message) => {
    broadcast(userId, "session", { status: "loading", percent, message });
  });

  sess.client.on("authenticated", () => {
    sess.connectionState = "connecting";
    sess.currentQR = null;
    broadcast(userId, "session", { status: "authenticated" });
  });

  sess.client.on("auth_failure", (msg) => {
    sess.connectionState = "disconnected";
    sess.isReady = false;
    sess.currentQR = null;
    broadcast(userId, "session", { status: "auth_failure", error: msg });
  });

  sess.client.on("ready", () => {
    console.log(`✅ WhatsApp pronto para usuário ${userId}`);
    sess.connectionState = "connected";
    sess.isReady = true;
    sess.currentQR = null;
    // Captura o número de telefone conectado
    try {
      const wid = sess.client.info && sess.client.info.wid;
      sess.phoneNumber = wid ? wid.user : null;
    } catch { sess.phoneNumber = null; }
    console.log(`📱 Número conectado: ${sess.phoneNumber}`);
    broadcast(userId, "session", { status: "connected", phoneNumber: sess.phoneNumber });
    // Tenta retomar fila pendente do usuário
    resumePendingQueue(userId);
  });

  sess.client.on("disconnected", (reason) => {
    sess.connectionState = "disconnected";
    sess.isReady = false;
    sess.currentQR = null;
    sess.phoneNumber = null;
    broadcast(userId, "session", { status: "disconnected", reason });
  });

  sess.client.initialize().catch((err) => {
    console.error(`Erro ao inicializar (${userId}):`, err);
    sess.connectionState = "disconnected";
    sess.isReady = false;
    broadcast(userId, "session", { status: "error", error: err.message });
  });
}

// ═══════════════════════════════════════════════════════════════
// ROTAS — PERFIL DO USUÁRIO
// ═══════════════════════════════════════════════════════════════
app.get("/api/profile", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", req.userId)
      .single();
    if (error) {
      console.warn(`[PROFILE] Supabase error (tabela pode não existir):`, error.message);
      // Fallback: retorna dados básicos do auth
      return res.json({
        success: true,
        profile: {
          id: req.userId,
          email: req.user?.email || "",
          name: req.user?.user_metadata?.name || req.user?.email?.split("@")[0] || "Usuário",
          plan: "free",
          daily_limit: 200,
          is_admin: ADMIN_EMAILS.includes((req.user?.email || "").toLowerCase()),
          status: "active"
        }
      });
    }
    res.json({ success: true, profile: data });
  } catch (err) {
    console.error(`[PROFILE] Erro:`, err.message);
    res.json({
      success: true,
      profile: {
        id: req.userId,
        email: req.user?.email || "",
        name: req.user?.user_metadata?.name || "Usuário",
        plan: "free",
        daily_limit: 200,
        is_admin: ADMIN_EMAILS.includes((req.user?.email || "").toLowerCase()),
        status: "active"
      }
    });
  }
});

app.put("/api/profile", async (req, res) => {
  const { name } = req.body;
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", req.userId);
    if (error) {
      console.warn("[PROFILE PUT] Erro:", error.message);
      return res.json({ success: true }); // Falha silenciosa se tabela não existe
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: true }); // Falha silenciosa
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — ADMIN PANEL
// ═══════════════════════════════════════════════════════════════

// Verificar se usuário é admin (rota legada, redireciona para /api/check-admin)
app.get("/api/admin/check", async (req, res) => {
  // Esta rota passa pelo adminMiddleware, então só admins chegam aqui
  res.json({ isAdmin: true });
});

// Listar todos os usuários
app.get("/api/admin/users", async (req, res) => {
  try {
    // Buscar dados de auth (sempre funciona)
    const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
    const authMap = {};
    if (authUsers) {
      authUsers.forEach(u => {
        authMap[u.id] = {
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          created_at_auth: u.created_at,
          provider: u.app_metadata?.provider || "email",
        };
      });
    }

    // Tentar buscar profiles (pode não existir)
    let profilesMap = {};
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (profiles) {
      profiles.forEach(p => { profilesMap[p.id] = p; });
    }

    // Tentar buscar stats e history (podem não existir)
    const statsMap = {};
    const historyMap = {};
    try {
      const { data: stats } = await supabaseAdmin.from("daily_stats").select("user_id, sent");
      if (stats) stats.forEach(s => {
        if (!statsMap[s.user_id]) statsMap[s.user_id] = 0;
        statsMap[s.user_id] += s.sent;
      });
    } catch { }
    try {
      const { data: historyData } = await supabaseAdmin.from("history").select("user_id, sent, failed");
      if (historyData) historyData.forEach(h => {
        if (!historyMap[h.user_id]) historyMap[h.user_id] = { sent: 0, failed: 0, campaigns: 0 };
        historyMap[h.user_id].sent += h.sent || 0;
        historyMap[h.user_id].failed += h.failed || 0;
        historyMap[h.user_id].campaigns += 1;
      });
    } catch { }

    // Montar lista de usuários (auth como base, enriquecido com profiles)
    const enriched = (authUsers || []).map(u => {
      const profile = profilesMap[u.id] || {
        id: u.id,
        email: u.email,
        name: u.user_metadata?.name || u.email?.split("@")[0] || "Usuário",
        plan: "free",
        daily_limit: 200,
        is_admin: ADMIN_EMAILS.includes((u.email || "").toLowerCase()),
        status: "active",
        created_at: u.created_at,
        updated_at: u.created_at,
      };
      return {
        ...profile,
        auth: authMap[u.id] || {},
        total_messages: statsMap[u.id] || 0,
        history_stats: historyMap[u.id] || { sent: 0, failed: 0, campaigns: 0 },
      };
    });

    res.json({ success: true, users: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalhes de um usuário específico
app.get("/api/admin/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // Auth data (sempre funciona)
    const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!authUser) return res.status(404).json({ error: "Usuário não encontrado" });

    // Profile (pode não existir)
    let profile;
    try {
      const { data } = await supabaseAdmin.from("profiles").select("*").eq("id", userId).single();
      profile = data;
    } catch { }
    if (!profile) {
      profile = {
        id: userId,
        email: authUser.email,
        name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Usuário",
        plan: "free",
        daily_limit: 200,
        is_admin: ADMIN_EMAILS.includes((authUser.email || "").toLowerCase()),
        status: "active",
        created_at: authUser.created_at,
      };
    }

    // Templates, History, Schedules, Daily Stats (podem não existir)
    let templates = [], history = [], schedules = [], dailyStats = [];
    try { const { data } = await supabaseAdmin.from("templates").select("*").eq("user_id", userId); if (data) templates = data; } catch { }
    try { const { data } = await supabaseAdmin.from("history").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20); if (data) history = data; } catch { }
    try { const { data } = await supabaseAdmin.from("schedules").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10); if (data) schedules = data; } catch { }
    try { const { data } = await supabaseAdmin.from("daily_stats").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(30); if (data) dailyStats = data; } catch { }

    res.json({
      success: true,
      user: {
        ...profile,
        auth: authUser ? {
          last_sign_in_at: authUser.last_sign_in_at,
          email_confirmed_at: authUser.email_confirmed_at,
          provider: authUser.app_metadata?.provider || "email",
        } : {},
        templates: templates || [],
        history: history || [],
        schedules: schedules || [],
        daily_stats: dailyStats || [],
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar dados de um usuário
app.put("/api/admin/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const { plan, daily_limit, status, is_admin } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (plan !== undefined) updates.plan = plan;
    if (daily_limit !== undefined) updates.daily_limit = parseInt(daily_limit);
    if (status !== undefined) updates.status = status;
    if (is_admin !== undefined) updates.is_admin = is_admin;

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", userId);

    if (error) {
      console.warn("[ADMIN] Erro ao atualizar profile:", error.message);
      // Se tabela não existe, apenas ignora
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar usuário
app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // Não permitir deletar a si próprio
    if (userId === req.userId) {
      return res.status(400).json({ error: "Você não pode deletar sua própria conta" });
    }

    // Deletar dados relacionados (ignora erros se tabelas não existem)
    try { await supabaseAdmin.from("daily_stats").delete().eq("user_id", userId); } catch { }
    try { await supabaseAdmin.from("schedules").delete().eq("user_id", userId); } catch { }
    try { await supabaseAdmin.from("history").delete().eq("user_id", userId); } catch { }
    try { await supabaseAdmin.from("templates").delete().eq("user_id", userId); } catch { }
    try { await supabaseAdmin.from("profiles").delete().eq("id", userId); } catch { }

    // Deletar do auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estatísticas gerais do admin
app.get("/api/admin/stats", async (req, res) => {
  try {
    // Total de usuários
    const { count: totalUsers } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true });

    // Usuários ativos (criados nos últimos 30 dias)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { count: recentUsers } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo.toISOString());

    // Usuários por plano
    const { data: planData } = await supabaseAdmin
      .from("profiles")
      .select("plan");
    const planCounts = {};
    if (planData) {
      planData.forEach(p => {
        const plan = p.plan || "free";
        planCounts[plan] = (planCounts[plan] || 0) + 1;
      });
    }

    // Usuários por status
    const { data: statusData } = await supabaseAdmin
      .from("profiles")
      .select("status");
    const statusCounts = {};
    if (statusData) {
      statusData.forEach(s => {
        const st = s.status || "active";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      });
    }

    // Total de mensagens enviadas
    const { data: allStats } = await supabaseAdmin
      .from("daily_stats")
      .select("sent, date");
    let totalMessages = 0;
    let todayMessages = 0;
    const today = new Date().toISOString().split("T")[0];
    if (allStats) {
      allStats.forEach(s => {
        totalMessages += s.sent || 0;
        if (s.date === today) todayMessages += s.sent || 0;
      });
    }

    // Total de campanhas
    const { count: totalCampaigns } = await supabaseAdmin
      .from("history")
      .select("*", { count: "exact", head: true });

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        recentUsers: recentUsers || 0,
        planCounts,
        statusCounts,
        totalMessages,
        todayMessages,
        totalCampaigns: totalCampaigns || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — SESSÃO WHATSAPP (per-user)
// ═══════════════════════════════════════════════════════════════
app.post("/api/session/start", async (req, res) => {
  const sess = getSession(req.userId);
  if (sess.isReady) return res.json({ success: true, message: "Já conectado!" });
  if (sess.connectionState === "connecting" || sess.connectionState === "qr")
    return res.json({ success: true, message: "Já conectando." });
  try {
    await initializeClient(req.userId);
    res.json({ success: true, message: "Iniciando conexão..." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/session/status", (req, res) => {
  const sess = getSession(req.userId);
  res.json({
    status: sess.connectionState,
    loggedIn: sess.isReady,
    qr: sess.currentQR,
    jobRunning: !!sess.currentJob,
    phoneNumber: sess.phoneNumber || null,
  });
});

app.post("/api/session/close", async (req, res) => {
  const sess = getSession(req.userId);
  try {
    if (sess.client) {
      await sess.client.logout();
      await sess.client.destroy();
      sess.client = null;
    }
  } catch { }
  sess.connectionState = "disconnected";
  sess.isReady = false;
  sess.currentQR = null;
  broadcast(req.userId, "session", { status: "disconnected" });
  res.json({ success: true });
});

app.post("/api/session/restart", async (req, res) => {
  const sess = getSession(req.userId);
  sess.connectionState = "disconnected";
  sess.isReady = false;
  await initializeClient(req.userId);
  res.json({ success: true, message: "Reconectando..." });
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — CONTATOS (persistência)
// ═══════════════════════════════════════════════════════════════
app.get("/api/customers", (req, res) => {
  const db = userDb(req.userId);
  const data = db.getCustomers();
  res.json({ success: true, ...data });
});

app.post("/api/customers", (req, res) => {
  const db = userDb(req.userId);
  const { headers, customers } = req.body;
  db.saveCustomers({ headers: headers || [], customers: customers || [] });
  res.json({ success: true, count: (customers || []).length });
});

app.delete("/api/customers", (req, res) => {
  const db = userDb(req.userId);
  db.saveCustomers({ headers: [], customers: [] });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — CONFIG
// ═══════════════════════════════════════════════════════════════
app.get("/api/config", (req, res) => {
  const db = userDb(req.userId);
  const config = db.getConfig();
  res.json({ success: true, dailyLimit: config.dailyLimit, hasPassword: !!config.password });
});

app.post("/api/config", (req, res) => {
  const db = userDb(req.userId);
  const config = db.getConfig();
  if (req.body.dailyLimit !== undefined) config.dailyLimit = parseInt(req.body.dailyLimit) || 0;
  db.saveConfig(config);
  res.json({ success: true });
});

app.get("/api/daily-stats", (req, res) => {
  const db = userDb(req.userId);
  res.json({ success: true, ...db.getDailyStats() });
});

app.post("/api/daily-stats/reset", (req, res) => {
  const db = userDb(req.userId);
  const config = db.getConfig();
  config.sentToday = 0;
  config.lastReset = new Date().toISOString().split("T")[0];
  db.saveConfig(config);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — ANALYTICS / RELATÓRIOS
// ═══════════════════════════════════════════════════════════════
app.get("/api/analytics", (req, res) => {
  const db = userDb(req.userId);
  const history = db.getHistory();
  const period = req.query.period || "30"; // dias

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - parseInt(period));

  // Filtrar pelo período
  const filtered = history.filter((h) => new Date(h.date) >= cutoff);

  // Totais gerais
  let totalSent = 0, totalFailed = 0, totalCampaigns = filtered.length;
  filtered.forEach((h) => {
    totalSent += h.sent || 0;
    totalFailed += h.failed || 0;
  });

  // Agrupar por dia
  const dailyMap = {};
  filtered.forEach((h) => {
    const day = new Date(h.date).toISOString().split("T")[0];
    if (!dailyMap[day]) dailyMap[day] = { sent: 0, failed: 0, campaigns: 0 };
    dailyMap[day].sent += h.sent || 0;
    dailyMap[day].failed += h.failed || 0;
    dailyMap[day].campaigns++;
  });

  // Preencher dias sem dados
  const daily = [];
  const d = new Date(cutoff);
  while (d <= now) {
    const key = d.toISOString().split("T")[0];
    daily.push({
      date: key,
      sent: dailyMap[key]?.sent || 0,
      failed: dailyMap[key]?.failed || 0,
      campaigns: dailyMap[key]?.campaigns || 0,
    });
    d.setDate(d.getDate() + 1);
  }

  // Agrupar por semana (ISO week)
  const weeklyMap = {};
  filtered.forEach((h) => {
    const dt = new Date(h.date);
    const jan1 = new Date(dt.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((dt - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const key = `${dt.getFullYear()}-S${String(weekNum).padStart(2, "0")}`;
    if (!weeklyMap[key]) weeklyMap[key] = { sent: 0, failed: 0, campaigns: 0 };
    weeklyMap[key].sent += h.sent || 0;
    weeklyMap[key].failed += h.failed || 0;
    weeklyMap[key].campaigns++;
  });
  const weekly = Object.entries(weeklyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({ week, ...data }));

  // Agrupar por mês
  const monthlyMap = {};
  filtered.forEach((h) => {
    const dt = new Date(h.date);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    if (!monthlyMap[key]) monthlyMap[key] = { sent: 0, failed: 0, campaigns: 0 };
    monthlyMap[key].sent += h.sent || 0;
    monthlyMap[key].failed += h.failed || 0;
    monthlyMap[key].campaigns++;
  });
  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  // Horários de pico (hora do dia que mais envia)
  const hourMap = {};
  filtered.forEach((h) => {
    const hour = new Date(h.date).getHours();
    hourMap[hour] = (hourMap[hour] || 0) + (h.sent || 0);
  });
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    sent: hourMap[i] || 0,
  }));

  // Campanhas recentes (top 10)
  const recentCampaigns = filtered.slice(0, 10).map((h) => ({
    id: h.id,
    date: h.date,
    messagePreview: h.messagePreview || "—",
    total: h.total || 0,
    sent: h.sent || 0,
    failed: h.failed || 0,
    successRate: h.total > 0 ? Math.round(((h.sent || 0) / h.total) * 100) : 0,
  }));

  res.json({
    success: true,
    period: parseInt(period),
    summary: {
      totalSent,
      totalFailed,
      totalMessages: totalSent + totalFailed,
      totalCampaigns,
      successRate: (totalSent + totalFailed) > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 0,
      avgPerCampaign: totalCampaigns > 0 ? Math.round(totalSent / totalCampaigns) : 0,
    },
    daily,
    weekly,
    monthly,
    hourly,
    recentCampaigns,
  });
});

// Exportar todo o histórico como CSV
app.get("/api/analytics/export", (req, res) => {
  const db = userDb(req.userId);
  const history = db.getHistory();

  let csv = "Data,Campanha,Total,Enviados,Falhas,Taxa Sucesso\n";
  for (const h of history) {
    const date = new Date(h.date).toLocaleString("pt-BR");
    const preview = (h.messagePreview || "—").replace(/"/g, '""').replace(/\n/g, " ");
    const total = h.total || 0;
    const sent = h.sent || 0;
    const failed = h.failed || 0;
    const rate = total > 0 ? Math.round((sent / total) * 100) + "%" : "—";
    csv += `"${date}","${preview}",${total},${sent},${failed},"${rate}"\n`;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=relatorio_completo_${new Date().toISOString().split("T")[0]}.csv`);
  res.send("\uFEFF" + csv);
});

// Exportar detalhado (cada mensagem de cada campanha)
app.get("/api/analytics/export-detailed", (req, res) => {
  const db = userDb(req.userId);
  const history = db.getHistory();

  let csv = "Data Campanha,Nome,WhatsApp,Status,Erro\n";
  for (const h of history) {
    const date = new Date(h.date).toLocaleString("pt-BR");
    for (const r of h.results || []) {
      const nome = (r.nome || "").replace(/"/g, '""');
      const phone = (r.phone || "").replace(/"/g, '""');
      const status = r.status === "ok" ? "Enviado" : "Erro";
      const error = (r.error || "").replace(/"/g, '""');
      csv += `"${date}","${nome}","${phone}","${status}","${error}"\n`;
    }
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=relatorio_detalhado_${new Date().toISOString().split("T")[0]}.csv`);
  res.send("\uFEFF" + csv);
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — IMAGENS
// ═══════════════════════════════════════════════════════════════
app.post("/api/images/upload", upload.array("images", 10), (req, res) => {
  const files = req.files.map((f) => ({
    id: f.filename,
    name: f.originalname,
    path: `/uploads/${f.filename}`,
    fullPath: f.path,
    caption: "",
  }));
  res.json({ success: true, files });
});

app.get("/api/images", (req, res) => {
  if (!fs.existsSync(uploadsDir)) return res.json({ success: true, files: [] });
  const files = fs.readdirSync(uploadsDir).map((f) => ({
    id: f,
    name: f,
    path: `/uploads/${f}`,
    fullPath: path.join(uploadsDir, f),
    caption: "",
  }));
  res.json({ success: true, files });
});

app.delete("/api/images/:id", (req, res) => {
  const fp = path.join(uploadsDir, req.params.id);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — TEMPLATES
// ═══════════════════════════════════════════════════════════════
app.get("/api/templates", (req, res) => {
  const db = userDb(req.userId);
  res.json({ success: true, templates: db.getTemplates() });
});

app.post("/api/templates", (req, res) => {
  const db = userDb(req.userId);
  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ success: false, error: "Nome e mensagem obrigatórios." });
  const tpl = db.saveTemplate({ name, message, id: req.body.id });
  res.json({ success: true, template: tpl });
});

app.delete("/api/templates/:id", (req, res) => {
  const db = userDb(req.userId);
  db.deleteTemplate(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — IMPORTAÇÃO
// ═══════════════════════════════════════════════════════════════
app.post("/api/import/sheets", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "URL não fornecida." });

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match)
    return res.status(400).json({ success: false, error: "URL inválida do Google Sheets." });

  const sheetId = match[1];
  const gid = url.match(/gid=(\d+)/)?.[1] || "0";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  try {
    const csv = await httpsGet(csvUrl);
    res.json({ success: true, data: parseCSV(csv) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// LÓGICA DE ENVIO (per-user)
// ═══════════════════════════════════════════════════════════════
app.post("/api/send", async (req, res) => {
  const sess = getSession(req.userId);
  const db = userDb(req.userId);
  if (!sess.isReady || !sess.client)
    return res.status(400).json({ success: false, error: "WhatsApp não está conectado." });
  if (sess.currentJob)
    return res.status(400).json({ success: false, error: "Já existe um envio em andamento." });

  const {
    customers,
    messageTemplate,
    images,
    documents,
    interactiveData,
    sendOrder,
    intervalMin,
    intervalMax,
    sendImage,
    dailyLimit,
    scheduleStart,
    scheduleEnd,
    useSchedule,
  } = req.body;

  if (!customers || customers.length === 0)
    return res.status(400).json({ success: false, error: "Nenhum contato." });

  const jobId = uuidv4();
  sess.currentJob = {
    id: jobId,
    total: customers.length,
    sent: 0,
    failed: 0,
    cancelled: false,
    results: [],
  };

  res.json({ success: true, jobId, total: customers.length });

  // Salva fila para crash recovery
  db.saveQueue({
    customers,
    messageTemplate,
    images,
    documents: documents || [],
    interactiveData: interactiveData || null,
    sendOrder: sendOrder || "text_first",
    intervalMin,
    intervalMax,
    sendImage,
    dailyLimit,
    scheduleStart: useSchedule ? scheduleStart : null,
    scheduleEnd: useSchedule ? scheduleEnd : null,
    currentIndex: 0,
    jobId,
  });

  processMessages(
    req.userId,
    customers,
    messageTemplate,
    images,
    documents || [],
    interactiveData || null,
    sendOrder || "text_first",
    intervalMin,
    intervalMax,
    sendImage,
    {
      dailyLimit: parseInt(dailyLimit) || 0,
      scheduleStart: useSchedule ? scheduleStart : null,
      scheduleEnd: useSchedule ? scheduleEnd : null,
    }
  );
});

app.post("/api/send/cancel", (req, res) => {
  const sess = getSession(req.userId);
  if (sess.currentJob) {
    sess.currentJob.cancelled = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, message: "Nenhum envio em andamento." });
  }
});

app.get("/api/send/status", (req, res) => {
  const sess = getSession(req.userId);
  res.json(sess.currentJob ? { running: true, ...sess.currentJob } : { running: false });
});

// ─── Horário de trabalho (per-user) ──────────────
async function waitForSchedule(userId, start, end) {
  if (!start || !end) return false;
  const sess = getSession(userId);
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const sMin = sH * 60 + sM;
  const eMin = eH * 60 + eM;
  const now = new Date();
  const cMin = now.getHours() * 60 + now.getMinutes();

  if (cMin >= sMin && cMin < eMin) return false; // dentro do horário

  let target = new Date(now);
  if (cMin >= eMin) {
    target.setDate(target.getDate() + 1);
  }
  target.setHours(sH, sM, 0, 0);

  const waitMs = target - now;
  const resumeStr = target.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  broadcast(userId, "job", {
    type: "paused_schedule",
    message: `Fora do horário (${start} - ${end}). Retoma às ${resumeStr}.`,
    waitTime: waitMs,
  });

  let rem = waitMs;
  while (rem > 0 && sess.currentJob && !sess.currentJob.cancelled) {
    await delay(Math.min(30000, rem));
    rem -= 30000;
  }
  return true;
}

// ─── Processamento principal (per-user) ───────────
async function processMessages(userId, customers, messageTemplate, images, documents, interactiveData, sendOrder, intervalMin, intervalMax, sendImage, config = {}) {
  const sess = getSession(userId);
  const db = userDb(userId);
  const { dailyLimit = 0, scheduleStart, scheduleEnd } = config;

  for (let i = 0; i < customers.length; i++) {
    if (sess.currentJob.cancelled) {
      broadcast(userId, "job", { type: "cancelled", jobId: sess.currentJob.id });
      break;
    }

    // Verificar horário
    if (scheduleStart && scheduleEnd) {
      const waited = await waitForSchedule(userId, scheduleStart, scheduleEnd);
      if (sess.currentJob.cancelled) break;
      if (waited) broadcast(userId, "job", { type: "schedule_resumed", message: "Retomando envios." });
    }

    // Verificar limite diário
    if (dailyLimit > 0) {
      const stats = db.getDailyStats();
      if (stats.sent >= dailyLimit) {
        broadcast(userId, "job", {
          type: "paused_limit",
          message: `Limite diário atingido (${stats.sent}/${dailyLimit}). Aguardando próximo dia...`,
        });
        // Espera até meia-noite
        const now = new Date();
        const midnight = new Date(now);
        midnight.setDate(midnight.getDate() + 1);
        midnight.setHours(0, 0, 5, 0);
        let rem = midnight - now;
        while (rem > 0 && sess.currentJob && !sess.currentJob.cancelled) {
          await delay(Math.min(30000, rem));
          rem -= 30000;
        }
        if (sess.currentJob.cancelled) break;
        if (scheduleStart && scheduleEnd) await waitForSchedule(userId, scheduleStart, scheduleEnd);
        if (sess.currentJob.cancelled) break;
        broadcast(userId, "job", { type: "schedule_resumed", message: "Novo dia! Retomando envios." });
      }
    }

    const customer = customers[i];
    const origIdx = customer._idx !== undefined ? customer._idx : i;

    // Substituir variáveis dinâmicas
    let msg = messageTemplate || "";
    for (const [key, val] of Object.entries(customer)) {
      if (key === "_idx" || key === "active") continue;
      msg = msg.replace(new RegExp(`\\{${key}\\}`, "gi"), val || "");
    }

    broadcast(userId, "job", {
      type: "progress",
      current: i + 1,
      total: customers.length,
      customer: customer.nome,
      phone: customer.whatsapp,
    });

    try {
      await sendSingleMessage(userId, customer.whatsapp, msg, sendImage ? images : [], sendImage ? documents : [], interactiveData, sendOrder);
      sess.currentJob.sent++;
      db.incrementDaily();
      sess.currentJob.results.push({ phone: customer.whatsapp, nome: customer.nome, status: "ok" });
      broadcast(userId, "job", {
        type: "sent",
        index: origIdx,
        phone: customer.whatsapp,
        nome: customer.nome,
      });
    } catch (err) {
      sess.currentJob.failed++;
      sess.currentJob.results.push({
        phone: customer.whatsapp,
        nome: customer.nome,
        status: "error",
        error: err.message,
      });
      broadcast(userId, "job", {
        type: "error",
        index: origIdx,
        phone: customer.whatsapp,
        nome: customer.nome,
        error: err.message,
      });
    }

    // Atualiza fila
    db.saveQueue({
      customers,
      messageTemplate,
      images,
      documents,
      interactiveData,
      sendOrder,
      intervalMin,
      intervalMax,
      sendImage,
      dailyLimit,
      scheduleStart,
      scheduleEnd,
      currentIndex: i + 1,
      jobId: sess.currentJob.id,
    });

    // Intervalo
    if (i < customers.length - 1 && !sess.currentJob.cancelled) {
      const wt = randomInterval(intervalMin || 5000, intervalMax || 15000);
      broadcast(userId, "job", { type: "waiting", waitTime: wt });
      await delay(wt);
    }
  }

  // Salva no histórico
  const dailyStats = db.getDailyStats();
  const historyEntry = {
    messagePreview: (messageTemplate || "").slice(0, 80),
    total: customers.length,
    sent: sess.currentJob.sent,
    failed: sess.currentJob.failed,
    results: sess.currentJob.results,
    dailySent: dailyStats.sent,
  };
  db.saveHistory(historyEntry);

  broadcast(userId, "job", {
    type: "completed",
    sent: sess.currentJob.sent,
    failed: sess.currentJob.failed,
    total: customers.length,
    historyId: historyEntry.id,
    dailySent: dailyStats.sent,
  });

  db.clearQueue();
  sess.currentJob = null;
}

async function sendSingleMessage(userId, phone, message, images, documents, interactiveData, sendOrder) {
  const sess = getSession(userId);
  const chatId = formatPhone(phone);
  let numberId;
  try {
    numberId = await sess.client.getNumberId(chatId);
  } catch {
    numberId = { _serialized: chatId };
  }
  if (!numberId) throw new Error(`${phone} não está registrado no WhatsApp`);

  const validChatId = numberId._serialized;

  // Monta a mensagem final (texto + botões/lista como texto formatado)
  let finalMsg = message || "";

  if (interactiveData && interactiveData.enabled && interactiveData.items && interactiveData.items.length > 0) {
    if (interactiveData.type === "buttons") {
      finalMsg += "\n";
      interactiveData.items.forEach((item, i) => {
        finalMsg += `\n▶ ${i + 1}. ${item}`;
      });
      const footer = interactiveData.footer || "Responda com o número da opção";
      finalMsg += `\n\n_${footer}_`;
    } else if (interactiveData.type === "list") {
      const sectionTitle = interactiveData.sectionTitle || "Opções disponíveis";
      finalMsg += `\n\n🗒 *${sectionTitle}:*`;
      interactiveData.items.forEach((item, i) => {
        const desc = interactiveData.descriptions && interactiveData.descriptions[i] ? ` — ${interactiveData.descriptions[i]}` : "";
        finalMsg += `\n  ${i + 1}. ${item}${desc}`;
      });
      const footer = interactiveData.footer || "Responda com o número da opção";
      finalMsg += `\n\n_${footer}_`;
    }
  }

  // Funções auxiliares para enviar cada tipo
  async function sendText() {
    if (finalMsg && finalMsg.trim()) {
      await sess.client.sendMessage(validChatId, finalMsg);
    }
  }

  async function sendMedia() {
    if (images && images.length > 0) {
      for (const img of images) {
        const imgPath = img.fullPath || path.join(__dirname, "uploads", img.id);
        if (!fs.existsSync(imgPath)) continue;
        const media = MessageMedia.fromFilePath(imgPath);
        if (img.caption && img.caption.trim()) {
          await sess.client.sendMessage(validChatId, media, { caption: img.caption });
        } else {
          await sess.client.sendMessage(validChatId, media);
        }
        await delay(1500);
      }
    }

    if (documents && documents.length > 0) {
      for (const doc of documents) {
        const docPath = doc.fullPath || path.join(__dirname, "uploads", doc.id);
        if (!fs.existsSync(docPath)) continue;
        const media = MessageMedia.fromFilePath(docPath);
        await sess.client.sendMessage(validChatId, media, {
          sendMediaAsDocument: true,
          caption: doc.caption || "",
        });
        await delay(1500);
      }
    }
  }

  // Envia na ordem escolhida pelo usuário
  if (sendOrder === "media_first") {
    await sendMedia();
    await sendText();
  } else {
    await sendText();
    await sendMedia();
  }
}

// ─── Retomar fila pendente (per-user) ─────────────
function resumePendingQueue(userId) {
  const db = userDb(userId);
  const sess = getSession(userId);
  const queue = db.getQueue();
  if (!queue || !queue.customers) return;

  const remaining = queue.customers.slice(queue.currentIndex || 0);
  if (remaining.length === 0) {
    db.clearQueue();
    return;
  }

  console.log(`📋 Retomando fila (${userId}): ${remaining.length} mensagens pendentes`);
  broadcast(userId, "job", {
    type: "resuming",
    message: `Retomando ${remaining.length} envios pendentes...`,
    remaining: remaining.length,
  });

  const jobId = queue.jobId || uuidv4();
  sess.currentJob = {
    id: jobId,
    total: remaining.length,
    sent: 0,
    failed: 0,
    cancelled: false,
    results: [],
  };

  processMessages(
    userId,
    remaining,
    queue.messageTemplate,
    queue.images,
    queue.documents || [],
    queue.interactiveData || null,
    queue.sendOrder || "text_first",
    queue.intervalMin,
    queue.intervalMax,
    queue.sendImage,
    {
      dailyLimit: parseInt(queue.dailyLimit) || 0,
      scheduleStart: queue.scheduleStart,
      scheduleEnd: queue.scheduleEnd,
    }
  );
}

// ═══════════════════════════════════════════════════════════════
// ROTAS — HISTÓRICO
// ═══════════════════════════════════════════════════════════════
app.get("/api/history", (req, res) => {
  const db = userDb(req.userId);
  const history = db.getHistory().map((h) => ({
    id: h.id,
    date: h.date,
    messagePreview: h.messagePreview,
    total: h.total,
    sent: h.sent,
    failed: h.failed,
  }));
  res.json({ success: true, history });
});

app.get("/api/history/:id", (req, res) => {
  const db = userDb(req.userId);
  const entry = db.getHistory().find((h) => h.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false });
  res.json({ success: true, entry });
});

app.get("/api/history/:id/export", (req, res) => {
  const db = userDb(req.userId);
  const entry = db.getHistory().find((h) => h.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false });

  let csv = "Nome,WhatsApp,Status,Erro\n";
  for (const r of entry.results || []) {
    const nome = (r.nome || "").replace(/"/g, '""');
    const phone = (r.phone || "").replace(/"/g, '""');
    const status = r.status === "ok" ? "Enviado" : "Erro";
    const error = (r.error || "").replace(/"/g, '""');
    csv += `"${nome}","${phone}","${status}","${error}"\n`;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=relatorio_${req.params.id}.csv`);
  res.send("\uFEFF" + csv); // BOM para Excel
});

// ═══════════════════════════════════════════════════════════════
// ROTAS — AGENDAMENTOS
// ═══════════════════════════════════════════════════════════════
app.get("/api/schedules", (req, res) => {
  const db = userDb(req.userId);
  res.json({ success: true, schedules: db.getSchedules() });
});

app.post("/api/schedules", (req, res) => {
  const db = userDb(req.userId);
  const { name, scheduledAt, customers, messageTemplate, images, sendImage, intervalMin, intervalMax } = req.body;
  if (!scheduledAt || !customers?.length)
    return res.status(400).json({ success: false, error: "Data e contatos obrigatórios." });

  const schedule = db.saveSchedule({
    name: name || `Envio ${new Date(scheduledAt).toLocaleString("pt-BR")}`,
    scheduledAt,
    customers,
    messageTemplate,
    images: images || [],
    sendImage: !!sendImage,
    intervalMin: intervalMin || 5000,
    intervalMax: intervalMax || 15000,
    status: "pending",
  });
  res.json({ success: true, schedule });
});

app.delete("/api/schedules/:id", (req, res) => {
  const db = userDb(req.userId);
  db.deleteSchedule(req.params.id);
  res.json({ success: true });
});

// ─── Verificador de agendamentos (30s) — per-user ─
setInterval(() => {
  // Itera por todos os usuários com sessão ativa
  for (const [userId, sess] of sessions) {
    if (!sess.isReady || sess.currentJob) continue;

    const db = userDb(userId);
    const schedules = db.getSchedules();
    const now = new Date();

    for (const s of schedules) {
      if (s.status !== "pending") continue;
      const scheduledTime = new Date(s.scheduledAt);
      if (scheduledTime <= now) {
        console.log(`⏰ Executando agendamento (${userId}): ${s.name}`);
        s.status = "running";
        db.saveSchedule(s);

        const jobId = uuidv4();
        sess.currentJob = {
          id: jobId,
          total: s.customers.length,
          sent: 0,
          failed: 0,
          cancelled: false,
          results: [],
          scheduleId: s.id,
        };

        broadcast(userId, "job", {
          type: "schedule_started",
          name: s.name,
          total: s.customers.length,
        });

        processMessages(
          userId,
          s.customers,
          s.messageTemplate,
          s.images,
          s.intervalMin,
          s.intervalMax,
          s.sendImage,
          {}
        ).then(() => {
          s.status = "completed";
          s.completedAt = new Date().toISOString();
          db.saveSchedule(s);
        });
        break; // Executa um de cada vez por usuário
      }
    }
  }
}, 30000);

// ═══════════════════════════════════════════════════════════════
// ROTA — VERIFICAR NÚMERO (per-user)
// ═══════════════════════════════════════════════════════════════
app.get("/api/check/:phone", async (req, res) => {
  const sess = getSession(req.userId);
  if (!sess.isReady) return res.status(400).json({ error: "Não conectado" });
  try {
    const chatId = formatPhone(req.params.phone);
    const numberId = await sess.client.getNumberId(chatId);
    res.json({ registered: !!numberId, resolvedId: numberId?._serialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA — VALIDAR NÚMEROS EM MASSA (per-user)
// ═══════════════════════════════════════════════════════════════
app.post("/api/validate-numbers", async (req, res) => {
  const sess = getSession(req.userId);
  if (!sess.isReady || !sess.client)
    return res.status(400).json({ success: false, error: "WhatsApp não está conectado. Conecte primeiro." });

  const { phones } = req.body;
  if (!phones || !Array.isArray(phones) || phones.length === 0)
    return res.status(400).json({ success: false, error: "Nenhum número fornecido." });

  const results = [];
  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    try {
      const chatId = formatPhone(phone);
      console.log(`[VALIDATE] Verificando ${phone} → ${chatId}`);
      // Timeout de 10s para cada verificação
      const numberId = await Promise.race([
        sess.client.getNumberId(chatId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]);
      console.log(`[VALIDATE] ${phone} → ${numberId ? 'REGISTRADO' : 'NÃO ENCONTRADO'}`);
      results.push({ phone, registered: !!numberId });
    } catch (err) {
      console.error(`[VALIDATE] Erro para ${phone}:`, err.message || err);
      results.push({ phone, registered: false });
    }
    // Pequeno delay para não sobrecarregar
    if (i < phones.length - 1) await delay(300);
  }

  console.log(`[VALIDATE] Concluído: ${results.length} números verificados`);
  res.json({ success: true, results });
});

// ═══════════════════════════════════════════════════════════════
// CLEANUP — Destrói todas as sessões ativas
// ═══════════════════════════════════════════════════════════════
async function destroyAllSessions() {
  for (const [userId, sess] of sessions) {
    if (sess.client) {
      try { await sess.client.destroy(); } catch { }
    }
  }
}
process.on("SIGINT", async () => {
  await destroyAllSessions();
  process.exit();
});
process.on("SIGTERM", async () => {
  await destroyAllSessions();
  process.exit();
});

// ═══════════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════

// Limpeza de processos zumbis do Chromium na inicialização
(function cleanupZombieBrowsers() {
  try {
    const { execSync } = require("child_process");
    const authDir = path.join(__dirname, ".wwebjs_auth");
    if (process.platform === "win32") {
      // Windows: remove lock files via PowerShell
      execSync(`powershell -Command "Get-ChildItem -Path '${authDir}' -Recurse -Include SingletonLock,SingletonSocket,SingletonCookie -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue"`, { timeout: 5000, shell: true });
    } else {
      // Linux/Mac
      execSync(`lsof -ti "${authDir}" 2>/dev/null | xargs kill -9 2>/dev/null || true`, { timeout: 5000 });
      execSync(`find "${authDir}" -name "SingletonLock" -delete 2>/dev/null || true`, { timeout: 5000 });
      execSync(`find "${authDir}" -name "SingletonSocket" -delete 2>/dev/null || true`, { timeout: 5000 });
      execSync(`find "${authDir}" -name "SingletonCookie" -delete 2>/dev/null || true`, { timeout: 5000 });
    }
    console.log("🧹 Limpeza de processos anteriores concluída");
  } catch { }
})();

app.listen(port, () => {
  console.log(`\n🟢 WhatsApp Sender Pro v5.1 Multi-User — http://localhost:${port}\n`);
  console.log(`   Landing: http://localhost:${port}/`);
  console.log(`   App:     http://localhost:${port}/app\n`);
}).on("listening", function () {
  // Aumenta timeouts do servidor para suportar conexões SSE long-lived
  this.keepAliveTimeout = 120000;  // 2 minutos
  this.headersTimeout = 125000;    // um pouco acima do keepAliveTimeout
});
