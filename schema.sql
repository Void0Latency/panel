-- Users table
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
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_online ON users(last_active);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('proxy_ip', 'proxyip.cmliussss.net'),
  ('frag_len', '20-30'),
  ('frag_int', '1-2'),
  ('theme', 'dark');
