"use strict";
/* ============================================================
   精听实验室 · 轻量账号服务（零依赖，仅用 Node 内置模块）
   ------------------------------------------------------------
   职责：
     1) 托管静态站点（index.html 等）
     2) 提供账号接口：注册 / 登录 / 读数据 / 写数据
   存储：同目录下 data/store.json（JSON 文件，随应用一起跑）
   启动：PORT=xxxx node server.js
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.LL_DATA ? path.resolve(process.env.LL_DATA) : path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

const TOKEN_DAYS = 60;            // 令牌有效期
const MAX_BODY = 16 * 1024 * 1024; // 单次请求体上限 16MB
const MAX_FAILS = 10;             // 同一账号连续失败次数上限
const LOCK_MS = 60 * 1000;        // 触发上限后锁定时间

/* ---------------- 存储层 ---------------- */
let DB = { users: {}, tokens: {} };

function loadDB() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      const o = JSON.parse(raw);
      if (o && typeof o === "object") {
        DB.users = o.users && typeof o.users === "object" ? o.users : {};
        DB.tokens = o.tokens && typeof o.tokens === "object" ? o.tokens : {};
      }
    }
  } catch (e) {
    console.error("[store] 读取失败，改用空库：", e.message);
  }
}
let saveTimer = null;
function saveDB(now) {
  if (!now && saveTimer) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(DB), "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error("[store] 写入失败：", e.message);
  }
}
function saveLater() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveDB(true); }, 400);
}

/* ---------------- 工具 ---------------- */
const normUser = (u) => String(u || "").trim().toLowerCase();
const keyOfUser = (u) => crypto.createHash("sha256").update("ll::" + normUser(u)).digest("hex").slice(0, 32);

function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}
function newSalt() { return crypto.randomBytes(16).toString("hex"); }
function newToken() { return crypto.randomBytes(32).toString("hex"); }

function safeEq(a, b) {
  const A = Buffer.from(String(a), "utf8"), B = Buffer.from(String(b), "utf8");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function checkUser(u) {
  const s = String(u || "").trim();
  if (s.length < 3 || s.length > 24) return "账号名需要 3-24 个字符";
  if (!/^[\w\u4e00-\u9fa5.@-]+$/.test(s)) return "账号名只能用中英文、数字、_ . @ -";
  return "";
}
function checkPass(p) {
  const s = String(p || "");
  if (s.length < 6) return "密码至少 6 位";
  if (s.length > 128) return "密码太长了（最多 128 位）";
  return "";
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LL-Token",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("数据太大（上限 16MB）")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const t = Buffer.concat(chunks).toString("utf8");
      if (!t) return resolve({});
      try { resolve(JSON.parse(t)); } catch (e) { reject(new Error("请求格式不对（需要 JSON）")); }
    });
    req.on("error", reject);
  });
}

function queryOf(req) {
  const u = req.url || "";
  const i = u.indexOf("?");
  return new URLSearchParams(i >= 0 ? u.slice(i + 1) : "");
}
/* 令牌可以走四个地方传：Authorization 头 / X-LL-Token 头 / ?token= 查询串 / 请求体 token 字段。
   为什么要这么啰嗦：线上网关会用自己的 JWT **覆盖** Authorization 头，所以不能只信它，
   而是把所有来源收集起来一个个试，谁能对上库里的令牌就用谁。 */
function tokenCandidates(req, query, body) {
  const out = [];
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const m = h.match(/^\s*bearer\s+(\S+)\s*$/i);
  if (m) out.push(m[1]);
  const x = req.headers && req.headers["x-ll-token"];
  if (x) out.push(String(x).trim());
  if (query && typeof query.get === "function") { const q = query.get("token"); if (q) out.push(String(q).trim()); }
  if (query && query.token) out.push(String(query.token).trim());
  if (body && typeof body.token === "string") out.push(body.token.trim());
  return out.filter(Boolean);
}
function auth(req, query, body) {
  const cands = tokenCandidates(req, query, body);
  for (let i = 0; i < cands.length; i++) {
    const tk = cands[i];
    const rec = DB.tokens[tk];
    if (!rec) continue;
    if (rec.exp && rec.exp < Date.now()) { delete DB.tokens[tk]; saveLater(); continue; }
    const u = DB.users[rec.u];
    if (!u) continue;
    return { token: tk, rec, user: u, ukey: rec.u, via: i };
  }
  return null;
}

/* ---------------- 静态资源 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".webp": "image/webp",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end("403"); return; }
  const base = path.basename(full);
  const prodData = path.join(ROOT, "data") + path.sep;      // 生产数据目录：任何情况下都不给下载
  if (base.startsWith(".") || full.includes(path.sep + "node_modules" + path.sep) ||
      full === DB_FILE || full.startsWith(DATA_DIR + path.sep) || full.startsWith(prodData)) {
    res.writeHead(404); res.end("404");
    return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 找不到这个文件");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, p) {
  /* 健康检查：浏览器打开 /api/ping 能确认服务活着 */
  if (p === "/api/ping" && req.method === "GET") {
    return send(res, 200, { ok: true, app: "listenlab", users: Object.keys(DB.users).length, time: Date.now() });
  }

  if (p === "/api/register" && req.method === "POST") {
    const b = await readBody(req);
    const e1 = checkUser(b.user); if (e1) return send(res, 400, { ok: false, error: e1 });
    const e2 = checkPass(b.pass); if (e2) return send(res, 400, { ok: false, error: e2 });
    const uk = keyOfUser(b.user);
    if (DB.users[uk]) return send(res, 409, { ok: false, error: "这个账号名已经被注册了，直接登录，或换一个名字" });
    const salt = newSalt();
    DB.users[uk] = {
      user: String(b.user).trim(), salt, hash: hashPass(b.pass, salt),
      created: Date.now(), fails: 0, lockedUntil: 0,
      data: b.data && typeof b.data === "object" ? b.data : null,
      updated: Number(b.updated) || Date.now(),
    };
    const tk = newToken();
    DB.tokens[tk] = { u: uk, exp: Date.now() + TOKEN_DAYS * 86400000 };
    saveDB();
    return send(res, 200, { ok: true, token: tk, user: DB.users[uk].user, data: DB.users[uk].data, updated: DB.users[uk].updated });
  }

  if (p === "/api/login" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.user || !b.pass) return send(res, 400, { ok: false, error: "请填写账号和密码" });
    const uk = keyOfUser(b.user);
    const u = DB.users[uk];
    if (!u) return send(res, 404, { ok: false, error: "没有这个账号，检查一下账号名（或先注册）" });
    if (u.lockedUntil && u.lockedUntil > Date.now()) {
      return send(res, 429, { ok: false, error: "密码错太多次了，等 1 分钟再试" });
    }
    if (!safeEq(u.hash, hashPass(b.pass, u.salt))) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) { u.lockedUntil = Date.now() + LOCK_MS; u.fails = 0; }
      saveDB();
      return send(res, 401, { ok: false, error: "密码不对" });
    }
    u.fails = 0; u.lockedUntil = 0;
    const tk = newToken();
    DB.tokens[tk] = { u: uk, exp: Date.now() + TOKEN_DAYS * 86400000 };
    saveDB();
    return send(res, 200, { ok: true, token: tk, user: u.user, data: u.data, updated: u.updated || 0 });
  }

  /* 自检接口：报告服务端收到的令牌来源，用来排查网关是否覆盖/吞掉了请求头 */
  if (p === "/api/whoami" && req.method === "GET") {
    const q = queryOf(req);
    const hdr = String((req.headers && req.headers.authorization) || "");
    const cands = tokenCandidates(req, q);
    const seen = {
      header: hdr ? (hdr.slice(0, 14) + "…") : null,
      xToken: req.headers && req.headers["x-ll-token"] ? "有" : null,
      queryToken: q.get("token") ? "有" : null,
      candidates: cands.length,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 40),
    };
    const a = auth(req, q);
    return send(res, 200, { ok: true, seen, authed: !!a, who: a ? a.user.user : null, viaCandidate: a ? a.via : null });
  }

  if (p === "/api/logout" && req.method === "POST") {
    let b = {}; try { b = await readBody(req); } catch (e) { b = {}; }
    const a = auth(req, queryOf(req), b);
    if (a) { delete DB.tokens[a.token]; saveDB(); }
    return send(res, 200, { ok: true });
  }

  if (p === "/api/data" && req.method === "GET") {
    const a = auth(req, queryOf(req));
    if (!a) return send(res, 401, { ok: false, error: "登录已过期，请重新登录" });
    a.rec.exp = Date.now() + TOKEN_DAYS * 86400000;   // 用一次续一次
    saveLater();
    return send(res, 200, { ok: true, user: a.user.user, data: a.user.data || null, updated: a.user.updated || 0 });
  }

  if (p === "/api/data" && req.method === "PUT") {
    const b = await readBody(req);
    const a = auth(req, queryOf(req), b);
    if (!a) return send(res, 401, { ok: false, error: "登录已过期，请重新登录" });
    if (!b.data || typeof b.data !== "object") return send(res, 400, { ok: false, error: "缺少数据内容" });
    a.user.data = b.data;
    a.user.updated = Number(b.updated) || Date.now();
    a.rec.exp = Date.now() + TOKEN_DAYS * 86400000;
    saveDB();
    return send(res, 200, { ok: true, updated: a.user.updated });
  }

  if (p === "/api/passwd" && req.method === "POST") {
    const b = await readBody(req);
    const a = auth(req, queryOf(req), b);
    if (!a) return send(res, 401, { ok: false, error: "登录已过期，请重新登录" });
    const e2 = checkPass(b.newPass); if (e2) return send(res, 400, { ok: false, error: e2 });
    if (!safeEq(a.user.hash, hashPass(b.pass, a.user.salt))) return send(res, 401, { ok: false, error: "原密码不对" });
    a.user.salt = newSalt();
    a.user.hash = hashPass(b.newPass, a.user.salt);
    DB.tokens = Object.fromEntries(Object.entries(DB.tokens).filter(([, v]) => v.u !== a.ukey));
    saveDB();
    return send(res, 200, { ok: true, message: "密码已修改，请用新密码重新登录" });
  }

  return send(res, 404, { ok: false, error: "接口不存在：" + p });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LL-Token",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (e) {
      if (!res.headersSent) send(res, 400, { ok: false, error: e.message || "请求处理失败" });
    }
    return;
  }

  serveStatic(req, res, urlPath);
});

loadDB();
server.listen(PORT, HOST, () => {
  console.log("精听实验室账号服务已启动 → http://" + HOST + ":" + PORT);
  console.log("账号数：" + Object.keys(DB.users).length + " · 数据文件：" + DB_FILE);
});

process.on("SIGTERM", () => { saveDB(true); process.exit(0); });
process.on("SIGINT", () => { saveDB(true); process.exit(0); });
