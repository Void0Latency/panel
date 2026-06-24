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

## 📖 درباره پروژه

**VoidLatency Panel** یک پنل مدیریت VPN پیشرفته و مدرن است که بر روی Cloudflare Workers اجرا می‌شود. این پنل با استفاده از پروتکل VLESS+WS، امکان مدیریت کاربران، مشاهده آمار ترافیک و ایجاد لینک‌های اشتراک‌گذاری را فراهم می‌کند.

### ویژگی‌های کلیدی:
- **راه‌اندازی یک‌کلیک** با استفاده از Cloudflare Workers
- **پنل مدیریت کاربران** با قابلیت افزودن، ویرایش و حذف کاربر
- **لینک‌های اشتراک‌گذاری** در دو فرمت Text و JSON
- **صفحه وضعیت کاربر** برای مشاهده مصرف و زمان باقی‌مانده
- **رابط کاربری مدرن** با الهام از 3x-UI
- **پروتکل امن VLESS+WS** با پشتیبانی از TLS

---

## ✨ امکانات کامل

| ویژگی | توضیحات |
|-------|---------|
| 🔒 **VLESS+WS** | پروتکل امن و پرسرعت |
| 👥 **مدیریت کاربران** | ایجاد، ویرایش و حذف کاربران |
| 📊 **آمار ترافیک** | مشاهده مصرف لحظه‌ای |
| 🔑 **پنل ادمین** | کنترل کامل بر کاربران |
| 📱 **لینک اشتراک** | دو فرمت Text و JSON |
| 🎨 **رابط مدرن** | طراحی الهام گرفته از 3x-UI |
| ⚡ **دپلوی یک‌کلیک** | نصب در چند ثانیه |

---

## 🚀 راه‌اندازی سریع

### روش ۱: دپلوی خودکار (توسط کاربر)

1. وارد سایت [VoidLatency Deployer](https://voidlatency-deployer.void0latency.workers.dev) شوید
2. توکن API کلودفلر خود را از [اینجا](https://dash.cloudflare.com/profile/api-tokens) دریافت کنید
3. توکن را در سایت وارد کرده و روی "Deploy Panel" کلیک کنید
4. پس از چند لحظه، لینک پنل و رمز عبور ادمین به شما نمایش داده می‌شود

### روش ۲: نصب دستی

۱. **کلون کردن ریپازیتوری**

```
git clone https://github.com/Void0Latency/panel.git
cd panel
```

۲. **نصب وابستگی‌ها**

```
npm install
```

۳. **ساخت دیتابیس D1**

```
npx wrangler d1 create voidlatency-db
```

(شناسه دیتابیس را در فایل `wrangler.toml` قرار دهید)

۴. **اجرای migrations**

```
npx wrangler d1 execute voidlatency-db --file=./schema.sql
```

۵. **دپلوی روی Cloudflare**

```
npm run deploy
```

۶. **دریافت لینک پنل**

```
https://your-worker-name.workers.dev/panel
```

---

## 📋 پیش‌نیازها

- [حساب Cloudflare](https://dash.cloudflare.com/sign-up) (رایگان)
- [حساب GitHub](https://github.com/signup) (رایگان)
- Node.js 18 یا بالاتر

---

## 📱 لینک‌های اشتراک

پس از نصب پنل، لینک‌های زیر برای هر کاربر قابل استفاده است:

| نوع | فرمت |
|-----|------|
| متنی | `https://your-panel.workers.dev/feed/username` |
| JSON | `https://your-panel.workers.dev/feed/json/username` |
| وضعیت | `https://your-panel.workers.dev/status/username` |

---

## 🔧 API Endpoints

| متد | آدرس | توضیحات |
|-----|------|---------|
| GET | `/api/users` | دریافت لیست کاربران |
| POST | `/api/users` | ایجاد کاربر جدید |
| PUT | `/api/users/{username}` | ویرایش کاربر |
| DELETE | `/api/users/{username}` | حذف کاربر |
| GET | `/feed/{username}` | دریافت لینک اشتراک متنی |
| GET | `/feed/json/{username}` | دریافت لینک اشتراک JSON |
| GET | `/status/{username}` | مشاهده وضعیت کاربر |

---

## 🛠️ توسعه و سفارشی‌سازی

برای اجرا در محیط توسعه:

```
npm run dev
```

برای دپلوی روی Cloudflare:

```
npm run deploy
```

---

## 📁 ساختار پروژه

```
panel/
├── voidlatency-core.js    # کد اصلی پنل
├── schema.sql             # ساختار دیتابیس
├── wrangler.toml          # تنظیمات Cloudflare
├── package.json           # وابستگی‌ها
├── deploy.sh              # اسکریپت دپلوی خودکار
└── README.md              # مستندات
```

---

## 🤝 مشارکت در توسعه

1. ریپازیتوری را Fork کنید
2. برنچ جدید بسازید (`git checkout -b feature/amazing`)
3. تغییرات را commit کنید (`git commit -m 'Add amazing feature'`)
4. به برنچ Push کنید (`git push origin feature/amazing`)
5. Pull Request باز کنید

---

## 📄 لایسنس

این پروژه تحت لایسنس MIT منتشر شده است - برای جزئیات بیشتر فایل LICENSE را مشاهده کنید.

---

## 🙏 پشتیبانی و ارتباط با ما

<div align="center">
  <a href="https://github.com/Void0Latency">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="https://t.me/VoidLatency">
    <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
  </a>
  <a href="https://voidlatency-deployer.void0latency.workers.dev">
    <img src="https://img.shields.io/badge/Deploy-Now-brightgreen?style=for-the-badge" alt="Deploy">
  </a>
</div>

---

## ⭐ تاریخچه ستاره‌ها

[![Star History Chart](https://api.star-history.com/svg?repos=Void0Latency/panel&type=Date)](https://star-history.com/#Void0Latency/panel&Date)

---

<p align="center">
  ساخته شده با ❤️ توسط <a href="https://github.com/Void0Latency">Void0Latency</a>
  <br>
  ⚡ پشتیبانی شده توسط Cloudflare Workers
</p>
