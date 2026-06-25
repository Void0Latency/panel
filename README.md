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
- **سیستم ادمین‌های جداگانه** با لاگین یوزرنیم و پسورد
- **حجم واقعی ترافیک** با نمایش دقیق مصرف
- **بیش از ۴۰ API** برای مدیریت و یکپارچه‌سازی

---

## ✨ امکانات کامل

| ویژگی | توضیحات |
|-------|---------|
| 🔒 **VLESS+WS** | پروتکل امن و پرسرعت |
| 👥 **مدیریت کاربران** | ایجاد، ویرایش و حذف کاربران |
| 📊 **آمار ترافیک** | مشاهده مصرف لحظه‌ای و حجم واقعی |
| 🔑 **پنل ادمین** | کنترل کامل بر کاربران با سیستم ادمین مجزا |
| 📱 **لینک اشتراک** | دو فرمت Text و JSON |
| 🎨 **رابط مدرن** | طراحی الهام گرفته از 3x-UI |
| ⚡ **دپلوی یک‌کلیک** | نصب در چند ثانیه |
| 📈 **API های کامل** | بیش از ۴۰ API برای مدیریت |
| 🛡️ **امنیت پیشرفته** | احراز هویت دو مرحله‌ای |

---

## 🚀 راه‌اندازی سریع

### روش ۱: دپلوی خودکار (توسط کاربر)

1. وارد سایت [VoidLatency Deployer](https://voidlatency-deployer.void0latency.workers.dev) شوید
2. توکن API کلودفلر خود را دریافت کنید
3. توکن را در سایت وارد کرده و روی "Deploy Panel" کلیک کنید
4. پس از چند لحظه، لینک پنل و رمز عبور ادمین به شما نمایش داده می‌شود

### روش ۲: نصب دستی

```
git clone https://github.com/Void0Latency/panel.git
cd panel
npm install
npx wrangler d1 create voidlatency-db
npx wrangler d1 execute voidlatency-db --file=./schema.sql
npm run deploy
```

---

## 📋 پیش‌نیازها

- حساب Cloudflare (رایگان)
- حساب GitHub (رایگان)
- Node.js 18 یا بالاتر

---

## 📱 لینک‌های اشتراک

پس از نصب پنل، لینک‌های زیر برای هر کاربر قابل استفاده است:

| نوع | فرمت |
|-----|------|
| متنی | `https://your-panel.workers.dev/feed/username` |
| JSON | `https://your-panel.workers.dev/feed/json/username` |
| وضعیت | `https://your-panel.workers.dev/status/username` |
| کانفیگ مستقیم | `https://your-panel.workers.dev/sub/username` |

---

## 🔧 API های کامل

### احراز هویت و مدیریت

| متد | آدرس | توضیحات |
|-----|------|---------|
| POST | `/api/login` | ورود با یوزرنیم و پسورد |
| POST | `/api/setup-password` | تنظیم رمز اولیه پنل |
| POST | `/api/logout` | خروج از حساب |
| GET | `/api/auth/verify` | بررسی وضعیت احراز هویت |
| POST | `/api/change-password` | تغییر رمز پنل |
| POST | `/api/admin/create` | ایجاد ادمین جدید |

### مدیریت کاربران

| متد | آدرس | توضیحات |
|-----|------|---------|
| GET | `/api/users` | دریافت لیست کاربران |
| POST | `/api/users` | ایجاد کاربر جدید |
| PUT | `/api/users/{username}` | ویرایش کاربر |
| DELETE | `/api/users/{username}` | حذف کاربر |
| GET | `/api/users/{username}` | دریافت اطلاعات کاربر |
| GET | `/api/users/stats/{username}` | آمار مصرف کاربر |
| GET | `/api/users/traffic/{username}` | اطلاعات ترافیک کاربر |
| GET | `/api/users/check/{username}` | بررسی وجود کاربر |
| GET | `/api/users/config/{username}` | دریافت کانفیگ کاربر |
| POST | `/api/users/reset/{username}` | ریست ترافیک کاربر |
| POST | `/api/users/reset-all` | ریست همه ترافیک‌ها |
| POST | `/api/users/bulk` | ایجاد چند کاربر |
| GET | `/api/users/online/{username}` | وضعیت آنلاین کاربر |
| POST | `/api/users/extend/{username}` | تمدید زمان کاربر |
| POST | `/api/users/add-traffic/{username}` | افزودن حجم به کاربر |
| POST | `/api/users/rename` | تغییر نام کاربر |
| GET | `/api/users/export` | خروجی کاربران |

### مدیریت ادمین‌ها

| متد | آدرس | توضیحات |
|-----|------|---------|
| GET | `/api/admins` | لیست ادمین‌ها |
| POST | `/api/admins` | ایجاد ادمین جدید |
| DELETE | `/api/admins` | حذف ادمین |
| POST | `/api/admin/change-password` | تغییر رمز ادمین |

### سیستم و تنظیمات

| متد | آدرس | توضیحات |
|-----|------|---------|
| GET | `/api/system/stats` | آمار سیستم |
| GET | `/api/system/info` | اطلاعات سیستم |
| GET | `/api/health` | وضعیت سلامت |
| GET | `/api/stats/summary` | خلاصه آمار |
| POST | `/api/xray` | کنترل Xray |
| GET | `/api/xray/status` | وضعیت Xray |
| POST | `/api/theme` | تغییر تم |
| GET | `/api/theme` | دریافت تم فعلی |
| POST | `/api/proxy-ip` | تنظیمات پروکسی |
| GET | `/api/proxy-ip` | دریافت تنظیمات پروکسی |
| GET | `/api/update-check` | بررسی بروزرسانی |
| GET | `/api/logs` | دریافت لاگ‌ها |
| GET | `/api/panel/config` | تنظیمات پنل |
| GET | `/api/subscription/{username}` | لینک‌های اشتراک کاربر |
| GET | `/api/status/{username}` | وضعیت عمومی کاربر |

### اشتراک‌گذاری

| متد | آدرس | توضیحات |
|-----|------|---------|
| GET | `/feed/{username}` | لینک اشتراک متنی |
| GET | `/feed/json/{username}` | لینک اشتراک JSON |
| GET | `/sub/{username}` | لینک اشتراک ساده |
| GET | `/status/{username}` | صفحه وضعیت کاربر |
| GET | `/locations` | لیست لوکیشن‌ها |

---

## 🛠️ توسعه و سفارشی‌سازی

```
npm run dev
npm run deploy
```

---

## 📁 ساختار پروژه

```
panel/
├── voidlatency-core.js    # کد اصلی پنل (Full)
├── schema.sql             # ساختار دیتابیس
├── wrangler.toml          # تنظیمات Cloudflare
├── package.json           # وابستگی‌ها
├── deploy.sh              # اسکریپت دپلوی خودکار
├── LICENSE                # لایسنس MIT
└── README.md              # مستندات
```

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
