<p align="center">
  <img src="assets/logo.svg" width="120" alt="VoidLatency Logo">
</p>

<h1 align="center">🚀 VoidLatency Panel</h1>

<p align="center">
  <strong>Next-Gen VPN Management Panel • VLESS+WS • Cloudflare Workers</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-deploy">Quick Deploy</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-documentation">Documentation</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/Void0Latency/panel?style=for-the-badge&color=818cf8">
  <img src="https://img.shields.io/github/forks/Void0Latency/panel?style=for-the-badge&color=a78bfa">
  <img src="https://img.shields.io/github/issues/Void0Latency/panel?style=for-the-badge&color=8b5cf6">
  <img src="https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge&logo=cloudflare">
  <img src="https://img.shields.io/badge/Version-2.9.4-blue?style=for-the-badge">
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔒 **VLESS+WS Protocol** | Secure and fast VPN protocol |
| 👥 **User Management** | Create, edit, delete users with ease |
| 📊 **Traffic Statistics** | Real-time usage monitoring |
| 🔑 **Admin Panel** | Full control over your VPN |
| 📱 **Subscription Links** | Text & JSON formats supported |
| 🎨 **3x-UI Inspired** | Beautiful, modern interface |
| ⚡ **Cloudflare Workers** | Serverless, fast, and free |
| 🔐 **D1 Database** | Built-in database for users |

## 🚀 Quick Deploy

### One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com)

### Manual Deploy

```bash
# 1. Clone the repository
git clone https://github.com/Void0Latency/panel.git
cd panel

# 2. Install Wrangler
npm install -g wrangler

# 3. Login to Cloudflare
wrangler login

# 4. Create D1 Database
wrangler d1 create voidlatency-db

# 5. Update wrangler.toml with database_id

# 6. Deploy
wrangler deploy
