# LeadForge — B2B Lead Generation & Multi-Tenant Outreach SaaS

A production-ready platform for B2B lead scraping, WhatsApp outreach, and transactional email campaigns.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Lead Scraper** | Multi-filter wizard — select channels, niche, and geo-location. Deep-crawls business websites for emails, phones, and up to 15 social URLs per lead |
| 📱 **WhatsApp Session Manager** | Isolated Baileys sessions per user — QR login, real-time Socket.io, anti-ban jitter delays, opt-out circuit breaker |
| 📧 **Email Outreach** | Brevo transactional SMTP — branded HTML templates with logo, phone, and merge fields |
| 🏢 **Multi-Tenant** | Each user gets an isolated WA session directory and their own Brevo API key |
| 🔥 **Firebase Backend** | Firestore for campaigns, leads, and outreach logs. Firebase Auth ready |
| 📊 **Campaign Explorer** | Admin table with lead counts, status, and drill-down to individual leads |

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/darapet/EMAIL-MARKETING.git
cd EMAIL-MARKETING/email-marketing-saas
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your values:
# - FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
# - BREVO_API_KEY (fallback admin key)
# - PORT (default: 3000)
```

### 3. Set Up Firebase

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore** (start in production mode)
3. Go to **Project Settings → Service Accounts → Generate new private key**
4. Copy values into your `.env` file
5. Deploy Firestore rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use your-project-id
   firebase deploy --only firestore
   ```

### 4. Run
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Open `http://localhost:3000`

---

## 🗂️ Project Structure

```
email-marketing-saas/
├── public/                    # Frontend (HTML + CSS + Vanilla JS)
│   ├── index.html             # Single-page dashboard
│   ├── css/styles.css         # All styles (dark theme, responsive)
│   └── js/
│       ├── app.js             # Main SPA — navigation, wizard, API calls
│       └── locations.js       # Countries + States dataset
│
├── server/                    # Node.js / Express backend
│   ├── index.js               # Entry — Express + Socket.io setup
│   ├── config/firebase.js     # Firebase Admin SDK (singleton)
│   ├── middleware/auth.js      # Auth middleware (dev token or Firebase JWT)
│   ├── routes/
│   │   ├── campaigns.js       # CRUD + launch trigger
│   │   ├── leads.js           # Lead management + opt-out
│   │   ├── whatsapp.js        # Session REST endpoints
│   │   ├── outreach.js        # Email campaign launcher
│   │   └── user.js            # Profile + API key storage
│   └── services/
│       ├── scraper.js         # Async scraper engine (cheerio + axios)
│       ├── whatsapp-session.js # Baileys multi-tenant session manager
│       └── email-sender.js    # Brevo SMTP + HTML builder
│
├── firestore.rules            # Security rules
├── firestore.indexes.json     # Composite index definitions
├── firebase.json              # Firebase project config
├── .env.example               # Environment variable template
└── package.json
```

---

## 🔒 Security Notes

- **Never commit your `.env` file** — it's in `.gitignore`
- Brevo API keys are stored server-side in Firestore, never sent to the client
- Set `REQUIRE_AUTH=true` in production to enforce Firebase ID token verification
- WhatsApp session files are stored locally under `sessions/<userId>/` — add this to `.gitignore` for production

---

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/campaigns` | List user campaigns |
| POST | `/api/campaigns` | Create + launch campaign |
| GET | `/api/campaigns/:id/leads` | Get leads for a campaign |
| GET | `/api/whatsapp/status` | WhatsApp session status |
| POST | `/api/whatsapp/broadcast` | Start WA broadcast |
| POST | `/api/outreach/email` | Start email campaign |
| POST | `/api/outreach/test-email` | Send a test email |
| PUT | `/api/user/profile` | Update user profile |
| PUT | `/api/user/apikeys` | Save Brevo API key |

---

## 🛡️ Anti-Ban WhatsApp

The broadcast engine includes:
- **Randomised jitter delays**: 60–180 seconds between messages (configurable)
- **Typing simulation**: `sendPresenceUpdate('composing')` before each send
- **Opt-out circuit breaker**: Intercepts `STOP` replies, marks lead as opted-out, sends acknowledgement, halts future sends

---

## 📦 Key Dependencies

| Package | Purpose |
|---------|---------|
| `@whiskeysockets/baileys` | WhatsApp Web API (no headless browser) |
| `sib-api-v3-sdk` | Brevo (Sendinblue) transactional email |
| `firebase-admin` | Firestore + Auth |
| `socket.io` | Real-time QR + scrape progress |
| `cheerio` | HTML parsing for scraper |
| `axios` | HTTP requests for scraper |
| `qrcode` | QR code image generation |
| `express` | REST API server |
| `helmet` | Security headers |

---

## 📄 License

MIT — built for [darapet](https://github.com/darapet)
