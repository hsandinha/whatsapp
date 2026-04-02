// ═══════════════════════════════════════════════════════════════
// WhatsApp Sender Pro v5.0 — Multi-User SaaS
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");

// ═══════════════════════════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || "https://piigfztyhymxrcrpavwq.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
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
const port = process.env.PORT || 3001;
let WhatsAppClientClass = null;
let WhatsAppLocalAuthClass = null;
let WhatsAppMessageMediaClass = null;
let PuppeteerModule = null;
const WA_READY_TIMEOUT_MS = Math.max(
  parseInt(process.env.WA_READY_TIMEOUT_MS || "120000", 10) || 120000,
  30000
);

function getWhatsAppClientDeps() {
  if (!WhatsAppClientClass || !WhatsAppLocalAuthClass) {
    // Lazy-load because puppeteer can delay package initialization and block the HTTP server boot.
    WhatsAppClientClass = require("whatsapp-web.js/src/Client");
    WhatsAppLocalAuthClass = require("whatsapp-web.js/src/authStrategies/LocalAuth");
  }

  return {
    Client: WhatsAppClientClass,
    LocalAuth: WhatsAppLocalAuthClass,
  };
}

function getWhatsAppMessageMedia() {
  if (!WhatsAppMessageMediaClass) {
    WhatsAppMessageMediaClass = require("whatsapp-web.js/src/structures/MessageMedia");
  }

  return WhatsAppMessageMediaClass;
}

function getPuppeteerModule() {
  if (!PuppeteerModule) {
    PuppeteerModule = require("puppeteer");
  }

  return PuppeteerModule;
}

function findChromeExecutableInDir(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        (entry.name === "chrome" ||
          entry.name === "chrome.exe" ||
          entry.name === "Chromium")
      ) {
        return entryPath;
      }
    }
  }

  return null;
}

function resolveChromeExecutablePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  try {
    const puppeteer = getPuppeteerModule();
    const detectedPath =
      typeof puppeteer.executablePath === "function"
        ? puppeteer.executablePath()
        : puppeteer.executablePath;

    if (detectedPath && fs.existsSync(detectedPath)) {
      return detectedPath;
    }
  } catch (err) {
    console.warn("[PUPPETEER] Falha ao resolver executablePath automaticamente:", err.message || err);
  }

  const fixedCandidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];

  for (const candidate of fixedCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const cacheCandidates = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(__dirname, ".cache", "puppeteer"),
    path.join(process.cwd(), ".cache", "puppeteer"),
    path.join("/opt/render/project", ".cache", "puppeteer"),
    path.join(os.homedir(), ".cache", "puppeteer"),
  ].filter(Boolean);

  for (const candidate of cacheCandidates) {
    const chromePath = findChromeExecutableInDir(candidate);
    if (chromePath) return chromePath;
  }

  return envPath || undefined;
}

function resolveAuthDataDir() {
  if (process.env.WWEBJS_AUTH_DIR) return path.resolve(process.env.WWEBJS_AUTH_DIR);
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "whatsapp-sender-pro",
      ".wwebjs_auth"
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "whatsapp-sender-pro",
      ".wwebjs_auth"
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "whatsapp-sender-pro",
    ".wwebjs_auth"
  );
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolveStorageDir(envKey, defaultDirName) {
  const envPath = process.env[envKey];
  if (envPath) return path.resolve(envPath);
  return path.resolve(path.join(__dirname, defaultDirName));
}

function migrateLegacyDir(legacyDir, nextDir, label) {
  if (legacyDir === nextDir) return;
  if (!fs.existsSync(legacyDir)) return;

  const targetIsMissing = !fs.existsSync(nextDir);
  const targetIsEmpty =
    !targetIsMissing &&
    fs.statSync(nextDir).isDirectory() &&
    fs.readdirSync(nextDir).length === 0;

  if (!targetIsMissing && !targetIsEmpty) return;

  ensureDirExists(nextDir);
  fs.cpSync(legacyDir, nextDir, { recursive: true });
  console.log(`[${label}] Dados migrados para diretório persistente`);
}

const LEGACY_AUTH_DIR = path.resolve(path.join(__dirname, ".wwebjs_auth"));
const LEGACY_DATA_DIR = path.resolve(path.join(__dirname, "data"));
const LEGACY_UPLOADS_DIR = path.resolve(path.join(__dirname, "uploads"));
const AUTH_DIR = ensureDirExists(resolveAuthDataDir());
migrateLegacyDir(LEGACY_AUTH_DIR, AUTH_DIR, "AUTH");
const DATA_DIR = ensureDirExists(resolveStorageDir("DATA_DIR", "data"));
migrateLegacyDir(LEGACY_DATA_DIR, DATA_DIR, "DATA");
const UPLOADS_DIR = ensureDirExists(resolveStorageDir("UPLOADS_DIR", "uploads"));
migrateLegacyDir(LEGACY_UPLOADS_DIR, UPLOADS_DIR, "UPLOADS");

function ensureAuthSessionDir(userId) {
  const sessionName = `session-${userId}`;
  const legacySessionDir = path.join(LEGACY_AUTH_DIR, sessionName);
  const sessionDir = path.join(AUTH_DIR, sessionName);

  if (
    AUTH_DIR !== LEGACY_AUTH_DIR &&
    fs.existsSync(legacySessionDir) &&
    !fs.existsSync(sessionDir)
  ) {
    fs.cpSync(legacySessionDir, sessionDir, { recursive: true });
    console.log(`[AUTH] Sessão migrada para diretório persistente (${userId})`);
  }

  return sessionDir;
}

// ═══════════════════════════════════════════════════════════════
// DATABASE (JSON files em /data/<userId>)
// ═══════════════════════════════════════════════════════════════
// Retorna um objeto db com escopo por userId
function userDb(userId) {
  const userDir = path.join(DATA_DIR, userId);
  ensureDirExists(userDir);

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
      lastDisconnectReason: null,
      lastWaState: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      autoReconnectEnabled: true,
      syncWatchdogTimer: null,
    });
  }
  return sessions.get(userId);
}

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Em localhost, desabilita cache dos assets principais para evitar UI com JS antigo.
app.use((req, res, next) => {
  if (
    req.path === "/" ||
    req.path === "/app" ||
    /\.(?:js|css|html)$/i.test(req.path)
  ) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    authDir: AUTH_DIR,
    dataDir: DATA_DIR,
    uploadsDir: UPLOADS_DIR,
  });
});

app.use("/uploads", express.static(UPLOADS_DIR));

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
const uploadsDir = UPLOADS_DIR;
const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".gif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".zip"]);
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_FILE_SIZE_MB = 100;
const MAX_UPLOAD_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;

function getUploadKind(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "unknown";
}

function mapUploadedFile(file) {
  return {
    id: file.filename,
    name: file.originalname,
    path: `/uploads/${file.filename}`,
    fullPath: file.path,
    caption: "",
    kind: getUploadKind(file.originalname),
  };
}

function mapStoredUpload(filename) {
  return {
    id: filename,
    name: filename,
    path: `/uploads/${filename}`,
    fullPath: path.join(uploadsDir, filename),
    caption: "",
    kind: getUploadKind(filename),
  };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (getUploadKind(file.originalname) === "unknown") {
      cb(new Error("Formato de arquivo nao suportado."));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES },
});

function uploadMediaFiles(req, res, next) {
  upload.array("images", MAX_UPLOAD_FILES)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: `Arquivo acima do limite de ${MAX_UPLOAD_FILE_SIZE_MB} MB.`,
        });
      }

      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          success: false,
          error: `Limite de ${MAX_UPLOAD_FILES} arquivos por envio.`,
        });
      }

      return res.status(400).json({
        success: false,
        error: err.message || "Falha ao processar upload.",
      });
    }

    return res.status(400).json({
      success: false,
      error: err.message || "Falha ao processar upload.",
    });
  });
}

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
  res.write(`event: session\ndata: ${JSON.stringify(getSessionPayload(userId))}\n\n`);
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

function getSessionPayload(userId, extra = {}) {
  const sess = getSession(userId);
  return {
    status: sess.connectionState,
    qr: sess.currentQR,
    phoneNumber: sess.phoneNumber || null,
    reason: sess.lastDisconnectReason,
    waState: sess.lastWaState,
    reconnecting: !!sess.reconnectTimer,
    ...extra,
  };
}

function broadcastSession(userId, extra = {}) {
  broadcast(userId, "session", getSessionPayload(userId, extra));
}

function getJobPayload(sess) {
  if (!sess.currentJob) return { running: false };
  const sent = sess.currentJob.sent || 0;
  const failed = sess.currentJob.failed || 0;
  const total = sess.currentJob.total || 0;
  return {
    running: true,
    ...sess.currentJob,
    sent,
    failed,
    total,
    remaining: Math.max(total - sent - failed, 0),
  };
}

function sanitizeJobResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((result) => ({
    index: typeof result?.index === "number" ? result.index : undefined,
    phone: result?.phone || "",
    nome: result?.nome || "",
    status: result?.status === "ok" ? "ok" : "error",
    error: result?.error || "",
  }));
}

function normalizeQueueProgress(queue) {
  const total = Number.isFinite(queue?.total) && queue.total > 0
    ? queue.total
    : Array.isArray(queue?.customers)
      ? queue.customers.length
      : 0;
  const currentIndex = Number.isFinite(queue?.currentIndex) && queue.currentIndex >= 0
    ? queue.currentIndex
    : 0;
  const failed = Number.isFinite(queue?.failed) && queue.failed >= 0 ? queue.failed : 0;
  const sent = Number.isFinite(queue?.sent) && queue.sent >= 0
    ? queue.sent
    : Math.max(currentIndex - failed, 0);

  return {
    total,
    currentIndex,
    sent,
    failed,
    results: sanitizeJobResults(queue?.results),
  };
}

function createJobState({
  jobId,
  total,
  sent = 0,
  failed = 0,
  results = [],
  scheduleId = null,
  messageTemplate = "",
  images = [],
  videos = [],
  documents = [],
  interactiveData = null,
  sendOrder = "text_first",
  intervalMin = 5000,
  intervalMax = 15000,
  sendImage = false,
  dailyLimit = 0,
  scheduleStart = null,
  scheduleEnd = null,
}) {
  return {
    id: jobId || uuidv4(),
    total: Number.isFinite(total) ? total : 0,
    sent: Number.isFinite(sent) ? sent : 0,
    failed: Number.isFinite(failed) ? failed : 0,
    cancelled: false,
    results: sanitizeJobResults(results),
    scheduleId,
    messageTemplate: messageTemplate || "",
    images: Array.isArray(images) ? images : [],
    videos: Array.isArray(videos) ? videos : [],
    documents: Array.isArray(documents) ? documents : [],
    interactiveData: interactiveData || null,
    sendOrder: sendOrder || "text_first",
    intervalMin: Number.isFinite(intervalMin) ? intervalMin : 5000,
    intervalMax: Number.isFinite(intervalMax) ? intervalMax : 15000,
    sendImage: !!sendImage,
    dailyLimit: parseInt(dailyLimit, 10) || 0,
    scheduleStart: scheduleStart || null,
    scheduleEnd: scheduleEnd || null,
  };
}

function getQueuePayload(queue) {
  if (!queue || !Array.isArray(queue.customers) || queue.customers.length === 0) {
    return { running: false };
  }

  const progress = normalizeQueueProgress(queue);
  return {
    running: true,
    id: queue.jobId || null,
    total: progress.total,
    sent: progress.sent,
    failed: progress.failed,
    results: progress.results,
    currentIndex: progress.currentIndex,
    messageTemplate: queue.messageTemplate || "",
    images: Array.isArray(queue.images) ? queue.images : [],
    videos: Array.isArray(queue.videos) ? queue.videos : [],
    documents: Array.isArray(queue.documents) ? queue.documents : [],
    interactiveData: queue.interactiveData || null,
    sendOrder: queue.sendOrder || "text_first",
    intervalMin: Number.isFinite(queue.intervalMin) ? queue.intervalMin : 5000,
    intervalMax: Number.isFinite(queue.intervalMax) ? queue.intervalMax : 15000,
    sendImage: !!queue.sendImage,
    dailyLimit: parseInt(queue.dailyLimit, 10) || 0,
    scheduleStart: queue.scheduleStart || null,
    scheduleEnd: queue.scheduleEnd || null,
    remaining: Math.max(progress.total - progress.sent - progress.failed, 0),
  };
}

function getCurrentJobPayload(userId) {
  const sess = getSession(userId);
  const queue = userDb(userId).getQueue();
  const queuePayload = getQueuePayload(queue);

  if (!sess.currentJob) return queuePayload;

  const sent = sess.currentJob.sent || 0;
  const failed = sess.currentJob.failed || 0;
  const total = sess.currentJob.total || queuePayload.total || 0;

  return {
    ...queuePayload,
    ...sess.currentJob,
    sent,
    failed,
    total,
    results: sanitizeJobResults(sess.currentJob.results || queuePayload.results),
    remaining: Math.max(total - sent - failed, 0),
    running: true,
  };
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

function clearReconnectTimer(sess) {
  if (!sess.reconnectTimer) return;
  clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = null;
}

function clearSyncWatchdog(sess) {
  if (!sess.syncWatchdogTimer) return;
  clearTimeout(sess.syncWatchdogTimer);
  sess.syncWatchdogTimer = null;
}

function scheduleSyncWatchdog(userId, phase = "authenticated") {
  const sess = getSession(userId);
  clearSyncWatchdog(sess);

  if (!WA_READY_TIMEOUT_MS) return;

  sess.syncWatchdogTimer = setTimeout(async () => {
    const latest = getSession(userId);
    latest.syncWatchdogTimer = null;

    if (!latest.client || latest.isReady) return;

    if (!["connecting", "authenticated", "loading"].includes(latest.connectionState)) {
      return;
    }

    latest.connectionState = "disconnected";
    latest.currentQR = null;
    latest.phoneNumber = null;
    latest.lastDisconnectReason = "READY_TIMEOUT";

    console.error(
      `[WA READY TIMEOUT] ${userId}: travou em ${phase} por ${WA_READY_TIMEOUT_MS}ms`
    );

    try {
      await latest.client.destroy();
    } catch (err) {
      console.warn(`[WA READY TIMEOUT] Erro ao destruir client (${userId}):`, err.message || err);
    }

    latest.client = null;
    broadcastSession(userId, {
      status: "error",
      error: "Timeout aguardando sincronização do WhatsApp Web.",
      reason: "READY_TIMEOUT",
    });
    scheduleReconnect(userId, "TIMEOUT");
  }, WA_READY_TIMEOUT_MS);
}

function normalizeStateValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shouldAutoReconnect(reason) {
  return reason === "TIMEOUT" || reason === "CONFLICT";
}

function scheduleReconnect(userId, reason) {
  const sess = getSession(userId);
  if (
    !sess.autoReconnectEnabled ||
    sess.reconnectTimer ||
    sess.isReady ||
    sess.connectionState === "connecting" ||
    sess.connectionState === "qr" ||
    !shouldAutoReconnect(reason)
  ) {
    return;
  }

  const attempt = sess.reconnectAttempts + 1;
  const delayMs = Math.min(attempt * 5000, 30000);
  sess.reconnectAttempts = attempt;
  sess.connectionState = "reconnecting";
  console.warn(
    `[RECONNECT] Sessão ${userId} caiu por ${reason}. Nova tentativa em ${delayMs / 1000}s`
  );
  broadcastSession(userId, { status: "reconnecting", attempt, delayMs });

  sess.reconnectTimer = setTimeout(async () => {
    sess.reconnectTimer = null;
    const latest = getSession(userId);
    if (
      !latest.autoReconnectEnabled ||
      latest.isReady ||
      latest.connectionState === "connecting" ||
      latest.connectionState === "qr"
    ) {
      return;
    }

    try {
      await initializeClient(userId);
    } catch (err) {
      console.error(`[RECONNECT] Erro ao reconectar (${userId}):`, err.message || err);
      scheduleReconnect(userId, reason);
    }
  }, delayMs);
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP CLIENT — Per-user
// ═══════════════════════════════════════════════════════════════
async function initializeClient(userId) {
  const sess = getSession(userId);
  const sessionDir = ensureAuthSessionDir(userId);
  const { Client, LocalAuth } = getWhatsAppClientDeps();
  const chromeExecutablePath = resolveChromeExecutablePath();

  clearReconnectTimer(sess);
  clearSyncWatchdog(sess);
  sess.autoReconnectEnabled = true;

  if (sess.client) {
    try { await sess.client.destroy(); } catch (e) {
      console.warn(`[INIT] Erro ao destruir client anterior (${userId}):`, e.message);
    }
    sess.client = null;
    // Espera liberação do lock do browser
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Mata processos Chromium zumbis que usam a sessão deste usuário
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

  // Remove locks órfãos do Chromium. Os Singleton* ficam na raiz do perfil.
  const lockCandidates = [
    path.join(sessionDir, "SingletonLock"),
    path.join(sessionDir, "SingletonSocket"),
    path.join(sessionDir, "SingletonCookie"),
    path.join(sessionDir, "DevToolsActivePort"),
    path.join(sessionDir, "Default", "LOCK"),
  ];
  for (const lockFile of lockCandidates) {
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile);
        console.log(`[INIT] Removido lock órfão (${userId}): ${path.basename(lockFile)}`);
      } catch { }
    }
  }

  // Espera extra para garantir que processos morreram
  await new Promise((r) => setTimeout(r, 1000));

  sess.connectionState = "connecting";
  sess.isReady = false;
  sess.currentQR = null;
  sess.phoneNumber = null;
  console.log(
    `[INIT] Chromium (${userId}): ${chromeExecutablePath || "auto"} | cache=${
      process.env.PUPPETEER_CACHE_DIR || "default"
    }`
  );
  broadcastSession(userId, { status: "connecting" });

  sess.client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: AUTH_DIR,
    }),
    authTimeoutMs: 60000,
    puppeteer: {
      headless: true,
      executablePath: chromeExecutablePath,
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
    takeoverOnConflict: true,
    takeoverTimeoutMs: 5000,
    webVersionCache: {
      type: "none",
    },
  });

  sess.client.on("qr", async (qr) => {
    clearSyncWatchdog(sess);
    sess.connectionState = "qr";
    sess.lastDisconnectReason = null;
    try { sess.currentQR = await QRCode.toDataURL(qr, { width: 300, margin: 2 }); } catch { sess.currentQR = null; }
    broadcastSession(userId, { status: "qr" });
  });

  sess.client.on("loading_screen", (percent, message) => {
    sess.connectionState = "loading";
    scheduleSyncWatchdog(userId, "loading");
    broadcastSession(userId, { status: "loading", percent, message });
  });

  sess.client.on("authenticated", () => {
    sess.connectionState = "authenticated";
    sess.currentQR = null;
    sess.lastDisconnectReason = null;
    console.log(`[WA AUTHENTICATED] ${userId}`);
    scheduleSyncWatchdog(userId, "authenticated");
    broadcastSession(userId, { status: "authenticated" });
  });

  sess.client.on("auth_failure", (msg) => {
    clearReconnectTimer(sess);
    clearSyncWatchdog(sess);
    sess.connectionState = "disconnected";
    sess.isReady = false;
    sess.currentQR = null;
    sess.phoneNumber = null;
    sess.lastDisconnectReason = normalizeStateValue(msg) || "AUTH_FAILURE";
    console.error(`[WA AUTH FAILURE] ${userId}:`, sess.lastDisconnectReason);
    broadcastSession(userId, { status: "auth_failure", error: msg });
  });

  sess.client.on("change_state", (state) => {
    sess.lastWaState = normalizeStateValue(state);
    console.log(`[WA STATE] ${userId}: ${sess.lastWaState}`);
    broadcastSession(userId);
  });

  sess.client.on("ready", () => {
    console.log(`✅ WhatsApp pronto para usuário ${userId}`);
    clearReconnectTimer(sess);
    clearSyncWatchdog(sess);
    sess.connectionState = "connected";
    sess.isReady = true;
    sess.currentQR = null;
    sess.lastDisconnectReason = null;
    sess.lastWaState = "CONNECTED";
    sess.reconnectAttempts = 0;
    // Captura o número de telefone conectado
    try {
      const wid = sess.client.info && sess.client.info.wid;
      sess.phoneNumber = wid ? wid.user : null;
    } catch { sess.phoneNumber = null; }
    console.log(`📱 Número conectado: ${sess.phoneNumber}`);
    broadcastSession(userId, { status: "connected" });
    // Tenta retomar fila pendente do usuário
    resumePendingQueue(userId);
  });

  sess.client.on("disconnected", (reason) => {
    const normalizedReason = normalizeStateValue(reason);
    clearReconnectTimer(sess);
    clearSyncWatchdog(sess);
    sess.connectionState = "disconnected";
    sess.isReady = false;
    sess.currentQR = null;
    sess.phoneNumber = null;
    sess.lastDisconnectReason = normalizedReason;
    sess.lastWaState = normalizedReason || sess.lastWaState;
    console.warn(`[WA DISCONNECTED] ${userId}:`, normalizedReason);
    broadcastSession(userId, { status: "disconnected" });
    scheduleReconnect(userId, normalizedReason);
  });

  sess.client.initialize().catch((err) => {
    console.error(`Erro ao inicializar (${userId}):`, err);
    clearReconnectTimer(sess);
    clearSyncWatchdog(sess);
    sess.connectionState = "disconnected";
    sess.isReady = false;
    sess.lastDisconnectReason = normalizeStateValue(err);
    broadcastSession(userId, { status: "error", error: err.message });
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
  if (sess.connectionState === "connecting" || sess.connectionState === "qr" || sess.connectionState === "reconnecting")
    return res.json({ success: true, message: "Já conectando." });

  clearReconnectTimer(sess);
  sess.autoReconnectEnabled = true;
  sess.reconnectAttempts = 0;

  res.json({ success: true, message: "Iniciando conexão..." });

  setImmediate(async () => {
    try {
      await initializeClient(req.userId);
    } catch (err) {
      const latest = getSession(req.userId);
      latest.connectionState = "disconnected";
      latest.isReady = false;
      latest.currentQR = null;
      latest.phoneNumber = null;
      latest.lastDisconnectReason = normalizeStateValue(err) || "START_FAILURE";
      console.error(`[SESSION START] Erro ao iniciar (${req.userId}):`, err);
      broadcastSession(req.userId, { status: "error", error: err.message });
    }
  });
});

app.get("/api/session/status", (req, res) => {
  const sess = getSession(req.userId);
  res.json({
    ...getSessionPayload(req.userId),
    loggedIn: sess.isReady,
    jobRunning: !!sess.currentJob,
  });
});

app.post("/api/session/close", async (req, res) => {
  const sess = getSession(req.userId);
  clearReconnectTimer(sess);
  clearSyncWatchdog(sess);
  sess.autoReconnectEnabled = false;
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
  sess.phoneNumber = null;
  sess.lastDisconnectReason = null;
  sess.lastWaState = null;
  broadcastSession(req.userId, { status: "disconnected" });
  res.json({ success: true });
});

app.post("/api/session/restart", async (req, res) => {
  const sess = getSession(req.userId);
  clearReconnectTimer(sess);
  clearSyncWatchdog(sess);
  sess.autoReconnectEnabled = true;
  sess.reconnectAttempts = 0;
  sess.connectionState = "disconnected";
  sess.isReady = false;

  res.json({ success: true, message: "Reconectando..." });

  setImmediate(async () => {
    try {
      await initializeClient(req.userId);
    } catch (err) {
      const latest = getSession(req.userId);
      latest.connectionState = "disconnected";
      latest.isReady = false;
      latest.currentQR = null;
      latest.phoneNumber = null;
      latest.lastDisconnectReason = normalizeStateValue(err) || "RESTART_FAILURE";
      console.error(`[SESSION RESTART] Erro ao reiniciar (${req.userId}):`, err);
      broadcastSession(req.userId, { status: "error", error: err.message });
    }
  });
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
// ROTAS — MIDIAS
// ═══════════════════════════════════════════════════════════════
app.post("/api/images/upload", uploadMediaFiles, (req, res) => {
  const files = Array.isArray(req.files) ? req.files.map(mapUploadedFile) : [];
  if (!files.length) {
    return res.status(400).json({
      success: false,
      error: "Nenhum arquivo valido foi enviado.",
    });
  }
  res.json({
    success: true,
    files,
    maxFileSizeMb: MAX_UPLOAD_FILE_SIZE_MB,
  });
});

app.get("/api/images", (req, res) => {
  if (!fs.existsSync(uploadsDir)) return res.json({ success: true, files: [] });
  const files = fs.readdirSync(uploadsDir).map(mapStoredUpload);
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
    videos,
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
  const scheduleStartValue = useSchedule ? scheduleStart : null;
  const scheduleEndValue = useSchedule ? scheduleEnd : null;
  sess.currentJob = createJobState({
    jobId,
    total: customers.length,
    messageTemplate,
    images,
    videos: videos || [],
    documents: documents || [],
    interactiveData: interactiveData || null,
    sendOrder: sendOrder || "text_first",
    intervalMin,
    intervalMax,
    sendImage,
    dailyLimit,
    scheduleStart: scheduleStartValue,
    scheduleEnd: scheduleEndValue,
  });

  res.json({ success: true, jobId, total: customers.length });

  // Salva fila para crash recovery
  db.saveQueue({
    customers,
    messageTemplate,
    images,
    videos: videos || [],
    documents: documents || [],
    interactiveData: interactiveData || null,
    sendOrder: sendOrder || "text_first",
    intervalMin,
    intervalMax,
    sendImage,
    dailyLimit,
    scheduleStart: scheduleStartValue,
    scheduleEnd: scheduleEndValue,
    currentIndex: 0,
    total: customers.length,
    sent: 0,
    failed: 0,
    results: [],
    jobId,
  });

  processMessages(
    req.userId,
    customers,
    messageTemplate,
    images,
    videos || [],
    documents || [],
    interactiveData || null,
    sendOrder || "text_first",
    intervalMin,
    intervalMax,
    sendImage,
    {
      dailyLimit: parseInt(dailyLimit) || 0,
      scheduleStart: scheduleStartValue,
      scheduleEnd: scheduleEndValue,
    },
    {
      queueCustomers: customers,
      indexOffset: 0,
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
  res.json(getCurrentJobPayload(req.userId));
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
async function processMessages(userId, customers, messageTemplate, images, videos, documents, interactiveData, sendOrder, intervalMin, intervalMax, sendImage, config = {}, runtime = {}) {
  const sess = getSession(userId);
  const db = userDb(userId);
  const { dailyLimit = 0, scheduleStart, scheduleEnd } = config;
  const queueCustomers = Array.isArray(runtime.queueCustomers) && runtime.queueCustomers.length > 0 ? runtime.queueCustomers : customers;
  const indexOffset = Number.isFinite(runtime.indexOffset) ? runtime.indexOffset : 0;
  const total = sess.currentJob?.total || queueCustomers.length || customers.length;

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
    const processedIndex = indexOffset + i;
    const origIdx = customer._idx !== undefined ? customer._idx : i;

    // Substituir variáveis dinâmicas
    let msg = messageTemplate || "";
    for (const [key, val] of Object.entries(customer)) {
      if (key === "_idx" || key === "active") continue;
      msg = msg.replace(new RegExp(`\\{${key}\\}`, "gi"), val || "");
    }

    broadcast(userId, "job", {
      type: "progress",
      current: processedIndex + 1,
      total,
      customer: customer.nome,
      phone: customer.whatsapp,
      sent: sess.currentJob.sent,
      failed: sess.currentJob.failed,
      remaining: Math.max(total - sess.currentJob.sent - sess.currentJob.failed, 0),
    });

    try {
      await sendSingleMessage(
        userId,
        customer.whatsapp,
        msg,
        sendImage ? images : [],
        sendImage ? videos : [],
        sendImage ? documents : [],
        interactiveData,
        sendOrder
      );
      sess.currentJob.sent++;
      db.incrementDaily();
      sess.currentJob.results.push({ index: origIdx, phone: customer.whatsapp, nome: customer.nome, status: "ok" });
      broadcast(userId, "job", {
        type: "sent",
        index: origIdx,
        phone: customer.whatsapp,
        nome: customer.nome,
        sent: sess.currentJob.sent,
        failed: sess.currentJob.failed,
        total,
        remaining: Math.max(total - sess.currentJob.sent - sess.currentJob.failed, 0),
      });
    } catch (err) {
      sess.currentJob.failed++;
      sess.currentJob.results.push({
        index: origIdx,
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
        sent: sess.currentJob.sent,
        failed: sess.currentJob.failed,
        total,
        remaining: Math.max(total - sess.currentJob.sent - sess.currentJob.failed, 0),
      });
    }

    // Atualiza fila
    db.saveQueue({
      customers: queueCustomers,
      messageTemplate,
      images,
      videos,
      documents,
      interactiveData,
      sendOrder,
      intervalMin,
      intervalMax,
      sendImage,
      dailyLimit,
      scheduleStart,
      scheduleEnd,
      currentIndex: processedIndex + 1,
      total,
      sent: sess.currentJob.sent,
      failed: sess.currentJob.failed,
      results: sess.currentJob.results,
      jobId: sess.currentJob.id,
    });

    // Intervalo
    if (i < customers.length - 1 && !sess.currentJob.cancelled) {
      const wt = randomInterval(intervalMin || 5000, intervalMax || 15000);
      broadcast(userId, "job", { type: "waiting", waitTime: wt });
      await delay(wt);
    }
  }

  const finishedJob = sess.currentJob;
  if (!finishedJob) return;

  // Salva no histórico
  const dailyStats = db.getDailyStats();
  const historyEntry = {
    messagePreview: (messageTemplate || "").slice(0, 80),
    messageTemplate,
    images,
    videos,
    documents,
    interactiveData,
    sendOrder,
    intervalMin,
    intervalMax,
    sendImage,
    dailyLimit,
    scheduleStart,
    scheduleEnd,
    total: finishedJob.total || total,
    sent: finishedJob.sent,
    failed: finishedJob.failed,
    results: finishedJob.results,
    status: finishedJob.cancelled ? "cancelled" : "completed",
    dailySent: dailyStats.sent,
  };
  db.saveHistory(historyEntry);

  if (!finishedJob.cancelled) {
    broadcast(userId, "job", {
      type: "completed",
      sent: finishedJob.sent,
      failed: finishedJob.failed,
      total: finishedJob.total || total,
      historyId: historyEntry.id,
      dailySent: dailyStats.sent,
    });
  }

  db.clearQueue();
  sess.currentJob = null;
}

async function sendSingleMessage(userId, phone, message, images, videos, documents, interactiveData, sendOrder) {
  const sess = getSession(userId);
  const MessageMedia = getWhatsAppMessageMedia();
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

    if (videos && videos.length > 0) {
      for (const video of videos) {
        const videoPath = video.fullPath || path.join(__dirname, "uploads", video.id);
        if (!fs.existsSync(videoPath)) continue;
        const media = MessageMedia.fromFilePath(videoPath);
        if (video.caption && video.caption.trim()) {
          await sess.client.sendMessage(validChatId, media, { caption: video.caption });
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

  const progress = normalizeQueueProgress(queue);
  const remaining = queue.customers.slice(progress.currentIndex);
  if (remaining.length === 0) {
    db.clearQueue();
    return;
  }

  console.log(`📋 Retomando fila (${userId}): ${remaining.length} mensagens pendentes`);
  sess.currentJob = createJobState({
    jobId: queue.jobId || uuidv4(),
    total: progress.total,
    sent: progress.sent,
    failed: progress.failed,
    results: progress.results,
    messageTemplate: queue.messageTemplate,
    images: queue.images,
    videos: queue.videos || [],
    documents: queue.documents || [],
    interactiveData: queue.interactiveData || null,
    sendOrder: queue.sendOrder || "text_first",
    intervalMin: queue.intervalMin,
    intervalMax: queue.intervalMax,
    sendImage: queue.sendImage,
    dailyLimit: queue.dailyLimit,
    scheduleStart: queue.scheduleStart,
    scheduleEnd: queue.scheduleEnd,
  });

  broadcast(userId, "job", {
    type: "resuming",
    message: `Retomando ${remaining.length} envios pendentes...`,
    remaining: Math.max(progress.total - progress.sent - progress.failed, 0),
    total: progress.total,
    sent: progress.sent,
    failed: progress.failed,
  });

  processMessages(
    userId,
    remaining,
    queue.messageTemplate,
    queue.images,
    queue.videos || [],
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
    },
    {
      queueCustomers: queue.customers,
      indexOffset: progress.currentIndex,
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
  const {
    name,
    scheduledAt,
    customers,
    messageTemplate,
    images,
    videos,
    documents,
    interactiveData,
    sendOrder,
    sendImage,
    intervalMin,
    intervalMax,
  } = req.body;
  if (!scheduledAt || !customers?.length)
    return res.status(400).json({ success: false, error: "Data e contatos obrigatórios." });

  const schedule = db.saveSchedule({
    name: name || `Envio ${new Date(scheduledAt).toLocaleString("pt-BR")}`,
    scheduledAt,
    customers,
    messageTemplate,
    images: images || [],
    videos: videos || [],
    documents: documents || [],
    interactiveData: interactiveData || null,
    sendOrder: sendOrder || "text_first",
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
        sess.currentJob = createJobState({
          jobId,
          total: s.customers.length,
          scheduleId: s.id,
          messageTemplate: s.messageTemplate,
          images: s.images || [],
          videos: s.videos || [],
          documents: s.documents || [],
          interactiveData: s.interactiveData || null,
          sendOrder: s.sendOrder || "text_first",
          intervalMin: s.intervalMin || 5000,
          intervalMax: s.intervalMax || 15000,
          sendImage: !!s.sendImage,
        });

        broadcast(userId, "job", {
          type: "schedule_started",
          name: s.name,
          total: s.customers.length,
        });

        processMessages(
          userId,
          s.customers,
          s.messageTemplate,
          s.images || [],
          s.videos || [],
          s.documents || [],
          s.interactiveData || null,
          s.sendOrder || "text_first",
          s.intervalMin || 5000,
          s.intervalMax || 15000,
          !!s.sendImage,
          {},
          {
            queueCustomers: s.customers,
            indexOffset: 0,
          }
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
    clearReconnectTimer(sess);
    clearSyncWatchdog(sess);
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
    const authDir = AUTH_DIR;
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
