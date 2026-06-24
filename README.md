<p align="center">
  <img src="https://img.shields.io/badge/Version-2.9.4-blue?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Protocol-VLESS%2BWS-purple?style=for-the-badge" alt="Protocol">
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Status">
</p>

<div align="center">
  <img src="https://raw.githubusercontent.com/Void0Latency/panel/main/assets/logo.png" width="150" alt="VoidLatency Logo">
  <h1>🚀 VoidLatency Panel</h1>
  <p><strong>Next-Gen VPN Management Panel</strong></p>
  <p>Modern • Fast • Secure</p>
  
  [![GitHub stars](https://img.shields.io/github/stars/Void0Latency/panel?style=social)](https://github.com/Void0Latency/panel/stargazers)
  [![GitHub forks](https://img.shields.io/github/forks/Void0Latency/panel?style=social)](https://github.com/Void0Latency/panel/network/members)
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

# Install dependencies
npm install

# Deploy to Cloudflare
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
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
📁 Project Structure
text
panel/
├── voidlatency-core.js    # Main panel code
├── schema.sql             # Database schema
├── wrangler.toml          # Cloudflare config
├── package.json           # Dependencies
├── deploy.sh              # Auto deploy script
└── README.md              # Documentation
🤝 Contributing
Fork the repository

Create your feature branch (git checkout -b feature/amazing)

Commit your changes (git commit -m 'Add amazing feature')

Push to the branch (git push origin feature/amazing)

Open a Pull Request

📄 License
MIT License - see the LICENSE file for details.

🙏 Support & Community
<div align="center"> <a href="https://github.com/Void0Latency"> <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"> </a> <a href="#"> <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"> </a> <a href="#"> <img src="https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare"> </a> <a href="#"> <img src="https://img.shields.io/badge/Twitter-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" alt="Twitter"> </a> </div>
⭐ Star History
https://api.star-history.com/svg?repos=Void0Latency/panel&type=Date

<p align="center"> Made with ❤️ by <a href="https://github.com/Void0Latency">Void0Latency</a><br> ⚡ Powered by Cloudflare Workers </p> ```
