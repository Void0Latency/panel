<p align="center">
  <img src="https://img.shields.io/badge/Version-2.9.4-blue?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Protocol-VLESS%2BWS-purple?style=for-the-badge" alt="Protocol">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=for-the-badge" alt="Platform">
</p>

<div align="center">
  <h1>🚀 VoidLatency Panel</h1>
  <p><strong>Next-Gen VPN Management Panel</strong></p>
  <p>Modern • Fast • Secure</p>
</div>

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

## 🚀 One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://dash.cloudflare.com)

### Manual Deploy

```bash
# Clone
git clone https://github.com/Void0Latency/panel.git
cd panel

# Deploy
npm install
npm run deploy
📋 Requirements
Cloudflare Account (Free)

GitHub Account (Free)

Node.js 18+

📱 Subscription Links
Type	Format
Text	https://your-panel.workers.dev/feed/username
JSON	https://your-panel.workers.dev/feed/json/username
Status	https://your-panel.workers.dev/status/username
🔧 API Endpoints
Method	Endpoint	Description
GET	/api/users	List all users
POST	/api/users	Create user
PUT	/api/users/{username}	Update user
DELETE	/api/users/{username}	Delete user
GET	/feed/{username}	Text subscription
GET	/feed/json/{username}	JSON subscription
GET	/status/{username}	User status page
🛠️ Development
bash
# Install
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
🙏 Support
<div align="center">
https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white
https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white
https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white

</div>
<p align="center"> Made with ❤️ by <a href="https://github.com/Void0Latency">Void0Latency</a> <br> ⚡ Powered by Cloudflare Workers </p> ```
