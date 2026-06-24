<p align="center">
  <img src="https://img.shields.io/badge/Version-2.9.4-blue?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Protocol-VLESS%2BWS-purple?style=for-the-badge" alt="Protocol">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Status">
</p>

<div align="center">
  <h1>🚀 VoidLatency Panel</h1>
  <p><strong>Next-Gen VPN Management Panel</strong></p>
  <p>Modern • Fast • Secure</p>
  
  [![GitHub stars](https://img.shields.io/github/stars/Void0Latency/panel?style=social)](https://github.com/Void0Latency/panel/stargazers)
  [![GitHub forks](https://img.shields.io/github/forks/Void0Latency/panel?style=social)](https://github.com/Void0Latency/panel/network/members)
</div>

---

## 📦 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Deploy](#-quick-deploy)
- [📋 Requirements](#-requirements)
- [📱 Subscription Links](#-subscription-links)
- [🔧 API Endpoints](#-api-endpoints)
- [🛠️ Development](#️-development)
- [📁 Project Structure](#-project-structure)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Support & Community](#-support--community)
- [⭐ Star History](#-star-history)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔒 **VLESS+WS** | Secure and fast protocol |
| 👥 **User Management** | Create, edit, delete users |
| 📊 **Traffic Stats** | Real-time usage monitoring |
| 🔑 **Admin Panel** | Full control over your users |
| 📱 **Subscription Links** | Text & JSON formats |
| 🎨 **Modern UI** | 3x-UI inspired design |
| ⚡ **One-Click Deploy** | Deploy in seconds |

---

## 🚀 Quick Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://dash.cloudflare.com)

### Manual Deploy

Clone the repository, install dependencies, and deploy to Cloudflare Workers.

---

## 📋 Requirements

- Cloudflare Account (Free)
- GitHub Account (Free)
- Node.js 18+

---

## 📱 Subscription Links

| Type | Format |
|------|--------|
| Text | `https://your-panel.workers.dev/feed/username` |
| JSON | `https://your-panel.workers.dev/feed/json/username` |
| Status | `https://your-panel.workers.dev/status/username` |

---

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| PUT | `/api/users/{username}` | Update user |
| DELETE | `/api/users/{username}` | Delete user |
| GET | `/feed/{username}` | Text subscription |
| GET | `/feed/json/{username}` | JSON subscription |
| GET | `/status/{username}` | User status page |

---

## 🛠️ Development

Install dependencies, run locally, and deploy to Cloudflare Workers.

---

## 📁 Project Structure

```
panel/
├── voidlatency-core.js    # Main panel code
├── schema.sql             # Database schema
├── wrangler.toml          # Cloudflare config
├── package.json           # Dependencies
├── deploy.sh              # Auto deploy script
└── README.md              # Documentation
```

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

MIT License - see the LICENSE file for details.

---

## 🙏 Support & Community

<div align="center">
  <a href="https://github.com/Void0Latency">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare">
  </a>
</div>

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Void0Latency/panel&type=Date)](https://star-history.com/#Void0Latency/panel&Date)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Void0Latency">Void0Latency</a><br>
  ⚡ Powered by Cloudflare Workers
</p>
