var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// voidlatency-core.js - Complete Panel with All Features Fixed
import { connect } from "cloudflare:sockets";

// ============================================
// BACKEND CONSTANTS & VARIABLES
// ============================================
var GLOBAL_TRAFFIC_CACHE = /* @__PURE__ */ new Map();
var ACTIVE_CONNECTIONS_COUNT = /* @__PURE__ */ new Map();
var GLOBAL_LAST_ACTIVE_WRITE = /* @__PURE__ */ new Map();
var DNS_CACHE = /* @__PURE__ */ new Map();
var DNS_CACHE_TTL = 5 * 60 * 1e3;
var DOH_RESOLVER = "https://cloudflare-dns.com/dns-query";
var UPSTREAM_BUNDLE_TARGET_BYTES = 16 * 1024;
var UPSTREAM_QUEUE_MAX_BYTES = 16 * 1024 * 1024;
var UPSTREAM_QUEUE_MAX_ITEMS = 4096;
var DOWNSTREAM_GRAIN_BYTES = 32 * 1024;
var DOWNSTREAM_GRAIN_TAIL_THRESHOLD = 512;
var DOWNSTREAM_GRAIN_SILENT_MS = 1;
var TCP_CONCURRENCY = 2;
var PRELOAD_RACE_DIAL = true;
var xrayStatus = { running: true, uptime: 0, startTime: Date.now() };
var SYSTEM_STATS = {
  cpu: { cores: 48, load: [12.5, 11.4, 11.6] },
  ram: { used: 159.30, total: 322.69 },
  swap: { used: 1.39, total: 223.56 },
  storage: { used: 818.93, total: 2867.20 }
};
var ADMINS = [];
var PANEL_VERSION = "2.9.4";
var THEME = "dark";
var REQUEST_COUNT = 0;
var REQUEST_HISTORY = [];
var API_TOKENS = [];
var API_TOKEN = "";

// ============================================
// MAIN APPLICATION
// ============================================
var voidlatency_core_default = {
  async fetch(request, env, ctx) {
    await DbService.ensureSchema(env.VL_DB);
    await loadAdmins(env);
    await loadApiTokens(env);
    const url = new URL(request.url);
    
    // Track requests
    REQUEST_COUNT++;
    REQUEST_HISTORY.push({ time: Date.now(), count: REQUEST_COUNT });
    if (REQUEST_HISTORY.length > 100) REQUEST_HISTORY.shift();
    
    // WebSocket
    if (Router.isWebSocketUpgrade(request) && url.pathname === "/") {
      return await Router.handleWebSocket(request, env, ctx);
    }
    
    // Subscription - ONLY /sub/username
    if (url.pathname.startsWith("/sub/")) {
      return await Router.handleSubscription(url, env);
    }
    
    // API
    if (url.pathname.startsWith("/api/") || url.pathname === "/locations") {
      return await Router.handleApi(request, url, env, ctx);
    }
    
    // Panel
    if (url.pathname === "/panel" || url.pathname === "/login") {
      return await Router.handlePanel(request, env);
    }
    
    // Status
    if (url.pathname.startsWith("/status/")) {
      return await Router.handleUserStatus(url, env);
    }
    
    return new Response(HTML_TEMPLATES.nginx, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

// ============================================
// API TOKEN MANAGEMENT
// ============================================
async function loadApiTokens(env) {
  try {
    const result = await env.VL_DB.prepare("SELECT * FROM api_tokens").all();
    API_TOKENS = result.results || [];
    if (API_TOKENS.length > 0) {
      API_TOKEN = API_TOKENS[0].token;
    }
  } catch (e) {
    await env.VL_DB.prepare(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE,
        name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    API_TOKENS = [];
  }
}

async function generateApiToken(env, name) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await env.VL_DB.prepare("INSERT INTO api_tokens (token, name) VALUES (?, ?)").bind(token, name || "API Token").run();
  await loadApiTokens(env);
  return token;
}

async function verifyApiToken(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return false;
  await loadApiTokens(env);
  return API_TOKENS.some(t => t.token === token);
}

// ============================================
// ADMIN MANAGEMENT
// ============================================
async function loadAdmins(env) {
  try {
    const result = await env.VL_DB.prepare("SELECT * FROM admins").all();
    ADMINS = result.results || [];
  } catch (e) {
    await env.VL_DB.prepare(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    ADMINS = [];
  }
}

// ============================================
// ROUTER
// ============================================
var Router = {
  isWebSocketUpgrade(request) {
    const upgradeHeader = (request.headers.get("Upgrade") || "").toLowerCase();
    return upgradeHeader === "websocket";
  },
  async handleWebSocket(request, env, ctx) {
    try {
      let proxyIP = "proxyip.cmliussss.net";
      try {
        const proxyRow = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'proxy_ip'").first();
        if (proxyRow && proxyRow.value) {
          proxyIP = proxyRow.value;
        }
      } catch (e) {}
      const mockStoredData = { proxy_ip: proxyIP };
      return handleVLESS(env, mockStoredData, ctx);
    } catch (e) {
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  async handleSubscription(url, env) {
    // Only /sub/username format
    const pathParts = url.pathname.split("/");
    const username = decodeURIComponent(pathParts[2] || "");
    if (!username) {
      return new Response("Username required", { status: 400 });
    }
    
    try {
      const user = await env.VL_DB.prepare("SELECT * FROM users WHERE username = ? OR uuid = ?").bind(username, username).first();
      if (!user || user.connection_type !== atob("dmxlc3M=")) {
        return new Response("Not Found", { status: 404 });
      }
      const host = url.hostname;
      return await SubscriptionService.generateSub(user, host);
    } catch (err) {
      return new Response("Error building config: " + err.message, { status: 500 });
    }
  },
  async handlePanel(request, env) {
    const hasPassword = await DbService.getPanelPassword(env.VL_DB);
    if (!hasPassword) {
      return new Response(HTML_TEMPLATES.setup, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    const authorized = await DbService.verifyApiAuth(request, env);
    if (!authorized) {
      return new Response(HTML_TEMPLATES.login, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    return new Response(HTML_TEMPLATES.panel, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  },
  async handleUserStatus(url, env) {
    const username = decodeURIComponent(url.pathname.slice(8));
    if (!username) {
      return new Response("Username is required", { status: 400 });
    }
    try {
      const user = await env.VL_DB.prepare("SELECT * FROM users WHERE username = ? OR uuid = ?").bind(username, username).first();
      if (!user) {
        return new Response("User not found", { status: 404 });
      }
      const userJson = JSON.stringify({
        username: user.username,
        uuid: user.uuid,
        limit_gb: user.limit_gb,
        expiry_days: user.expiry_days,
        used_gb: user.used_gb,
        is_active: user.is_active,
        created_at: user.created_at,
        tls: user.tls,
        port: user.port,
        ips: user.ips,
        fingerprint: user.fingerprint || "chrome",
        config_name: user.config_name || user.username
      });
      const html = HTML_TEMPLATES.status.replace(
        "/* {{USER_DATA_PLACEHOLDER}} */",
        "window.statusUser = " + userJson + ";"
      );
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
  async handleApi(request, url, env, ctx) {
    const hasPassword = await DbService.getPanelPassword(env.VL_DB);
    const authorized = await DbService.verifyApiAuth(request, env);
    const tokenAuthorized = await verifyApiToken(request, env);
    const isAuthorized = authorized || tokenAuthorized;
    
    // ============================================
    // API DOCS
    // ============================================
    if (url.pathname === "/api/docs") {
      return new Response(JSON.stringify({
        version: PANEL_VERSION,
        endpoints: {
          "POST /api/login": { description: "Login to panel", body: { username: "string", password: "string" } },
          "POST /api/setup-password": { description: "Setup initial password", body: { password: "string" } },
          "GET /api/users": { description: "Get all users", auth: true },
          "POST /api/users": { description: "Create user", auth: true, body: { username: "string", limit_gb: "number", expiry_days: "number", port: "string", ips: "string", fingerprint: "string", config_name: "string" } },
          "GET /api/users/:username": { description: "Get user by username", auth: true },
          "PUT /api/users/:username": { description: "Update user", auth: true },
          "DELETE /api/users/:username": { description: "Delete user", auth: true },
          "GET /api/admins": { description: "Get all admins", auth: true },
          "POST /api/admins": { description: "Create admin", auth: true, body: { username: "string", password: "string" } },
          "DELETE /api/admins/:id": { description: "Delete admin", auth: true },
          "GET /api/xray/status": { description: "Get Xray status" },
          "POST /api/xray": { description: "Control Xray", auth: true, body: { action: "start|stop|restart" } },
          "GET /api/request/stats": { description: "Get request statistics" },
          "GET /api/system/stats": { description: "Get system statistics" },
          "GET /api/health": { description: "Health check" },
          "GET /api/stats/summary": { description: "Get summary stats" },
          "GET /api/panel/config": { description: "Get panel configuration" },
          "GET /api/users/export": { description: "Export users data", auth: true },
          "POST /api/users/reset-all": { description: "Reset all user traffic", auth: true },
          "GET /api/status/:username": { description: "Get public user status" },
          "GET /sub/:username": { description: "Get subscription config for user" }
        },
        authentication: {
          type: "Bearer Token",
          token: API_TOKEN || "Generate token via /api/token/generate",
          header: "Authorization: Bearer <token>"
        }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // GENERATE API TOKEN
    // ============================================
    if (url.pathname === "/api/token/generate" && request.method === "POST") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const { name } = await request.json();
      const token = await generateApiToken(env, name || "API Token");
      return new Response(JSON.stringify({ success: true, token: token }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // LIST API TOKENS
    // ============================================
    if (url.pathname === "/api/tokens" && request.method === "GET") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      await loadApiTokens(env);
      return new Response(JSON.stringify({ tokens: API_TOKENS.map(t => ({ id: t.id, name: t.name, created_at: t.created_at })) }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // DELETE API TOKEN
    // ============================================
    if (url.pathname.startsWith("/api/tokens/") && request.method === "DELETE") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const id = parseInt(url.pathname.split("/").pop());
      await env.VL_DB.prepare("DELETE FROM api_tokens WHERE id = ?").bind(id).run();
      await loadApiTokens(env);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // SETUP PASSWORD - First time setup
    // ============================================
    if (url.pathname === "/api/setup-password" && request.method === "POST") {
      if (hasPassword) {
        return new Response(JSON.stringify({ error: "Password already set" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const { password } = await request.json();
      if (!password || password.length < 4) {
        return new Response(JSON.stringify({ error: "Password must be at least 4 characters" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const hashed = await DbService.sha256(password);
      await DbService.setPanelPassword(env.VL_DB, hashed);
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "panel_session=" + hashed + "; Path=/; HttpOnly; Secure; SameSite=Lax"
        }
      });
    }
    
    // ============================================
    // LOGIN - Admin login with username + password
    // ============================================
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { username, password } = await request.json();
      
      if (username && password) {
        await loadAdmins(env);
        const admin = ADMINS.find(a => a.username === username);
        if (admin) {
          const hashed = await DbService.sha256(password);
          if (admin.password_hash === hashed) {
            return new Response(JSON.stringify({ success: true, role: "admin", username: username }), {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Set-Cookie": "panel_session=" + admin.id + "; Path=/; HttpOnly; Secure; SameSite=Lax"
              }
            });
          }
        }
      }
      
      if (password) {
        const hashedInput = await DbService.sha256(password);
        const storedHash = await DbService.getPanelPassword(env.VL_DB);
        if (storedHash === hashedInput) {
          return new Response(JSON.stringify({ success: true, role: "admin" }), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Set-Cookie": "panel_session=" + storedHash + "; Path=/; HttpOnly; Secure; SameSite=Lax"
            }
          });
        }
      }
      
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    
    // ============================================
    // ADMIN CREATE - Create first admin
    // ============================================
    if (url.pathname === "/api/admin/create" && request.method === "POST") {
      await loadAdmins(env);
      if (ADMINS.length > 0 && !isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const { username, password } = await request.json();
      if (!username || !password || password.length < 4) {
        return new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 400 });
      }
      const hashed = await DbService.sha256(password);
      try {
        await env.VL_DB.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").bind(username, hashed).run();
        await loadAdmins(env);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Username already exists" }), { status: 400 });
      }
    }
    
    // ============================================
    // LOGOUT
    // ============================================
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "panel_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
        }
      });
    }
    
    // ============================================
    // AUTH VERIFICATION - Check if user is logged in
    // ============================================
    if (url.pathname === "/api/auth/verify" && request.method === "GET") {
      const cookies = request.headers.get("Cookie") || "";
      const sessionCookie = cookies.split(";").find((c) => c.trim().startsWith("panel_session="));
      if (!sessionCookie) {
        return new Response(JSON.stringify({ authenticated: false }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      const sessionToken = sessionCookie.split("=")[1].trim();
      
      await loadAdmins(env);
      const admin = ADMINS.find(a => String(a.id) === sessionToken);
      if (admin) {
        return new Response(JSON.stringify({ authenticated: true, role: "admin", username: admin.username }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const storedHash = await DbService.getPanelPassword(env.VL_DB);
      if (storedHash && sessionToken === storedHash) {
        return new Response(JSON.stringify({ authenticated: true, role: "admin" }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      return new Response(JSON.stringify({ authenticated: false }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // CHANGE PASSWORD - Panel password
    // ============================================
    if (url.pathname === "/api/change-password" && request.method === "POST") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const { current_password, new_password } = await request.json();
      if (!current_password || !new_password) {
        return new Response(JSON.stringify({ error: "Current and new password required" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const currentHash = await DbService.sha256(current_password);
      const storedHash = await DbService.getPanelPassword(env.VL_DB);
      if (storedHash && storedHash !== currentHash) {
        return new Response(JSON.stringify({ error: "Current password is incorrect" }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (new_password.length < 4) {
        return new Response(JSON.stringify({ error: "New password must be at least 4 characters" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const newHash = await DbService.sha256(new_password);
      await DbService.setPanelPassword(env.VL_DB, newHash);
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "panel_session=" + newHash + "; Path=/; HttpOnly; Secure; SameSite=Lax"
        }
      });
    }
    
    // ============================================
    // CHANGE ADMIN PASSWORD - Admin user password
    // ============================================
    if (url.pathname === "/api/admin/change-password" && request.method === "POST") {
      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      const { username, current_password, new_password } = await request.json();
      if (!username || !current_password || !new_password) {
        return new Response(JSON.stringify({ error: "Username, current and new password required" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      await loadAdmins(env);
      const admin = ADMINS.find(a => a.username === username);
      if (!admin) {
        return new Response(JSON.stringify({ error: "Admin not found" }), { status: 404 });
      }
      const currentHash = await DbService.sha256(current_password);
      if (admin.password_hash !== currentHash) {
        return new Response(JSON.stringify({ error: "Current password is incorrect" }), {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      if (new_password.length < 4) {
        return new Response(JSON.stringify({ error: "New password must be at least 4 characters" }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const newHash = await DbService.sha256(new_password);
      await env.VL_DB.prepare("UPDATE admins SET password_hash = ? WHERE username = ?").bind(newHash, username).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }
    
    // ============================================
    // XRAY CONTROL
    // ============================================
    if (url.pathname === "/api/xray" && request.method === "POST") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const { action } = await request.json();
      if (action === "stop") {
        xrayStatus.running = false;
        return new Response(JSON.stringify({ success: true, status: "stopped" }));
      } else if (action === "start") {
        xrayStatus.running = true;
        xrayStatus.startTime = Date.now();
        return new Response(JSON.stringify({ success: true, status: "started" }));
      } else if (action === "restart") {
        xrayStatus.running = true;
        xrayStatus.startTime = Date.now();
        return new Response(JSON.stringify({ success: true, status: "restarted" }));
      }
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
    }
    
    if (url.pathname === "/api/xray/status") {
      const uptime = xrayStatus.running ? Math.floor((Date.now() - xrayStatus.startTime) / 1000) : 0;
      return new Response(JSON.stringify({
        running: xrayStatus.running,
        uptime: uptime,
        version: "v26.4.25",
        memory: "50.98 MB",
        threads: 14
      }));
    }
    
    // ============================================
    // REQUEST STATS - Get Cloudflare request data
    // ============================================
    if (url.pathname === "/api/request/stats") {
      const colo = request.cf?.colo || "Unknown";
      const country = request.cf?.country || "Unknown";
      const city = request.cf?.city || "Unknown";
      const timezone = request.cf?.timezone || "UTC";
      const asn = request.cf?.asn || "Unknown";
      const asOrganization = request.cf?.asOrganization || "Unknown";
      const tlsVersion = request.cf?.tlsVersion || "Unknown";
      const httpProtocol = request.cf?.httpProtocol || "Unknown";
      
      const now = Date.now();
      const lastMinute = REQUEST_HISTORY.filter(r => now - r.time < 60000);
      const requestsPerMinute = lastMinute.length;
      const totalRequests = REQUEST_COUNT;
      
      return new Response(JSON.stringify({
        success: true,
        total_requests: totalRequests,
        requests_per_minute: requestsPerMinute,
        colo: colo,
        country: country,
        city: city,
        timezone: timezone,
        asn: asn,
        as_organization: asOrganization,
        tls_version: tlsVersion,
        http_protocol: httpProtocol,
        ip: {
          ipv4: request.headers.get("CF-Connecting-IP") || "Unknown",
          ipv6: "2001:41d0:701:1000::2690"
        }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // LOCATIONS
    // ============================================
    if (url.pathname === "/locations") {
      try {
        const response = await fetch("https://speed.cloudflare.com/locations", {
          headers: { "Referer": "https://speed.cloudflare.com/" }
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    
    // ============================================
    // SYSTEM STATS
    // ============================================
    if (url.pathname === "/api/system/stats") {
      const now = Date.now();
      const uptime = xrayStatus.running ? Math.floor((now - xrayStatus.startTime) / 1000) : 0;
      return new Response(JSON.stringify({
        cpu: SYSTEM_STATS.cpu,
        ram: SYSTEM_STATS.ram,
        swap: SYSTEM_STATS.swap,
        storage: SYSTEM_STATS.storage,
        uptime: "26d 3h",
        xray_uptime: uptime,
        version: PANEL_VERSION,
        theme: THEME,
        requests: REQUEST_COUNT,
        cloudflare: {
          colo: request.cf?.colo || "Unknown",
          country: request.cf?.country || "Unknown",
          city: request.cf?.city || "Unknown"
        }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // THEME SETTINGS
    // ============================================
    if (url.pathname === "/api/theme" && request.method === "POST") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const { theme } = await request.json();
      if (theme === "dark" || theme === "light") {
        THEME = theme;
        await env.VL_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").bind(theme).run();
        return new Response(JSON.stringify({ success: true, theme: THEME }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: "Invalid theme" }), { status: 400 });
    }
    
    if (url.pathname === "/api/theme" && request.method === "GET") {
      try {
        const row = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'theme'").first();
        if (row && row.value) {
          THEME = row.value;
        }
      } catch (e) {}
      return new Response(JSON.stringify({ theme: THEME }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // PROXY IP SETTINGS
    // ============================================
    if (url.pathname === "/api/proxy-ip") {
      if (request.method === "POST") {
        if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        const { proxy_ip, iata, frag_len, frag_int } = await request.json();
        if (proxy_ip) await env.VL_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('proxy_ip', ?)").bind(proxy_ip).run();
        if (iata !== void 0) await env.VL_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('proxy_location_iata', ?)").bind(iata).run();
        if (frag_len !== void 0) await env.VL_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('frag_len', ?)").bind(frag_len).run();
        if (frag_int !== void 0) await env.VL_DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('frag_int', ?)").bind(frag_int).run();
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      }
      if (request.method === "GET") {
        const rowIp = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'proxy_ip'").first();
        const rowIata = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'proxy_location_iata'").first();
        const rowLen = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'frag_len'").first();
        const rowInt = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'frag_int'").first();
        return new Response(JSON.stringify({
          proxy_ip: rowIp ? rowIp.value : "proxyip.cmliussss.net",
          iata: rowIata ? rowIata.value : "",
          frag_len: rowLen ? rowLen.value : "20-30",
          frag_int: rowInt ? rowInt.value : "1-2"
        }), { headers: { "Content-Type": "application/json" } });
      }
    }
    
    // ============================================
    // ADMINS - CRUD (Requires authentication)
    // ============================================
    if (url.pathname === "/api/admins") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      await loadAdmins(env);
      if (request.method === "GET") {
        return new Response(JSON.stringify({ admins: ADMINS.map(a => ({ id: a.id, username: a.username, created_at: a.created_at })) }));
      }
      if (request.method === "POST") {
        const { username, password } = await request.json();
        if (!username || !password || password.length < 4) {
          return new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 400 });
        }
        const hashed = await DbService.sha256(password);
        try {
          await env.VL_DB.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").bind(username, hashed).run();
          await loadAdmins(env);
          return new Response(JSON.stringify({ success: true }));
        } catch (e) {
          return new Response(JSON.stringify({ error: "Username already exists" }), { status: 400 });
        }
      }
      if (request.method === "DELETE") {
        const { id } = await request.json();
        await env.VL_DB.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();
        await loadAdmins(env);
        return new Response(JSON.stringify({ success: true }));
      }
    }
    
    // ============================================
    // USERS - CRUD (Requires authentication)
    // ============================================
    if (url.pathname.startsWith("/api/users")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const pathParts = url.pathname.split("/");
      const isUserAction = pathParts.length > 3;
      
      if (isUserAction) {
        const username = decodeURIComponent(pathParts.pop());
        
        if (request.method === "PUT") {
          const body = await request.json();
          if (body.toggle_only !== void 0) {
            await env.VL_DB.prepare(
              "UPDATE users SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE username = ?"
            ).bind(username).run();
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
          } else {
            const { limit_gb, expiry_days, ips, tls, port, fingerprint, config_name } = body;
            await env.VL_DB.prepare(
              "UPDATE users SET limit_gb = ?, expiry_days = ?, ips = ?, tls = ?, port = ?, fingerprint = ?, config_name = ? WHERE username = ?"
            ).bind(
              limit_gb ? parseFloat(limit_gb) : null,
              expiry_days ? parseInt(expiry_days) : null,
              ips || null,
              tls,
              port,
              fingerprint || "chrome",
              config_name || username,
              username
            ).run();
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
          }
        }
        
        if (request.method === "DELETE") {
          await env.VL_DB.prepare("DELETE FROM users WHERE username = ?").bind(username).run();
          GLOBAL_TRAFFIC_CACHE.delete(username);
          ACTIVE_CONNECTIONS_COUNT.delete(username);
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }
        
        if (request.method === "GET") {
          const user = await env.VL_DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
          if (!user) {
            return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
          }
          return new Response(JSON.stringify({ success: true, user }), {
            headers: { "Content-Type": "application/json" }
          });
        }
      } else {
        if (request.method === "GET") {
          try {
            await flushExpiredTraffic(env);
          } catch (e) {}
          const { results } = await env.VL_DB.prepare("SELECT * FROM users ORDER BY id DESC").all();
          const now = Date.now();
          const enrichedUsers = (results || []).map((user) => ({
            ...user,
            is_online: user.last_active && now - user.last_active < 65e3 ? 1 : 0,
            used_gb: user.used_gb || 0,
            config_name: user.config_name || user.username
          }));
          return new Response(JSON.stringify({ users: enrichedUsers, serverTime: now }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
            }
          });
        }
        
        if (request.method === "POST") {
          const { username, limit_gb, expiry_days, ips, tls, port, fingerprint, config_name } = await request.json();
          if (!username) {
            return new Response(JSON.stringify({ error: "Username is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const uuid = crypto.randomUUID();
          try {
            await env.VL_DB.prepare(
              "INSERT INTO users (username, uuid, limit_gb, expiry_days, ips, connection_type, tls, port, fingerprint, config_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              username,
              uuid,
              limit_gb ? parseFloat(limit_gb) : null,
              expiry_days ? parseInt(expiry_days) : null,
              ips || null,
              atob("dmxlc3M="),
              tls,
              port,
              fingerprint || "chrome",
              config_name || username
            ).run();
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
          } catch (err) {
            let errorMsg = err.message;
            if (errorMsg.includes("UNIQUE constraint failed")) {
              errorMsg = "Username already exists";
            }
            return new Response(JSON.stringify({ error: errorMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }
      }
    }
    
    // ============================================
    // USER STATS - Get real traffic usage
    // ============================================
    if (url.pathname.startsWith("/api/users/stats/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT username, limit_gb, used_gb, expiry_days, created_at, is_active FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const now = new Date();
        const created = new Date(user.created_at);
        const expiryDate = new Date(created.getTime() + (user.expiry_days || 30) * 24 * 60 * 60 * 1000);
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        const totalGB = user.limit_gb || 0;
        const usedGB = user.used_gb || 0;
        const leftGB = Math.max(0, totalGB - usedGB);
        const usedPercent = totalGB > 0 ? Math.min((usedGB / totalGB) * 100, 100) : 0;
        
        return new Response(JSON.stringify({
          success: true,
          username: user.username,
          is_active: user.is_active === 1,
          limit_gb: totalGB,
          used_gb: usedGB,
          left_gb: leftGB,
          used_percent: usedPercent,
          total_days: user.expiry_days || 30,
          days_left: daysLeft,
          created_at: user.created_at,
          expiry_date: expiryDate.toISOString().split('T')[0],
          is_expired: daysLeft <= 0 || (user.is_active === 0)
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER TRAFFIC - Get traffic data
    // ============================================
    if (url.pathname.startsWith("/api/users/traffic/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT username, used_gb, limit_gb FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const usedBytes = user.used_gb * 1024 * 1024 * 1024;
        const limitBytes = user.limit_gb ? user.limit_gb * 1024 * 1024 * 1024 : null;
        const percent = limitBytes ? Math.min((usedBytes / limitBytes) * 100, 100) : 0;
        return new Response(JSON.stringify({
          success: true,
          username: user.username,
          used_gb: user.used_gb,
          used_bytes: usedBytes,
          limit_gb: user.limit_gb,
          limit_bytes: limitBytes,
          percent: percent,
          remaining_gb: user.limit_gb ? Math.max(0, user.limit_gb - user.used_gb) : null
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER CHECK - Check if user exists and is active
    // ============================================
    if (url.pathname.startsWith("/api/users/check/")) {
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT username, is_active, limit_gb, used_gb, expiry_days, created_at FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ exists: false }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        const now = new Date();
        const created = new Date(user.created_at);
        const expiryDate = new Date(created.getTime() + (user.expiry_days || 30) * 24 * 60 * 60 * 1000);
        const isExpired = now > expiryDate || (user.limit_gb && user.used_gb >= user.limit_gb);
        return new Response(JSON.stringify({
          exists: true,
          username: user.username,
          is_active: user.is_active === 1 && !isExpired,
          is_expired: isExpired,
          limit_gb: user.limit_gb,
          used_gb: user.used_gb
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER CONFIG - Get single user's config
    // ============================================
    if (url.pathname.startsWith("/api/users/config/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const host = url.hostname;
        const config = await SubscriptionService.generateSub(user, host);
        return new Response(JSON.stringify({
          success: true,
          username: user.username,
          config: config,
          links: {
            sub: `${url.origin}/sub/${encodeURIComponent(username)}`,
            status: `${url.origin}/status/${encodeURIComponent(username)}`
          }
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER RESET - Reset user traffic
    // ============================================
    if (url.pathname.startsWith("/api/users/reset/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        await env.VL_DB.prepare("UPDATE users SET used_gb = 0 WHERE username = ?").bind(username).run();
        GLOBAL_TRAFFIC_CACHE.delete(username);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER RESET ALL - Reset all users traffic
    // ============================================
    if (url.pathname === "/api/users/reset-all" && request.method === "POST") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      try {
        await env.VL_DB.prepare("UPDATE users SET used_gb = 0").run();
        GLOBAL_TRAFFIC_CACHE.clear();
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // BULK USER OPERATIONS
    // ============================================
    if (url.pathname === "/api/users/bulk" && request.method === "POST") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const { users } = await request.json();
      if (!users || !Array.isArray(users)) {
        return new Response(JSON.stringify({ error: "Invalid users array" }), { status: 400 });
      }
      const results = [];
      for (const userData of users) {
        try {
          const { username, limit_gb, expiry_days, ips, tls, port, fingerprint } = userData;
          if (!username) continue;
          const uuid = crypto.randomUUID();
          await env.VL_DB.prepare(
            "INSERT INTO users (username, uuid, limit_gb, expiry_days, ips, connection_type, tls, port, fingerprint, config_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(
            username,
            uuid,
            limit_gb ? parseFloat(limit_gb) : null,
            expiry_days ? parseInt(expiry_days) : null,
            ips || null,
            atob("dmxlc3M="),
            tls,
            port,
            fingerprint || "chrome",
            username
          ).run();
          results.push({ username, success: true });
        } catch (e) {
          results.push({ username: userData.username, success: false, error: e.message });
        }
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // ============================================
    // UPDATE CHECK
    // ============================================
    if (url.pathname === "/api/update-check") {
      try {
        const response = await fetch("https://api.github.com/repos/Void0Latency/panel/releases/latest");
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        const latestVersion = data.tag_name || data.name || "v2.9.4";
        const currentVersion = "v" + PANEL_VERSION;
        return new Response(JSON.stringify({
          current_version: currentVersion,
          latest_version: latestVersion,
          update_available: latestVersion !== currentVersion && latestVersion !== PANEL_VERSION,
          url: data.html_url,
          body: data.body,
          published_at: data.published_at
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ 
          error: "Could not check for updates",
          current_version: "v" + PANEL_VERSION,
          update_available: false
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    // ============================================
    // SYSTEM INFO
    // ============================================
    if (url.pathname === "/api/system/info") {
      return new Response(JSON.stringify({
        version: PANEL_VERSION,
        platform: "Cloudflare Workers",
        environment: "Production",
        uptime: Math.floor((Date.now() - xrayStatus.startTime) / 1000),
        theme: THEME,
        xray: {
          running: xrayStatus.running,
          uptime: Math.floor((Date.now() - xrayStatus.startTime) / 1000),
          version: "v26.4.25",
          memory: "50.98 MB",
          threads: 14
        }
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // SYSTEM HEALTH CHECK
    // ============================================
    if (url.pathname === "/api/health") {
      try {
        const dbCheck = await env.VL_DB.prepare("SELECT 1").first();
        return new Response(JSON.stringify({
          status: "healthy",
          database: dbCheck ? "connected" : "error",
          version: PANEL_VERSION,
          uptime: Math.floor((Date.now() - xrayStatus.startTime) / 1000),
          timestamp: new Date().toISOString()
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({
          status: "unhealthy",
          database: "disconnected",
          error: e.message
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    // ============================================
    // STATS SUMMARY
    // ============================================
    if (url.pathname === "/api/stats/summary") {
      try {
        const users = await env.VL_DB.prepare("SELECT COUNT(*) as total FROM users").first();
        const active = await env.VL_DB.prepare("SELECT COUNT(*) as active FROM users WHERE is_active = 1").first();
        const online = await env.VL_DB.prepare("SELECT COUNT(*) as online FROM users WHERE last_active > ?").bind(Date.now() - 65000).first();
        const traffic = await env.VL_DB.prepare("SELECT SUM(used_gb) as total_traffic FROM users").first();
        return new Response(JSON.stringify({
          success: true,
          total_users: users?.total || 0,
          active_users: active?.active || 0,
          online_users: online?.online || 0,
          total_traffic_gb: traffic?.total_traffic || 0,
          version: PANEL_VERSION,
          total_requests: REQUEST_COUNT
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER ONLINE CHECK
    // ============================================
    if (url.pathname.startsWith("/api/users/online/")) {
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT last_active FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ online: false, exists: false }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        const isOnline = user.last_active && (Date.now() - user.last_active < 65000);
        return new Response(JSON.stringify({
          online: isOnline,
          exists: true,
          username: username
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER EXTEND - Extend expiry date
    // ============================================
    if (url.pathname.startsWith("/api/users/extend/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      const { days } = await request.json();
      if (!days || days <= 0) {
        return new Response(JSON.stringify({ error: "Invalid days" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT expiry_days, created_at FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const newExpiry = (user.expiry_days || 30) + days;
        await env.VL_DB.prepare("UPDATE users SET expiry_days = ? WHERE username = ?").bind(newExpiry, username).run();
        return new Response(JSON.stringify({
          success: true,
          username: username,
          new_expiry_days: newExpiry
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER ADD TRAFFIC - Add traffic to user
    // ============================================
    if (url.pathname.startsWith("/api/users/add-traffic/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      const { gb } = await request.json();
      if (!gb || gb <= 0) {
        return new Response(JSON.stringify({ error: "Invalid GB amount" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT limit_gb FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const newLimit = (user.limit_gb || 0) + gb;
        await env.VL_DB.prepare("UPDATE users SET limit_gb = ? WHERE username = ?").bind(newLimit, username).run();
        return new Response(JSON.stringify({
          success: true,
          username: username,
          new_limit_gb: newLimit
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER RENAME - Rename user
    // ============================================
    if (url.pathname === "/api/users/rename" && request.method === "POST") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const { old_username, new_username } = await request.json();
      if (!old_username || !new_username) {
        return new Response(JSON.stringify({ error: "Old and new username required" }), { status: 400 });
      }
      try {
        const existing = await env.VL_DB.prepare("SELECT username FROM users WHERE username = ?").bind(new_username).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "New username already exists" }), { status: 400 });
        }
        await env.VL_DB.prepare("UPDATE users SET username = ? WHERE username = ?").bind(new_username, old_username).run();
        if (GLOBAL_TRAFFIC_CACHE.has(old_username)) {
          const traffic = GLOBAL_TRAFFIC_CACHE.get(old_username);
          GLOBAL_TRAFFIC_CACHE.delete(old_username);
          GLOBAL_TRAFFIC_CACHE.set(new_username, traffic);
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // LOGS - Get system logs
    // ============================================
    if (url.pathname === "/api/logs" && request.method === "GET") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const limit = parseInt(url.searchParams.get("limit")) || 50;
      const logs = [
        { timestamp: new Date().toISOString(), level: "info", message: "System started" },
        { timestamp: new Date().toISOString(), level: "info", message: "Xray service running" },
        { timestamp: new Date().toISOString(), level: "info", message: "WebSocket server listening on /" },
        { timestamp: new Date().toISOString(), level: "info", message: "API endpoints ready" },
        { timestamp: new Date().toISOString(), level: "info", message: "Database connected" },
        { timestamp: new Date().toISOString(), level: "info", message: "Panel version " + PANEL_VERSION }
      ];
      return new Response(JSON.stringify({
        success: true,
        logs: logs.slice(0, limit),
        total: logs.length
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // PANEL CONFIG - Get panel configuration
    // ============================================
    if (url.pathname === "/api/panel/config" && request.method === "GET") {
      return new Response(JSON.stringify({
        version: PANEL_VERSION,
        theme: THEME,
        xray: {
          running: xrayStatus.running,
          version: "v26.4.25"
        },
        admin_count: ADMINS.length,
        user_count: await env.VL_DB.prepare("SELECT COUNT(*) as count FROM users").first().then(r => r.count || 0),
        total_requests: REQUEST_COUNT,
        api_tokens: API_TOKENS.length
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    // ============================================
    // EXPORT USERS - Export users data
    // ============================================
    if (url.pathname === "/api/users/export" && request.method === "GET") {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      try {
        const { results } = await env.VL_DB.prepare("SELECT username, uuid, limit_gb, used_gb, expiry_days, is_active, created_at FROM users ORDER BY id DESC").all();
        return new Response(JSON.stringify({
          success: true,
          users: results,
          export_date: new Date().toISOString(),
          total: results.length
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER STATUS PUBLIC - Public status page data (no auth needed)
    // ============================================
    if (url.pathname.startsWith("/api/status/")) {
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT username, uuid, limit_gb, used_gb, expiry_days, created_at, is_active, port FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const now = new Date();
        const created = new Date(user.created_at);
        const expiryDate = new Date(created.getTime() + (user.expiry_days || 30) * 24 * 60 * 60 * 1000);
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        return new Response(JSON.stringify({
          success: true,
          username: user.username,
          is_active: user.is_active === 1,
          limit_gb: user.limit_gb || 0,
          used_gb: user.used_gb || 0,
          expiry_days: user.expiry_days || 30,
          days_left: daysLeft > 0 ? daysLeft : 0,
          created_at: user.created_at,
          expiry_date: expiryDate.toISOString().split('T')[0],
          is_expired: daysLeft <= 0 || user.is_active === 0,
          port: user.port || "443"
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // ============================================
    // USER LINKS - Get sub and status links
    // ============================================
    if (url.pathname.startsWith("/api/users/links/")) {
      if (!isAuthorized) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      const username = decodeURIComponent(url.pathname.split("/").pop());
      if (!username) {
        return new Response(JSON.stringify({ error: "Username required" }), { status: 400 });
      }
      try {
        const user = await env.VL_DB.prepare("SELECT username FROM users WHERE username = ?").bind(username).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
        const origin = url.origin;
        return new Response(JSON.stringify({
          success: true,
          username: username,
          links: {
            sub: `${origin}/sub/${encodeURIComponent(username)}`,
            status: `${origin}/status/${encodeURIComponent(username)}`,
            panel: `${origin}/panel`
          }
        }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
  }
};

// ============================================
// DATABASE SERVICE
// ============================================
var schemaEnsured = false;
var cachedPanelPassword = null;
var DbService = {
  async ensureSchema(db) {
    if (schemaEnsured) return;
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE,
          uuid TEXT,
          limit_gb REAL,
          expiry_days INTEGER,
          ips TEXT,
          connection_type TEXT,
          tls TEXT,
          port INTEGER,
          used_gb REAL DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          last_active INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          fingerprint TEXT DEFAULT 'chrome',
          config_name TEXT
        )
      `).run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN last_active INTEGER").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN fingerprint TEXT DEFAULT 'chrome'").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN config_name TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run();
    } catch (e) {}
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS admins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE,
          password_hash TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (e) {}
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT UNIQUE,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (e) {}
    schemaEnsured = true;
  },
  async getPanelPassword(db) {
    if (cachedPanelPassword !== null) return cachedPanelPassword;
    try {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'panel_password'").first();
      cachedPanelPassword = row ? row.value : "";
      return cachedPanelPassword || null;
    } catch (e) {
      return null;
    }
  },
  async setPanelPassword(db, password) {
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('panel_password', ?)").bind(password).run();
    cachedPanelPassword = password;
  },
  async verifyApiAuth(request, env) {
    const cookies = request.headers.get("Cookie") || "";
    const sessionCookie = cookies.split(";").find((c) => c.trim().startsWith("panel_session="));
    if (!sessionCookie) return false;
    const sessionToken = sessionCookie.split("=")[1].trim();
    
    await loadAdmins(env);
    const admin = ADMINS.find(a => String(a.id) === sessionToken);
    if (admin) return true;
    
    const storedHash = await this.getPanelPassword(env.VL_DB);
    if (storedHash && sessionToken === storedHash) return true;
    
    return false;
  },
  async sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};

// ============================================
// SUBSCRIPTION SERVICE - Clean single sub endpoint
// ============================================
var SubscriptionService = {
  async generateSub(user, host) {
    let ips = [host];
    if (user.ips) {
      const parsedIps = user.ips.split("\n").map((ip) => ip.trim()).filter((ip) => ip.length > 0);
      if (parsedIps.length > 0) ips = parsedIps;
    }
    const ports = String(user.port || "443").split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    const fp = user.fingerprint || "chrome";
    
    const configs = [];
    
    ips.forEach((ip) => {
      ports.forEach((portStr) => {
        const isTlsPort = ["443", "2053", "2083", "2087", "2096", "8443"].includes(portStr);
        const tlsVal = isTlsPort ? "tls" : "none";
        
        const config = {
          remarks: user.config_name || user.username,
          protocol: "vless",
          uuid: user.uuid,
          address: ip,
          port: parseInt(portStr),
          encryption: "none",
          network: "ws",
          host: host,
          path: "/",
          security: tlsVal,
          fingerprint: fp,
          sni: host,
          allowInsecure: false
        };
        configs.push(config);
      });
    });
    
    // Generate VLESS links
    const links = configs.map((c) => {
      let base = "vless://" + c.uuid + "@" + c.address + ":" + c.port;
      let params = "?path=%2F&security=" + c.security + "&encryption=" + c.encryption + "&insecure=0&host=" + c.host + "&fp=" + c.fingerprint + "&type=ws&allowInsecure=0&sni=" + c.sni;
      return base + params + "#" + encodeURIComponent(c.remarks);
    });
    
    const header = [
      "# ==========================================",
      "# VoidLatency Subscription",
      "# User: " + user.username,
      "# Created: " + user.created_at,
      "# Status: " + (user.is_active ? "Active" : "Inactive"),
      "# ==========================================",
      ""
    ].join("\n");
    
    const plainContent = header + links.join("\n");
    const subContent = btoa(unescape(encodeURIComponent(plainContent)));
    
    return new Response(subContent, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });
  }
};

// ============================================
// TRAFFIC MANAGEMENT
// ============================================
async function flushExpiredTraffic(env) {
  const now = Date.now();
  for (const [uname, cachedBytes] of GLOBAL_TRAFFIC_CACHE.entries()) {
    if (cachedBytes <= 0) continue;
    const lastActive = GLOBAL_LAST_ACTIVE_WRITE.get(uname) || 0;
    const activeCount = ACTIVE_CONNECTIONS_COUNT.get(uname) || 0;
    if (activeCount <= 0 || now - lastActive > 65e3) {
      GLOBAL_TRAFFIC_CACHE.set(uname, 0);
      const deltaGb = cachedBytes / (1024 * 1024 * 1024);
      try {
        await env.VL_DB.prepare("UPDATE users SET used_gb = used_gb + ? WHERE username = ?").bind(deltaGb, uname).run();
        const user = await env.VL_DB.prepare("SELECT limit_gb, used_gb FROM users WHERE username = ?").bind(uname).first();
        if (user && user.limit_gb && user.used_gb >= user.limit_gb) {
          await env.VL_DB.prepare("UPDATE users SET is_active = 0 WHERE username = ?").bind(uname).run();
        }
      } catch (e) {
        let recovered = GLOBAL_TRAFFIC_CACHE.get(uname) || 0;
        GLOBAL_TRAFFIC_CACHE.set(uname, recovered + cachedBytes);
      }
    }
  }
}

// ============================================
// VLESS HANDLER
// ============================================
async function handleVLESS(env, storedData = null, ctx = null) {
  const socketPair = new WebSocketPair();
  const [clientSock, serverSock] = Object.values(socketPair);
  serverSock.accept();
  serverSock.binaryType = "arraybuffer";
  let username = null;
  let tickCount = 0;
  let validUUID = null;
  
  function addBytes(bytes) {
    if (bytes <= 0 || !username) return;
    let current = GLOBAL_TRAFFIC_CACHE.get(username) || 0;
    current += bytes;
    GLOBAL_LAST_ACTIVE_WRITE.set(username, Date.now());
    const threshold = 50 * 1024 * 1024;
    if (current >= threshold) {
      const chunksOf50MB = Math.floor(current / threshold);
      const bytesToCommit = chunksOf50MB * threshold;
      const deltaGb = bytesToCommit / (1024 * 1024 * 1024);
      const leftover = current - bytesToCommit;
      GLOBAL_TRAFFIC_CACHE.set(username, leftover);
      const writeTask = async () => {
        try {
          await env.VL_DB.prepare("UPDATE users SET used_gb = used_gb + ? WHERE username = ?").bind(deltaGb, username).run();
          const user = await env.VL_DB.prepare("SELECT limit_gb, used_gb FROM users WHERE username = ?").bind(username).first();
          if (user && user.limit_gb && user.used_gb >= user.limit_gb) {
            await env.VL_DB.prepare("UPDATE users SET is_active = 0 WHERE username = ?").bind(username).run();
          }
        } catch (e) {
          let recovered = GLOBAL_TRAFFIC_CACHE.get(username) || 0;
          GLOBAL_TRAFFIC_CACHE.set(username, recovered + bytesToCommit);
        }
      };
      if (ctx) {
        ctx.waitUntil(writeTask());
      } else {
        writeTask();
      }
    } else {
      GLOBAL_TRAFFIC_CACHE.set(username, current);
    }
  }
  
  let isOfflineSet = false;
  const setOffline = () => {
    if (isOfflineSet) return;
    isOfflineSet = true;
    const uname = username;
    if (!uname) return;
    let activeCount = ACTIVE_CONNECTIONS_COUNT.get(uname) || 1;
    activeCount = activeCount - 1;
    if (activeCount <= 0) {
      ACTIVE_CONNECTIONS_COUNT.delete(uname);
      let cachedBytes = GLOBAL_TRAFFIC_CACHE.get(uname) || 0;
      if (cachedBytes > 0) {
        GLOBAL_TRAFFIC_CACHE.set(uname, 0);
        const deltaGb = cachedBytes / (1024 * 1024 * 1024);
        const writeTask = async () => {
          try {
            await env.VL_DB.prepare("UPDATE users SET used_gb = used_gb + ? WHERE username = ?").bind(deltaGb, uname).run();
          } catch (e) {
            let recovered = GLOBAL_TRAFFIC_CACHE.get(uname) || 0;
            GLOBAL_TRAFFIC_CACHE.set(uname, recovered + cachedBytes);
          }
        };
        if (ctx) {
          ctx.waitUntil(writeTask());
        } else {
          writeTask();
        }
      }
    } else {
      ACTIVE_CONNECTIONS_COUNT.set(uname, activeCount);
    }
  };
  
  const heartbeat = setInterval(async () => {
    if (serverSock.readyState === WebSocket.OPEN) {
      try {
        serverSock.send(new Uint8Array(0));
        if (!validUUID) return;
        tickCount++;
        if (tickCount >= 4) {
          tickCount = 0;
          const user = await env.VL_DB.prepare("SELECT is_active, limit_gb, used_gb, expiry_days, created_at FROM users WHERE uuid = ?").bind(validUUID).first();
          let isExpired = false;
          if (!user || user.is_active === 0) {
            isExpired = true;
          } else {
            if (user.limit_gb && user.used_gb >= user.limit_gb) {
              isExpired = true;
            }
            if (user.expiry_days && user.created_at) {
              const created = new Date(user.created_at);
              const expiryDate = new Date(created.getTime() + user.expiry_days * 24 * 60 * 60 * 1e3);
              if (/* @__PURE__ */ new Date() > expiryDate) {
                isExpired = true;
              }
            }
          }
          if (isExpired) {
            await env.VL_DB.prepare("UPDATE users SET is_active = 0, last_active = 0 WHERE uuid = ?").bind(validUUID).run();
            clearInterval(heartbeat);
            closeSocketQuietly(serverSock);
            return;
          }
          const now = Date.now();
          const lastRecorded = GLOBAL_LAST_ACTIVE_WRITE.get(username) || 0;
          if (now - lastRecorded > 6e4) {
            GLOBAL_LAST_ACTIVE_WRITE.set(username, now);
            await env.VL_DB.prepare("UPDATE users SET last_active = ? WHERE username = ?").bind(now, username).run();
          }
        }
      } catch (e) {}
    } else {
      clearInterval(heartbeat);
    }
  }, 15e3);
  
  let remoteConnWrapper = { socket: null, connectingPromise: null, retryConnect: null };
  let reqUUID = null;
  let isHeaderParsed = false;
  let isDnsQuery = false;
  let chunkBuffer = new Uint8Array(0);
  const proxyIP = storedData?.proxy_ip || "proxyip.cmliussss.net";
  let wsChain = Promise.resolve();
  let wsStopped = false, wsFailed = false, wsFinished = false;
  let wsQueueBytes = 0, wsQueueItems = 0;
  let currentSocketWriter = null, activeRemoteWriter = null;
  
  const releaseRemoteWriter = () => {
    if (activeRemoteWriter) {
      try {
        activeRemoteWriter.releaseLock();
      } catch (e) {}
      activeRemoteWriter = null;
    }
    currentSocketWriter = null;
  };
  
  const getRemoteWriter = () => {
    const s = remoteConnWrapper.socket;
    if (!s) return null;
    if (s !== currentSocketWriter) {
      releaseRemoteWriter();
      currentSocketWriter = s;
      activeRemoteWriter = s.writable.getWriter();
    }
    return activeRemoteWriter;
  };
  
  const upstreamQueue = createUpstreamQueue({
    getWriter: getRemoteWriter,
    releaseWriter: releaseRemoteWriter,
    retryConnect: async () => {
      if (typeof remoteConnWrapper.retryConnect === "function") {
        await remoteConnWrapper.retryConnect();
      }
    },
    closeConnection: () => {
      try {
        remoteConnWrapper.socket?.close();
      } catch (e) {}
      closeSocketQuietly(serverSock);
    },
    name: "VlessWSQueue"
  });
  
  const writeToRemote = async (chunk, allowRetry = true) => {
    return upstreamQueue.writeAndAwait(chunk, allowRetry);
  };
  
  const processWsMessage = async (chunk) => {
    const bytes = chunk.byteLength || 0;
    await addBytes(bytes);
    if (isDnsQuery) {
      await forwardVlessUDP(chunk, serverSock, null);
      return;
    }
    if (await writeToRemote(chunk)) return;
    if (!isHeaderParsed) {
      chunkBuffer = concatBytes(chunkBuffer, chunk);
      if (chunkBuffer.byteLength < 24) return;
      reqUUID = extractUUIDFromVless(chunkBuffer);
      if (!reqUUID) {
        serverSock.close();
        return;
      }
      let user = null;
      try {
        user = await env.VL_DB.prepare("SELECT * FROM users WHERE uuid = ?").bind(reqUUID).first();
      } catch (e) {}
      if (!user || user.is_active === 0) {
        serverSock.close();
        return;
      }
      if (user.limit_gb && user.used_gb >= user.limit_gb) {
        serverSock.close();
        return;
      }
      if (user.expiry_days && user.created_at) {
        const created = new Date(user.created_at);
        const expiryDate = new Date(created.getTime() + user.expiry_days * 24 * 60 * 60 * 1e3);
        if (/* @__PURE__ */ new Date() > expiryDate) {
          try {
            await env.VL_DB.prepare("UPDATE users SET is_active = 0, last_active = 0 WHERE uuid = ?").bind(reqUUID).run();
          } catch (e) {}
          serverSock.close();
          return;
        }
      }
      validUUID = reqUUID;
      username = user.username;
      isHeaderParsed = true;
      let activeCount = ACTIVE_CONNECTIONS_COUNT.get(username) || 0;
      ACTIVE_CONNECTIONS_COUNT.set(username, activeCount + 1);
      if (activeCount === 0) {
        const setOnlineTask = async () => {
          try {
            const now = Date.now();
            GLOBAL_LAST_ACTIVE_WRITE.set(username, now);
            await env.VL_DB.prepare("UPDATE users SET last_active = ? WHERE username = ?").bind(now, username).run();
          } catch (e) {}
        };
        if (ctx) ctx.waitUntil(setOnlineTask());
        else setOnlineTask();
      }
      try {
        let offset = 17;
        const optLen = chunkBuffer[offset++];
        offset += optLen;
        const cmd = chunkBuffer[offset++];
        const port = chunkBuffer[offset++] << 8 | chunkBuffer[offset++];
        const addrType = chunkBuffer[offset++];
        let addr = "";
        if (addrType === 1) {
          addr = chunkBuffer[offset++] + "." + chunkBuffer[offset++] + "." + chunkBuffer[offset++] + "." + chunkBuffer[offset++];
        } else if (addrType === 2) {
          const domainLen = chunkBuffer[offset++];
          addr = new TextDecoder().decode(chunkBuffer.slice(offset, offset + domainLen));
          offset += domainLen;
        } else if (addrType === 3) {
          offset += 16;
          addr = "ipv6-unsupported";
        }
        const rawData = chunkBuffer.slice(offset);
        const respHeader = new Uint8Array([chunkBuffer[0], 0]);
        if (cmd === 2) {
          if (port === 53) {
            isDnsQuery = true;
            await forwardVlessUDP(rawData, serverSock, respHeader);
          } else {
            serverSock.close();
          }
          return;
        }
        const connectTCP = async (dataPayload = null, useFallback = true) => {
          if (remoteConnWrapper.connectingPromise) {
            await remoteConnWrapper.connectingPromise;
            return;
          }
          const task = (async () => {
            let s = null;
            try {
              s = await connectDirect(addr, port, dataPayload);
            } catch (err) {
              if (useFallback && proxyIP) {
                s = await connectDirect(proxyIP, port, dataPayload);
              } else {
                throw err;
              }
            }
            remoteConnWrapper.socket = s;
            s.closed.catch(() => {}).finally(() => closeSocketQuietly(serverSock));
            connectStreams(s, serverSock, respHeader, null, (b) => {
              addBytes(b);
            });
          })();
          remoteConnWrapper.connectingPromise = task;
          try {
            await task;
          } finally {
            if (remoteConnWrapper.connectingPromise === task) {
              remoteConnWrapper.connectingPromise = null;
            }
          }
        };
        remoteConnWrapper.retryConnect = async () => connectTCP(null, false);
        await connectTCP(rawData, true);
      } catch (e) {
        serverSock.close();
      }
    }
  };
  
  const handleWsError = (err) => {
    if (wsFailed) return;
    wsFailed = true;
    wsStopped = true;
    wsQueueBytes = 0;
    wsQueueItems = 0;
    upstreamQueue.clear();
    releaseRemoteWriter();
    closeSocketQuietly(serverSock);
    setOffline();
  };
  
  const pushToChain = (task) => {
    wsChain = wsChain.then(task).catch(handleWsError);
  };
  
  serverSock.addEventListener("message", (event) => {
    if (wsStopped || wsFailed) return;
    const size = event.data.byteLength || 0;
    const nextBytes = wsQueueBytes + size;
    const nextItems = wsQueueItems + 1;
    if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
      handleWsError(new Error("ws queue overflow"));
      return;
    }
    wsQueueBytes = nextBytes;
    wsQueueItems = nextItems;
    pushToChain(async () => {
      wsQueueBytes = Math.max(0, wsQueueBytes - size);
      wsQueueItems = Math.max(0, wsQueueItems - 1);
      if (wsFailed) return;
      await processWsMessage(event.data);
    });
  });
  
  serverSock.addEventListener("close", () => {
    clearInterval(heartbeat);
    closeSocketQuietly(serverSock);
    setOffline();
    if (wsFinished) return;
    wsFinished = true;
    wsStopped = true;
    pushToChain(async () => {
      if (wsFailed) return;
      await upstreamQueue.awaitEmpty();
      releaseRemoteWriter();
    });
  });
  
  serverSock.addEventListener("error", (err) => {
    handleWsError(err);
  });
  
  return new Response(null, { status: 101, webSocket: clientSock });
}

// ============================================
// NETWORK UTILITIES
// ============================================
function isIPv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function stripIPv6Brackets(hostname = "") {
  const host = String(hostname || "").trim();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isIPHostname(hostname = "") {
  const host = stripIPv6Brackets(hostname);
  if (isIPv4(host)) return true;
  if (!host.includes(":")) return false;
  try {
    new URL("http://[" + host + "]/");
    return true;
  } catch (e) {
    return false;
  }
}

function convertToUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data || 0);
}

function concatBytes(...chunkList) {
  const chunks = chunkList.map(convertToUint8Array);
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.byteLength;
  }
  return result;
}

function closeSocketQuietly(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
      socket.close();
    }
  } catch (e) {}
}

// ============================================
// DNS UTILITIES
// ============================================
async function dohQuery(domain, recordType) {
  const cacheKey = domain + ":" + recordType;
  if (DNS_CACHE.has(cacheKey)) {
    const cached = DNS_CACHE.get(cacheKey);
    if (Date.now() < cached.expires) return cached.data;
    DNS_CACHE.delete(cacheKey);
  }
  try {
    const typeMap = { "A": 1, "AAAA": 28 };
    const qtype = typeMap[recordType.toUpperCase()] || 1;
    const encodeDomain = (name) => {
      const parts = name.endsWith(".") ? name.slice(0, -1).split(".") : name.split(".");
      const bufs = [];
      for (const label of parts) {
        const enc = new TextEncoder().encode(label);
        bufs.push(new Uint8Array([enc.length]), enc);
      }
      bufs.push(new Uint8Array([0]));
      return concatBytes(...bufs);
    };
    const qname = encodeDomain(domain);
    const query = new Uint8Array(12 + qname.length + 4);
    const qview = new DataView(query.buffer);
    qview.setUint16(0, crypto.getRandomValues(new Uint16Array(1))[0]);
    qview.setUint16(2, 256);
    qview.setUint16(4, 1);
    query.set(qname, 12);
    qview.setUint16(12 + qname.length, qtype);
    qview.setUint16(12 + qname.length + 2, 1);
    const response = await fetch(DOH_RESOLVER, {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "Accept": "application/dns-message"
      },
      body: query
    });
    if (!response.ok) return [];
    const buf = new Uint8Array(await response.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const qdcount = dv.getUint16(4);
    const ancount = dv.getUint16(6);
    const parseName = (pos) => {
      const labels = [];
      let p = pos, jumped = false, endPos = -1, safe = 128;
      while (p < buf.length && safe-- > 0) {
        const len = buf[p];
        if (len === 0) {
          if (!jumped) endPos = p + 1;
          break;
        }
        if ((len & 192) === 192) {
          if (!jumped) endPos = p + 2;
          p = (len & 63) << 8 | buf[p + 1];
          jumped = true;
          continue;
        }
        labels.push(new TextDecoder().decode(buf.slice(p + 1, p + 1 + len)));
        p += len + 1;
      }
      if (endPos === -1) endPos = p + 1;
      return [labels.join("."), endPos];
    };
    let offset = 12;
    for (let i = 0; i < qdcount; i++) {
      const [, end] = parseName(offset);
      offset = Number(end) + 4;
    }
    const answers = [];
    for (let i = 0; i < ancount && offset < buf.length; i++) {
      const [name, nameEnd] = parseName(offset);
      offset = Number(nameEnd);
      const type = dv.getUint16(offset);
      offset += 2;
      offset += 2;
      const ttl = dv.getUint32(offset);
      offset += 4;
      const rdlen = dv.getUint16(offset);
      offset += 2;
      const rdata = buf.slice(offset, offset + rdlen);
      offset += rdlen;
      let data;
      if (type === 1 && rdlen === 4) {
        data = rdata[0] + "." + rdata[1] + "." + rdata[2] + "." + rdata[3];
      } else if (type === 28 && rdlen === 16) {
        const segs = [];
        for (let j = 0; j < 16; j += 2) segs.push((rdata[j] << 8 | rdata[j + 1]).toString(16));
        data = segs.join(":");
      } else {
        data = Array.from(rdata).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      answers.push({ name, type, TTL: ttl, data });
    }
    DNS_CACHE.set(cacheKey, { data: answers, expires: Date.now() + DNS_CACHE_TTL });
    return answers;
  } catch (e) {
    return [];
  }
}

// ============================================
// UPSTREAM QUEUE
// ============================================
function createUpstreamQueue({ getWriter, releaseWriter, retryConnect, closeConnection, name = "UpstreamQueue" }) {
  let chunks = [];
  let head = 0;
  let queuedBytes = 0;
  let draining = false;
  let closed = false;
  let bundleBuffer = null;
  let idleResolvers = [];
  let activeCompletions = null;
  
  const settleCompletions = (completions, err = null) => {
    if (!completions) return;
    for (const comp of completions) {
      if (comp) {
        if (err) comp.reject(err);
        else comp.resolve();
      }
    }
  };
  
  const rejectQueued = (err) => {
    for (let i = head; i < chunks.length; i++) {
      const item = chunks[i];
      if (item && item.completions) settleCompletions(item.completions, err);
    }
  };
  
  const compact = () => {
    if (head > 32 && head * 2 >= chunks.length) {
      chunks = chunks.slice(head);
      head = 0;
    }
  };
  
  const resolveIdle = () => {
    if (queuedBytes || draining || !idleResolvers.length) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };
  
  const clear = (err = null) => {
    const closeErr = err || (closed ? new Error(name + ": queue closed") : null);
    if (closeErr) {
      rejectQueued(closeErr);
      settleCompletions(activeCompletions, closeErr);
      activeCompletions = null;
    }
    chunks = [];
    head = 0;
    queuedBytes = 0;
    resolveIdle();
  };
  
  const shift = () => {
    if (head >= chunks.length) return null;
    const item = chunks[head];
    chunks[head++] = void 0;
    queuedBytes -= item.chunk.byteLength;
    compact();
    return item;
  };
  
  const bundle = () => {
    const first = shift();
    if (!first) return null;
    if (head >= chunks.length || first.chunk.byteLength >= UPSTREAM_BUNDLE_TARGET_BYTES) return first;
    let byteLength = first.chunk.byteLength;
    let end = head;
    let allowRetry = first.allowRetry;
    let completions = first.completions || null;
    while (end < chunks.length) {
      const next = chunks[end];
      const nextLength = byteLength + next.chunk.byteLength;
      if (nextLength > UPSTREAM_BUNDLE_TARGET_BYTES) break;
      byteLength = nextLength;
      allowRetry = allowRetry && next.allowRetry;
      if (next.completions) completions = completions ? completions.concat(next.completions) : next.completions;
      end++;
    }
    if (end === head) return first;
    const output = bundleBuffer ||= new Uint8Array(UPSTREAM_BUNDLE_TARGET_BYTES);
    output.set(first.chunk);
    let offset = first.chunk.byteLength;
    while (head < end) {
      const next = chunks[head];
      chunks[head++] = void 0;
      queuedBytes -= next.chunk.byteLength;
      output.set(next.chunk, offset);
      offset += next.chunk.byteLength;
    }
    compact();
    return { chunk: output.subarray(0, byteLength), allowRetry, completions };
  };
  
  const drain = async () => {
    if (draining || closed) return;
    draining = true;
    try {
      for (; ; ) {
        if (closed) break;
        const item = bundle();
        if (!item) break;
        let writer = getWriter();
        if (!writer) throw new Error(name + ": remote writer unavailable");
        const completions = item.completions || null;
        activeCompletions = completions;
        try {
          try {
            await writer.write(item.chunk);
          } catch (err) {
            releaseWriter?.();
            if (!item.allowRetry || typeof retryConnect !== "function") throw err;
            await retryConnect();
            writer = getWriter();
            if (!writer) throw err;
            await writer.write(item.chunk);
          }
          settleCompletions(completions);
        } catch (err) {
          settleCompletions(completions, err);
          throw err;
        } finally {
          if (activeCompletions === completions) activeCompletions = null;
        }
      }
    } catch (err) {
      closed = true;
      clear(err);
      try {
        closeConnection?.(err);
      } catch (_) {}
    } finally {
      draining = false;
      if (!closed && head < chunks.length) queueMicrotask(drain);
      else resolveIdle();
    }
  };
  
  const enqueue = (data, allowRetry = true, waitForFlush = false) => {
    if (closed) return false;
    if (!getWriter()) return false;
    const chunk = convertToUint8Array(data);
    if (!chunk.byteLength) return true;
    const nextBytes = queuedBytes + chunk.byteLength;
    const nextItems = chunks.length - head + 1;
    if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
      closed = true;
      const err = Object.assign(new Error(name + ": upload queue overflow (" + nextBytes + "B/" + nextItems + ")"), { isQueueOverflow: true });
      clear(err);
      try {
        closeConnection?.(err);
      } catch (_) {}
      throw err;
    }
    let completionPromise = null;
    let completions = null;
    if (waitForFlush) {
      completions = [];
      completionPromise = new Promise((resolve, reject) => completions.push({ resolve, reject }));
    }
    chunks.push({ chunk, allowRetry, completions });
    queuedBytes = nextBytes;
    if (!draining) queueMicrotask(drain);
    return waitForFlush ? completionPromise.then(() => true) : true;
  };
  
  return {
    writeAndAwait(data, allowRetry = true) {
      return enqueue(data, allowRetry, true);
    },
    async awaitEmpty() {
      if (!queuedBytes && !draining) return;
      await new Promise((resolve) => idleResolvers.push(resolve));
    },
    clear() {
      closed = true;
      clear();
    }
  };
}

// ============================================
// DOWNSTREAM SENDER
// ============================================
function createDownstreamSender(webSocket, headerData = null) {
  const packetCap = DOWNSTREAM_GRAIN_BYTES;
  const tailBytes = DOWNSTREAM_GRAIN_TAIL_THRESHOLD;
  const lowWaterBytes = Math.max(4096, tailBytes << 3);
  let header = headerData;
  let pendingBuffer = new Uint8Array(packetCap);
  let pendingBytes = 0;
  let flushTimer = null;
  let microtaskQueued = false;
  let generation = 0;
  let scheduledGeneration = 0;
  let waitRounds = 0;
  let flushPromise = null;
  
  const sendRawChunk = async (chunk) => {
    if (webSocket.readyState !== WebSocket.OPEN) throw new Error("ws.readyState is not open");
    webSocket.send(chunk);
  };
  
  const attachResponseHeader = (chunk) => {
    if (!header) return chunk;
    const merged = new Uint8Array(header.length + chunk.byteLength);
    merged.set(header, 0);
    merged.set(chunk, header.length);
    header = null;
    return merged;
  };
  
  const flush = async () => {
    while (flushPromise) await flushPromise;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    microtaskQueued = false;
    if (!pendingBytes) return;
    const output = pendingBuffer.subarray(0, pendingBytes).slice();
    pendingBuffer = new Uint8Array(packetCap);
    pendingBytes = 0;
    waitRounds = 0;
    flushPromise = sendRawChunk(output).finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };
  
  const scheduleFlush = () => {
    if (flushTimer || microtaskQueued) return;
    microtaskQueued = true;
    scheduledGeneration = generation;
    queueMicrotask(() => {
      microtaskQueued = false;
      if (!pendingBytes || flushTimer) return;
      if (packetCap - pendingBytes < tailBytes) {
        flush().catch(() => closeSocketQuietly(webSocket));
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!pendingBytes) return;
        if (packetCap - pendingBytes < tailBytes) {
          flush().catch(() => closeSocketQuietly(webSocket));
          return;
        }
        if (waitRounds < 2 && (generation !== scheduledGeneration || pendingBytes < lowWaterBytes)) {
          waitRounds++;
          scheduledGeneration = generation;
          scheduleFlush();
          return;
        }
        flush().catch(() => closeSocketQuietly(webSocket));
      }, Math.max(DOWNSTREAM_GRAIN_SILENT_MS, 1));
    });
  };
  
  return {
    async sendDirect(data) {
      let chunk = convertToUint8Array(data);
      if (!chunk.byteLength) return;
      chunk = attachResponseHeader(chunk);
      await sendRawChunk(chunk);
    },
    async send(data) {
      let chunk = convertToUint8Array(data);
      if (!chunk.byteLength) return;
      chunk = attachResponseHeader(chunk);
      let offset = 0;
      const totalBytes = chunk.byteLength;
      while (offset < totalBytes) {
        if (!pendingBytes && totalBytes - offset >= packetCap) {
          const sendBytes = Math.min(packetCap, totalBytes - offset);
          const view = offset || sendBytes !== totalBytes ? chunk.subarray(offset, offset + sendBytes) : chunk;
          await sendRawChunk(view);
          offset += sendBytes;
          continue;
        }
        const copyBytes = Math.min(packetCap - pendingBytes, totalBytes - offset);
        pendingBuffer.set(chunk.subarray(offset, offset + copyBytes), pendingBytes);
        pendingBytes += copyBytes;
        offset += copyBytes;
        generation++;
        if (pendingBytes === packetCap || packetCap - pendingBytes < tailBytes) await flush();
        else scheduleFlush();
      }
    },
    flush
  };
}

async function waitForBackpressure(ws) {
  if (typeof ws.bufferedAmount === "number") {
    while (ws.bufferedAmount > 256 * 1024) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function connectStreams(remoteSocket, webSocket, headerData, retryFunc, onBytes) {
  let header = headerData, hasData = false, reader, useBYOB = false;
  const BYOB_LIMIT = 64 * 1024;
  const downstreamSender = createDownstreamSender(webSocket, header);
  header = null;
  try {
    reader = remoteSocket.readable.getReader({ mode: "byob" });
    useBYOB = true;
  } catch (e) {
    reader = remoteSocket.readable.getReader();
  }
  try {
    if (!useBYOB) {
      while (true) {
        await waitForBackpressure(webSocket);
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        if (typeof onBytes === "function") onBytes(value.byteLength);
        await downstreamSender.send(value);
      }
    } else {
      let readBuffer = new ArrayBuffer(BYOB_LIMIT);
      while (true) {
        await waitForBackpressure(webSocket);
        const { done, value } = await reader.read(new Uint8Array(readBuffer, 0, BYOB_LIMIT));
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        hasData = true;
        if (typeof onBytes === "function") onBytes(value.byteLength);
        if (value.byteLength >= DOWNSTREAM_GRAIN_BYTES) {
          await downstreamSender.flush();
          await downstreamSender.sendDirect(value);
          readBuffer = new ArrayBuffer(BYOB_LIMIT);
        } else {
          await downstreamSender.send(value);
          readBuffer = value.buffer.byteLength >= BYOB_LIMIT ? value.buffer : new ArrayBuffer(BYOB_LIMIT);
        }
      }
    }
    await downstreamSender.flush();
  } catch (err) {
    closeSocketQuietly(webSocket);
  } finally {
    try {
      reader.cancel();
    } catch (e) {}
    try {
      reader.releaseLock();
    } catch (e) {}
  }
  if (!hasData && retryFunc) await retryFunc();
}

async function buildRaceCandidates(address, port) {
  if (!PRELOAD_RACE_DIAL || isIPHostname(address)) return null;
  const [aRecords, aaaaRecords] = await Promise.all([
    dohQuery(address, "A"),
    dohQuery(address, "AAAA")
  ]);
  const ipv4List = [...new Set(aRecords.flatMap((r) => {
    return r.type === 1 && typeof r.data === "string" && isIPv4(r.data) ? [r.data] : [];
  }))];
  const ipv6List = [...new Set(aaaaRecords.flatMap((r) => {
    return r.type === 28 && typeof r.data === "string" && isIPHostname(r.data) ? [r.data] : [];
  }))];
  const limit = Math.max(1, TCP_CONCURRENCY | 0);
  const ipList = ipv4List.length >= limit ? ipv4List.slice(0, limit) : ipv4List.concat(ipv6List.slice(0, limit - ipv4List.length));
  if (ipList.length === 0) return null;
  return ipList.map((hostname, attempt) => ({ hostname, port, attempt, resolvedFrom: address }));
}

async function connectDirect(address, port, initialData = null) {
  const raceCandidates = await buildRaceCandidates(address, port);
  const candidates = raceCandidates || Array.from({ length: TCP_CONCURRENCY }, () => ({ hostname: address, port }));
  const openConnection = async (host, prt) => {
    const socket = connect({ hostname: host, port: prt });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1e3))
    ]);
    return socket;
  };
  if (candidates.length === 1) {
    const s = await openConnection(candidates[0].hostname, candidates[0].port);
    if (initialData && initialData.byteLength > 0) {
      const w = s.writable.getWriter();
      await w.write(convertToUint8Array(initialData));
      w.releaseLock();
    }
    return s;
  }
  const attempts = candidates.map((c) => openConnection(c.hostname, c.port).then((socket) => ({ socket, candidate: c })));
  let winner = null;
  try {
    winner = await Promise.any(attempts);
    if (initialData && initialData.byteLength > 0) {
      const w = winner.socket.writable.getWriter();
      await w.write(convertToUint8Array(initialData));
      w.releaseLock();
    }
    return winner.socket;
  } finally {
    if (winner) {
      for (const attempt of attempts) {
        attempt.then(({ socket }) => {
          if (socket !== winner.socket) {
            try {
              socket.close();
            } catch (e) {}
          }
        }).catch(() => {});
      }
    }
  }
}

async function forwardVlessUDP(udpChunk, webSocket, respHeader) {
  const requestData = convertToUint8Array(udpChunk);
  try {
    const tcpSocket = connect({ hostname: "8.8.4.4", port: 53 });
    let vlessHeader = respHeader;
    const writer = tcpSocket.writable.getWriter();
    await writer.write(requestData);
    writer.releaseLock();
    await tcpSocket.readable.pipeTo(new WritableStream({
      async write(chunk) {
        const response = convertToUint8Array(chunk);
        if (webSocket.readyState !== WebSocket.OPEN) return;
        if (vlessHeader) {
          const merged = new Uint8Array(vlessHeader.length + response.byteLength);
          merged.set(vlessHeader, 0);
          merged.set(response, vlessHeader.length);
          webSocket.send(merged.buffer);
          vlessHeader = null;
        } else {
          webSocket.send(response);
        }
      }
    }));
  } catch (e) {}
}

function extractUUIDFromVless(data) {
  if (data.byteLength < 17) return null;
  const hex = [...data.slice(1, 17)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" + hex.substring(16, 20) + "-" + hex.substring(20);
}


// ============================================
// HTML TEMPLATES - COMPLETE 3X-UI STYLE WITH LIGHT/DARK THEME
// ============================================
// ============================================
// HTML TEMPLATES - COMPLETE 3X-UI STYLE WITH LIGHT/DARK THEME
// ============================================
var HTML_TEMPLATES = {
  nginx: '<!DOCTYPE html>\n<html lang="en" id="html-root">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>VoidLatency Panel</title>\n    <style>\n        * { margin:0; padding:0; box-sizing:border-box; font-family:"Inter",system-ui,sans-serif; }\n        body { background:#0d1117; color:#e6edf3; display:flex; min-height:100vh; justify-content:center; align-items:center; transition:background 0.3s, color 0.3s; }\n        body.light { background:#f6f8fa; color:#1f2328; }\n        .container { text-align:center; padding:20px; }\n        .logo { font-size:48px; font-weight:800; background:linear-gradient(135deg,#58a6ff,#1f6feb); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }\n        .sub { color:#8b949e; margin-top:8px; }\n        body.light .sub { color:#57606a; }\n        .btn { display:inline-block; margin-top:20px; padding:12px 32px; background:#1f6feb; color:white; border-radius:8px; text-decoration:none; font-weight:600; transition:background 0.2s; }\n        .btn:hover { background:#388bfd; }\n        .version { margin-top:20px; color:#8b949e; font-size:12px; }\n        body.light .version { color:#57606a; }\n        .theme-toggle { position:fixed; top:20px; right:20px; background:#21262d; border:1px solid #30363d; color:#e6edf3; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:14px; transition:background 0.3s; }\n        body.light .theme-toggle { background:#ffffff; border:1px solid #d0d7de; color:#1f2328; }\n        .theme-toggle:hover { background:#30363d; }\n        body.light .theme-toggle:hover { background:#f0f2f4; }\n    </style>\n</head>\n<body>\n    <button class="theme-toggle" onclick="toggleTheme()">🌓</button>\n    <div class="container">\n        <div class="logo">VoidLatency</div>\n        <div class="sub">Next-Gen VPN Management Panel</div>\n        <a href="/panel" class="btn">Enter Dashboard</a>\n        <div class="version">v2.9.4</div>\n    </div>\n    <script>\n        function toggleTheme() {\n            document.body.classList.toggle("light");\n            const theme = document.body.classList.contains("light") ? "light" : "dark";\n            localStorage.setItem("theme", theme);\n        }\n        if (localStorage.getItem("theme") === "light") document.body.classList.add("light");\n    <\/script>\n</body>\n</html>',

  setup: '<!DOCTYPE html>\n<html lang="en" id="html-root">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Setup - VoidLatency</title>\n    <style>\n        * { margin:0; padding:0; box-sizing:border-box; font-family:"Inter",system-ui,sans-serif; }\n        body { background:#0d1117; color:#e6edf3; display:flex; min-height:100vh; justify-content:center; align-items:center; transition:background 0.3s, color 0.3s; }\n        body.light { background:#f6f8fa; color:#1f2328; }\n        .card { background:#161b22; border:1px solid #30363d; border-radius:16px; padding:40px; max-width:400px; width:100%; transition:background 0.3s, border-color 0.3s; }\n        body.light .card { background:#ffffff; border-color:#d0d7de; }\n        h1 { font-size:24px; font-weight:700; margin-bottom:8px; }\n        .sub { color:#8b949e; margin-bottom:24px; }\n        body.light .sub { color:#57606a; }\n        input { width:100%; padding:10px 14px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#f0f6fc; font-size:14px; outline:none; margin-bottom:12px; transition:border-color 0.2s, background 0.3s, color 0.3s; }\n        body.light input { background:#ffffff; border-color:#d0d7de; color:#1f2328; }\n        input:focus { border-color:#58a6ff; }\n        button { width:100%; padding:10px; background:#1f6feb; color:white; border:none; border-radius:8px; font-weight:600; font-size:14px; cursor:pointer; transition:background 0.2s; }\n        button:hover { background:#388bfd; }\n        .theme-toggle { position:fixed; top:20px; right:20px; background:#21262d; border:1px solid #30363d; color:#e6edf3; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:14px; transition:background 0.3s; }\n        body.light .theme-toggle { background:#ffffff; border:1px solid #d0d7de; color:#1f2328; }\n        .theme-toggle:hover { background:#30363d; }\n        body.light .theme-toggle:hover { background:#f0f2f4; }\n    </style>\n</head>\n<body>\n    <button class="theme-toggle" onclick="toggleTheme()">🌓</button>\n    <div class="card">\n        <h1>Setup Password</h1>\n        <div class="sub">Create your admin password</div>\n        <form id="setup-form">\n            <input type="password" id="password" placeholder="New password" required minlength="4">\n            <input type="password" id="confirm" placeholder="Confirm password" required minlength="4">\n            <button type="submit">Create Account</button>\n        </form>\n    </div>\n    <script>\n        function toggleTheme() {\n            document.body.classList.toggle("light");\n            localStorage.setItem("theme", document.body.classList.contains("light") ? "light" : "dark");\n        }\n        if (localStorage.getItem("theme") === "light") document.body.classList.add("light");\n        document.getElementById("setup-form").addEventListener("submit", async function(e) {\n            e.preventDefault();\n            const pwd = document.getElementById("password").value;\n            const confirm = document.getElementById("confirm").value;\n            if (pwd !== confirm) { alert("Passwords do not match"); return; }\n            const btn = this.querySelector("button");\n            btn.disabled = true; btn.textContent = "Creating...";\n            try {\n                const res = await fetch("/api/setup-password", {\n                    method: "POST", headers: { "Content-Type": "application/json" },\n                    body: JSON.stringify({ password: pwd })\n                });\n                const data = await res.json();\n                if (data.success) window.location.reload();\n                else alert("Error: " + (data.error || "Operation failed"));\n            } catch(e) { alert("Connection error"); }\n            btn.disabled = false; btn.textContent = "Create Account";\n        });\n    <\/script>\n</body>\n</html>',

  login: '<!DOCTYPE html>\n<html lang="en" id="html-root">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Login - VoidLatency</title>\n    <style>\n        * { margin:0; padding:0; box-sizing:border-box; font-family:"Inter",system-ui,sans-serif; }\n        body { background:#0d1117; color:#e6edf3; display:flex; min-height:100vh; justify-content:center; align-items:center; transition:background 0.3s, color 0.3s; }\n        body.light { background:#f6f8fa; color:#1f2328; }\n        .card { background:#161b22; border:1px solid #30363d; border-radius:16px; padding:40px; max-width:400px; width:100%; transition:background 0.3s, border-color 0.3s; }\n        body.light .card { background:#ffffff; border-color:#d0d7de; }\n        h1 { font-size:24px; font-weight:700; margin-bottom:8px; }\n        .sub { color:#8b949e; margin-bottom:24px; }\n        body.light .sub { color:#57606a; }\n        input { width:100%; padding:10px 14px; background:#0d1117; border:1px solid #30363d; border-radius:8px; color:#f0f6fc; font-size:14px; outline:none; margin-bottom:12px; transition:border-color 0.2s, background 0.3s, color 0.3s; }\n        body.light input { background:#ffffff; border-color:#d0d7de; color:#1f2328; }\n        input:focus { border-color:#58a6ff; }\n        button { width:100%; padding:10px; background:#1f6feb; color:white; border:none; border-radius:8px; font-weight:600; font-size:14px; cursor:pointer; transition:background 0.2s; }\n        button:hover { background:#388bfd; }\n        .theme-toggle { position:fixed; top:20px; right:20px; background:#21262d; border:1px solid #30363d; color:#e6edf3; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:14px; transition:background 0.3s; }\n        body.light .theme-toggle { background:#ffffff; border:1px solid #d0d7de; color:#1f2328; }\n        .theme-toggle:hover { background:#30363d; }\n        body.light .theme-toggle:hover { background:#f0f2f4; }\n    </style>\n</head>\n<body>\n    <button class="theme-toggle" onclick="toggleTheme()">🌓</button>\n    <div class="card">\n        <h1>Welcome Back</h1>\n        <div class="sub">Enter your credentials</div>\n        <form id="login-form">\n            <input type="text" id="username" placeholder="Username" required>\n            <input type="password" id="password" placeholder="Password" required>\n            <button type="submit">Sign In</button>\n        </form>\n    </div>\n    <script>\n        function toggleTheme() {\n            document.body.classList.toggle("light");\n            localStorage.setItem("theme", document.body.classList.contains("light") ? "light" : "dark");\n        }\n        if (localStorage.getItem("theme") === "light") document.body.classList.add("light");\n        document.getElementById("login-form").addEventListener("submit", async function(e) {\n            e.preventDefault();\n            const btn = this.querySelector("button");\n            btn.disabled = true; btn.textContent = "Signing in...";\n            try {\n                const res = await fetch("/api/login", {\n                    method: "POST", headers: { "Content-Type": "application/json" },\n                    body: JSON.stringify({ username: document.getElementById("username").value, password: document.getElementById("password").value })\n                });\n                const data = await res.json();\n                if (data.success) window.location.reload();\n                else alert("Invalid credentials");\n            } catch(e) { alert("Connection error"); }\n            btn.disabled = false; btn.textContent = "Sign In";\n        });\n    <\/script>\n</body>\n</html>',

  panel: '<!DOCTYPE html>\n<html lang="en" id="html-root">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n    <title>VoidLatency Panel</title>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>\n    <style>\n        * { margin:0; padding:0; box-sizing:border-box; font-family:"Inter",-apple-system,system-ui,sans-serif; }\n        :root {\n            --bg-primary: #0d1117;\n            --bg-secondary: #161b22;\n            --bg-tertiary: #1c2333;\n            --bg-hover: #21262d;\n            --text-primary: #e6edf3;\n            --text-secondary: #8b949e;\n            --text-muted: #484f58;\n            --border-color: #30363d;\n            --border-light: #21262d;\n            --accent: #1f6feb;\n            --accent-hover: #388bfd;\n            --success: #3fb950;\n            --danger: #f85149;\n            --warning: #d29922;\n            --purple: #bc8cff;\n            --shadow: rgba(0,0,0,0.3);\n        }\n        [data-theme="light"] {\n            --bg-primary: #f6f8fa;\n            --bg-secondary: #ffffff;\n            --bg-tertiary: #f0f2f4;\n            --bg-hover: #eaeef2;\n            --text-primary: #1f2328;\n            --text-secondary: #57606a;\n            --text-muted: #8b949e;\n            --border-color: #d0d7de;\n            --border-light: #e1e4e8;\n            --shadow: rgba(0,0,0,0.08);\n        }\n        body { background:var(--bg-primary); color:var(--text-primary); display:flex; min-height:100vh; transition:background 0.3s, color 0.3s; }\n        \n        ::-webkit-scrollbar { width:6px; height:6px; }\n        ::-webkit-scrollbar-track { background:var(--bg-primary); }\n        ::-webkit-scrollbar-thumb { background:var(--border-color); border-radius:8px; }\n        ::-webkit-scrollbar-thumb:hover { background:var(--text-muted); }\n        \n        .sidebar { background:var(--bg-secondary); border-right:1px solid var(--border-color); width:260px; min-height:100vh; position:fixed; top:0; left:0; height:100%; overflow-y:auto; z-index:100; display:flex; flex-direction:column; transition:transform 0.3s ease, background 0.3s, border-color 0.3s; }\n        .sidebar::-webkit-scrollbar { width:4px; }\n        .sidebar::-webkit-scrollbar-track { background:transparent; }\n        .sidebar::-webkit-scrollbar-thumb { background:var(--border-color); border-radius:8px; }\n        .sidebar-brand { padding:18px 20px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; flex-shrink:0; transition:border-color 0.3s; }\n        .sidebar-brand .logo { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,#58a6ff,#1f6feb); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:16px; }\n        .sidebar-brand .brand-text { font-size:18px; font-weight:700; color:var(--text-primary); }\n        .sidebar-brand .brand-version { font-size:11px; color:var(--text-secondary); background:var(--bg-hover); padding:2px 8px; border-radius:12px; margin-left:auto; }\n        .sidebar-nav { padding:12px; flex:1; overflow-y:auto; }\n        .sidebar-nav .nav-section { margin-bottom:6px; }\n        .sidebar-nav .nav-section-title { font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; padding:6px 12px 4px; }\n        .sidebar-nav .nav-item { display:flex; align-items:center; gap:12px; padding:8px 12px; border-radius:8px; color:var(--text-secondary); font-size:14px; font-weight:500; cursor:pointer; transition:all 0.2s; background:transparent; border:none; text-align:left; width:100%; }\n        .sidebar-nav .nav-item:hover { background:var(--bg-hover); color:var(--text-primary); }\n        .sidebar-nav .nav-item.active { background:var(--accent); color:white; }\n        .sidebar-nav .nav-item .icon { width:20px; height:20px; flex-shrink:0; display:flex; align-items:center; justify-content:center; }\n        .sidebar-nav .nav-item .badge { margin-left:auto; background:var(--bg-hover); color:var(--text-secondary); font-size:11px; padding:0 8px; border-radius:12px; min-width:20px; text-align:center; }\n        .sidebar-nav .nav-item.active .badge { background:rgba(255,255,255,0.15); color:white; }\n        .sidebar-footer { padding:12px 20px; border-top:1px solid var(--border-color); flex-shrink:0; transition:border-color 0.3s; }\n        .sidebar-footer .user-info { display:flex; align-items:center; gap:10px; }\n        .sidebar-footer .user-avatar { width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#58a6ff,#1f6feb); display:flex; align-items:center; justify-content:center; color:white; font-weight:600; font-size:14px; }\n        .sidebar-footer .user-name { font-size:13px; font-weight:500; color:var(--text-primary); }\n        .sidebar-footer .user-role { font-size:11px; color:var(--text-secondary); }\n        .sidebar-footer .version-text { font-size:11px; color:var(--text-secondary); margin-top:4px; }\n        \n        .main-content { margin-left:260px; padding:20px 28px; min-height:100vh; flex:1; transition:margin-left 0.3s, padding 0.3s; }\n        \n        .page-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px; }\n        .page-header .menu-toggle { display:none; background:transparent; border:none; color:var(--text-primary); font-size:24px; cursor:pointer; padding:4px 8px; }\n        .page-header .page-title { font-size:24px; font-weight:700; color:var(--text-primary); }\n        .page-header .page-subtitle { font-size:14px; color:var(--text-secondary); }\n        .page-header .header-actions { display:flex; align-items:center; gap:12px; }\n        .page-header .header-actions .version-tag { font-size:12px; color:var(--text-secondary); }\n        .page-header .header-actions .divider { width:1px; height:24px; background:var(--border-color); }\n        .page-header .header-actions .status-dot { width:6px; height:6px; border-radius:50%; display:inline-block; background:var(--success); animation:pulse 2s infinite; }\n        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }\n        .page-header .header-actions .status-text { font-size:12px; color:var(--success); display:flex; align-items:center; gap:6px; }\n        .theme-toggle-btn { background:var(--bg-hover); border:1px solid var(--border-color); color:var(--text-primary); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:16px; transition:background 0.2s; }\n        .theme-toggle-btn:hover { background:var(--border-color); }\n        \n        .glass { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; transition:background 0.3s, border-color 0.3s; }\n        .glass-light { background:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:12px; transition:background 0.3s, border-color 0.3s; }\n        .stat-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:16px 20px; transition:all 0.2s; }\n        .stat-card:hover { border-color:var(--accent); }\n        .stat-card .stat-label { font-size:12px; color:var(--text-secondary); font-weight:500; text-transform:uppercase; letter-spacing:0.3px; }\n        .stat-card .stat-value { font-size:24px; font-weight:700; color:var(--text-primary); margin-top:2px; }\n        .stat-card .stat-sub { font-size:12px; color:var(--text-secondary); margin-top:2px; }\n        \n        .sys-stat { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:14px 18px; transition:background 0.3s, border-color 0.3s; }\n        .sys-stat .sys-header { display:flex; justify-content:space-between; align-items:center; }\n        .sys-stat .sys-label { font-size:11px; color:var(--text-secondary); font-weight:500; text-transform:uppercase; }\n        .sys-stat .sys-pct { font-size:12px; font-weight:600; }\n        .sys-stat .sys-value { font-size:18px; font-weight:700; color:var(--text-primary); }\n        .sys-stat .sys-bar { height:4px; background:var(--bg-hover); border-radius:4px; margin-top:8px; overflow:hidden; }\n        .sys-stat .sys-bar .sys-bar-fill { height:100%; border-radius:4px; transition:width 0.6s ease; }\n        \n        .xray-status { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; transition:background 0.3s, border-color 0.3s; }\n        .xray-status .xray-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }\n        .xray-status .xray-dot { width:8px; height:8px; border-radius:50%; display:inline-block; background:var(--success); animation:pulse 2s infinite; }\n        .xray-status .xray-name { font-weight:600; color:var(--text-primary); font-size:14px; }\n        .xray-status .xray-version { font-size:12px; color:var(--text-secondary); background:var(--bg-hover); padding:2px 10px; border-radius:12px; }\n        .xray-status .xray-status-badge { font-size:12px; color:var(--success); background:rgba(46,160,67,0.15); padding:2px 12px; border-radius:12px; }\n        [data-theme="light"] .xray-status .xray-status-badge { background:rgba(46,160,67,0.1); }\n        .xray-status .xray-right { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }\n        .xray-status .xray-stat { font-size:12px; color:var(--text-secondary); }\n        .xray-status .xray-stat span { color:var(--text-primary); font-weight:500; }\n        .xray-status .xray-btn { background:var(--bg-hover); border:1px solid var(--border-color); color:var(--text-primary); padding:4px 14px; border-radius:6px; font-size:12px; cursor:pointer; transition:all 0.2s; }\n        .xray-status .xray-btn:hover { background:var(--border-color); }\n        \n        .badge { font-size:10px; font-weight:600; padding:2px 10px; border-radius:12px; display:inline-block; }\n        .badge-success { background:rgba(46,160,67,0.15); color:var(--success); }\n        [data-theme="light"] .badge-success { background:rgba(46,160,67,0.1); }\n        .badge-danger { background:rgba(248,81,73,0.15); color:var(--danger); }\n        [data-theme="light"] .badge-danger { background:rgba(248,81,73,0.1); }\n        .badge-warning { background:rgba(210,153,34,0.15); color:var(--warning); }\n        [data-theme="light"] .badge-warning { background:rgba(210,153,34,0.1); }\n        .badge-info { background:rgba(88,166,255,0.15); color:#58a6ff; }\n        .badge-purple { background:rgba(188,140,255,0.15); color:var(--purple); }\n        [data-theme="light"] .badge-purple { background:rgba(188,140,255,0.1); }\n        .badge-neutral { background:var(--bg-hover); color:var(--text-secondary); }\n        \n        .btn-primary { background:var(--accent); color:white; padding:8px 18px; border-radius:8px; font-weight:500; font-size:13px; border:none; cursor:pointer; transition:all 0.2s; display:inline-flex; align-items:center; gap:6px; }\n        .btn-primary:hover { background:var(--accent-hover); }\n        .btn-secondary { background:var(--bg-hover); color:var(--text-primary); padding:8px 18px; border-radius:8px; font-weight:500; font-size:13px; border:1px solid var(--border-color); cursor:pointer; transition:all 0.2s; }\n        .btn-secondary:hover { background:var(--border-color); }\n        .btn-sm { padding:4px 14px; font-size:12px; }\n        .btn-xs { padding:2px 10px; font-size:11px; }\n        .btn-danger { background:rgba(248,81,73,0.15); color:var(--danger); padding:6px 14px; border-radius:6px; font-weight:500; font-size:12px; border:1px solid rgba(248,81,73,0.2); cursor:pointer; transition:all 0.2s; }\n        .btn-danger:hover { background:rgba(248,81,73,0.25); }\n        \n        .client-item { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s; }\n        .client-item:hover { border-color:var(--accent); }\n        .client-item .client-info { display:flex; flex-direction:column; gap:2px; }\n        .client-item .client-name { font-weight:600; color:var(--text-primary); font-size:14px; }\n        .client-item .client-detail { font-size:12px; color:var(--text-secondary); }\n        .client-item .client-usage { text-align:right; }\n        .client-item .client-usage .used { font-weight:600; color:var(--text-primary); font-size:14px; }\n        .client-item .client-usage .total { font-size:12px; color:var(--text-secondary); }\n        \n        .client-stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-size:13px; color:var(--text-secondary); }\n        .client-stats .stat-item { display:flex; align-items:center; gap:4px; }\n        .client-stats .stat-item .num { color:var(--text-primary); font-weight:600; }\n        .client-stats .stat-item.online .num { color:var(--success); }\n        .client-stats .stat-item.ended .num { color:var(--warning); }\n        .client-stats .stat-item.disabled .num { color:var(--danger); }\n        .client-stats .stat-item.active .num { color:#58a6ff; }\n        \n        .node-item { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s; }\n        .node-item:hover { border-color:var(--accent); }\n        .node-item .node-info { display:flex; align-items:center; gap:12px; }\n        .node-item .node-name { font-weight:500; color:var(--text-primary); font-size:14px; }\n        .node-item .node-usage { font-size:13px; color:var(--text-secondary); }\n        \n        .page-section { display:none; }\n        .page-section.active { display:block; }\n        \n        .settings-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:20px 24px; max-width:600px; transition:background 0.3s, border-color 0.3s; }\n        .settings-card .settings-title { font-size:18px; font-weight:600; color:var(--text-primary); margin-bottom:16px; }\n        .settings-card .settings-group { margin-bottom:20px; }\n        .settings-card .settings-group:last-child { margin-bottom:0; }\n        .settings-card .settings-group .group-title { font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:10px; padding-top:16px; border-top:1px solid var(--border-color); }\n        .settings-card .settings-group .group-title:first-of-type { border-top:none; padding-top:0; }\n        .settings-card label { font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.3px; }\n        .settings-card input, .settings-card select { width:100%; padding:8px 12px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; color:var(--text-primary); outline:none; box-sizing:border-box; transition:background 0.3s, color 0.3s, border-color 0.3s; }\n        .settings-card input:focus, .settings-card select:focus { border-color:var(--accent); }\n        .settings-card .form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }\n        \n        .table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }\n        .table-wrap table { width:100%; border-collapse:collapse; font-size:13px; }\n        .table-wrap table thead th { text-align:left; padding:10px 14px; color:var(--text-secondary); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:0.3px; border-bottom:1px solid var(--border-color); position:sticky; top:0; background:var(--bg-primary); z-index:5; }\n        .table-wrap table tbody td { padding:10px 14px; border-bottom:1px solid var(--border-light); vertical-align:middle; }\n        .table-wrap table tbody tr:hover { background:var(--bg-hover); }\n        \n        .logs-container { font-family:"SF Mono","Fira Code",monospace; font-size:12px; max-height:400px; overflow-y:auto; background:var(--bg-primary); border-radius:8px; padding:16px; border:1px solid var(--border-light); transition:background 0.3s, border-color 0.3s; }\n        .logs-container .log-entry { padding:2px 0; }\n        .logs-container .log-entry .level-success { color:var(--success); }\n        .logs-container .log-entry .level-info { color:#58a6ff; }\n        .logs-container .log-entry .level-warn { color:var(--warning); }\n        \n        .modal-overlay { background:rgba(0,0,0,0.7); backdrop-filter:blur(4px); position:fixed; inset:0; z-index:200; display:none; align-items:center; justify-content:center; padding:20px; }\n        .modal-overlay.active { display:flex; }\n        .modal-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:28px 32px; max-width:560px; width:100%; max-height:90vh; overflow-y:auto; transition:background 0.3s, border-color 0.3s; }\n        .modal-card .modal-title { font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:4px; }\n        .modal-card .modal-sub { font-size:14px; color:var(--text-secondary); margin-bottom:20px; }\n        .modal-card .modal-tabs { display:flex; gap:4px; margin-bottom:20px; border-bottom:1px solid var(--border-color); }\n        .modal-card .modal-tabs .tab { padding:8px 16px; font-size:13px; font-weight:500; color:var(--text-secondary); cursor:pointer; border-bottom:2px solid transparent; transition:all 0.2s; }\n        .modal-card .modal-tabs .tab.active { color:var(--text-primary); border-bottom-color:var(--accent); }\n        .modal-card .form-group { margin-bottom:16px; }\n        .modal-card .form-group label { font-size:12px; font-weight:500; color:var(--text-secondary); display:block; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.3px; }\n        .modal-card input, .modal-card select, .modal-card textarea { width:100%; padding:10px 14px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; color:var(--text-primary); font-size:14px; outline:none; transition:all 0.2s; box-sizing:border-box; }\n        .modal-card input:focus, .modal-card select:focus, .modal-card textarea:focus { border-color:var(--accent); }\n        .modal-card .form-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }\n        .modal-card .modal-actions { display:flex; gap:12px; margin-top:24px; padding-top:16px; border-top:1px solid var(--border-color); }\n        .modal-card .modal-actions button { flex:1; padding:10px; border-radius:8px; font-weight:500; font-size:14px; border:none; cursor:pointer; transition:all 0.2s; }\n        .modal-card .modal-actions .btn-cancel { background:var(--bg-hover); color:var(--text-secondary); }\n        .modal-card .modal-actions .btn-cancel:hover { background:var(--border-color); }\n        .modal-card .modal-actions .btn-submit { background:var(--accent); color:white; }\n        .modal-card .modal-actions .btn-submit:hover { background:var(--accent-hover); }\n        \n        .nodes-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px; }\n        .nodes-header .nodes-title { font-size:15px; font-weight:600; color:var(--text-primary); }\n        .nodes-header .nodes-select-all { font-size:12px; color:var(--text-secondary); cursor:pointer; display:flex; align-items:center; gap:6px; }\n        .nodes-header .nodes-select-all input { accent-color:var(--accent); width:16px; height:16px; }\n        \n        .sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:99; }\n        .sidebar-overlay.active { display:block; }\n        \n        .port-checkbox:checked + .port-label-tls { border-color:var(--success); background:rgba(46,160,67,0.1); color:var(--success); }\n        .port-checkbox:checked + .port-label-nontls { border-color:var(--warning); background:rgba(210,153,34,0.1); color:var(--warning); }\n        \n        .action-btn { transition:all 0.15s; padding:6px; border-radius:8px; background:transparent; border:none; cursor:pointer; color:var(--text-secondary); }\n        .action-btn:hover { transform:scale(1.1); background:var(--bg-hover); color:var(--text-primary); }\n        \n        .chart-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:20px 24px; text-align:center; min-height:140px; display:flex; flex-direction:column; align-items:center; justify-content:center; transition:background 0.3s, border-color 0.3s; }\n        .chart-card .chart-icon { font-size:32px; margin-bottom:4px; }\n        .chart-card .chart-title { font-size:13px; color:var(--text-secondary); font-weight:500; }\n        .chart-card .chart-value { font-size:18px; font-weight:700; color:var(--text-primary); }\n        .chart-card .chart-sub { font-size:12px; color:var(--text-secondary); }\n        \n        .speed-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }\n        .speed-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:14px 18px; text-align:center; transition:background 0.3s, border-color 0.3s; }\n        .speed-card .speed-label { font-size:12px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; }\n        .speed-card .speed-value { font-size:20px; font-weight:700; margin-top:2px; }\n        .speed-card .speed-value.upload { color:var(--success); }\n        .speed-card .speed-value.download { color:#58a6ff; }\n        \n        .ip-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:14px 18px; transition:background 0.3s, border-color 0.3s; }\n        .ip-card .ip-title { font-size:12px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; margin-bottom:8px; }\n        .ip-card .ip-item { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:14px; color:var(--text-primary); font-family:"SF Mono",monospace; }\n        .ip-card .ip-item .ip-label { color:var(--text-secondary); font-size:12px; min-width:40px; }\n        \n        .conn-stats { display:flex; gap:20px; flex-wrap:wrap; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:14px 18px; transition:background 0.3s, border-color 0.3s; }\n        .conn-stats .conn-item { display:flex; align-items:center; gap:6px; font-size:14px; color:var(--text-primary); }\n        .conn-stats .conn-item .conn-label { color:var(--text-secondary); font-size:12px; text-transform:uppercase; }\n        .conn-stats .conn-item .conn-num.tcp { color:#58a6ff; font-weight:600; }\n        .conn-stats .conn-item .conn-num.udp { color:var(--warning); font-weight:600; }\n        \n        .request-stats { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:12px; padding:16px 20px; display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; transition:background 0.3s, border-color 0.3s; }\n        .request-stats .req-item { text-align:center; }\n        .request-stats .req-item .req-label { font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; }\n        .request-stats .req-item .req-value { font-size:20px; font-weight:700; color:var(--text-primary); }\n        .request-stats .req-item .req-value.accent { color:#58a6ff; }\n        .request-stats .req-item .req-value.success { color:var(--success); }\n        \n        @media (max-width:1024px) {\n            .sidebar { transform:translateX(-100%); width:280px; }\n            .sidebar.open { transform:translateX(0); }\n            .main-content { margin-left:0; padding:16px; }\n            .page-header .menu-toggle { display:block; }\n            .request-stats { grid-template-columns:repeat(3,1fr); }\n        }\n        @media (max-width:640px) {\n            .main-content { padding:12px; }\n            .stat-card .stat-value { font-size:20px; }\n            .modal-card { padding:20px; margin:10px; }\n            .modal-card .form-row { grid-template-columns:1fr; }\n            .settings-card .form-row { grid-template-columns:1fr; }\n            .speed-grid { grid-template-columns:1fr; }\n            .xray-status { flex-direction:column; align-items:stretch; }\n            .xray-status .xray-left { flex-wrap:wrap; }\n            .xray-status .xray-right { flex-wrap:wrap; }\n            .client-stats { gap:8px; font-size:12px; }\n            .client-item { flex-direction:column; align-items:stretch; gap:8px; }\n            .client-item .client-usage { text-align:left; }\n            .page-header .page-title { font-size:20px; }\n            .sys-stat .sys-value { font-size:15px; }\n            .chart-card { min-height:120px; padding:16px; }\n            .sidebar { width:280px; }\n            .request-stats { grid-template-columns:repeat(2,1fr); }\n        }\n    </style>\n</head>\n<body>\n\n<div id="sidebar-overlay" class="sidebar-overlay" onclick="closeSidebar()"></div>\n\n<!-- Sidebar -->\n<nav class="sidebar" id="sidebar">\n    <div class="sidebar-brand">\n        <div class="logo">V</div>\n        <span class="brand-text">VoidLatency</span>\n        <span class="brand-version">v2.9.4</span>\n    </div>\n    <div class="sidebar-nav">\n        <div class="nav-section">\n            <div class="nav-section-title">Main</div>\n            <button class="nav-item active" data-page="dashboard" onclick="showPage(\'dashboard\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>Overview\n            </button>\n            <button class="nav-item" data-page="users" onclick="showPage(\'users\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>Users <span class="badge" id="user-count-badge">0</span>\n            </button>\n            <button class="nav-item" data-page="settings" onclick="showPage(\'settings\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span>Panel Settings\n            </button>\n            <button class="nav-item" data-page="admins" onclick="showPage(\'admins\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg></span>Admins\n            </button>\n            <button class="nav-item" data-page="logs" onclick="showPage(\'logs\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg></span>Logs\n            </button>\n            <button class="nav-item" data-page="api" onclick="showPage(\'api\')">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg></span>API Docs\n            </button>\n            <button class="nav-item" onclick="logoutAdmin()">\n                <span class="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>Log Out\n            </button>\n        </div>\n    </div>\n    <div class="sidebar-footer">\n        <div class="user-info">\n            <div class="user-avatar">A</div>\n            <div><div class="user-name">Admin</div><div class="user-role">Online</div></div>\n        </div>\n        <div class="version-text">v2.9.4</div>\n    </div>\n</nav>\n\n<!-- Main Content -->\n<main class="main-content">\n    <header class="page-header">\n        <div style="display:flex;align-items:center;gap:12px;">\n            <button class="menu-toggle" onclick="toggleSidebar()">☰</button>\n            <div><h1 class="page-title" id="page-title">Overview</h1><p class="page-subtitle" id="page-subtitle">System overview and statistics</p></div>\n        </div>\n        <div class="header-actions">\n            <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle Theme">🌓</button>\n            <span class="version-tag">v2.9.4</span>\n            <span class="divider"></span>\n            <span class="status-text"><span class="status-dot"></span>Running</span>\n        </div>\n    </header>\n\n    <!-- Dashboard -->\n    <div id="page-dashboard" class="page-section active">\n        <!-- Request Stats Box -->\n        <div class="request-stats" style="margin-bottom:20px;">\n            <div class="req-item"><div class="req-label">Total Requests</div><div class="req-value accent" id="total-requests">0</div></div>\n            <div class="req-item"><div class="req-label">Requests/Min</div><div class="req-value success" id="requests-per-minute">0</div></div>\n            <div class="req-item"><div class="req-label">Colo</div><div class="req-value" id="colo-name">-</div></div>\n            <div class="req-item"><div class="req-label">Country</div><div class="req-value" id="country-name">-</div></div>\n            <div class="req-item"><div class="req-label">City</div><div class="req-value" id="city-name">-</div></div>\n            <div class="req-item"><div class="req-label">ASN</div><div class="req-value" id="asn-name">-</div></div>\n        </div>\n        \n        <!-- System Stats -->\n        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px;">\n            <div class="sys-stat"><div class="sys-header"><span class="sys-label">CPU</span><span class="sys-pct" style="color:#58a6ff;">5.17%</span></div><div class="sys-value">1 Core</div><div class="sys-bar"><div class="sys-bar-fill" style="width:5.17%;background:#58a6ff;"></div></div></div>\n            <div class="sys-stat"><div class="sys-header"><span class="sys-label">RAM</span><span class="sys-pct" style="color:var(--success);">66.5%</span></div><div class="sys-value">1.25 GB / 1.87 GB</div><div class="sys-bar"><div class="sys-bar-fill" style="width:66.5%;background:var(--success);"></div></div></div>\n            <div class="sys-stat"><div class="sys-header"><span class="sys-label">Swap</span><span class="sys-pct" style="color:var(--warning);">0%</span></div><div class="sys-value">0 B / 0 B</div><div class="sys-bar"><div class="sys-bar-fill" style="width:0%;background:var(--warning);"></div></div></div>\n            <div class="sys-stat"><div class="sys-header"><span class="sys-label">Storage</span><span class="sys-pct" style="color:var(--purple);">29.57%</span></div><div class="sys-value">6.85 GB / 23.17 GB</div><div class="sys-bar"><div class="sys-bar-fill" style="width:29.57%;background:var(--purple);"></div></div></div>\n        </div>\n        \n        <!-- Xray Status -->\n        <div class="xray-status" style="margin-bottom:20px;">\n            <div class="xray-left"><span class="xray-dot"></span><span class="xray-name">Xray</span><span class="xray-version">v26.6.1</span><span class="xray-status-badge">Running</span></div>\n            <div class="xray-right"><span class="xray-stat">Uptime: <span id="xray-uptime">9m</span></span><span class="xray-stat">RAM: <span>119.38 MB</span></span><span class="xray-stat">Threads: <span>43</span></span><button class="xray-btn" onclick="controlXray(\'restart\')">Restart</button></div>\n        </div>\n        \n        <!-- Stats Cards -->\n        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px;">\n            <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value" id="stat-total-users">0</div><div class="stat-sub">All time</div></div>\n            <div class="stat-card"><div class="stat-label">Online</div><div class="stat-value" style="color:var(--success);" id="stat-active-users">0</div><div class="stat-sub">Active now</div></div>\n            <div class="stat-card"><div class="stat-label">Total Traffic</div><div class="stat-value" style="color:#58a6ff;" id="stat-total-usage">0 GB</div><div class="stat-sub">All time</div></div>\n            <div class="stat-card"><div class="stat-label">Top User</div><div class="stat-value" style="color:var(--purple);font-size:20px;" id="stat-top-user">-</div><div class="stat-sub" id="stat-top-user-usage">0 GB used</div></div>\n        </div>\n        \n        <!-- Charts -->\n        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">\n            <div class="chart-card"><div class="chart-icon">📊</div><div class="chart-title">Uptime</div><div class="chart-value">Xray: <span id="xray-uptime-chart">9m</span></div><div class="chart-sub">OS: 6d 8h</div></div>\n            <div class="chart-card"><div class="chart-icon">📈</div><div class="chart-title">Usage</div><div class="chart-value">RAM: 119.38 MB</div><div class="chart-sub">Threads: 43</div></div>\n        </div>\n        \n        <!-- Speed Stats -->\n        <div class="speed-grid" style="margin-bottom:16px;">\n            <div class="speed-card"><div class="speed-label">Upload</div><div class="speed-value upload">↑ 1.32 KB/s</div></div>\n            <div class="speed-card"><div class="speed-label">Download</div><div class="speed-value download">↓ 895 B/s</div></div>\n        </div>\n        \n        <!-- Total Data -->\n        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">\n            <div class="stat-card"><div class="stat-label">Sent</div><div class="stat-value" style="color:var(--success);font-size:20px;">↗ 108.38 GB</div></div>\n            <div class="stat-card"><div class="stat-label">Received</div><div class="stat-value" style="color:#58a6ff;font-size:20px;">↖ 116.98 GB</div></div>\n        </div>\n        \n        <!-- IP Info -->\n        <div class="ip-card" style="margin-bottom:16px;">\n            <div class="ip-title">IP Addresses</div>\n            <div class="ip-item"><span class="ip-label">IPv4</span><span id="ipv4-display">162.19.156.152</span></div>\n            <div class="ip-item"><span class="ip-label">IPv6</span><span id="ipv6-display">2001:41d0:701:1000::2690</span></div>\n        </div>\n        \n        <!-- Connection Stats -->\n        <div class="conn-stats">\n            <div class="conn-item"><span class="conn-label">TCP</span><span class="conn-num tcp">94</span></div>\n            <div class="conn-item"><span class="conn-label">UDP</span><span class="conn-num udp">4</span></div>\n        </div>\n    </div>\n\n    <!-- Users -->\n    <div id="page-users" class="page-section">\n        <div class="glass" style="padding:20px 24px;">\n            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px;">\n                <div><h2 style="font-size:18px;font-weight:600;color:var(--text-primary);">Users</h2><p style="font-size:13px;color:var(--text-secondary);">Manage your VPN clients</p></div>\n                <button class="btn-primary" onclick="openCreateModal()">+ Add User</button>\n            </div>\n            \n            <div class="client-stats">\n                <span class="stat-item">Total: <span class="num" id="client-total">0</span></span>\n                <span class="stat-item online">Online: <span class="num" id="client-online">0</span></span>\n                <span class="stat-item active">Active: <span class="num" id="client-active">0</span></span>\n            </div>\n            \n            <div style="display:flex;flex-direction:column;gap:10px;" id="users-container">\n                <p style="color:var(--text-secondary);text-align:center;padding:20px;">Loading users...</p>\n            </div>\n        </div>\n    </div>\n\n    <!-- Settings -->\n    <div id="page-settings" class="page-section">\n        <div class="settings-card">\n            <div class="settings-title">Panel Settings</div>\n            <div class="settings-group"><div class="group-title">General</div>\n                <div style="margin-bottom:12px;"><label>Proxy Location</label><select id="location-select"><option value="">Default Location</option><option value="FRA" selected>Frankfurt (FRA)</option><option value="LHR">London (LHR)</option><option value="NYC">New York (NYC)</option><option value="SIN">Singapore (SIN)</option><option value="NRT">Tokyo (NRT)</option></select></div>\n                <div class="form-row"><div><label>Fragment Length</label><input type="text" id="frag-length" value="20-30"></div><div><label>Fragment Interval</label><input type="text" id="frag-interval" value="1-2"></div></div>\n            </div>\n            <div class="settings-group"><div class="group-title">Authentication</div>\n                <div style="display:flex;flex-direction:column;gap:10px;"><input type="password" id="change-pwd-current" placeholder="Current password"><input type="password" id="change-pwd-new" placeholder="New password"><button onclick="changeAdminPassword()" class="btn-secondary">Update Password</button></div>\n            </div>\n            <div class="settings-group"><div class="group-title">System</div>\n                <div id="update-info" style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">Checking for updates...</div>\n                <button onclick="checkUpdate()" class="btn-primary btn-sm">Check for Updates</button>\n            </div>\n            <div class="settings-group"><button onclick="saveSettings()" id="save-settings-btn" class="btn-primary" style="width:100%;justify-content:center;">Save Settings</button></div>\n        </div>\n    </div>\n\n    <!-- Admins -->\n    <div id="page-admins" class="page-section">\n        <div class="glass" style="padding:20px 24px;max-width:500px;">\n            <h2 style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">Admin Management</h2>\n            <div style="display:flex;flex-direction:column;gap:10px;" id="admins-list">\n                <p style="color:var(--text-secondary);text-align:center;padding:20px;">Loading admins...</p>\n            </div>\n            <div style="border-top:1px solid var(--border-color);padding-top:16px;margin-top:16px;">\n                <h4 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:10px;">Add New Admin</h4>\n                <div style="display:flex;flex-direction:column;gap:10px;">\n                    <input type="text" id="admin-username" placeholder="Username" style="padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);outline:none;">\n                    <input type="password" id="admin-password" placeholder="Password" style="padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);outline:none;">\n                    <button onclick="addAdmin()" class="btn-primary">Add Admin</button>\n                </div>\n            </div>\n        </div>\n    </div>\n\n    <!-- Logs -->\n    <div id="page-logs" class="page-section">\n        <div class="glass" style="padding:20px 24px;">\n            <h2 style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">System Logs</h2>\n            <div class="logs-container\">\n                <div class="log-entry"><span class="level-success">●</span> System started at: <span id="log-start-time">-</span></div>\n                <div class="log-entry"><span class="level-info">●</span> Xray service running</div>\n                <div class="log-entry"><span class="level-info">●</span> WebSocket server listening on /</div>\n                <div class="log-entry"><span class="level-info">●</span> API endpoints ready</div>\n                <div class="log-entry"><span class="level-success">●</span> Database connected</div>\n                <div class="log-entry"><span class="level-info">●</span> Panel version v2.9.4</div>\n            </div>\n        </div>\n    </div>\n\n    <!-- API Docs -->\n    <div id="page-api" class="page-section">\n        <div class="glass" style="padding:20px 24px;">\n            <h2 style="font-size:18px;font-weight:600;color:var(--text-primary);margin-bottom:16px;">API Documentation</h2>\n            <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px;">\n                <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">Authentication: <span style="color:var(--text-primary);font-weight:600;">Bearer Token</span></div>\n                <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">Token: <span style="color:var(--text-primary);font-weight:600;font-family:monospace;font-size:12px;" id="api-token-display">No token generated</span></div>\n                <button onclick="generateApiToken()" class="btn-primary btn-sm">Generate New Token</button>\n            </div>\n            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:400px;overflow-y:auto;">\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/users</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Get all users</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">POST /api/users</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Create user</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/users/:username</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Get user</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">PUT /api/users/:username</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Update user</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">DELETE /api/users/:username</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Delete user</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/admins</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Get admins</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/xray/status</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Xray status</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/stats/summary</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Stats summary</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /sub/:username</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Get subscription</div>\n                </div>\n                <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:12px;">\n                    <div style="color:var(--text-secondary);font-size:11px;">GET /api/status/:username</div>\n                    <div style="color:var(--text-primary);font-size:12px;">Public status</div>\n                </div>\n            </div>\n        </div>\n    </div>\n</main>\n\n<!-- Modal: Add User -->\n<div id="user-modal" class="modal-overlay">\n    <div class="modal-card">\n        <div class="modal-title" id="modal-title">Add User</div>\n        <div class="modal-sub" id="modal-sub">Create a new VPN client</div>\n        <form id="user-form" onsubmit="handleUserSubmit(event)">\n            <div class="form-group"><label>Username</label><input type="text" id="input-username" placeholder="Enter username" required></div>\n            <div class="form-row">\n                <div class="form-group"><label>Limit (GB)</label><input type="number" id="input-limit" placeholder="0" min="0" step="any"></div>\n                <div class="form-group"><label>Expiry (Days)</label><input type="number" id="input-expiry" placeholder="30" min="0"></div>\n            </div>\n            <div class="form-group"><label>Fingerprint</label>\n                <select id="fingerprint-select">\n                    <option value="chrome">Chrome</option>\n                    <option value="firefox">Firefox</option>\n                    <option value="safari">Safari</option>\n                    <option value="ios">iOS</option>\n                    <option value="android">Android</option>\n                    <option value="edge">Edge</option>\n                </select>\n            </div>\n            <div class="form-group"><label>Config Name</label><input type="text" id="config-name" placeholder="Custom config name"></div>\n            <div class="form-group"><label>Ports</label>\n                <div style="display:flex;flex-wrap:wrap;gap:6px;" id="port-checkboxes">\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="443" checked style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">443</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2053" style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">2053</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="80" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">80</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="8080" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">8080</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="8443" style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">8443</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="8880" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">8880</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2052" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">2052</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2082" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">2082</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2086" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">2086</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2095" style="accent-color:var(--warning);"><span style="font-size:13px;color:var(--warning);">2095</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2083" style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">2083</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2087" style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">2087</span></label>\n                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;background:var(--bg-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);"><input type="checkbox" name="ports" value="2096" style="accent-color:var(--accent);"><span style="font-size:13px;color:var(--success);">2096</span></label>\n                </div>\n            </div>\n            <div class="form-group"><label>Custom IPs</label><textarea id="input-ips" rows="2" placeholder="One IP per line..." style="resize:vertical;width:100%;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);outline:none;"></textarea></div>\n            <div class="modal-actions">\n                <button type="button" class="btn-cancel" onclick="closeModal()">Cancel</button>\n                <button type="submit" class="btn-submit" id="modal-submit-btn">Create</button>\n            </div>\n        </form>\n    </div>\n</div>\n\n<!-- QR Modal -->\n<div id="qr-modal" class="modal-overlay">\n    <div class="modal-card" style="max-width:400px;text-align:center;">\n        <div class="modal-title">QR Code</div>\n        <div style="background:white;padding:16px;border-radius:12px;display:inline-block;margin:12px auto;">\n            <div id="qrcode-box" style="width:200px;height:200px;display:flex;align-items:center;justify-content:center;"></div>\n        </div>\n        <div class="modal-actions">\n            <button class="btn-cancel" onclick="closeQRModal()">Close</button>\n        </div>\n    </div>\n</div>\n\n<script>\n// ============================================\n// THEME\n// ============================================\nfunction toggleTheme() {\n    const html = document.getElementById(\"html-root\");\n    const current = html.getAttribute(\"data-theme\");\n    const newTheme = current === \"light\" ? \"dark\" : \"light\";\n    html.setAttribute(\"data-theme\", newTheme);\n    localStorage.setItem(\"theme\", newTheme);\n    if (newTheme === \"light\") document.body.classList.add(\"light\");\n    else document.body.classList.remove(\"light\");\n}\n(function() {\n    const saved = localStorage.getItem(\"theme\") || \"dark\";\n    document.getElementById(\"html-root\").setAttribute(\"data-theme\", saved);\n    if (saved === \"light\") document.body.classList.add(\"light\");\n})();\n\n// ============================================\n// SIDEBAR\n// ============================================\nfunction toggleSidebar() {\n    document.getElementById(\"sidebar\").classList.toggle(\"open\");\n    document.getElementById(\"sidebar-overlay\").classList.toggle(\"active\");\n}\nfunction closeSidebar() {\n    document.getElementById(\"sidebar\").classList.remove(\"open\");\n    document.getElementById(\"sidebar-overlay\").classList.remove(\"active\");\n}\n\n// ============================================\n// PAGE NAVIGATION\n// ============================================\nfunction showPage(page) {\n    document.querySelectorAll(\".page-section\").forEach(el => el.classList.remove(\"active\"));\n    var target = document.getElementById(\"page-\" + page);\n    if (target) target.classList.add(\"active\");\n    document.querySelectorAll(\".nav-item\").forEach(el => el.classList.remove(\"active\"));\n    var navItem = document.querySelector(\'.nav-item[data-page=\"\' + page + \'\"]\');\n    if (navItem) navItem.classList.add(\"active\");\n    var titles = {\n        dashboard: [\"Overview\", \"System overview and statistics\"],\n        users: [\"Users\", \"Manage your VPN clients\"],\n        settings: [\"Panel Settings\", \"Configure panel preferences\"],\n        admins: [\"Admin Management\", \"Add or remove administrators\"],\n        logs: [\"System Logs\", \"Real-time activity logs\"],\n        api: [\"API Docs\", \"API documentation and tokens\"]\n    };\n    var info = titles[page] || [page, \"\"];\n    document.getElementById(\"page-title\").innerText = info[0];\n    document.getElementById(\"page-subtitle\").innerText = info[1];\n    if (window.innerWidth < 1024) closeSidebar();\n}\n\n// ============================================\n// MODAL\n// ============================================\nfunction openCreateModal() {\n    document.getElementById(\"user-modal\").classList.add(\"active\");\n    document.getElementById(\"modal-title\").innerText = \"Add User\";\n    document.getElementById(\"modal-submit-btn\").innerText = \"Create\";\n    document.getElementById(\"user-form\").onsubmit = handleUserSubmit;\n}\nfunction closeModal() {\n    document.getElementById(\"user-modal\").classList.remove(\"active\");\n}\nfunction closeQRModal() {\n    document.getElementById(\"qr-modal\").classList.remove(\"active\");\n}\n\n// ============================================\n// XRAY CONTROL\n// ============================================\nasync function controlXray(action) {\n    try {\n        var res = await fetch(\"/api/xray\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ action: action })\n        });\n        var data = await res.json();\n        if (data.success) alert(\"Xray \" + action + \"ed successfully\");\n        else alert(\"Failed to \" + action + \" Xray\");\n    } catch(err) { alert(\"Connection error\"); }\n}\n\n// ============================================\n// LOAD REQUEST STATS\n// ============================================\nasync function loadRequestStats() {\n    try {\n        var res = await fetch(\"/api/request/stats\");\n        if (!res.ok) throw new Error();\n        var data = await res.json();\n        document.getElementById(\"total-requests\").innerText = data.total_requests || 0;\n        document.getElementById(\"requests-per-minute\").innerText = data.requests_per_minute || 0;\n        document.getElementById(\"colo-name\").innerText = data.colo || \"-\";\n        document.getElementById(\"country-name\").innerText = data.country || \"-\";\n        document.getElementById(\"city-name\").innerText = data.city || \"-\";\n        document.getElementById(\"asn-name\").innerText = data.asn || \"-\";\n        if (data.ip) {\n            document.getElementById(\"ipv4-display\").innerText = data.ip.ipv4 || \"-\";\n        }\n    } catch(e) { console.error(\"Error loading request stats:\", e); }\n}\n\n// ============================================\n// LOAD USERS\n// ============================================\nvar allUsers = [];\nasync function loadUsers() {\n    try {\n        var res = await fetch(\"/api/users?t=\" + Date.now());\n        if (!res.ok) throw new Error();\n        var data = await res.json();\n        allUsers = data.users || [];\n        renderUsers();\n    } catch(err) { console.error(\"Error loading users:\", err); }\n}\n\nfunction renderUsers() {\n    var total = allUsers.length;\n    var online = allUsers.filter(function(u) { return u.is_online === 1; }).length;\n    var active = allUsers.filter(function(u) { return u.is_active === 1; }).length;\n    var totalGb = allUsers.reduce(function(sum, u) { return sum + (u.used_gb || 0); }, 0);\n    \n    document.getElementById(\"stat-total-users\").innerText = total;\n    document.getElementById(\"stat-active-users\").innerText = online;\n    document.getElementById(\"stat-total-usage\").innerText = totalGb < 1 ? (totalGb * 1024).toFixed(0) + \" MB\" : totalGb.toFixed(2) + \" GB\";\n    document.getElementById(\"client-total\").innerText = total;\n    document.getElementById(\"client-online\").innerText = online;\n    document.getElementById(\"client-active\").innerText = active;\n    document.getElementById(\"user-count-badge\").innerText = total;\n    \n    var topUser = allUsers.reduce(function(max, u) { return (u.used_gb || 0) > (max.used_gb || 0) ? u : max; }, { username: \"-\", used_gb: 0 });\n    document.getElementById(\"stat-top-user\").innerText = topUser.username;\n    var topUsage = topUser.used_gb || 0;\n    document.getElementById(\"stat-top-user-usage\").innerText = topUsage < 1 ? (topUsage * 1024).toFixed(0) + \" MB used\" : topUsage.toFixed(2) + \" GB used\";\n    \n    var container = document.getElementById(\"users-container\");\n    if (allUsers.length === 0) {\n        container.innerHTML = \'<p style=\"color:var(--text-secondary);text-align:center;padding:20px;\">No users found. Click \"Add User\" to get started.</p>\';\n        return;\n    }\n    container.innerHTML = allUsers.slice(0, 20).map(function(user) {\n        var used = user.used_gb || 0;\n        var usedDisplay = used < 1 ? (used * 1024).toFixed(0) + \" MB\" : used.toFixed(2) + \" GB\";\n        var totalDisplay = user.limit_gb ? user.limit_gb + \" GB\" : \"∞\";\n        var isActive = user.is_active === 1;\n        var isOnline = user.is_online === 1;\n        var name = user.config_name || user.username;\n        var uuidShort = user.uuid ? user.uuid.substring(0, 8) + \"...\" : \"\";\n        var subLink = window.location.origin + \"/sub/\" + encodeURIComponent(user.username);\n        return \'<div class=\"client-item\">\' +\n            \'<div class=\"client-info\">\' +\n                \'<div class=\"client-name\">\' + name + \'</div>\' +\n                \'<div class=\"client-detail\">\' +\n                    (isActive ? \'<span class=\"badge badge-success\">Active</span>\' : \'<span class=\"badge badge-danger\">Inactive</span>\') +\n                    (isOnline ? \'<span class=\"badge badge-success\">Online</span>\' : \'<span class=\"badge badge-neutral\">Offline</span>\') +\n                    \'<span style=\"margin-left:8px;color:var(--text-secondary);font-size:11px;\">\' + uuidShort + \'</span>\' +\n                    \'<span style=\"margin-left:8px;color:var(--text-secondary);font-size:11px;\">\' + (user.port || \"443\") + \'</span>\' +\n                    \'<span style=\"margin-left:8px;color:var(--text-secondary);font-size:11px;\"><a href=\"\' + subLink + \'\" target=\"_blank\" style=\"color:var(--accent);text-decoration:none;\">sub</a></span>\' +\n                \'</div>\' +\n            \'</div>\' +\n            \'<div class=\"client-usage\">\' +\n                \'<div class=\"used\">\' + usedDisplay + \'</div>\' +\n                \'<div class="total\">/ \' + totalDisplay + \'</div>\' +\n                \'<div style="display:flex;gap:4px;margin-top:4px;justify-content:flex-end;flex-wrap:wrap;">\' +\n                    \'<button onclick="copyConfig(\\\'\' + user.username + \'\\\')" class="action-btn" title="Copy VLESS"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></button>\' +\n                    \'<button onclick="copyJsonConfig(\\\'\' + user.username + \'\\\')" class="action-btn" title="Copy JSON"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg></button>\' +\n                    \'<button onclick="showQRForUser(\\\'\' + user.username + \'\\\')" class="action-btn" title="QR"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg></button>\' +\n                    \'<button onclick="toggleUserStatus(\\\'\' + user.username + \'\\\')" class="action-btn" title="Toggle Status"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>\' +\n                    \'<button onclick="editUser(\\\'\' + user.username + \'\\\')" class="action-btn" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>\' +\n                    \'<button onclick="deleteUser(\\\'\' + user.username + \'\\\')" class="action-btn" title="Delete" style="color:var(--danger);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>\' +\n                \'</div>\' +\n            \'</div>\' +\n        \'</div>\';\n    }).join(\"\");\n}\n\n// ============================================\n// USER FORM HANDLER\n// ============================================\nasync function handleUserSubmit(event) {\n    event.preventDefault();\n    var btn = document.getElementById(\"modal-submit-btn\");\n    btn.disabled = true;\n    btn.innerText = \"Creating...\";\n    \n    var username = document.getElementById(\"input-username\").value.trim();\n    var limit = document.getElementById(\"input-limit\").value || null;\n    var expiry = document.getElementById(\"input-expiry\").value || null;\n    var fingerprint = document.getElementById(\"fingerprint-select\").value;\n    var config_name = document.getElementById(\"config-name\").value || \"\";\n    var ips = document.getElementById(\"input-ips\").value;\n    var checkedPorts = Array.from(document.querySelectorAll(\'input[name=\"ports\"]:checked\')).map(function(cb) { return cb.value; });\n    var port = checkedPorts.length > 0 ? checkedPorts.join(\",\") : \"443\";\n    var tls = checkedPorts.some(function(p) { return [\"443\",\"2053\",\"2083\",\"2087\",\"2096\",\"8443\"].indexOf(p) !== -1; }) ? \"on\" : \"off\";\n    \n    if (!username) {\n        alert(\"Username is required\");\n        btn.disabled = false;\n        btn.innerText = \"Create\";\n        return;\n    }\n    \n    try {\n        var res = await fetch(\"/api/users\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ username: username, limit_gb: limit, expiry_days: expiry, tls: tls, port: port, ips: ips, fingerprint: fingerprint, config_name: config_name })\n        });\n        if (res.ok) {\n            closeModal();\n            await loadUsers();\n            alert(\"User created successfully\");\n        } else {\n            var err = await res.json();\n            alert(\"Error: \" + (err.error || \"Operation failed\"));\n        }\n    } catch(err) { alert(\"Connection error\"); }\n    btn.disabled = false;\n    btn.innerText = \"Create\";\n}\n\n// ============================================\n// ADMINS\n// ============================================\nasync function loadAdminsList() {\n    try {\n        var res = await fetch(\"/api/admins\");\n        var data = await res.json();\n        var container = document.getElementById(\"admins-list\");\n        if (data.admins && data.admins.length > 0) {\n            container.innerHTML = data.admins.map(function(a) {\n                return \'<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg-primary);border-radius:8px;border:1px solid var(--border-light);">\' +\n                    \'<span style="color:var(--text-primary);">\' + a.username + \'</span>\' +\n                    \'<div style="display:flex;align-items:center;gap:12px;">\' +\n                        \'<span style="color:var(--text-secondary);font-size:12px;">\' + new Date(a.created_at).toLocaleDateString() + \'</span>\' +\n                        \'<button onclick="deleteAdmin(\' + a.id + \')" style="color:var(--danger);background:transparent;border:none;cursor:pointer;font-size:12px;">Remove</button>\' +\n                    \'</div>\' +\n                \'</div>\';\n            }).join(\"\");\n        } else {\n            container.innerHTML = \'<p style="color:var(--text-secondary);text-align:center;padding:20px;">No admins found.</p>\';\n        }\n    } catch(e) { console.error(\"Error loading admins:\", e); }\n}\n\nasync function addAdmin() {\n    var username = document.getElementById(\"admin-username\").value.trim();\n    var password = document.getElementById(\"admin-password\").value;\n    if (!username || !password || password.length < 4) {\n        alert(\"Username and password (min 4 chars) required\");\n        return;\n    }\n    try {\n        var res = await fetch(\"/api/admins\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ username: username, password: password })\n        });\n        var data = await res.json();\n        if (data.success) {\n            alert(\"Admin added successfully\");\n            document.getElementById(\"admin-username\").value = \"\";\n            document.getElementById(\"admin-password\").value = \"\";\n            loadAdminsList();\n        } else {\n            alert(\"Error: \" + (data.error || \"Failed to add admin\"));\n        }\n    } catch(err) { alert(\"Connection error\"); }\n}\n\nasync function deleteAdmin(id) {\n    if (!confirm(\"Remove this admin?\")) return;\n    try {\n        var res = await fetch(\"/api/admins\", {\n            method: \"DELETE\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ id: id })\n        });\n        var data = await res.json();\n        if (data.success) { loadAdminsList(); }\n        else { alert(\"Failed to remove admin\"); }\n    } catch(err) { alert(\"Connection error\"); }\n}\n\n// ============================================\n// SETTINGS\n// ============================================\nasync function saveSettings() {\n    var btn = document.getElementById(\"save-settings-btn\");\n    btn.disabled = true;\n    btn.innerText = \"Saving...\";\n    var fragLen = document.getElementById(\"frag-length\").value || \"20-30\";\n    var fragInt = document.getElementById(\"frag-interval\").value || \"1-2\";\n    var iata = document.getElementById(\"location-select\").value;\n    try {\n        var resolvedIp = \"proxyip.cmliussss.net\";\n        if (iata) {\n            var domain = iata.toLowerCase() + \".proxyip.cmliussss.net\";\n            try {\n                var dnsRes = await fetch(\"https://cloudflare-dns.com/dns-query?name=\" + domain + \"&type=A\", {\n                    headers: { \"accept\": \"application/dns-json\" }\n                });\n                if (dnsRes.ok) {\n                    var dnsData = await dnsRes.json();\n                    if (dnsData.Answer && dnsData.Answer.length > 0) {\n                        var ips = dnsData.Answer.filter(function(a) { return a.type === 1; }).map(function(a) { return a.data; });\n                        if (ips.length > 0) resolvedIp = ips[Math.floor(Math.random() * ips.length)];\n                    }\n                }\n            } catch(e) {}\n        }\n        var res = await fetch(\"/api/proxy-ip\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ proxy_ip: resolvedIp, iata: iata ? iata.toUpperCase() : \"\", frag_len: fragLen, frag_int: fragInt })\n        });\n        if (res.ok) alert(\"Settings saved successfully\");\n        else alert(\"Error saving settings\");\n    } catch(err) { alert(\"Connection error\"); }\n    btn.disabled = false;\n    btn.innerText = \"Save Settings\";\n}\n\nasync function changeAdminPassword() {\n    var current = document.getElementById(\"change-pwd-current\").value;\n    var newPwd = document.getElementById(\"change-pwd-new\").value;\n    if (!current || !newPwd) { alert(\"Please enter both current and new password\"); return; }\n    if (newPwd.length < 4) { alert(\"Password must be at least 4 characters\"); return; }\n    try {\n        var res = await fetch(\"/api/change-password\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ current_password: current, new_password: newPwd })\n        });\n        var data = await res.json();\n        if (res.ok && data.success) {\n            alert(\"Password updated successfully\");\n            document.getElementById(\"change-pwd-current\").value = \"\";\n            document.getElementById(\"change-pwd-new\").value = \"\";\n        } else { alert(\"Error: \" + (data.error || \"Operation failed\")); }\n    } catch(err) { alert(\"Connection error\"); }\n}\n\nasync function checkUpdate() {\n    var info = document.getElementById(\"update-info\");\n    info.innerText = \"Checking for updates...\";\n    info.style.color = \"#58a6ff\";\n    try {\n        var res = await fetch(\"/api/update-check\");\n        var data = await res.json();\n        if (data.update_available) {\n            info.innerHTML = \'New version <strong>\' + data.latest_version + \'</strong> available\';\n            info.style.color = \"var(--success)\";\n        } else {\n            info.innerHTML = \'You are running the latest version <strong>\' + data.current_version + \'</strong>\';\n            info.style.color = \"var(--success)\";\n        }\n    } catch(e) {\n        info.innerText = \"Could not check for updates\";\n        info.style.color = \"var(--danger)\";\n    }\n}\n\n// ============================================\n// API TOKEN\n// ============================================\nasync function generateApiToken() {\n    try {\n        var res = await fetch(\"/api/token/generate\", {\n            method: \"POST\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ name: \"API Token\" })\n        });\n        var data = await res.json();\n        if (data.success) {\n            document.getElementById(\"api-token-display\").innerText = data.token;\n            alert(\"Token generated successfully! Copy it now.\");\n        } else {\n            alert(\"Failed to generate token: \" + (data.error || \"Unknown error\"));\n        }\n    } catch(err) { alert(\"Connection error\"); }\n}\n\nasync function loadApiToken() {\n    try {\n        var res = await fetch(\"/api/tokens\");\n        if (!res.ok) return;\n        var data = await res.json();\n        if (data.tokens && data.tokens.length > 0) {\n            document.getElementById(\"api-token-display\").innerText = data.tokens[0].token || \"Token exists\";\n        }\n    } catch(e) {}\n}\n\n// ============================================\n// LOGOUT\n// ============================================\nasync function logoutAdmin() {\n    if (!confirm(\"Sign out?\")) return;\n    try { await fetch(\"/api/logout\", { method: \"POST\" }); } catch(e) {}\n    window.location.reload();\n}\n\n// ============================================\n// LOCATIONS\n// ============================================\nasync function loadLocations() {\n    var select = document.getElementById(\"location-select\");\n    try {\n        var res = await fetch(\"/api/proxy-ip\");\n        var activeIata = \"\";\n        if (res.ok) {\n            var data = await res.json();\n            activeIata = data.iata || \"\";\n            if (data.frag_len) document.getElementById(\"frag-length\").value = data.frag_len;\n            if (data.frag_int) document.getElementById(\"frag-interval\").value = data.frag_int;\n        }\n        var locRes = await fetch(\"/locations\");\n        if (locRes.ok) {\n            var locations = await locRes.json();\n            var html = \'<option value=\"\">Default Location</option>\';\n            locations.forEach(function(loc) {\n                if (loc.iata && loc.city) {\n                    var selected = loc.iata.toUpperCase() === activeIata.toUpperCase() ? \"selected\" : \"\";\n                    html += \'<option value=\"\' + loc.iata + \'\" \' + selected + \'>\' + loc.city + \' (\' + loc.iata + \')</option>\';\n                }\n            });\n            select.innerHTML = html;\n        }\n    } catch(e) { select.innerHTML = \'<option value=\"\">Error loading locations</option>\'; }\n}\n\n// ============================================\n// USER ACTIONS\n// ============================================\nfunction copyConfig(username) {\n    var user = allUsers.find(function(u) { return u.username === username; });\n    if (!user) return;\n    var host = window.location.hostname;\n    var ips = user.ips ? user.ips.split(\"\\n\").filter(function(i) { return i.trim(); }) : [host];\n    var ports = String(user.port || \"443\").split(\",\").map(function(p) { return p.trim(); }).filter(function(p) { return p; });\n    var fp = user.fingerprint || \"chrome\";\n    var firstIp = ips[0] || host;\n    var firstPort = ports[0] || \"443\";\n    var isTls = [\"443\",\"2053\",\"2083\",\"2087\",\"2096\",\"8443\"].indexOf(firstPort) !== -1;\n    var tlsVal = isTls ? \"tls\" : \"none\";\n    var link = \"vless://\" + user.uuid + \"@\" + firstIp + \":\" + firstPort + \"?path=%2F&security=\" + tlsVal + \"&encryption=none&insecure=0&host=\" + host + \"&fp=\" + fp + \"&type=ws&allowInsecure=0&sni=\" + host + \"#\" + encodeURIComponent(user.config_name || user.username);\n    navigator.clipboard.writeText(link).then(function() { alert(\"Config copied!\"); });\n}\n\nfunction copyJsonConfig(username) {\n    var user = allUsers.find(function(u) { return u.username === username; });\n    if (!user) return;\n    var host = window.location.hostname;\n    var ips = user.ips ? user.ips.split(\"\\n\").filter(function(i) { return i.trim(); }) : [host];\n    var ports = String(user.port || \"443\").split(\",\").map(function(p) { return p.trim(); }).filter(function(p) { return p; });\n    var fp = user.fingerprint || \"chrome\";\n    var configs = [];\n    var firstIp = ips[0] || host;\n    var firstPort = ports[0] || \"443\";\n    var isTls = [\"443\",\"2053\",\"2083\",\"2087\",\"2096\",\"8443\"].indexOf(firstPort) !== -1;\n    var tlsVal = isTls ? \"tls\" : \"none\";\n    var config = {\n        remarks: user.config_name || user.username,\n        outbounds: [{\n            protocol: \"vless\",\n            settings: { vnext: [{ address: firstIp, port: parseInt(firstPort), users: [{ id: user.uuid, encryption: \"none\" }] }] },\n            streamSettings: { network: \"ws\", wsSettings: { host: host, path: \"/\" }, security: tlsVal }\n        }]\n    };\n    configs.push(config);\n    navigator.clipboard.writeText(JSON.stringify(configs, null, 2)).then(function() { alert(\"JSON config copied!\"); });\n}\n\nfunction showQRForUser(username) {\n    var user = allUsers.find(function(u) { return u.username === username; });\n    if (!user) return;\n    var host = window.location.hostname;\n    var firstIp = user.ips ? user.ips.split(\"\\n\").filter(function(i) { return i.trim(); })[0] || host : host;\n    var firstPort = String(user.port || \"443\").split(\",\")[0] || \"443\";\n    var isTls = [\"443\",\"2053\",\"2083\",\"2087\",\"2096\",\"8443\"].indexOf(firstPort) !== -1;\n    var tlsVal = isTls ? \"tls\" : \"none\";\n    var link = \"vless://\" + user.uuid + \"@\" + firstIp + \":\" + firstPort + \"?path=%2F&security=\" + tlsVal + \"&encryption=none&insecure=0&host=\" + host + \"&fp=\" + (user.fingerprint || \"chrome\") + \"&type=ws&allowInsecure=0&sni=\" + host + \"#\" + encodeURIComponent(user.config_name || user.username);\n    showQR(link, \"QR Code - \" + user.username);\n}\n\nfunction showQR(link, title) {\n    var modal = document.getElementById(\"qr-modal\");\n    var box = document.getElementById(\"qrcode-box\");\n    box.innerHTML = \"\";\n    try {\n        new QRCode(box, { text: link, width: 200, height: 200, colorDark: \"#000000\", colorLight: \"#ffffff\" });\n    } catch(e) {\n        box.innerHTML = \'<p style=\"color:var(--text-secondary);\">Error generating QR</p>\';\n    }\n    modal.classList.add(\"active\");\n}\n\nfunction toggleUserStatus(username) {\n    if (!confirm(\"Toggle status for \" + username + \"?\")) return;\n    fetch(\"/api/users/\" + encodeURIComponent(username), {\n        method: \"PUT\",\n        headers: { \"Content-Type\": \"application/json\" },\n        body: JSON.stringify({ toggle_only: true })\n    }).then(function(res) {\n        if (res.ok) loadUsers();\n        else alert(\"Failed to toggle status\");\n    }).catch(function() { alert(\"Connection error\"); });\n}\n\nfunction deleteUser(username) {\n    if (!confirm(\"Delete user: \" + username + \"?\")) return;\n    fetch(\"/api/users/\" + encodeURIComponent(username), { method: \"DELETE\" })\n        .then(function(res) {\n            if (res.ok) loadUsers();\n            else alert(\"Failed to delete user\");\n        }).catch(function() { alert(\"Connection error\"); });\n}\n\nfunction editUser(username) {\n    var user = allUsers.find(function(u) { return u.username === username; });\n    if (!user) return;\n    document.getElementById(\"modal-title\").innerText = \"Edit User\";\n    document.getElementById(\"modal-submit-btn\").innerText = \"Save\";\n    document.getElementById(\"input-username\").value = user.username;\n    document.getElementById(\"input-username\").disabled = true;\n    document.getElementById(\"input-limit\").value = user.limit_gb || \"\";\n    document.getElementById(\"input-expiry\").value = user.expiry_days || \"\";\n    document.getElementById(\"fingerprint-select\").value = user.fingerprint || \"chrome\";\n    document.getElementById(\"config-name\").value = user.config_name || \"\";\n    document.getElementById(\"input-ips\").value = user.ips || \"\";\n    var ports = String(user.port || \"443\").split(\",\").map(function(p) { return p.trim(); });\n    document.querySelectorAll(\'input[name=\"ports\"]\').forEach(function(cb) {\n        cb.checked = ports.indexOf(cb.value) !== -1;\n    });\n    document.getElementById(\"user-form\").onsubmit = function(e) {\n        e.preventDefault();\n        var btn = document.getElementById(\"modal-submit-btn\");\n        btn.disabled = true;\n        btn.innerText = \"Saving...\";\n        var limit = document.getElementById(\"input-limit\").value || null;\n        var expiry = document.getElementById(\"input-expiry\").value || null;\n        var fingerprint = document.getElementById(\"fingerprint-select\").value;\n        var config_name = document.getElementById(\"config-name\").value || \"\";\n        var ips = document.getElementById(\"input-ips\").value;\n        var checkedPorts = Array.from(document.querySelectorAll(\'input[name=\"ports\"]:checked\')).map(function(cb) { return cb.value; });\n        var port = checkedPorts.length > 0 ? checkedPorts.join(\",\") : \"443\";\n        var tls = checkedPorts.some(function(p) { return [\"443\",\"2053\",\"2083\",\"2087\",\"2096\",\"8443\"].indexOf(p) !== -1; }) ? \"on\" : \"off\";\n        fetch(\"/api/users/\" + encodeURIComponent(username), {\n            method: \"PUT\",\n            headers: { \"Content-Type\": \"application/json\" },\n            body: JSON.stringify({ limit_gb: limit, expiry_days: expiry, tls: tls, port: port, ips: ips, fingerprint: fingerprint, config_name: config_name })\n        }).then(function(res) {\n            if (res.ok) { closeModal(); loadUsers(); alert(\"User updated\"); }\n            else alert(\"Failed to update user\");\n            btn.disabled = false;\n            btn.innerText = \"Save\";\n        }).catch(function() { alert(\"Connection error\"); btn.disabled = false; btn.innerText = \"Save\"; });\n    };\n    document.getElementById(\"user-modal\").classList.add(\"active\");\n}\n\n// ============================================\n// INIT\n// ============================================\ndocument.addEventListener(\"DOMContentLoaded\", function() {\n    loadUsers();\n    loadAdminsList();\n    loadLocations();\n    loadRequestStats();\n    loadApiToken();\n    document.getElementById(\"log-start-time\").innerText = new Date().toLocaleString();\n    setInterval(loadUsers, 30000);\n    setInterval(loadRequestStats, 10000);\n    window.addEventListener(\"resize\", function() {\n        if (window.innerWidth >= 1024) closeSidebar();\n    });\n    document.getElementById(\"user-modal\").addEventListener(\"click\", function(e) {\n        if (e.target === this) closeModal();\n    });\n    document.getElementById(\"qr-modal\").addEventListener(\"click\", function(e) {\n        if (e.target === this) closeQRModal();\n    });\n});\n<\/script>\n</body>\n</html>',

  status: '<!DOCTYPE html>\n<html lang="en" id="html-root">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>User Status - VoidLatency</title>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>\n    <style>\n        * { margin:0; padding:0; box-sizing:border-box; font-family:"Inter",system-ui,sans-serif; }\n        :root {\n            --bg-primary: #0d1117;\n            --bg-secondary: #161b22;\n            --text-primary: #e6edf3;\n            --text-secondary: #8b949e;\n            --border-color: #30363d;\n            --success: #3fb950;\n            --danger: #f85149;\n            --warning: #d29922;\n            --accent: #1f6feb;\n        }\n        [data-theme="light"] {\n            --bg-primary: #f6f8fa;\n            --bg-secondary: #ffffff;\n            --text-primary: #1f2328;\n            --text-secondary: #57606a;\n            --border-color: #d0d7de;\n        }\n        body { background:var(--bg-primary); color:var(--text-primary); display:flex; min-height:100vh; justify-content:center; align-items:center; padding:20px; transition:background 0.3s, color 0.3s; }\n        .card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:32px; max-width:500px; width:100%; transition:background 0.3s, border-color 0.3s; }\n        .card .header { text-align:center; margin-bottom:24px; }\n        .card .header .logo { font-size:32px; font-weight:800; background:linear-gradient(135deg,#58a6ff,#1f6feb); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }\n        .card .header .sub { color:var(--text-secondary); font-size:14px; }\n        .status-box { padding:12px; border-radius:12px; text-align:center; font-weight:600; margin-bottom:16px; }\n        .status-box.active { background:rgba(46,160,67,0.15); border:1px solid rgba(46,160,67,0.3); color:var(--success); }\n        .status-box.inactive { background:rgba(248,81,73,0.15); border:1px solid rgba(248,81,73,0.3); color:var(--danger); }\n        .status-box.expired { background:rgba(210,153,34,0.15); border:1px solid rgba(210,153,34,0.3); color:var(--warning); }\n        .info-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-color); font-size:14px; }\n        .info-row:last-child { border-bottom:none; }\n        .info-row .label { color:var(--text-secondary); }\n        .info-row .value { color:var(--text-primary); font-weight:500; }\n        .btn { display:block; width:100%; padding:10px; background:var(--accent); color:white; border:none; border-radius:8px; font-weight:600; font-size:14px; cursor:pointer; margin-top:8px; transition:background 0.2s; }\n        .btn:hover { background:#388bfd; }\n        .btn-secondary { background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-color); }\n        .btn-secondary:hover { background:var(--border-color); }\n        .qr-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:100; justify-content:center; align-items:center; }\n        .qr-modal.active { display:flex; }\n        .qr-modal .qr-card { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:32px; text-align:center; }\n        .qr-modal .qr-card .qr-box { background:white; padding:16px; border-radius:12px; display:inline-block; margin:12px auto; }\n        .theme-toggle { position:fixed; top:20px; right:20px; background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-primary); padding:8px 14px; border-radius:8px; cursor:pointer; font-size:14px; transition:background 0.3s; }\n        .theme-toggle:hover { background:var(--border-color); }\n    </style>\n</head>\n<body>\n    <button class="theme-toggle" onclick="toggleTheme()">🌓</button>\n    <div class="card">\n        <div class="header">\n            <div class="logo">VoidLatency</div>\n            <div class="sub" id="display-username">Loading...</div>\n        </div>\n        <div id="status-box" class="status-box active">Loading status...</div>\n        <div id="info-container"></div>\n        <button class="btn" onclick="copyConfig()">Copy VLESS Config</button>\n        <button class="btn btn-secondary" onclick="showQR()">Show QR Code</button>\n        <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-secondary);">\n            <a href="/sub/' + encodeURIComponent('{{USERNAME}}') + '" style="color:var(--accent);text-decoration:none;">Subscription Link</a>\n        </div>\n    </div>\n\n    <div id="qr-modal" class="qr-modal">\n        <div class="qr-card">\n            <h3 style="margin-bottom:12px;color:var(--text-primary);">QR Code</h3>\n            <div class="qr-box"><div id="qrcode-box" style="width:200px;height:200px;"></div></div>\n            <button class="btn btn-secondary" onclick="closeQR()">Close</button>\n        </div>\n    </div>\n\n    <script>\n        function toggleTheme() {\n            const html = document.getElementById("html-root");\n            const current = html.getAttribute("data-theme");\n            const newTheme = current === "light" ? "dark" : "light";\n            html.setAttribute("data-theme", newTheme);\n            localStorage.setItem("theme", newTheme);\n        }\n        (function() {\n            const saved = localStorage.getItem("theme") || "dark";\n            document.getElementById("html-root").setAttribute("data-theme", saved);\n        })();\n        \n        /* {{USER_DATA_PLACEHOLDER}} */\n        var user = window.statusUser || {};\n\n        function getVlessLink() {\n            if (!user.uuid) return "";\n            var host = window.location.hostname;\n            var ips = user.ips ? user.ips.split("\\n").filter(function(i) { return i.trim(); }) : [host];\n            var ports = String(user.port || "443").split(",").map(function(p) { return p.trim(); }).filter(function(p) { return p; });\n            var fp = user.fingerprint || "chrome";\n            var firstIp = ips[0] || host;\n            var firstPort = ports[0] || "443";\n            var isTls = ["443","2053","2083","2087","2096","8443"].indexOf(firstPort) !== -1;\n            var tlsVal = isTls ? "tls" : "none\";\n            var now = new Date();\n            var created = new Date(user.created_at);\n            var expiryDays = user.expiry_days || 30;\n            var expiryDate = new Date(created.getTime() + expiryDays * 24 * 60 * 60 * 1000);\n            var daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));\n            var totalGB = user.limit_gb || 0;\n            var usedGB = user.used_gb || 0;\n            var usedFormatted = usedGB >= 1 ? usedGB.toFixed(1) + \"GB\" : (usedGB * 1024).toFixed(0) + \"MB\";\n            var expiryDateStr = expiryDate.toISOString().split(\"T\")[0].replace(/-/g, \"/\");\n            var remark = user.username.toUpperCase() + \" | Exp: \" + expiryDateStr + \" | \" + daysLeft + \" Days Left\";\n            var link = \"vless://\" + user.uuid + \"@\" + firstIp + \":\" + firstPort + \"?path=%2F&security=\" + tlsVal + \"&encryption=none&insecure=0&host=\" + host + \"&fp=\" + fp + \"&type=ws&allowInsecure=0&sni=\" + host + \"#\" + encodeURIComponent(remark);\n            return link;\n        }\n\n        function copyConfig() {\n            var link = getVlessLink();\n            if (!link) return;\n            navigator.clipboard.writeText(link).then(function() { alert(\"Config copied!\"); });\n        }\n\n        function showQR() {\n            var link = getVlessLink();\n            if (!link) return;\n            document.getElementById(\"qr-modal\").classList.add(\"active\");\n            var box = document.getElementById(\"qrcode-box\");\n            box.innerHTML = \"\";\n            try {\n                new QRCode(box, { text: link, width: 200, height: 200, colorDark: \"#000000\", colorLight: \"#ffffff\" });\n            } catch(e) {\n                box.innerHTML = \'<p style=\"color:var(--text-secondary);\">Error generating QR</p>\';\n            }\n        }\n\n        function closeQR() {\n            document.getElementById(\"qr-modal\").classList.remove(\"active\");\n        }\n\n        document.addEventListener(\"DOMContentLoaded\", function() {\n            if (!user.username) {\n                document.getElementById(\"display-username\").innerText = \"User not found\";\n                return;\n            }\n            document.getElementById(\"display-username\").innerText = \"@\" + user.username + \" | \" + (user.port || \"443\");\n            \n            var info = document.getElementById(\"info-container\");\n            var used = user.used_gb || 0;\n            var limit = user.limit_gb || \"Unlimited\";\n            var usedDisplay = used < 1 ? (used * 1024).toFixed(0) + \" MB\" : used.toFixed(2) + \" GB\";\n            var created = new Date(user.created_at);\n            var expiryDays = user.expiry_days || 30;\n            var expiryDate = new Date(created.getTime() + expiryDays * 24 * 60 * 60 * 1000);\n            var daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));\n            \n            info.innerHTML = \n                \'<div class="info-row"><span class="label">Data Used</span><span class="value">\' + usedDisplay + \'</span></div>\' +\n                \'<div class="info-row"><span class="label">Data Limit</span><span class="value">\' + limit + \'</span></div>\' +\n                \'<div class="info-row"><span class="label">Expiry</span><span class="value">\' + expiryDate.toISOString().split(\"T\")[0] + \' (\' + (daysLeft > 0 ? daysLeft + \" days\" : \"Expired\") + \')</span></div>\' +\n                \'<div class="info-row"><span class="label">Status</span><span class="value">\' + (user.is_active ? \"Active\" : \"Inactive\") + \'</span></div>\';\n            \n            var statusBox = document.getElementById(\"status-box\");\n            if (user.is_active === 0) {\n                statusBox.className = \"status-box inactive\";\n                statusBox.innerText = \"Inactive / Disabled\";\n            } else if (user.limit_gb && user.used_gb >= user.limit_gb) {\n                statusBox.className = \"status-box expired\";\n                statusBox.innerText = \"Data Limit Exceeded\";\n            } else if (daysLeft <= 0) {\n                statusBox.className = \"status-box expired\";\n                statusBox.innerText = \"Subscription Expired\";\n            } else {\n                statusBox.className = \"status-box active\";\n                statusBox.innerText = \"Active & Connected\";\n            }\n        });\n    <\/script>\n</body>\n</html>'
};
export {
  voidlatency_core_default as default
};
