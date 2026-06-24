var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// voidlatency-core.js - Complete 3x-UI Style Panel with Full Responsive
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

// ============================================
// MAIN APPLICATION
// ============================================
var voidlatency_core_default = {
  async fetch(request, env, ctx) {
    await DbService.ensureSchema(env.VL_DB);
    await loadAdmins(env);
    const url = new URL(request.url);
    
    if (Router.isWebSocketUpgrade(request) && url.pathname === "/") {
      return await Router.handleWebSocket(request, env, ctx);
    }
    
    if (Router.isSubscriptionPath(url.pathname)) {
      return await Router.handleSubscription(url, env);
    }
    
    if (url.pathname.startsWith("/api/") || url.pathname === "/locations") {
      return await Router.handleApi(request, url, env, ctx);
    }
    
    if (url.pathname === "/panel" || url.pathname === "/login") {
      return await Router.handlePanel(request, env);
    }
    
    if (url.pathname.startsWith("/status/")) {
      return await Router.handleUserStatus(url, env);
    }
    
    return new Response(HTML_TEMPLATES.nginx, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

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
  isSubscriptionPath(pathname) {
    return pathname.startsWith("/sub/") || pathname.startsWith("/feed/");
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
    const isSubPath = url.pathname.startsWith("/sub/");
    const offset = isSubPath ? 5 : 6;
    let subUser = decodeURIComponent(url.pathname.slice(offset));
    const host = url.hostname;
    const isJson = !isSubPath && subUser.startsWith("json/");
    if (isJson) {
      subUser = subUser.slice(5);
    }
    try {
      const user = await env.VL_DB.prepare("SELECT * FROM users WHERE username = ? OR uuid = ?").bind(subUser, subUser).first();
      if (!user || user.connection_type !== atob("dmxlc3M=")) {
        return new Response("Not Found", { status: 404 });
      }
      if (isJson) {
        return await SubscriptionService.generateJson(user, host, env);
      } else {
        return await SubscriptionService.generateText(user, host);
      }
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
        fingerprint: user.fingerprint || "chrome"
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
    
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { password } = await request.json();
      const hashedInput = await DbService.sha256(password);
      const storedHash = await DbService.getPanelPassword(env.VL_DB);
      if (storedHash === hashedInput) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Set-Cookie": "panel_session=" + storedHash + "; Path=/; HttpOnly; Secure; SameSite=Lax"
          }
        });
      }
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "panel_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
        }
      });
    }
    
    const authorized = await DbService.verifyApiAuth(request, env);
    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    
    if (url.pathname === "/api/change-password" && request.method === "POST") {
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
    
    if (url.pathname === "/api/xray" && request.method === "POST") {
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
    
    if (url.pathname === "/api/system/stats") {
      return new Response(JSON.stringify({
        cpu: SYSTEM_STATS.cpu,
        ram: SYSTEM_STATS.ram,
        swap: SYSTEM_STATS.swap,
        storage: SYSTEM_STATS.storage,
        uptime: "26d 3h",
        xray_uptime: Math.floor((Date.now() - xrayStatus.startTime) / 1000)
      }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    
    if (url.pathname === "/api/proxy-ip") {
      if (request.method === "POST") {
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
    
    if (url.pathname === "/api/admins") {
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
    
    if (url.pathname.startsWith("/api/users")) {
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
            const { limit_gb, expiry_days, ips, tls, port, fingerprint } = body;
            await env.VL_DB.prepare(
              "UPDATE users SET limit_gb = ?, expiry_days = ?, ips = ?, tls = ?, port = ?, fingerprint = ? WHERE username = ?"
            ).bind(
              limit_gb ? parseFloat(limit_gb) : null,
              expiry_days ? parseInt(expiry_days) : null,
              ips || null,
              tls,
              port,
              fingerprint || "chrome",
              username
            ).run();
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
          }
        }
        if (request.method === "DELETE") {
          await env.VL_DB.prepare("DELETE FROM users WHERE username = ?").bind(username).run();
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
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
            used_gb: user.used_gb || 0
          }));
          return new Response(JSON.stringify({ users: enrichedUsers, serverTime: now }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
            }
          });
        }
        if (request.method === "POST") {
          const { username, limit_gb, expiry_days, ips, tls, port, fingerprint } = await request.json();
          if (!username) {
            return new Response(JSON.stringify({ error: "Username is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
          }
          const uuid = crypto.randomUUID();
          try {
            await env.VL_DB.prepare(
              "INSERT INTO users (username, uuid, limit_gb, expiry_days, ips, connection_type, tls, port, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(
              username,
              uuid,
              limit_gb ? parseFloat(limit_gb) : null,
              expiry_days ? parseInt(expiry_days) : null,
              ips || null,
              atob("dmxlc3M="),
              tls,
              port,
              fingerprint || "chrome"
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    const storedPasswordHash = await this.getPanelPassword(env.VL_DB);
    if (!storedPasswordHash) return true;
    const cookies = request.headers.get("Cookie") || "";
    const sessionCookie = cookies.split(";").find((c) => c.trim().startsWith("panel_session="));
    if (!sessionCookie) return false;
    const sessionToken = sessionCookie.split("=")[1].trim();
    return sessionToken === storedPasswordHash;
  },
  async sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};

// ============================================
// SUBSCRIPTION SERVICE (Enhanced - 2 configs with info, rest with format)
// ============================================
var SubscriptionService = {
  async generateJson(user, host, env) {
    let ips = [host];
    if (user.ips) {
      const parsedIps = user.ips.split("\n").map((ip) => ip.trim()).filter((ip) => ip.length > 0);
      if (parsedIps.length > 0) ips = parsedIps;
    }
    const ports = String(user.port || "443").split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    const fp = user.fingerprint || "chrome";
    let fragLen = "20-30";
    let fragInt = "1-2";
    try {
      const rowLen = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'frag_len'").first();
      if (rowLen && rowLen.value) fragLen = rowLen.value;
      const rowInt = await env.VL_DB.prepare("SELECT value FROM settings WHERE key = 'frag_int'").first();
      if (rowInt && rowInt.value) fragInt = rowInt.value;
    } catch (e) {}
    
    const configArray = [];
    const now = new Date();
    const created = new Date(user.created_at);
    const expiryDate = new Date(created.getTime() + (user.expiry_days || 30) * 24 * 60 * 60 * 1000);
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    const totalGB = user.limit_gb || 0;
    const usedGB = user.used_gb || 0;
    const leftGB = Math.max(0, totalGB - usedGB);
    
    ips.forEach((ip, ipIndex) => {
      ports.forEach((portStr, portIndex) => {
        const isTlsPort = ["443", "2053", "2083", "2087", "2096", "8443"].includes(portStr);
        const tlsVal = isTlsPort ? "tls" : "none";
        
        // First 2 configs have info (expiry and traffic)
        if (portIndex < 2) {
          // Config 1: Expiry info
          const remark1 = "⏳ INFO | " + user.username.toUpperCase() + " STATUS | 📅 Exp: " + expiryDate.toISOString().split('T')[0].replace(/-/g, '/') + " | 🔥 " + daysLeft + " Days Left | " + (daysLeft > 0 ? "🟢 ACTIVE" : "🔴 EXPIRED");
          const configObj1 = this.buildConfig(user, ip, portStr, tlsVal, host, fp, fragLen, fragInt, remark1);
          configArray.push(configObj1);
          
          // Config 2: Traffic info
          const usedFormatted = usedGB >= 1 ? usedGB.toFixed(1) + "GB" : (usedGB * 1024).toFixed(0) + "MB";
          const leftFormatted = leftGB >= 1 ? leftGB.toFixed(1) + "GB" : (leftGB * 1024).toFixed(0) + "MB";
          const totalFormatted = totalGB >= 1 ? totalGB + "GB" : "Unlimited";
          const remark2 = "📊 INFO | " + user.username.toUpperCase() + " TRAFFIC | 💾 " + totalFormatted + " Total | ⚡ " + usedFormatted + " Used | 🎯 " + leftFormatted + " Left";
          const configObj2 = this.buildConfig(user, ip, portStr, tlsVal, host, fp, fragLen, fragInt, remark2);
          configArray.push(configObj2);
        } else {
          // Rest use format: username | port | @VoidLatency | 🏁
          const remark = user.username + " | " + portStr + " | @VoidLatency | 🏁";
          const configObj = this.buildConfig(user, ip, portStr, tlsVal, host, fp, fragLen, fragInt, remark);
          configArray.push(configObj);
        }
      });
    });
    return new Response(JSON.stringify(configArray, null, 2), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });
  },
  
  buildConfig(user, ip, portStr, tlsVal, host, fp, fragLen, fragInt, remark) {
    const configObj = {
      remarks: remark,
      version: { min: "25.10.15" },
      log: { loglevel: "none" },
      dns: {
        servers: [
          { address: "https://8.8.8.8/dns-query", tag: "remote-dns" },
          { address: "8.8.8.8", domains: ["full:" + host], skipFallback: true }
        ],
        queryStrategy: "UseIP",
        tag: "dns"
      },
      inbounds: [
        {
          listen: "127.0.0.1",
          port: 10808,
          protocol: "socks",
          settings: { auth: "noauth", udp: true },
          sniffing: { destOverride: ["http", "tls"], enabled: true, routeOnly: true },
          tag: "mixed-in"
        },
        {
          listen: "127.0.0.1",
          port: 10853,
          protocol: "dokodemo-door",
          settings: { address: "1.1.1.1", network: "tcp,udp", port: 53 },
          tag: "dns-in"
        }
      ],
      outbounds: [
        {
          protocol: "vless",
          settings: {
            ["vnext"]: [{
              address: ip,
              port: parseInt(portStr),
              users: [{ id: user.uuid, encryption: "none" }]
            }]
          },
          ["streamSettings"]: {
            network: "ws",
            ["wsSettings"]: { host, path: "/" },
            security: tlsVal,
            sockopt: { ["dialerProxy"]: "fragment" }
          },
          tag: "proxy"
        },
        {
          protocol: "freedom",
          settings: {
            fragment: { packets: "tlshello", length: fragLen, interval: fragInt }
          },
          ["streamSettings"]: {
            sockopt: {
              domainStrategy: "UseIP",
              happyEyeballs: { tryDelayMs: 250, prioritizeIPv6: false, interleave: 2, maxConcurrentTry: 4 }
            }
          },
          tag: "fragment"
        },
        { protocol: "dns", settings: { nonIPQuery: "reject" }, tag: "dns-out" },
        { protocol: "freedom", settings: { domainStrategy: "UseIP" }, tag: "direct" },
        { protocol: "blackhole", settings: { response: { type: "http" } }, tag: "block" }
      ],
      routing: {
        domainStrategy: "IPIfNonMatch",
        rules: [
          { inboundTag: ["mixed-in"], port: 53, outboundTag: "dns-out", type: "field" },
          { inboundTag: ["dns-in"], outboundTag: "dns-out", type: "field" },
          { inboundTag: ["remote-dns"], outboundTag: "proxy", type: "field" },
          { inboundTag: ["dns"], outboundTag: "direct", type: "field" },
          { domain: ["geosite:private"], outboundTag: "direct", type: "field" },
          { ip: ["geoip:private"], outboundTag: "direct", type: "field" },
          { network: "udp", outboundTag: "block", type: "field" },
          { network: "tcp", outboundTag: "proxy", type: "field" }
        ]
      }
    };
    if (tlsVal === "tls") {
      configObj.outbounds[0]["streamSettings"]["tlsSettings"] = {
        serverName: host,
        fingerprint: fp,
        alpn: ["http/1.1"],
        allowInsecure: false
      };
    }
    return configObj;
  },
  
  async generateText(user, host) {
    let ips = [host];
    if (user.ips) {
      const parsedIps = user.ips.split("\n").map((ip) => ip.trim()).filter((ip) => ip.length > 0);
      if (parsedIps.length > 0) ips = parsedIps;
    }
    const ports = String(user.port || "443").split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    const fp = user.fingerprint || "chrome";
    
    const now = new Date();
    const created = new Date(user.created_at);
    const expiryDays = user.expiry_days || 30;
    const expiryDate = new Date(created.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    const totalGB = user.limit_gb || 0;
    const usedGB = user.used_gb || 0;
    const leftGB = Math.max(0, totalGB - usedGB);
    const expiryDateStr = expiryDate.toISOString().split('T')[0].replace(/-/g, '/');
    
    const links = [];
    ips.forEach((ip) => {
      ports.forEach((portStr, portIndex) => {
        const isTlsPort = ["443", "2053", "2083", "2087", "2096", "8443"].includes(portStr);
        const tlsVal = isTlsPort ? "tls" : "none";
        
        // First 2 configs have info
        if (portIndex < 2) {
          // Config 1: Expiry info
          const remark1 = "⏳ INFO | " + user.username.toUpperCase() + " STATUS | 📅 Exp: " + expiryDateStr + " | 🔥 " + daysLeft + " Days Left | " + (daysLeft > 0 ? "🟢 ACTIVE" : "🔴 EXPIRED");
          links.push(atob("dmxlc3M6Ly8=") + user.uuid + "@" + ip + ":" + portStr + "?path=%2F&security=" + tlsVal + "&encryption=none&insecure=0&host=" + host + "&fp=" + fp + "&type=ws&allowInsecure=0&sni=" + host + "#" + encodeURIComponent(remark1));
          
          // Config 2: Traffic info
          const usedFormatted = usedGB >= 1 ? usedGB.toFixed(1) + "GB" : (usedGB * 1024).toFixed(0) + "MB";
          const leftFormatted = leftGB >= 1 ? leftGB.toFixed(1) + "GB" : (leftGB * 1024).toFixed(0) + "MB";
          const totalFormatted = totalGB >= 1 ? totalGB + "GB" : "Unlimited";
          const remark2 = "📊 INFO | " + user.username.toUpperCase() + " TRAFFIC | 💾 " + totalFormatted + " Total | ⚡ " + usedFormatted + " Used | 🎯 " + leftFormatted + " Left";
          links.push(atob("dmxlc3M6Ly8=") + user.uuid + "@" + ip + ":" + portStr + "?path=%2F&security=" + tlsVal + "&encryption=none&insecure=0&host=" + host + "&fp=" + fp + "&type=ws&allowInsecure=0&sni=" + host + "#" + encodeURIComponent(remark2));
        } else {
          // Rest use format
          const remark = user.username + " | " + portStr + " | @VoidLatency | 🏁";
          links.push(atob("dmxlc3M6Ly8=") + user.uuid + "@" + ip + ":" + portStr + "?path=%2F&security=" + tlsVal + "&encryption=none&insecure=0&host=" + host + "&fp=" + fp + "&type=ws&allowInsecure=0&sni=" + host + "#" + encodeURIComponent(remark));
        }
      });
    });
    
    const header = [
      "# ==========================================",
      "# VoidLatency Subscription Feed",
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
      } catch (e) {
        let recovered = GLOBAL_TRAFFIC_CACHE.get(uname) || 0;
        GLOBAL_TRAFFIC_CACHE.set(uname, recovered + cachedBytes);
      }
    }
  }
}
__name(flushExpiredTraffic, "flushExpiredTraffic");

// ============================================
// VLESS HANDLER (Unchanged)
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
      const writeTask = /* @__PURE__ */ __name(async () => {
        try {
          await env.VL_DB.prepare("UPDATE users SET used_gb = used_gb + ? WHERE username = ?").bind(deltaGb, username).run();
        } catch (e) {
          let recovered = GLOBAL_TRAFFIC_CACHE.get(username) || 0;
          GLOBAL_TRAFFIC_CACHE.set(username, recovered + bytesToCommit);
        }
      }, "writeTask");
      if (ctx) {
        ctx.waitUntil(writeTask());
      } else {
        writeTask();
      }
    } else {
      GLOBAL_TRAFFIC_CACHE.set(username, current);
    }
  }
  __name(addBytes, "addBytes");
  
  let isOfflineSet = false;
  const setOffline = /* @__PURE__ */ __name(() => {
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
        const writeTask = /* @__PURE__ */ __name(async () => {
          try {
            await env.VL_DB.prepare("UPDATE users SET used_gb = used_gb + ? WHERE username = ?").bind(deltaGb, uname).run();
          } catch (e) {
            let recovered = GLOBAL_TRAFFIC_CACHE.get(uname) || 0;
            GLOBAL_TRAFFIC_CACHE.set(uname, recovered + cachedBytes);
          }
        }, "writeTask");
        if (ctx) {
          ctx.waitUntil(writeTask());
        } else {
          writeTask();
        }
      }
    } else {
      ACTIVE_CONNECTIONS_COUNT.set(uname, activeCount);
    }
  }, "setOffline");
  
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
  
  const releaseRemoteWriter = /* @__PURE__ */ __name(() => {
    if (activeRemoteWriter) {
      try {
        activeRemoteWriter.releaseLock();
      } catch (e) {}
      activeRemoteWriter = null;
    }
    currentSocketWriter = null;
  }, "releaseRemoteWriter");
  
  const getRemoteWriter = /* @__PURE__ */ __name(() => {
    const s = remoteConnWrapper.socket;
    if (!s) return null;
    if (s !== currentSocketWriter) {
      releaseRemoteWriter();
      currentSocketWriter = s;
      activeRemoteWriter = s.writable.getWriter();
    }
    return activeRemoteWriter;
  }, "getRemoteWriter");
  
  const upstreamQueue = createUpstreamQueue({
    getWriter: getRemoteWriter,
    releaseWriter: releaseRemoteWriter,
    retryConnect: /* @__PURE__ */ __name(async () => {
      if (typeof remoteConnWrapper.retryConnect === "function") {
        await remoteConnWrapper.retryConnect();
      }
    }, "retryConnect"),
    closeConnection: /* @__PURE__ */ __name(() => {
      try {
        remoteConnWrapper.socket?.close();
      } catch (e) {}
      closeSocketQuietly(serverSock);
    }, "closeConnection"),
    name: "VlessWSQueue"
  });
  
  const writeToRemote = /* @__PURE__ */ __name(async (chunk, allowRetry = true) => {
    return upstreamQueue.writeAndAwait(chunk, allowRetry);
  }, "writeToRemote");
  
  const processWsMessage = /* @__PURE__ */ __name(async (chunk) => {
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
        const setOnlineTask = /* @__PURE__ */ __name(async () => {
          try {
            const now = Date.now();
            GLOBAL_LAST_ACTIVE_WRITE.set(username, now);
            await env.VL_DB.prepare("UPDATE users SET last_active = ? WHERE username = ?").bind(now, username).run();
          } catch (e) {}
        }, "setOnlineTask");
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
        const connectTCP = /* @__PURE__ */ __name(async (dataPayload = null, useFallback = true) => {
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
        }, "connectTCP");
        remoteConnWrapper.retryConnect = async () => connectTCP(null, false);
        await connectTCP(rawData, true);
      } catch (e) {
        serverSock.close();
      }
    }
  }, "processWsMessage");
  
  const handleWsError = /* @__PURE__ */ __name((err) => {
    if (wsFailed) return;
    wsFailed = true;
    wsStopped = true;
    wsQueueBytes = 0;
    wsQueueItems = 0;
    upstreamQueue.clear();
    releaseRemoteWriter();
    closeSocketQuietly(serverSock);
    setOffline();
  }, "handleWsError");
  
  const pushToChain = /* @__PURE__ */ __name((task) => {
    wsChain = wsChain.then(task).catch(handleWsError);
  }, "pushToChain");
  
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
__name(handleVLESS, "handleVLESS");

// ============================================
// NETWORK UTILITIES (Unchanged)
// ============================================
function isIPv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
__name(isIPv4, "isIPv4");

function stripIPv6Brackets(hostname = "") {
  const host = String(hostname || "").trim();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
__name(stripIPv6Brackets, "stripIPv6Brackets");

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
__name(isIPHostname, "isIPHostname");

function convertToUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data || 0);
}
__name(convertToUint8Array, "convertToUint8Array");

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
__name(concatBytes, "concatBytes");

function closeSocketQuietly(socket) {
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
      socket.close();
    }
  } catch (e) {}
}
__name(closeSocketQuietly, "closeSocketQuietly");

// ============================================
// DNS UTILITIES (Unchanged)
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
    const encodeDomain = /* @__PURE__ */ __name((name) => {
      const parts = name.endsWith(".") ? name.slice(0, -1).split(".") : name.split(".");
      const bufs = [];
      for (const label of parts) {
        const enc = new TextEncoder().encode(label);
        bufs.push(new Uint8Array([enc.length]), enc);
      }
      bufs.push(new Uint8Array([0]));
      return concatBytes(...bufs);
    }, "encodeDomain");
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
    const parseName = /* @__PURE__ */ __name((pos) => {
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
    }, "parseName");
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
__name(dohQuery, "dohQuery");

// ============================================
// UPSTREAM QUEUE (Unchanged)
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
  
  const settleCompletions = /* @__PURE__ */ __name((completions, err = null) => {
    if (!completions) return;
    for (const comp of completions) {
      if (comp) {
        if (err) comp.reject(err);
        else comp.resolve();
      }
    }
  }, "settleCompletions");
  
  const rejectQueued = /* @__PURE__ */ __name((err) => {
    for (let i = head; i < chunks.length; i++) {
      const item = chunks[i];
      if (item && item.completions) settleCompletions(item.completions, err);
    }
  }, "rejectQueued");
  
  const compact = /* @__PURE__ */ __name(() => {
    if (head > 32 && head * 2 >= chunks.length) {
      chunks = chunks.slice(head);
      head = 0;
    }
  }, "compact");
  
  const resolveIdle = /* @__PURE__ */ __name(() => {
    if (queuedBytes || draining || !idleResolvers.length) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }, "resolveIdle");
  
  const clear = /* @__PURE__ */ __name((err = null) => {
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
  }, "clear");
  
  const shift = /* @__PURE__ */ __name(() => {
    if (head >= chunks.length) return null;
    const item = chunks[head];
    chunks[head++] = void 0;
    queuedBytes -= item.chunk.byteLength;
    compact();
    return item;
  }, "shift");
  
  const bundle = /* @__PURE__ */ __name(() => {
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
  }, "bundle");
  
  const drain = /* @__PURE__ */ __name(async () => {
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
  }, "drain");
  
  const enqueue = /* @__PURE__ */ __name((data, allowRetry = true, waitForFlush = false) => {
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
  }, "enqueue");
  
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
__name(createUpstreamQueue, "createUpstreamQueue");

// ============================================
// DOWNSTREAM SENDER (Unchanged)
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
  
  const sendRawChunk = /* @__PURE__ */ __name(async (chunk) => {
    if (webSocket.readyState !== WebSocket.OPEN) throw new Error("ws.readyState is not open");
    webSocket.send(chunk);
  }, "sendRawChunk");
  
  const attachResponseHeader = /* @__PURE__ */ __name((chunk) => {
    if (!header) return chunk;
    const merged = new Uint8Array(header.length + chunk.byteLength);
    merged.set(header, 0);
    merged.set(chunk, header.length);
    header = null;
    return merged;
  }, "attachResponseHeader");
  
  const flush = /* @__PURE__ */ __name(async () => {
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
  }, "flush");
  
  const scheduleFlush = /* @__PURE__ */ __name(() => {
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
  }, "scheduleFlush");
  
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
__name(createDownstreamSender, "createDownstreamSender");

async function waitForBackpressure(ws) {
  if (typeof ws.bufferedAmount === "number") {
    while (ws.bufferedAmount > 256 * 1024) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
__name(waitForBackpressure, "waitForBackpressure");

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
__name(connectStreams, "connectStreams");

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
__name(buildRaceCandidates, "buildRaceCandidates");

async function connectDirect(address, port, initialData = null) {
  const raceCandidates = await buildRaceCandidates(address, port);
  const candidates = raceCandidates || Array.from({ length: TCP_CONCURRENCY }, () => ({ hostname: address, port }));
  const openConnection = /* @__PURE__ */ __name(async (host, prt) => {
    const socket = connect({ hostname: host, port: prt });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1e3))
    ]);
    return socket;
  }, "openConnection");
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
__name(connectDirect, "connectDirect");

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
__name(forwardVlessUDP, "forwardVlessUDP");

function extractUUIDFromVless(data) {
  if (data.byteLength < 17) return null;
  const hex = [...data.slice(1, 17)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-" + hex.substring(16, 20) + "-" + hex.substring(20);
}
__name(extractUUIDFromVless, "extractUUIDFromVless");

// ============================================
// HTML TEMPLATES - Complete 3x-UI Style Panel with Full Responsive
// ============================================
var HTML_TEMPLATES = {
  nginx: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VoidLatency Panel</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(99, 102, 241, 0.15); }
        .gradient-text { background: linear-gradient(135deg, #818cf8, #a78bfa, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .animate-float { animation: float 6s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="max-w-3xl w-full text-center">
        <div class="animate-float mb-8">
            <div class="inline-block p-5 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 glow mb-4">
                <svg class="w-16 h-16 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
            </div>
            <h1 class="text-5xl font-black gradient-text mb-2">VoidLatency</h1>
            <p class="text-zinc-400 text-sm font-medium">Next-Gen VPN Management Panel</p>
            <div class="flex items-center justify-center gap-2 mt-2">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span class="text-xs text-emerald-400">● System Online</span>
            </div>
        </div>
        
        <div class="glass rounded-3xl p-10 glow">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div class="glass-light rounded-xl p-4">
                    <p class="text-xs text-zinc-400">Version</p>
                    <p class="text-lg font-bold text-white">v2.9.4</p>
                </div>
                <div class="glass-light rounded-xl p-4">
                    <p class="text-xs text-zinc-400">Protocol</p>
                    <p class="text-lg font-bold text-indigo-400">VLESS+WS</p>
                </div>
                <div class="glass-light rounded-xl p-4">
                    <p class="text-xs text-zinc-400">Status</p>
                    <p class="text-lg font-bold text-emerald-400">● Running</p>
                </div>
            </div>
            
            <a href="/panel" class="inline-flex items-center gap-3 px-10 py-4.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-2xl transition-all duration-200 shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 text-sm transform hover:scale-105">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
                </svg>
                Enter Dashboard
            </a>
            
            <div class="mt-8 pt-6 border-t border-zinc-800/50 flex flex-wrap justify-center gap-6 text-xs text-zinc-500">
                <span>🚀 v2.9.4</span>
                <span>•</span>
                <a href="https://github.com/Void0Latency/panel" target="_blank" class="hover:text-zinc-300 transition flex items-center gap-1">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z"/></svg>
                    GitHub
                </a>
                <span>•</span>
                <a href="https://t.me/VoidLatency" target="_blank" class="hover:text-zinc-300 transition flex items-center gap-1">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.94-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.37.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .24z"/></svg>
                    Telegram
                </a>
                <span>•</span>
                <span>@VoidLatency</span>
            </div>
        </div>
    </div>
</body>
</html>`,

  setup: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup - VoidLatency</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(99, 102, 241, 0.15); }
        input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s; }
        input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); outline: none; }
        .gradient-text { background: linear-gradient(135deg, #818cf8, #a78bfa, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full glass rounded-3xl p-8 glow">
        <div class="text-center mb-8">
            <div class="inline-block p-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-4">
                <svg class="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
            </div>
            <h2 class="text-2xl font-black text-white mb-1">Setup Password</h2>
            <p class="text-zinc-400 text-sm">Create your admin password to get started</p>
        </div>
        
        <form onsubmit="handleSetup(event)" class="space-y-4">
            <div>
                <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">New Password</label>
                <input type="password" id="password" class="w-full px-4 py-3.5 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition" placeholder="Enter password..." required minlength="4">
            </div>
            <div>
                <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Confirm Password</label>
                <input type="password" id="confirm-password" class="w-full px-4 py-3.5 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition" placeholder="Confirm password..." required minlength="4">
            </div>
            <button type="submit" id="submit-btn" class="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm shadow-lg shadow-indigo-500/25 transform hover:scale-[1.02]">Create Account</button>
        </form>
    </div>

    <script>
        async function handleSetup(event) {
            event.preventDefault();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const btn = document.getElementById('submit-btn');

            if (password !== confirmPassword) {
                alert('❌ Passwords do not match!');
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Creating...';

            try {
                const res = await fetch('/api/setup-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    window.location.reload();
                } else {
                    alert('❌ Error: ' + (data.error || 'Operation failed'));
                }
            } catch (err) {
                alert('❌ Connection error');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Create Account';
            }
        }
    <\/script>
</body>
</html>`,

  login: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - VoidLatency</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(99, 102, 241, 0.15); }
        input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s; }
        input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); outline: none; }
        .gradient-text { background: linear-gradient(135deg, #818cf8, #a78bfa, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full glass rounded-3xl p-8 glow">
        <div class="text-center mb-8">
            <div class="inline-block p-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-4">
                <svg class="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
                </svg>
            </div>
            <h2 class="text-2xl font-black text-white mb-1">Welcome Back</h2>
            <p class="text-zinc-400 text-sm">Enter your password to access the panel</p>
        </div>
        
        <form onsubmit="handleLogin(event)" class="space-y-4">
            <div>
                <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Password</label>
                <input type="password" id="password" class="w-full px-4 py-3.5 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition" placeholder="Enter password..." required>
            </div>
            <button type="submit" id="submit-btn" class="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm shadow-lg shadow-indigo-500/25 transform hover:scale-[1.02]">Sign In</button>
        </form>
    </div>

    <script>
        async function handleLogin(event) {
            event.preventDefault();
            const password = document.getElementById('password').value;
            const btn = document.getElementById('submit-btn');

            btn.disabled = true;
            btn.innerText = 'Signing in...';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    window.location.reload();
                } else {
                    alert('❌ Invalid password!');
                }
            } catch (err) {
                alert('❌ Connection error');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Sign In';
            }
        }
    <\/script>
</body>
</html>`,

  panel: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VoidLatency Panel</title>
    <script>
        const originalWarn = console.warn;
        console.warn = (...args) => {
            if (typeof args[0] === 'string' && args[0].includes('cdn.tailwindcss.com')) return;
            originalWarn(...args);
        };
    <\/script>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; color: #e5e7eb; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glass-light { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(99, 102, 241, 0.1); }
        
        /* Sidebar Styles */
        .sidebar { background: #0d0d18; border-right: 1px solid rgba(255,255,255,0.04); }
        .sidebar-link { transition: all 0.2s; border-radius: 12px; padding: 10px 16px; }
        .sidebar-link:hover { background: rgba(255,255,255,0.05); color: white; }
        .sidebar-link.active { background: rgba(99, 102, 241, 0.12); color: #818cf8; }
        .stat-card { transition: all 0.3s; }
        .stat-card:hover { transform: translateY(-4px); border-color: rgba(99, 102, 241, 0.3); }
        input, select, textarea { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s; }
        input:focus, select:focus, textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); outline: none; }
        .badge { padding: 2px 10px; border-radius: 6px; font-size: 10px; font-weight: 600; }
        .badge-success { background: rgba(52, 211, 153, 0.15); color: #34d399; }
        .badge-danger { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .badge-warning { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
        .badge-info { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
        .badge-purple { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
        .action-btn { transition: all 0.15s; padding: 6px; border-radius: 8px; }
        .action-btn:hover { transform: scale(1.1); background: rgba(255,255,255,0.05); }
        .system-stat { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 14px; padding: 16px; }
        .system-stat:hover { border-color: rgba(99, 102, 241, 0.2); }
        .btn-xray { padding: 6px 16px; border-radius: 8px; font-size: 12px; font-weight: 600; transition: all 0.2s; }
        .btn-xray:hover { transform: scale(1.05); }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.3); border-radius: 8px; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.3); border-radius: 8px; }
        .modal-overlay { background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); }
        .modal-card { max-height: 90vh; overflow-y: auto; }
        .page-section { display: none; }
        .page-section.active { display: block; }
        .port-checkbox:checked + .port-label-tls { border-color: #34d399; background: rgba(52, 211, 153, 0.1); color: #34d399; }
        .port-checkbox:checked + .port-label-nontls { border-color: #fbbf24; background: rgba(251, 191, 36, 0.1); color: #fbbf24; }
        .show-ports-btn { cursor: pointer; transition: all 0.2s; }
        .show-ports-btn:hover { color: #818cf8; }

        /* Mobile Responsive Fixes */
        @media (max-width: 1023px) {
            .sidebar {
                position: fixed !important;
                top: 0 !important;
                left: -100% !important;
                width: 280px !important;
                height: 100vh !important;
                background: #0d0d18 !important;
                border-right: 1px solid rgba(255,255,255,0.04) !important;
                transition: left 0.3s ease !important;
                z-index: 1000 !important;
                overflow-y: auto !important;
                display: block !important;
            }
            
            .sidebar.active {
                left: 0 !important;
            }
            
            .sidebar-overlay {
                display: none !important;
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: rgba(0,0,0,0.6) !important;
                z-index: 999 !important;
            }
            
            .sidebar-overlay.active {
                display: block !important;
            }
            
            .lg\\:ml-64 {
                margin-left: 0 !important;
            }
            
            .main-content {
                width: 100% !important;
                overflow-x: hidden !important;
            }
            
            .system-stat {
                padding: 12px !important;
            }
            
            .system-stat p.text-lg {
                font-size: 16px !important;
            }
            
            .stat-card {
                padding: 16px !important;
            }
            
            .stat-card p.text-3xl {
                font-size: 24px !important;
            }
            
            .users-table-wrap {
                overflow-x: auto !important;
                -webkit-overflow-scrolling: touch !important;
            }
            
            .users-table-wrap table {
                min-width: 700px !important;
            }
            
            .user-actions-wrap {
                flex-wrap: wrap !important;
            }
            
            .user-actions-wrap .action-btn {
                padding: 4px !important;
            }
            
            .subscription-buttons {
                flex-direction: column !important;
                gap: 4px !important;
            }
            
            .subscription-buttons button {
                width: 100% !important;
                font-size: 10px !important;
                padding: 4px 8px !important;
            }
        }

        @media (max-width: 640px) {
            .glass-modal {
                padding: 20px 16px !important;
            }
            
            .modal-card {
                max-width: 100% !important;
                margin: 10px !important;
            }
            
            .modal-card form .grid {
                grid-template-columns: 1fr !important;
            }
            
            .stats-grid {
                grid-template-columns: 1fr 1fr !important;
                gap: 8px !important;
            }
            
            .stats-grid .stat-card {
                padding: 12px !important;
            }
            
            .stats-grid .stat-card p.text-3xl {
                font-size: 20px !important;
            }
            
            .stats-grid .stat-card .w-12 {
                width: 36px !important;
                height: 36px !important;
            }
            
            .stats-grid .stat-card .w-12 svg {
                width: 18px !important;
                height: 18px !important;
            }
            
            header h1 {
                font-size: 16px !important;
            }
            
            header .text-xs {
                font-size: 10px !important;
            }
        }
    </style>
</head>
<body>

    <!-- Sidebar Overlay for Mobile -->
    <div id="sidebar-overlay" class="sidebar-overlay" onclick="toggleSidebar()"></div>

    <!-- Sidebar -->
    <div class="fixed inset-y-0 left-0 w-64 sidebar z-50">
        <div class="p-6">
            <div class="flex items-center gap-3 mb-10">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                </div>
                <span class="text-lg font-bold text-white">VoidLatency</span>
            </div>
            
            <nav class="space-y-1">
                <a href="#" onclick="showPage('dashboard')" class="sidebar-link active flex items-center gap-3 text-sm font-medium text-indigo-400" data-page="dashboard">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
                    </svg>
                    Overview
                </a>
                <a href="#" onclick="showPage('users')" class="sidebar-link flex items-center gap-3 text-sm font-medium text-zinc-400 hover:text-white transition" data-page="users">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                    </svg>
                    Users
                </a>
                <a href="#" onclick="showPage('settings')" class="sidebar-link flex items-center gap-3 text-sm font-medium text-zinc-400 hover:text-white transition" data-page="settings">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                    Panel Settings
                </a>
                <a href="#" onclick="showPage('logs')" class="sidebar-link flex items-center gap-3 text-sm font-medium text-zinc-400 hover:text-white transition" data-page="logs">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                    </svg>
                    Logs
                </a>
                <a href="#" onclick="showPage('admins')" class="sidebar-link flex items-center gap-3 text-sm font-medium text-zinc-400 hover:text-white transition" data-page="admins">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                    </svg>
                    Admins
                </a>
                <a href="#" onclick="logoutAdmin()" class="sidebar-link flex items-center gap-3 text-sm font-medium text-zinc-400 hover:text-red-400 transition">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                    </svg>
                    Log Out
                </a>
            </nav>
            
            <div class="absolute bottom-6 left-6 right-6">
                <div class="glass rounded-xl p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold text-white">A</div>
                        <div>
                            <p class="text-sm font-semibold text-white">Admin</p>
                            <p class="text-xs text-emerald-400">● Online</p>
                        </div>
                    </div>
                </div>
                <div class="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>v2.9.4</span>
                    <span>@VoidLatency</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Main Content -->
    <div class="lg:ml-64 min-h-screen main-content">
        <!-- Header -->
        <header class="bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-zinc-800/30 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-40">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3 sm:gap-4">
                    <button onclick="toggleSidebar()" class="lg:hidden p-2 rounded-lg hover:bg-white/5 text-zinc-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                        </svg>
                    </button>
                    <div>
                        <h1 class="text-lg sm:text-xl font-bold text-white" id="page-title">Overview</h1>
                        <p class="text-xs text-zinc-400 hidden sm:block" id="page-subtitle">System overview and statistics</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 sm:gap-3">
                    <span class="text-xs text-zinc-500 hidden sm:inline">v2.9.4</span>
                    <span class="w-px h-6 bg-zinc-800 hidden sm:block"></span>
                    <span class="text-xs text-emerald-400 flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span class="hidden xs:inline">Xray Running</span>
                    </span>
                </div>
            </div>
        </header>

        <!-- Content -->
        <main class="p-3 sm:p-6">
            <!-- Dashboard Page -->
            <div id="page-dashboard" class="page-section active">
                <!-- System Stats -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6 stats-grid">
                    <div class="system-stat">
                        <div class="flex items-center justify-between">
                            <p class="text-[10px] sm:text-xs text-zinc-400 font-medium">CPU</p>
                            <span class="text-[10px] sm:text-xs text-indigo-400">48 Cores</span>
                        </div>
                        <p class="text-base sm:text-lg font-bold text-white mt-1">12.5%</p>
                        <div class="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
                            <div class="bg-indigo-500 h-1.5 rounded-full transition-all" style="width: 12.5%"></div>
                        </div>
                        <p class="text-[8px] sm:text-[10px] text-zinc-500 mt-1">12.5 | 11.4 | 11.6</p>
                    </div>
                    <div class="system-stat">
                        <div class="flex items-center justify-between">
                            <p class="text-[10px] sm:text-xs text-zinc-400 font-medium">RAM</p>
                            <span class="text-[10px] sm:text-xs text-emerald-400">49.4%</span>
                        </div>
                        <p class="text-base sm:text-lg font-bold text-white">159.30 GB</p>
                        <p class="text-[8px] sm:text-xs text-zinc-500">/ 322.69 GB</p>
                        <div class="w-full bg-zinc-800 rounded-full h-1.5 mt-1">
                            <div class="bg-emerald-500 h-1.5 rounded-full transition-all" style="width: 49.4%"></div>
                        </div>
                    </div>
                    <div class="system-stat">
                        <div class="flex items-center justify-between">
                            <p class="text-[10px] sm:text-xs text-zinc-400 font-medium">Swap</p>
                            <span class="text-[10px] sm:text-xs text-yellow-400">0.6%</span>
                        </div>
                        <p class="text-base sm:text-lg font-bold text-white">1.39 GB</p>
                        <p class="text-[8px] sm:text-xs text-zinc-500">/ 223.56 GB</p>
                        <div class="w-full bg-zinc-800 rounded-full h-1.5 mt-1">
                            <div class="bg-yellow-500 h-1.5 rounded-full transition-all" style="width: 0.6%"></div>
                        </div>
                    </div>
                    <div class="system-stat">
                        <div class="flex items-center justify-between">
                            <p class="text-[10px] sm:text-xs text-zinc-400 font-medium">Storage</p>
                            <span class="text-[10px] sm:text-xs text-blue-400">28.6%</span>
                        </div>
                        <p class="text-base sm:text-lg font-bold text-white">818.93 GB</p>
                        <p class="text-[8px] sm:text-xs text-zinc-500">/ 2.86 TB</p>
                        <div class="w-full bg-zinc-800 rounded-full h-1.5 mt-1">
                            <div class="bg-blue-500 h-1.5 rounded-full transition-all" style="width: 28.6%"></div>
                        </div>
                    </div>
                </div>

                <!-- Xray Controls -->
                <div class="glass rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6">
                    <div class="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
                        <div class="flex items-center gap-3 sm:gap-4 flex-wrap">
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span class="text-sm font-bold text-white">Xray</span>
                            </div>
                            <span class="text-xs text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded">v26.4.25</span>
                            <span class="text-xs text-emerald-400 bg-emerald-500/10 px-2 sm:px-3 py-1 rounded-full border border-emerald-500/20">● Running</span>
                        </div>
                        <div class="flex items-center gap-1 sm:gap-2">
                            <button onclick="controlXray('stop')" class="btn-xray text-xs sm:text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 px-2 sm:px-4">Stop</button>
                            <button onclick="controlXray('restart')" class="btn-xray text-xs sm:text-sm bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 px-2 sm:px-4">Restart</button>
                            <button onclick="controlXray('start')" class="btn-xray text-xs sm:text-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 px-2 sm:px-4">Start</button>
                        </div>
                        <div class="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-zinc-400 flex-wrap">
                            <span>Uptime: <span id="xray-uptime" class="text-white font-medium">3m</span></span>
                            <span class="hidden xs:inline">|</span>
                            <span class="hidden xs:inline">RAM: <span class="text-white font-medium">50.98 MB</span></span>
                            <span class="hidden xs:inline">|</span>
                            <span class="hidden xs:inline">Threads: <span class="text-white font-medium">14</span></span>
                        </div>
                    </div>
                </div>

                <!-- Stats Grid -->
                <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-8 stats-grid">
                    <div class="glass rounded-2xl p-4 sm:p-6 stat-card">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-zinc-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Total Users</p>
                                <p class="text-2xl sm:text-3xl font-black text-white mt-1" id="stat-total-users">0</p>
                            </div>
                            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                <svg class="w-5 h-5 sm:w-6 sm:h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                    
                    <div class="glass rounded-2xl p-4 sm:p-6 stat-card">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-zinc-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Online</p>
                                <p class="text-2xl sm:text-3xl font-black text-emerald-400 mt-1" id="stat-active-users">0</p>
                            </div>
                            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                                <svg class="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                    
                    <div class="glass rounded-2xl p-4 sm:p-6 stat-card">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-zinc-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Traffic</p>
                                <p class="text-2xl sm:text-3xl font-black text-blue-400 mt-1" id="stat-total-usage">0 GB</p>
                            </div>
                            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                <svg class="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                    
                    <div class="glass rounded-2xl p-4 sm:p-6 stat-card">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-zinc-400 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Top User</p>
                                <p class="text-lg sm:text-2xl font-black text-purple-400 mt-1 truncate max-w-[80px] sm:max-w-[120px]" id="stat-top-user">-</p>
                            </div>
                            <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                                <svg class="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                </svg>
                            </div>
                        </div>
                        <p class="text-[10px] sm:text-xs text-zinc-500 mt-1 sm:mt-2" id="stat-top-user-usage">0 GB used</p>
                    </div>
                </div>
            </div>

            <!-- Users Page -->
            <div id="page-users" class="page-section">
                <div class="glass rounded-2xl p-4 sm:p-6">
                    <div class="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
                        <div>
                            <h2 class="text-lg font-bold text-white">Users</h2>
                            <p class="text-xs text-zinc-400">Manage your VLESS users</p>
                        </div>
                        <button onclick="openCreateModal()" class="flex items-center gap-2 px-3 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-xs sm:text-sm shadow-lg shadow-indigo-500/25 transform hover:scale-[1.02]">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
                            </svg>
                            <span class="hidden xs:inline">Add User</span>
                            <span class="xs:hidden">Add</span>
                        </button>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4 sm:mb-6">
                        <div class="flex-1 relative">
                            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                            <input type="text" id="search-input" oninput="filterAndRenderUsers()" placeholder="Search users..." class="w-full pl-9 pr-3 py-2 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                        </div>
                        <select id="filter-status" onchange="filterAndRenderUsers()" class="px-3 py-2 rounded-xl text-zinc-300 text-sm outline-none transition cursor-pointer bg-[rgba(255,255,255,0.05)] border border-zinc-800/50">
                            <option value="all">All</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="online">Online</option>
                            <option value="offline">Offline</option>
                            <option value="expired">Expired</option>
                        </select>
                        <select id="sort-users" onchange="filterAndRenderUsers()" class="px-3 py-2 rounded-xl text-zinc-300 text-sm outline-none transition cursor-pointer bg-[rgba(255,255,255,0.05)] border border-zinc-800/50">
                            <option value="newest">Newest</option>
                            <option value="name">Name</option>
                            <option value="usage-desc">Most Used</option>
                            <option value="usage-asc">Least Used</option>
                            <option value="expiry-asc">Expiring</option>
                        </select>
                    </div>

                    <div id="loading-state" class="text-center py-8 sm:py-12">
                        <div class="inline-block w-6 h-6 sm:w-8 sm:h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                        <p class="text-zinc-400 text-sm mt-3">Loading users...</p>
                    </div>

                    <div id="users-table-container" class="hidden">
                        <div class="users-table-wrap">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="border-b border-zinc-800/50 text-[10px] sm:text-xs text-zinc-400 uppercase tracking-wider">
                                        <th class="p-2 sm:p-3 font-medium">User</th>
                                        <th class="p-2 sm:p-3 font-medium">Sub</th>
                                        <th class="p-2 sm:p-3 font-medium hidden sm:table-cell">Protocol</th>
                                        <th class="p-2 sm:p-3 font-medium hidden md:table-cell">Ports</th>
                                        <th class="p-2 sm:p-3 font-medium hidden lg:table-cell">Usage</th>
                                        <th class="p-2 sm:p-3 font-medium hidden xl:table-cell">Expiry</th>
                                        <th class="p-2 sm:p-3 font-medium hidden 2xl:table-cell">Created</th>
                                    </tr>
                                </thead>
                                <tbody id="users-tbody" class="divide-y divide-zinc-800/30 text-sm"></tbody>
                            </table>
                        </div>
                    </div>

                    <div id="empty-state" class="hidden text-center py-8 sm:py-12">
                        <div class="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-zinc-800/30 flex items-center justify-center mx-auto mb-4">
                            <svg class="w-6 h-6 sm:w-8 sm:h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                            </svg>
                        </div>
                        <p class="text-zinc-400 text-sm">No users found.</p>
                    </div>
                </div>
            </div>

            <!-- Settings Page -->
            <div id="page-settings" class="page-section">
                <div class="glass rounded-2xl p-4 sm:p-6 max-w-2xl">
                    <h2 class="text-lg font-bold text-white mb-4">Panel Settings</h2>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Proxy Location</label>
                            <select id="location-select" class="w-full px-4 py-3 rounded-xl text-zinc-300 text-sm outline-none transition cursor-pointer bg-[rgba(255,255,255,0.05)] border border-zinc-800/50">
                                <option value="">Loading...</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-2 gap-3 sm:gap-4">
                            <div>
                                <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Fragment Length</label>
                                <input type="text" id="frag-length" placeholder="20-30" class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition text-center font-mono" dir="ltr">
                            </div>
                            <div>
                                <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Fragment Interval</label>
                                <input type="text" id="frag-interval" placeholder="1-2" class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition text-center font-mono" dir="ltr">
                            </div>
                        </div>
                        <div class="border-t border-zinc-800/30 pt-4">
                            <h4 class="text-sm font-semibold text-white mb-3">Change Password</h4>
                            <div class="space-y-3">
                                <input type="password" id="change-pwd-current" placeholder="Current password..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                                <input type="password" id="change-pwd-new" placeholder="New password..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                                <button type="button" onclick="changeAdminPassword()" id="change-pwd-btn" class="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm">Update Password</button>
                            </div>
                        </div>
                        <div class="flex gap-3 pt-2 border-t border-zinc-800/30">
                            <button type="button" onclick="saveSettings()" id="save-settings-btn" class="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm shadow-lg shadow-indigo-500/25">Save</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Logs Page -->
            <div id="page-logs" class="page-section">
                <div class="glass rounded-2xl p-4 sm:p-6">
                    <h2 class="text-lg font-bold text-white mb-4">System Logs</h2>
                    <div id="logs-container" class="space-y-1 font-mono text-xs max-h-96 overflow-y-auto scrollbar-thin">
                        <div class="text-emerald-400">● System started at: <span id="log-start-time">-</span></div>
                        <div class="text-zinc-500">● Xray service running</div>
                        <div class="text-zinc-500">● WebSocket server listening on /</div>
                        <div class="text-zinc-500">● API endpoints ready</div>
                        <div class="text-indigo-400">● Database connected</div>
                    </div>
                </div>
            </div>

            <!-- Admins Page -->
            <div id="page-admins" class="page-section">
                <div class="glass rounded-2xl p-4 sm:p-6 max-w-md">
                    <h2 class="text-lg font-bold text-white mb-4">Admin Management</h2>
                    <div id="admins-list" class="space-y-2">
                        <p class="text-zinc-400 text-sm">Loading admins...</p>
                    </div>
                    <div class="border-t border-zinc-800/30 pt-4 mt-4">
                        <h4 class="text-sm font-semibold text-white mb-3">Add New Admin</h4>
                        <div class="space-y-3">
                            <input type="text" id="admin-username" placeholder="Username..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                            <input type="password" id="admin-password" placeholder="Password..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                            <button onclick="addAdmin()" class="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm shadow-lg shadow-indigo-500/25">Add</button>
                        </div>
                    </div>
                </div>
            </div>

        </main>
    </div>

    <!-- Modals -->
    <!-- Add/Edit User Modal -->
    <div id="user-modal" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 modal-overlay opacity-0 pointer-events-none transition-opacity duration-300">
        <div id="user-modal-card" class="w-full max-w-2xl glass rounded-3xl p-4 sm:p-6 transition-all duration-300 opacity-0 scale-95 modal-card scrollbar-thin">
            <div class="flex items-center justify-between mb-4 sm:mb-6">
                <div>
                    <h3 id="modal-title" class="text-lg sm:text-xl font-bold text-white">Create User</h3>
                    <p class="text-xs text-zinc-400">Configure user settings and limits</p>
                </div>
                <button onclick="toggleModal(false)" class="p-2 rounded-lg hover:bg-white/5 text-zinc-400 transition">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <form id="create-user-form" onsubmit="handleFormSubmit(event)" class="space-y-4 sm:space-y-5">
                <div>
                    <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Username</label>
                    <input type="text" id="input-name" placeholder="Enter username..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition" required>
                </div>

                <div class="grid grid-cols-2 gap-3 sm:gap-4">
                    <div>
                        <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Limit (GB)</label>
                        <input type="number" id="input-limit" min="0" step="any" placeholder="Unlimited" class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                    </div>
                    <div>
                        <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Expiry (Days)</label>
                        <input type="number" id="input-expiry" min="0" placeholder="Unlimited" class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition">
                    </div>
                </div>

                <div>
                    <label class="block text-zinc-300 text-xs font-semibold mb-2 uppercase tracking-wider">Ports</label>
                    <div class="grid grid-cols-2 gap-2 sm:gap-3">
                        <div class="glass-light rounded-xl p-2 sm:p-3">
                            <p class="text-xs text-emerald-400 font-semibold mb-2">TLS</p>
                            <div class="flex flex-wrap gap-1 sm:gap-2" id="tls-ports-list"></div>
                        </div>
                        <div class="glass-light rounded-xl p-2 sm:p-3">
                            <p class="text-xs text-amber-400 font-semibold mb-2">Non-TLS</p>
                            <div class="flex flex-wrap gap-1 sm:gap-2" id="nontls-ports-list"></div>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Custom IPs</label>
                    <textarea id="input-ips" rows="2" placeholder="One IP per line..." class="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-500 text-sm outline-none transition resize-none"></textarea>
                </div>

                <div>
                    <label class="block text-zinc-300 text-xs font-semibold mb-1.5 uppercase tracking-wider">Fingerprint</label>
                    <select id="fingerprint-select" class="w-full px-4 py-3 rounded-xl text-zinc-300 text-sm outline-none transition cursor-pointer bg-[rgba(255,255,255,0.05)] border border-zinc-800/50">
                        <option value="chrome">Chrome</option>
                        <option value="firefox">Firefox</option>
                        <option value="safari">Safari</option>
                        <option value="ios">iOS</option>
                        <option value="android">Android</option>
                        <option value="edge">Edge</option>
                        <option value="360">360</option>
                        <option value="qq">QQ</option>
                        <option value="random">Random</option>
                        <option value="randomized">Randomized</option>
                    </select>
                </div>

                <div class="flex gap-3 pt-3 sm:pt-4 border-t border-zinc-800/30">
                    <button type="button" onclick="toggleModal(false)" class="flex-1 py-3 bg-white/5 hover:bg-white/10 text-zinc-400 font-semibold rounded-xl transition text-sm">Cancel</button>
                    <button type="submit" id="submit-btn" class="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-bold rounded-xl transition text-sm shadow-lg shadow-indigo-500/25">Create</button>
                </div>
            </form>
        </div>
    </div>

    <!-- QR Modal -->
    <div id="qr-modal" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 modal-overlay opacity-0 pointer-events-none transition-opacity duration-300">
        <div class="glass rounded-3xl p-4 sm:p-6 max-w-sm w-full transition-all duration-300 opacity-0 scale-95 text-center">
            <h3 id="qr-modal-title" class="text-lg font-bold text-white mb-4">QR Code</h3>
            <div class="bg-white p-2 sm:p-3 rounded-xl inline-block mb-4">
                <div id="qrcode-box" class="flex justify-center items-center w-40 h-40 sm:w-48 sm:h-48 mx-auto"></div>
            </div>
            <button onclick="toggleQRModal(false)" class="w-full py-3 bg-white/5 hover:bg-white/10 text-zinc-400 font-semibold rounded-xl transition text-sm">Close</button>
        </div>
    </div>

    <script>
        // ============================================
        // GLOBAL VARIABLES
        // ============================================
        window.globalFragLen = "20-30";
        window.globalFragInt = "1-2";
        const tlsPorts = ['443', '2053', '2083', '2087', '2096', '8443'];
        const nonTlsPorts = ['80', '8080', '8880', '2052', '2082', '2086', '2095'];
        let isEditMode = false;
        let editingUsername = '';
        let allUsers = [];
        let lastServerTime = Date.now();

        // ============================================
        // PAGE NAVIGATION
        // ============================================
        function showPage(page) {
            document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
            var activeLink = document.querySelector('.sidebar-link[data-page="' + page + '"]');
            if (activeLink) activeLink.classList.add('active');
            var titles = {
                dashboard: ['Overview', 'System overview and statistics'],
                users: ['Users', 'Manage your VLESS users'],
                settings: ['Panel Settings', 'Configure panel preferences'],
                logs: ['System Logs', 'Real-time activity logs'],
                admins: ['Admin Management', 'Add or remove administrators']
            };
            document.getElementById('page-title').innerText = titles[page][0];
            document.getElementById('page-subtitle').innerText = titles[page][1];
            
            // Close sidebar on mobile
            if (window.innerWidth < 1024) {
                toggleSidebar();
            }
        }

        // ============================================
        // SIDEBAR TOGGLE FOR MOBILE - FIXED
        // ============================================
        function toggleSidebar() {
            var sidebar = document.querySelector('.sidebar');
            var overlay = document.getElementById('sidebar-overlay');
            
            if (sidebar) {
                sidebar.classList.toggle('active');
            }
            if (overlay) {
                overlay.classList.toggle('active');
            }
        }

        // Close sidebar when clicking outside
        document.addEventListener('click', function(event) {
            var sidebar = document.querySelector('.sidebar');
            var toggleBtn = document.querySelector('.lg\\:hidden.p-2');
            var overlay = document.getElementById('sidebar-overlay');
            
            if (window.innerWidth < 1024 && sidebar && toggleBtn && overlay) {
                if (!sidebar.contains(event.target) && !toggleBtn.contains(event.target)) {
                    sidebar.classList.remove('active');
                    overlay.classList.remove('active');
                }
            }
        });

        // ============================================
        // PORT CHECKBOXES
        // ============================================
        function renderPortCheckboxes() {
            var tlsContainer = document.getElementById('tls-ports-list');
            var nonTlsContainer = document.getElementById('nontls-ports-list');

            tlsContainer.innerHTML = tlsPorts.map(function(port) {
                var checked = port === '443' ? 'checked' : '';
                return '<label class="relative cursor-pointer">' +
                    '<input type="checkbox" name="ports" value="' + port + '" ' + checked + ' class="peer sr-only port-checkbox">' +
                    '<div class="port-label-tls px-2 sm:px-3 py-1 rounded-lg text-xs font-medium border border-zinc-700/50 bg-[rgba(255,255,255,0.03)] text-zinc-400 peer-checked:border-emerald-400 peer-checked:text-emerald-400 peer-checked:bg-emerald-500/10 transition select-none">' +
                        port +
                    '</div>' +
                '</label>';
            }).join('');

            nonTlsContainer.innerHTML = nonTlsPorts.map(function(port) {
                return '<label class="relative cursor-pointer">' +
                    '<input type="checkbox" name="ports" value="' + port + '" class="peer sr-only port-checkbox">' +
                    '<div class="port-label-nontls px-2 sm:px-3 py-1 rounded-lg text-xs font-medium border border-zinc-700/50 bg-[rgba(255,255,255,0.03)] text-zinc-400 peer-checked:border-amber-400 peer-checked:text-amber-400 peer-checked:bg-amber-500/10 transition select-none">' +
                        port +
                    '</div>' +
                '</label>';
            }).join('');
        }

        // ============================================
        // MODAL CONTROLS
        // ============================================
        function toggleModal(show) {
            var modal = document.getElementById('user-modal');
            var card = document.getElementById('user-modal-card');
            if (show) {
                modal.classList.remove('opacity-0', 'pointer-events-none');
                modal.classList.add('opacity-100', 'pointer-events-auto');
                card.classList.remove('opacity-0', 'scale-95');
                card.classList.add('opacity-100', 'scale-100');
            } else {
                modal.classList.remove('opacity-100', 'pointer-events-auto');
                modal.classList.add('opacity-0', 'pointer-events-none');
                card.classList.remove('opacity-100', 'scale-100');
                card.classList.add('opacity-0', 'scale-95');
                isEditMode = false;
                editingUsername = '';
                document.getElementById('modal-title').innerText = 'Create User';
                document.getElementById('submit-btn').innerText = 'Create';
                document.getElementById('input-name').disabled = false;
                document.getElementById('create-user-form').reset();
                var cb443 = document.querySelector('input[name="ports"][value="443"]');
                if (cb443) cb443.checked = true;
            }
        }

        function openCreateModal() {
            isEditMode = false;
            editingUsername = '';
            document.getElementById('modal-title').innerText = 'Create User';
            document.getElementById('submit-btn').innerText = 'Create';
            document.getElementById('input-name').disabled = false;
            document.getElementById('create-user-form').reset();
            toggleModal(true);
            setTimeout(function() {
                var cb443 = document.querySelector('input[name="ports"][value="443"]');
                if (cb443) cb443.checked = true;
            }, 100);
        }

        function toggleQRModal(show, link, title) {
            var modal = document.getElementById('qr-modal');
            var card = modal.querySelector('div');
            var qrBox = document.getElementById('qrcode-box');
            var titleEl = document.getElementById('qr-modal-title');
            if (show) {
                titleEl.innerText = title || 'QR Code';
                qrBox.innerHTML = '';
                try {
                    new QRCode(qrBox, { text: link, width: 192, height: 192, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
                } catch(e) {
                    qrBox.innerHTML = '<p class="text-zinc-400 text-xs">Error generating QR</p>';
                }
                modal.classList.remove('opacity-0', 'pointer-events-none');
                modal.classList.add('opacity-100', 'pointer-events-auto');
                card.classList.remove('opacity-0', 'scale-95');
                card.classList.add('opacity-100', 'scale-100');
            } else {
                modal.classList.remove('opacity-100', 'pointer-events-auto');
                modal.classList.add('opacity-0', 'pointer-events-none');
                card.classList.remove('opacity-100', 'scale-100');
                card.classList.add('opacity-0', 'scale-95');
            }
        }

        // ============================================
        // XRAY CONTROL
        // ============================================
        async function controlXray(action) {
            try {
                var res = await fetch('/api/xray', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action })
                });
                var data = await res.json();
                if (data.success) {
                    alert('✅ Xray ' + action + 'ed successfully!');
                    updateXrayStatus();
                } else {
                    alert('❌ Failed to ' + action + ' Xray');
                }
            } catch (err) {
                alert('❌ Connection error');
            }
        }

        async function updateXrayStatus() {
            try {
                var res = await fetch('/api/xray/status');
                var data = await res.json();
                if (data.running) {
                    var uptime = data.uptime;
                    var hours = Math.floor(uptime / 3600);
                    var minutes = Math.floor((uptime % 3600) / 60);
                    document.getElementById('xray-uptime').innerText = hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
                } else {
                    document.getElementById('xray-uptime').innerText = 'Stopped';
                }
            } catch (e) {}
        }

        // ============================================
        // ADMIN MANAGEMENT
        // ============================================
        async function loadAdminsList() {
            try {
                var res = await fetch('/api/admins');
                var data = await res.json();
                var container = document.getElementById('admins-list');
                if (data.admins && data.admins.length > 0) {
                    container.innerHTML = data.admins.map(function(a) {
                        return '<div class="flex items-center justify-between p-3 glass-light rounded-xl">' +
                            '<span class="text-white text-sm">' + a.username + '</span>' +
                            '<div class="flex items-center gap-2">' +
                                '<span class="text-xs text-zinc-500">' + new Date(a.created_at).toLocaleDateString() + '</span>' +
                                '<button onclick="deleteAdmin(' + a.id + ')" class="text-red-400 hover:text-red-300 text-xs font-semibold">Remove</button>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                } else {
                    container.innerHTML = '<p class="text-zinc-400 text-sm">No admins found.</p>';
                }
            } catch (e) {
                document.getElementById('admins-list').innerHTML = '<p class="text-red-400 text-sm">Error loading admins</p>';
            }
        }

        async function addAdmin() {
            var username = document.getElementById('admin-username').value.trim();
            var password = document.getElementById('admin-password').value;
            if (!username || !password || password.length < 4) {
                alert('❌ Username and password (min 4 chars) required');
                return;
            }
            try {
                var res = await fetch('/api/admins', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                var data = await res.json();
                if (data.success) {
                    alert('✅ Admin added successfully!');
                    document.getElementById('admin-username').value = '';
                    document.getElementById('admin-password').value = '';
                    loadAdminsList();
                } else {
                    alert('❌ ' + (data.error || 'Failed to add admin'));
                }
            } catch (err) {
                alert('❌ Connection error');
            }
        }

        async function deleteAdmin(id) {
            if (!confirm('Are you sure you want to remove this admin?')) return;
            try {
                var res = await fetch('/api/admins', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                var data = await res.json();
                if (data.success) {
                    alert('✅ Admin removed!');
                    loadAdminsList();
                } else {
                    alert('❌ Failed to remove admin');
                }
            } catch (err) {
                alert('❌ Connection error');
            }
        }

        // ============================================
        // USER FUNCTIONS (Shortened for space)
        // ============================================
        function getVlessLink(username) {
            var user = allUsers.find(function(u) { return u.username === username; });
            if (!user) return '';
            var host = window.location.hostname;
            var ips = [host];
            if (user.ips) {
                ips = user.ips.split('\\n').map(function(ip) { return ip.trim(); }).filter(function(ip) { return ip.length > 0; });
                if (ips.length === 0) ips = [host];
            }
            var ports = String(user.port || '443').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
            var fp = user.fingerprint || 'chrome';
            var now = new Date();
            var created = new Date(user.created_at);
            var expiryDays = user.expiry_days || 30;
            var expiryDate = new Date(created.getTime() + expiryDays * 24 * 60 * 60 * 1000);
            var daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
            var totalGB = user.limit_gb || 0;
            var usedGB = user.used_gb || 0;
            var leftGB = Math.max(0, totalGB - usedGB);
            var expiryDateStr = expiryDate.toISOString().split('T')[0].replace(/-/g, '/');
            var links = [];
            ports.forEach(function(portStr) {
                var isTlsPort = tlsPorts.includes(portStr);
                var tlsVal = isTlsPort ? 'tls' : 'none';
                var remark1 = '⏳ INFO | ' + user.username.toUpperCase() + ' STATUS | 📅 Exp: ' + expiryDateStr + ' | 🔥 ' + daysLeft + ' Days Left | ' + (daysLeft > 0 ? '🟢 ACTIVE' : '🔴 EXPIRED');
                links.push('vle' + 'ss://' + (user.uuid || '') + '@' + ips[0] + ':' + portStr + '?path=%2F&security=' + tlsVal + '&encryption=none&insecure=0&host=' + host + '&fp=' + fp + '&type=ws&allowInsecure=0&sni=' + host + '#' + encodeURIComponent(remark1));
                var usedFormatted = usedGB >= 1 ? usedGB.toFixed(1) + 'GB' : (usedGB * 1024).toFixed(0) + 'MB';
                var leftFormatted = leftGB >= 1 ? leftGB.toFixed(1) + 'GB' : (leftGB * 1024).toFixed(0) + 'MB';
                var totalFormatted = totalGB >= 1 ? totalGB + 'GB' : 'Unlimited';
                var remark2 = '📊 INFO | ' + user.username.toUpperCase() + ' TRAFFIC | 💾 ' + totalFormatted + ' Total | ⚡ ' + usedFormatted + ' Used | 🎯 ' + leftFormatted + ' Left';
                links.push('vle' + 'ss://' + (user.uuid || '') + '@' + ips[0] + ':' + portStr + '?path=%2F&security=' + tlsVal + '&encryption=none&insecure=0&host=' + host + '&fp=' + fp + '&type=ws&allowInsecure=0&sni=' + host + '#' + encodeURIComponent(remark2));
            });
            return links.join('\\n');
        }

        function getSubLink(username) { return window.location.origin + '/feed/' + encodeURIComponent(username); }
        function getJsonSubLink(username) { return window.location.origin + '/feed/json/' + encodeURIComponent(username); }
        function getStatusLink(username) { return window.location.origin + '/status/' + encodeURIComponent(username); }

        function copySubLink(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            navigator.clipboard.writeText(getSubLink(username)).then(function() { alert('✅ Text subscription link copied!'); });
        }
        function copyJsonSubLink(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            navigator.clipboard.writeText(getJsonSubLink(username)).then(function() { alert('✅ JSON subscription link copied!'); });
        }
        function copyStatusLink(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            navigator.clipboard.writeText(getStatusLink(username)).then(function() { alert('✅ Status page link copied!'); });
        }
        function copyConfig(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            var link = getVlessLink(username);
            if (!link) return;
            navigator.clipboard.writeText(link).then(function() { alert('✅ VLESS config copied!'); });
        }
        function copyJsonConfig(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            var user = allUsers.find(function(u) { return u.username === username; });
            if (!user) return;
            var host = window.location.hostname;
            var ips = [host];
            if (user.ips) {
                ips = user.ips.split('\\n').map(function(ip) { return ip.trim(); }).filter(function(ip) { return ip.length > 0; });
                if (ips.length === 0) ips = [host];
            }
            var ports = String(user.port || '443').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
            var fp = user.fingerprint || 'chrome';
            var configArray = [];
            ips.forEach(function(ip) {
                ports.forEach(function(portStr) {
                    var isTlsPort = tlsPorts.includes(portStr);
                    var tlsVal = isTlsPort ? 'tls' : 'none';
                    var remark = user.username + ' | ' + portStr + ' | @VoidLatency | 🏁';
                    var jsonConfig = {
                        "remarks": remark,
                        "version": { "min": "25.10.15" },
                        "log": { "loglevel": "none" },
                        "dns": {
                            "servers": [
                                { "address": "https://8.8.8.8/dns-query", "tag": "remote-dns" },
                                { "address": "8.8.8.8", "domains": ["full:" + host], "skipFallback": true }
                            ],
                            "queryStrategy": "UseIP",
                            "tag": "dns"
                        },
                        "inbounds": [
                            {
                                "listen": "127.0.0.1", "port": 10808, "protocol": "socks",
                                "settings": { "auth": "noauth", "udp": true },
                                "sniffing": { "destOverride": ["http", "tls"], "enabled": true, "routeOnly": true },
                                "tag": "mixed-in"
                            },
                            {
                                "listen": "127.0.0.1", "port": 10853, "protocol": "dokodemo-door",
                                "settings": { "address": "1.1.1.1", "network": "tcp,udp", "port": 53 },
                                "tag": "dns-in"
                            }
                        ],
                        "outbounds": [
                            {
                                "protocol": "vle" + "ss",
                                "settings": {
                                    ["vne" + "xt"]: [
                                        { "address": ip, "port": parseInt(portStr), "users": [{ "id": user.uuid, "encryption": "none" }] }
                                    ]
                                },
                                ["stream" + "Settings"]: {
                                    "network": "ws",
                                    ["ws" + "Settings"]: { "host": host, "path": "/" },
                                    "security": tlsVal,
                                    "sockopt": { ["dialer" + "Proxy"]: "fragment" }
                                },
                                "tag": "proxy"
                            },
                            {
                                "protocol": "freedom",
                                "settings": {
                                    "fragment": {
                                        "packets": "tlshello",
                                        "length": window.globalFragLen || "20-30",
                                        "interval": window.globalFragInt || "1-2"
                                    }
                                },
                                "streamSettings": {
                                    "sockopt": {
                                        "domainStrategy": "UseIP",
                                        "happyEyeballs": { "tryDelayMs": 250, "prioritizeIPv6": false, "interleave": 2, "maxConcurrentTry": 4 }
                                    }
                                },
                                "tag": "fragment"
                            },
                            { "protocol": "dns", "settings": { "nonIPQuery": "reject" }, "tag": "dns-out" },
                            { "protocol": "freedom", "settings": { "domainStrategy": "UseIP" }, "tag": "direct" },
                            { "protocol": "blackhole", "settings": { "response": { "type": "http" } }, "tag": "block" }
                        ],
                        "routing": {
                            "domainStrategy": "IPIfNonMatch",
                            "rules": [
                                { "inboundTag": ["mixed-in"], "port": 53, "outboundTag": "dns-out", "type": "field" },
                                { "inboundTag": ["dns-in"], "outboundTag": "dns-out", "type": "field" },
                                { "inboundTag": ["remote-dns"], "outboundTag": "proxy", "type": "field" },
                                { "inboundTag": ["dns"], "outboundTag": "direct", "type": "field" },
                                { "domain": ["geosite:private"], "outboundTag": "direct", "type": "field" },
                                { "ip": ["geoip:private"], "outboundTag": "direct", "type": "field" },
                                { "network": "udp", "outboundTag": "block", "type": "field" },
                                { "network": "tcp", "outboundTag": "proxy", "type": "field" }
                            ]
                        }
                    };
                    if (tlsVal === 'tls') {
                        jsonConfig.outbounds[0]["stream" + "Settings"]["tls" + "Settings"] = {
                            "serverName": host, "fingerprint": fp, "alpn": ["http/1.1"], "allowInsecure": false
                        };
                    }
                    configArray.push(jsonConfig);
                });
            });
            navigator.clipboard.writeText(JSON.stringify(configArray, null, 2)).then(function() { alert('✅ JSON config copied!'); });
        }

        function showQR(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            var link = getVlessLink(username);
            if (!link) return;
            toggleQRModal(true, link, 'VLESS Config QR - ' + username);
        }

        function editUser(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            var user = allUsers.find(function(u) { return u.username === username; });
            if (!user) {
                alert('❌ User not found!');
                return;
            }
            isEditMode = true;
            editingUsername = username;
            document.getElementById('modal-title').innerText = 'Edit User: ' + username;
            document.getElementById('submit-btn').innerText = 'Save';
            document.getElementById('input-name').value = username;
            document.getElementById('input-name').disabled = true;
            document.getElementById('input-limit').value = user.limit_gb || '';
            document.getElementById('input-expiry').value = user.expiry_days || '';
            document.getElementById('input-ips').value = user.ips || '';
            document.getElementById('fingerprint-select').value = user.fingerprint || 'chrome';
            var userPorts = String(user.port || '').split(',').map(function(p) { return p.trim(); });
            document.querySelectorAll('input[name="ports"]').forEach(function(cb) {
                cb.checked = userPorts.includes(cb.value);
            });
            toggleModal(true);
        }

        async function deleteUser(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            if (!confirm('⚠️ Are you sure you want to delete user: ' + username + '?')) return;
            try {
                var response = await fetch('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
                if (response.ok) {
                    alert('✅ User deleted successfully!');
                    await loadUsers(true);
                } else {
                    var errData = await response.json();
                    alert('❌ Error: ' + (errData.error || 'Operation failed'));
                }
            } catch (err) {
                alert('❌ Connection error');
            }
        }

        async function toggleUserStatus(encodedUsername) {
            var username = decodeURIComponent(encodedUsername);
            try {
                var response = await fetch('/api/users/' + encodeURIComponent(username), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toggle_only: true })
                });
                if (response.ok) {
                    await loadUsers(true);
                } else {
                    var errData = await response.json();
                    alert('❌ Error: ' + (errData.error || 'Operation failed'));
                }
            } catch (err) {
                alert('❌ Connection error');
            }
        }

        // ============================================
        // LOCATIONS
        // ============================================
        function getFlagEmoji(countryCode) {
            if (!countryCode) return '🌐';
            var codePoints = countryCode.toUpperCase().split('').map(function(char) { return 127397 + char.charCodeAt(0); });
            try {
                return String.fromCodePoint.apply(String, codePoints);
            } catch (e) {
                return '🌐';
            }
        }

        function renderLocationsUI(locations, activeIata) {
            var select = document.getElementById('location-select');
            locations.sort(function(a, b) { return (a.cca2 || '').localeCompare(b.cca2 || ''); });
            var html = '<option value="">🌐 Default Location</option>';
            locations.forEach(function(loc) {
                if (loc.iata && loc.city) {
                    var flag = getFlagEmoji(loc.cca2);
                    var isSelected = loc.iata.toUpperCase() === activeIata.toUpperCase() ? 'selected' : '';
                    html += '<option value="' + loc.iata + '" ' + isSelected + '>' + flag + ' ' + loc.city + ' (' + loc.iata + ')</option>';
                }
            });
            select.innerHTML = html;
        }

        async function loadLocations() {
            var select = document.getElementById('location-select');
            var cachedLocations = localStorage.getItem('cached_locations_list');
            var cachedActiveIata = localStorage.getItem('cached_active_iata') || '';
            var hasCachedLocs = false;
            if (cachedLocations) {
                try {
                    var parsedLocs = JSON.parse(cachedLocations);
                    if (Array.isArray(parsedLocs) && parsedLocs.length > 0) {
                        renderLocationsUI(parsedLocs, cachedActiveIata);
                        hasCachedLocs = true;
                    }
                } catch(e) {}
            }
            try {
                var statusRes = await fetch('/api/proxy-ip');
                var activeIata = '';
                if (statusRes.ok) {
                    var statusData = await statusRes.json();
                    activeIata = statusData.iata || '';
                    localStorage.setItem('cached_active_iata', activeIata);
                    if(statusData.frag_len) {
                        window.globalFragLen = statusData.frag_len;
                        document.getElementById('frag-length').value = statusData.frag_len;
                    }
                    if(statusData.frag_int) {
                        window.globalFragInt = statusData.frag_int;
                        document.getElementById('frag-interval').value = statusData.frag_int;
                    }
                }
                var res = await fetch('/locations');
                if (!res.ok) throw new Error();
                var locations = await res.json();
                localStorage.setItem('cached_locations_list', JSON.stringify(locations));
                renderLocationsUI(locations, activeIata);
            } catch (err) {
                if (!hasCachedLocs) {
                    select.innerHTML = '<option value="">⚠️ Error loading locations</option>';
                }
            }
        }

        // ============================================
        // SETTINGS
        // ============================================
        async function saveSettings() {
            var select = document.getElementById('location-select');
            var fragLen = document.getElementById('frag-length').value || "20-30";
            var fragInt = document.getElementById('frag-interval').value || "1-2";
            var iata = select.value;
            var btn = document.getElementById('save-settings-btn');
            btn.disabled = true;
            btn.innerText = 'Saving...';
            try {
                var resolvedIp = 'proxyip.cmliussss.net';
                if (iata) {
                    var domain = iata.toLowerCase() + '.proxyip.cmliussss.net';
                    var dnsRes = await fetch('https://cloudflare-dns.com/dns-query?name=' + domain + '&type=A', {
                        headers: { 'accept': 'application/dns-json' }
                    });
                    resolvedIp = domain;
                    if (dnsRes.ok) {
                        var dnsData = await dnsRes.json();
                        if (dnsData.Answer && dnsData.Answer.length > 0) {
                            var ips = dnsData.Answer.filter(function(ans) { return ans.type === 1; }).map(function(ans) { return ans.data; });
                            if (ips.length > 0) {
                                resolvedIp = ips[Math.floor(Math.random() * ips.length)];
                            }
                        }
                    }
                }
                var response = await fetch('/api/proxy-ip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ proxy_ip: resolvedIp, iata: iata ? iata.toUpperCase() : '', frag_len: fragLen, frag_int: fragInt })
                });
                if (response.ok) {
                    window.globalFragLen = fragLen;
                    window.globalFragInt = fragInt;
                    alert('✅ Settings saved successfully!');
                } else {
                    alert('❌ Error saving settings');
                }
            } catch (err) {
                alert('❌ Connection error');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Save Settings';
            }
        }

        async function changeAdminPassword() {
            var currentPwd = document.getElementById('change-pwd-current').value;
            var newPwd = document.getElementById('change-pwd-new').value;
            var btn = document.getElementById('change-pwd-btn');
            if (!currentPwd || !newPwd) {
                alert('❌ Please enter both current and new password');
                return;
            }
            if (newPwd.length < 4) {
                alert('❌ New password must be at least 4 characters');
                return;
            }
            btn.disabled = true;
            btn.innerText = 'Updating...';
            try {
                var response = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ current_password: currentPwd, new_password: newPwd })
                });
                var data = await response.json();
                if (response.ok && data.success) {
                    alert('✅ Password updated successfully!');
                    document.getElementById('change-pwd-current').value = '';
                    document.getElementById('change-pwd-new').value = '';
                } else {
                    alert('❌ Error: ' + (data.error || 'Operation failed'));
                }
            } catch (err) {
                alert('❌ Connection error');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Update Password';
            }
        }

        // ============================================
        // LOGOUT
        // ============================================
        async function logoutAdmin() {
            if (!confirm('⚠️ Are you sure you want to sign out?')) return;
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (err) {}
            window.location.reload();
        }

        // ============================================
        // USER LOADING & RENDERING
        // ============================================
        async function loadUsers(silent) {
            var loadingState = document.getElementById('loading-state');
            var tableContainer = document.getElementById('users-table-container');
            var emptyState = document.getElementById('empty-state');
            if (!silent) {
                loadingState.classList.remove('hidden');
                tableContainer.classList.add('hidden');
                emptyState.classList.add('hidden');
            }
            try {
                var res = await fetch('/api/users?t=' + Date.now());
                if (!res.ok) throw new Error();
                var data = await res.json();
                renderUsersUI(data);
            } catch (err) {
                if (!silent) {
                    loadingState.innerHTML = '<span class="text-red-400">❌ Error loading users</span>';
                }
            }
        }

        function renderUsersUI(data) {
            try {
                var users = data.users || [];
                allUsers = users;
                var serverTime = data.serverTime || Date.now();
                lastServerTime = serverTime;
                var totalUsersCount = users.length;
                var activeUsersCount = users.filter(function(u) { return u.is_online === 1; }).length;
                var totalGbUsage = users.reduce(function(sum, u) { return sum + (u.used_gb || 0); }, 0);
                document.getElementById('stat-total-users').innerText = totalUsersCount;
                document.getElementById('stat-active-users').innerText = activeUsersCount;
                document.getElementById('stat-total-usage').innerText = totalGbUsage < 1 ? (totalGbUsage * 1024).toFixed(0) + ' MB' : totalGbUsage.toFixed(2) + ' GB';
                var topUser = users.reduce(function(max, u) { return (u.used_gb || 0) > (max.used_gb || 0) ? u : max; }, { username: 'None', used_gb: 0 });
                document.getElementById('stat-top-user').innerText = topUser.username;
                var topUsage = topUser.used_gb || 0;
                document.getElementById('stat-top-user-usage').innerText = topUsage < 1 ? (topUsage * 1024).toFixed(0) + ' MB used' : topUsage.toFixed(2) + ' GB used';
                filterAndRenderUsers();
                updateXrayStatus();
            } catch (err) {
                document.getElementById('loading-state').innerHTML = '<span class="text-red-400">❌ Error processing user data</span>';
            }
        }

        function filterAndRenderUsers() {
            if (!allUsers) return;
            var searchQuery = (document.getElementById('search-input').value || '').toLowerCase().trim();
            var filterStatus = document.getElementById('filter-status').value;
            var sortVal = document.getElementById('sort-users').value;
            var serverTime = lastServerTime || Date.now();
            var filtered = allUsers.slice();
            if (searchQuery) {
                filtered = filtered.filter(function(u) {
                    return (u.username || '').toLowerCase().includes(searchQuery) || 
                           (u.uuid || '').toLowerCase().includes(searchQuery);
                });
            }
            if (filterStatus !== 'all') {
                filtered = filtered.filter(function(u) {
                    var isOnline = u.is_online === 1;
                    var isActive = u.is_active === 1;
                    var isExpired = false;
                    if (u.limit_gb && u.used_gb >= u.limit_gb) isExpired = true;
                    if (u.expiry_days && u.created_at) {
                        var created = new Date(u.created_at);
                        var expiryDate = new Date(created.getTime() + (u.expiry_days * 24 * 60 * 60 * 1000));
                        if (new Date(serverTime) > expiryDate) isExpired = true;
                    }
                    if (filterStatus === 'active') return isActive && !isExpired;
                    if (filterStatus === 'inactive') return !isActive;
                    if (filterStatus === 'online') return isOnline;
                    if (filterStatus === 'offline') return !isOnline;
                    if (filterStatus === 'expired') return isExpired || !isActive;
                    return true;
                });
            }
            filtered.sort(function(a, b) {
                if (sortVal === 'newest') return b.id - a.id;
                if (sortVal === 'name') return (a.username || '').localeCompare(b.username || '');
                if (sortVal === 'usage-desc') return (b.used_gb || 0) - (a.used_gb || 0);
                if (sortVal === 'usage-asc') return (a.used_gb || 0) - (b.used_gb || 0);
                if (sortVal === 'expiry-asc') {
                    var getRemaining = function(u) {
                        if (!u.expiry_days) return Infinity;
                        if (!u.created_at) return Infinity;
                        var created = new Date(u.created_at);
                        var expiryDate = new Date(created.getTime() + (u.expiry_days * 24 * 60 * 60 * 1000));
                        return expiryDate - new Date(serverTime);
                    };
                    return getRemaining(a) - getRemaining(b);
                }
                return 0;
            });
            renderFilteredUsers(filtered, serverTime);
        }

        function renderFilteredUsers(users, serverTime) {
            var loadingState = document.getElementById('loading-state');
            var tableContainer = document.getElementById('users-table-container');
            var emptyState = document.getElementById('empty-state');
            var tbody = document.getElementById('users-tbody');
            if (users.length === 0) {
                loadingState.classList.add('hidden');
                emptyState.classList.remove('hidden');
                tableContainer.classList.add('hidden');
                if (allUsers && allUsers.length > 0) {
                    emptyState.querySelector('p').innerText = 'No users match your search criteria.';
                } else {
                    emptyState.querySelector('p').innerText = 'No users found. Click "Add User" to get started.';
                }
            } else {
                loadingState.classList.add('hidden');
                emptyState.classList.add('hidden');
                tableContainer.classList.remove('hidden');
                tbody.innerHTML = users.map(function(user) {
                    var createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';
                    var daysRemaining = 'Unlimited';
                    var daysPercent = 100;
                    if (user.expiry_days) {
                        if (user.created_at) {
                            var created = new Date(user.created_at);
                            var expiryDate = new Date(created.getTime() + (user.expiry_days * 24 * 60 * 60 * 1000));
                            var diffDays = Math.ceil((expiryDate - new Date(serverTime)) / (1000 * 60 * 60 * 24));
                            daysRemaining = diffDays > 0 ? diffDays : 0;
                            daysPercent = Math.max(0, Math.min(100, (daysRemaining / user.expiry_days) * 100));
                        } else {
                            daysRemaining = user.expiry_days;
                        }
                    }
                    var usedGb = user.used_gb || 0;
                    var formattedUsed = usedGb < 1 ? (usedGb * 1024).toFixed(0) + ' MB' : usedGb.toFixed(2) + ' GB';
                    var volumeHtml = '';
                    if (user.limit_gb) {
                        var limitPercent = Math.min((usedGb / user.limit_gb) * 100, 100);
                        var limitHue = 120 - (limitPercent * 1.2);
                        var formattedLimit = user.limit_gb < 1 ? (user.limit_gb * 1024).toFixed(0) + ' MB' : user.limit_gb + ' GB';
                        volumeHtml = '<div class="flex flex-col gap-1 w-full min-w-[100px]">' +
                            '<div class="flex justify-between text-[10px] sm:text-[11px] text-zinc-400 font-medium">' +
                                '<span>Used: ' + formattedUsed + '</span>' +
                                '<span>Total: ' + formattedLimit + '</span>' +
                            '</div>' +
                            '<div class="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">' +
                                '<div class="h-1 rounded-full transition-all duration-500" style="width: ' + limitPercent + '%; background-color: hsl(' + limitHue + ', 80%, 45%)"></div>' +
                            '</div>' +
                        '</div>';
                    } else {
                        volumeHtml = '<div class="flex flex-col gap-1 w-full min-w-[100px]">' +
                            '<div class="flex justify-between text-[10px] sm:text-[11px] text-zinc-400 font-medium">' +
                                '<span>Used: ' + formattedUsed + '</span>' +
                                '<span>Total: Unlimited</span>' +
                            '</div>' +
                            '<div class="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">' +
                                '<div class="bg-blue-500 h-1 rounded-full transition-all duration-500" style="width: 100%"></div>' +
                            '</div>' +
                        '</div>';
                    }
                    var expiryHtml = '';
                    if (user.expiry_days) {
                        var expiryHue = daysPercent * 1.2;
                        expiryHtml = '<div class="flex flex-col gap-1 w-full min-w-[100px]">' +
                            '<div class="flex justify-between text-[10px] sm:text-[11px] text-zinc-400 font-medium">' +
                                '<span>Remaining: ' + daysRemaining + ' days</span>' +
                                '<span>Total: ' + user.expiry_days + ' days</span>' +
                            '</div>' +
                            '<div class="w-full bg-zinc-800 rounded-full h-1 overflow-hidden flex justify-end">' +
                                '<div class="h-1 rounded-full transition-all duration-500" style="width: ' + daysPercent + '%; background-color: hsl(' + expiryHue + ', 80%, 45%)"></div>' +
                            '</div>' +
                        '</div>';
                    } else {
                        expiryHtml = '<div class="flex flex-col gap-1 w-full min-w-[100px]">' +
                            '<div class="flex justify-between text-[10px] sm:text-[11px] text-zinc-400 font-medium">' +
                                '<span>Remaining: Unlimited</span>' +
                                '<span>Total: Unlimited</span>' +
                            '</div>' +
                            '<div class="w-full bg-zinc-800 rounded-full h-1 overflow-hidden flex justify-end">' +
                                '<div class="bg-blue-500 h-1 rounded-full transition-all duration-500" style="width: 100%"></div>' +
                            '</div>' +
                        '</div>';
                    }
                    var statusBtnColor = user.is_active === 0 ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-amber-400 hover:bg-amber-500/10';
                    var statusBtnTitle = user.is_active === 0 ? 'Activate' : 'Deactivate';
                    var statusBtnIcon = user.is_active === 0 
                        ? '<svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
                        : '<svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                    var statusClass = user.is_active === 0 ? 'badge-danger' : 'badge-success';
                    var statusText = user.is_active === 0 ? 'Inactive' : 'Active';
                    var onlineClass = user.is_online === 1 ? 'badge-success' : 'badge';
                    var onlineText = user.is_online === 1 ? '● Online' : 'Offline';
                    var userDisplay = user.username + ' | ' + user.port + ' | @VoidLatency';
                    return '<tr class="hover:bg-white/5 border-b border-zinc-800/30">' +
                        '<td class="p-2 sm:p-3">' +
                            '<div class="flex flex-col gap-1">' +
                                '<span class="font-bold text-white text-xs sm:text-sm truncate max-w-[120px] sm:max-w-[200px]">' + userDisplay + '</span>' +
                                '<div class="flex items-center gap-1 flex-wrap">' +
                                    '<span class="badge ' + statusClass + '">' + statusText + '</span>' +
                                    '<span class="badge ' + onlineClass + '">' + onlineText + '</span>' +
                                '</div>' +
                                '<div class="flex gap-0.5 sm:gap-1 flex-wrap user-actions-wrap">' +
                                    '<button onclick="copyConfig(\\'' + encodeURIComponent(user.username) + '\\')" title="Copy VLESS" class="action-btn text-zinc-400 hover:text-indigo-400 transition"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></button>' +
                                    '<button onclick="copyJsonConfig(\\'' + encodeURIComponent(user.username) + '\\')" title="Copy JSON" class="action-btn text-zinc-400 hover:text-purple-400 transition"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg></button>' +
                                    '<button onclick="showQR(\\'' + encodeURIComponent(user.username) + '\\')" title="QR" class="action-btn text-zinc-400 hover:text-emerald-400 transition"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg></button>' +
                                    '<button onclick="toggleUserStatus(\\'' + encodeURIComponent(user.username) + '\\')" title="' + statusBtnTitle + '" class="action-btn ' + statusBtnColor + ' transition">' + statusBtnIcon + '</button>' +
                                    '<button onclick="editUser(\\'' + encodeURIComponent(user.username) + '\\')" title="Edit" class="action-btn text-zinc-400 hover:text-yellow-400 transition"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>' +
                                    '<button onclick="deleteUser(\\'' + encodeURIComponent(user.username) + '\\')" title="Delete" class="action-btn text-zinc-400 hover:text-red-400 transition"><svg class="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
                                '</div>' +
                            '</div>' +
                        '</td>' +
                        '<td class="p-2 sm:p-3">' +
                            '<div class="flex flex-col gap-1 subscription-buttons">' +
                                '<div class="flex gap-0.5 sm:gap-1">' +
                                    '<button onclick="copySubLink(\\'' + encodeURIComponent(user.username) + '\\')" class="flex-1 px-1 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-xs font-medium rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition">Text</button>' +
                                    '<button onclick="copyJsonSubLink(\\'' + encodeURIComponent(user.username) + '\\')" class="flex-1 px-1 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-xs font-medium rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition">JSON</button>' +
                                '</div>' +
                                '<button onclick="copyStatusLink(\\'' + encodeURIComponent(user.username) + '\\')" class="px-1 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition">Status</button>' +
                            '</div>' +
                        '</td>' +
                        '<td class="p-2 sm:p-3 text-[10px] sm:text-xs font-mono uppercase text-indigo-400 font-semibold hidden sm:table-cell">VLESS</td>' +
                        '<td class="p-2 sm:p-3 text-[10px] sm:text-xs hidden md:table-cell">' + 
                            '<div class="flex flex-wrap gap-0.5 sm:gap-1 max-w-[120px]">' +
                                String(user.port || "").split(",").map(function(p) {
                                    p = p.trim();
                                    if (!p) return "";
                                    var isTls = tlsPorts.includes(p);
                                    return '<span class="badge ' + (isTls ? 'badge-success' : 'badge-warning') + '">' + p + '</span>';
                                }).join("") +
                            '</div>' +
                        '</td>' +
                        '<td class="p-2 sm:p-3 hidden lg:table-cell">' + volumeHtml + '</td>' +
                        '<td class="p-2 sm:p-3 hidden xl:table-cell">' + expiryHtml + '</td>' +
                        '<td class="p-2 sm:p-3 text-[10px] sm:text-xs text-zinc-400 hidden 2xl:table-cell">' + createdDate + '</td>' +
                    '</tr>';
                }).join('');
            }
        }

        // ============================================
        // FORM HANDLER
        // ============================================
        async function handleFormSubmit(event) {
            event.preventDefault();
            var submitButton = document.getElementById('submit-btn');
            submitButton.disabled = true;
            submitButton.innerText = isEditMode ? 'Saving...' : 'Creating...';
            var username = document.getElementById('input-name').value.trim();
            var limit = document.getElementById('input-limit').value || null;
            var expiry = document.getElementById('input-expiry').value || null;
            var checkedPorts = Array.from(document.querySelectorAll('input[name="ports"]:checked')).map(function(cb) { return cb.value; });
            if (checkedPorts.length === 0) {
                alert('❌ Please select at least one port!');
                submitButton.disabled = false;
                submitButton.innerText = isEditMode ? 'Save' : 'Create';
                return;
            }
            var port = checkedPorts.join(',');
            var tls = checkedPorts.some(function(p) { return tlsPorts.includes(p); }) ? 'on' : 'off';
            var ips = document.getElementById('input-ips').value;
            var fingerprint = document.getElementById('fingerprint-select').value;
            var url = isEditMode ? '/api/users/' + encodeURIComponent(editingUsername) : '/api/users';
            var method = isEditMode ? 'PUT' : 'POST';
            try {
                var response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, limit_gb: limit, expiry_days: expiry, tls, port, ips, fingerprint })
                });
                if (response.ok) {
                    toggleModal(false);
                    await loadUsers(true);
                } else {
                    var errData = await response.json();
                    alert('❌ Error: ' + (errData.error || 'Operation failed'));
                }
            } catch (err) {
                alert('❌ Connection error');
            } finally {
                submitButton.disabled = false;
                submitButton.innerText = isEditMode ? 'Save' : 'Create';
            }
        }

        // ============================================
        // INITIALIZATION
        // ============================================
        document.addEventListener('DOMContentLoaded', function() {
            renderPortCheckboxes();
            loadUsers();
            loadLocations();
            loadAdminsList();
            setInterval(function() { loadUsers(true); }, 30000);
            setInterval(updateXrayStatus, 10000);
            showPage('dashboard');
            setTimeout(function() {
                var cb443 = document.querySelector('input[name="ports"][value="443"]');
                if (cb443) cb443.checked = true;
            }, 200);
        });
    <\/script>
</body>
</html>`,

  status: `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Status - VoidLatency</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
        * { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background: #0a0a0f; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glow { box-shadow: 0 0 60px rgba(99, 102, 241, 0.15); }
        .gradient-text { background: linear-gradient(135deg, #818cf8, #a78bfa, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .glass-light { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="max-w-lg w-full glass rounded-3xl p-8 glow">
        <div class="text-center mb-8">
            <div class="inline-block p-3 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-3">
                <svg class="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
            </div>
            <h1 class="text-2xl font-bold text-white mb-1">Subscription Status</h1>
            <p id="display-username" class="text-sm text-indigo-400 font-mono font-semibold"></p>
            <p class="text-xs text-zinc-500 mt-1">@VoidLatency</p>
        </div>

        <div id="status-card" class="mb-6 rounded-2xl p-4 text-center border font-semibold transition">
            <span id="status-text" class="text-sm">Loading status...</span>
        </div>

        <div class="space-y-4 mb-6">
            <div class="glass-light rounded-2xl p-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs text-zinc-400 font-medium">📊 Data Usage</span>
                    <span id="volume-pct" class="text-xs font-bold text-indigo-400">0%</span>
                </div>
                <div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden mb-2">
                    <div id="volume-progress" class="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-1000" style="width: 0%"></div>
                </div>
                <div class="flex justify-between text-xs text-zinc-400">
                    <span>Used: <span id="used-vol" class="text-white font-medium">-</span></span>
                    <span>Total: <span id="limit-vol" class="text-white font-medium">-</span></span>
                </div>
            </div>

            <div class="glass-light rounded-2xl p-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs text-zinc-400 font-medium">⏳ Time Remaining</span>
                    <span id="expiry-pct" class="text-xs font-bold text-purple-400">0%</span>
                </div>
                <div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden mb-2">
                    <div id="expiry-progress" class="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-1000" style="width: 0%"></div>
                </div>
                <div class="flex justify-between text-xs text-zinc-400">
                    <span>Remaining: <span id="days-remaining" class="text-white font-medium">-</span></span>
                    <span>Total: <span id="total-days" class="text-white font-medium">-</span></span>
                </div>
            </div>
        </div>

        <div class="border-t border-zinc-800/30 pt-4 space-y-2">
            <button onclick="copyVlessConfig()" class="w-full flex items-center justify-between px-4 py-3 glass-light hover:border-indigo-500/50 rounded-xl text-sm font-medium transition">
                <span class="flex items-center gap-2 text-zinc-300">🚀 Copy VLESS Config</span>
                <span class="text-indigo-400 text-xs font-semibold">Copy</span>
            </button>
            <button onclick="copyJsonSub()" class="w-full flex items-center justify-between px-4 py-3 glass-light hover:border-purple-500/50 rounded-xl text-sm font-medium transition">
                <span class="flex items-center gap-2 text-zinc-300">📄 Copy JSON Subscription</span>
                <span class="text-purple-400 text-xs font-semibold">Copy</span>
            </button>
            <button onclick="copyTextSub()" class="w-full flex items-center justify-between px-4 py-3 glass-light hover:border-blue-500/50 rounded-xl text-sm font-medium transition">
                <span class="flex items-center gap-2 text-zinc-300">📋 Copy Text Subscription</span>
                <span class="text-blue-400 text-xs font-semibold">Copy</span>
            </button>
            <button onclick="showQR()" class="w-full flex items-center justify-between px-4 py-3 glass-light hover:border-emerald-500/50 rounded-xl text-sm font-medium transition">
                <span class="flex items-center gap-2 text-zinc-300">📱 Show QR Code</span>
                <span class="text-emerald-400 text-xs font-semibold">View</span>
            </button>
        </div>
        
        <div class="mt-4 pt-4 border-t border-zinc-800/30 text-center">
            <p class="text-xs text-zinc-500">VoidLatency v2.9.4 | @VoidLatency</p>
        </div>
    </div>

    <div id="qr-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-300">
        <div class="glass rounded-3xl p-6 max-w-sm w-full transition-all duration-300 opacity-0 scale-95 text-center">
            <h3 class="text-lg font-bold text-white mb-4">QR Code</h3>
            <div class="bg-white p-3 rounded-xl inline-block mb-4">
                <div id="qrcode-box" class="flex justify-center items-center w-48 h-48 mx-auto"></div>
            </div>
            <button onclick="toggleQRModal(false)" class="w-full py-3.5 bg-white/5 hover:bg-white/10 text-zinc-400 font-semibold rounded-xl transition text-sm">Close</button>
        </div>
    </div>

    <script>
        /* {{USER_DATA_PLACEHOLDER}} */
        function toggleQRModal(show, link) {
            const modal = document.getElementById('qr-modal');
            const card = modal.querySelector('div');
            const qrBox = document.getElementById('qrcode-box');
            if (show) {
                qrBox.innerHTML = '';
                try {
                    new QRCode(qrBox, { text: link, width: 192, height: 192, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
                } catch(e) {
                    qrBox.innerHTML = '<p class="text-zinc-400 text-xs">Error generating QR</p>';
                }
                modal.classList.remove('opacity-0', 'pointer-events-none');
                modal.classList.add('opacity-100', 'pointer-events-auto');
                card.classList.remove('opacity-0', 'scale-95');
                card.classList.add('opacity-100', 'scale-100');
            } else {
                modal.classList.remove('opacity-100', 'pointer-events-auto');
                modal.classList.add('opacity-0', 'pointer-events-none');
                card.classList.remove('opacity-100', 'scale-100');
                card.classList.add('opacity-0', 'scale-95');
            }
        }

        function getHost() { return window.location.host; }

        function getVlessLink() {
            const u = window.statusUser;
            if (!u) return '';
            const host = getHost();
            var ips = [host];
            if (u.ips) {
                ips = u.ips.split('\\n').map(function(ip) { return ip.trim(); }).filter(function(ip) { return ip.length > 0; });
                if (ips.length === 0) ips = [host];
            }
            var ports = String(u.port || '443').split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
            var fp = u.fingerprint || 'chrome';
            
            var now = new Date();
            var created = new Date(u.created_at);
            var expiryDays = u.expiry_days || 30;
            var expiryDate = new Date(created.getTime() + expiryDays * 24 * 60 * 60 * 1000);
            var daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
            var totalGB = u.limit_gb || 0;
            var usedGB = u.used_gb || 0;
            var leftGB = Math.max(0, totalGB - usedGB);
            var expiryDateStr = expiryDate.toISOString().split('T')[0].replace(/-/g, '/');
            
            var links = [];
            ports.forEach(function(portStr) {
                var isTlsPort = ['443', '2053', '2083', '2087', '2096', '8443'].includes(portStr);
                var tlsVal = isTlsPort ? 'tls' : 'none';
                
                var remark1 = '⏳ INFO | ' + u.username.toUpperCase() + ' STATUS | 📅 Exp: ' + expiryDateStr + ' | 🔥 ' + daysLeft + ' Days Left | ' + (daysLeft > 0 ? '🟢 ACTIVE' : '🔴 EXPIRED');
                links.push('vle' + 'ss://' + (u.uuid || '') + '@' + ips[0] + ':' + portStr + '?path=%2F&security=' + tlsVal + '&encryption=none&insecure=0&host=' + host + '&fp=' + fp + '&type=ws&allowInsecure=0&sni=' + host + '#' + encodeURIComponent(remark1));
                
                var usedFormatted = usedGB >= 1 ? usedGB.toFixed(1) + 'GB' : (usedGB * 1024).toFixed(0) + 'MB';
                var leftFormatted = leftGB >= 1 ? leftGB.toFixed(1) + 'GB' : (leftGB * 1024).toFixed(0) + 'MB';
                var totalFormatted = totalGB >= 1 ? totalGB + 'GB' : 'Unlimited';
                var remark2 = '📊 INFO | ' + u.username.toUpperCase() + ' TRAFFIC | 💾 ' + totalFormatted + ' Total | ⚡ ' + usedFormatted + ' Used | 🎯 ' + leftFormatted + ' Left';
                links.push('vle' + 'ss://' + (u.uuid || '') + '@' + ips[0] + ':' + portStr + '?path=%2F&security=' + tlsVal + '&encryption=none&insecure=0&host=' + host + '&fp=' + fp + '&type=ws&allowInsecure=0&sni=' + host + '#' + encodeURIComponent(remark2));
            });
            return links.join('\\n');
        }

        function copyVlessConfig() {
            var link = getVlessLink();
            if (!link) return;
            navigator.clipboard.writeText(link).then(function() { alert('✅ Config copied!'); });
        }

        function copyJsonSub() {
            var link = window.location.protocol + '//' + getHost() + '/feed/json/' + encodeURIComponent(window.statusUser.username);
            navigator.clipboard.writeText(link).then(function() { alert('✅ JSON subscription link copied!'); });
        }

        function copyTextSub() {
            var link = window.location.protocol + '//' + getHost() + '/sub/' + encodeURIComponent(window.statusUser.username);
            navigator.clipboard.writeText(link).then(function() { alert('✅ Text subscription link copied!'); });
        }

        function showQR() {
            var link = getVlessLink();
            if (!link) return;
            toggleQRModal(true, link);
        }

        document.addEventListener('DOMContentLoaded', function() {
            var u = window.statusUser;
            if (!u) return;
            
            document.getElementById('display-username').innerText = '@' + u.username + ' | ' + u.port + ' | @VoidLatency | 🏁';
            
            var usedGb = u.used_gb || 0;
            var limitGb = u.limit_gb;
            var formattedUsed = usedGb < 1 ? (usedGb * 1024).toFixed(0) + ' MB' : usedGb.toFixed(2) + ' GB';
            document.getElementById('used-vol').innerText = formattedUsed;
            
            var isVolumeExpired = false;
            if (limitGb) {
                document.getElementById('limit-vol').innerText = limitGb + ' GB';
                var pct = Math.min((usedGb / limitGb) * 100, 100);
                document.getElementById('volume-pct').innerText = pct.toFixed(0) + '%';
                document.getElementById('volume-progress').style.width = pct + '%';
                if (usedGb >= limitGb) isVolumeExpired = true;
            } else {
                document.getElementById('limit-vol').innerText = 'Unlimited';
                document.getElementById('volume-pct').innerText = '0%';
                document.getElementById('volume-progress').style.width = '100%';
            }
            
            var daysRemaining = 'Unlimited';
            var totalDays = 'Unlimited';
            var isTimeExpired = false;
            
            if (u.expiry_days) {
                totalDays = u.expiry_days + ' days';
                if (u.created_at) {
                    var created = new Date(u.created_at);
                    var expiryDate = new Date(created.getTime() + (u.expiry_days * 24 * 60 * 60 * 1000));
                    var diffDays = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                    daysRemaining = diffDays > 0 ? diffDays : 0;
                    var pct = Math.max(0, Math.min(100, (daysRemaining / u.expiry_days) * 100));
                    document.getElementById('expiry-pct').innerText = pct.toFixed(0) + '%';
                    document.getElementById('expiry-progress').style.width = pct + '%';
                    if (new Date() > expiryDate) isTimeExpired = true;
                }
            } else {
                document.getElementById('expiry-pct').innerText = '0%';
                document.getElementById('expiry-progress').style.width = '100%';
            }
            
            document.getElementById('days-remaining').innerText = daysRemaining === 'Unlimited' ? 'Unlimited' : daysRemaining + ' days';
            document.getElementById('total-days').innerText = totalDays;
            
            var statusCard = document.getElementById('status-card');
            var statusText = document.getElementById('status-text');
            
            if (u.is_active === 0) {
                statusCard.className = 'mb-6 rounded-2xl p-4 text-center border font-semibold transition bg-red-500/10 border-red-500/30 text-red-400';
                statusText.innerText = '🔴 Inactive / Disabled';
            } else if (isVolumeExpired) {
                statusCard.className = 'mb-6 rounded-2xl p-4 text-center border font-semibold transition bg-yellow-500/10 border-yellow-500/30 text-yellow-400';
                statusText.innerText = '⚠️ Data Limit Exceeded';
            } else if (isTimeExpired) {
                statusCard.className = 'mb-6 rounded-2xl p-4 text-center border font-semibold transition bg-yellow-500/10 border-yellow-500/30 text-yellow-400';
                statusText.innerText = '⚠️ Subscription Expired';
            } else {
                statusCard.className = 'mb-6 rounded-2xl p-4 text-center border font-semibold transition bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
                statusText.innerText = '✅ Active & Connected';
            }
        });
    <\/script>
</body>
</html>`
};

export {
  voidlatency_core_default as default
};
