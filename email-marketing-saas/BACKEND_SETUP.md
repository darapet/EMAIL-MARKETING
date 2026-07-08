# LeadForge — Backend Setup Guide

> Complete guide to replacing Firebase with Supabase + adding all new features.

---

## What Changed (Firebase → Supabase)

| Old (Firebase)                      | New (Supabase)                        |
|--------------------------------------|---------------------------------------|
| `server/config/firebase.js`          | `server/config/supabase.js`           |
| `middleware/auth.js` (Firebase JWT)  | `middleware/auth.js` (Supabase JWT)   |
| Firestore collections                | PostgreSQL tables                     |
| Firebase Storage                     | Supabase Storage                      |

---

## Step 1 — Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Note your **Project URL**, **Anon Key**, and **Service Role Key**  
   (Settings → API)

---

## Step 2 — Run the Database Migration

1. In your Supabase project, go to **SQL Editor**
2. Open `supabase/migrations/001_initial_schema.sql` from this repo
3. Paste it into the editor and click **Run**

After running, you'll have these tables:
- `profiles` — user accounts, branding, SMTP keys, plan status
- `campaigns` — scraping campaigns
- `leads` — scraped business leads
- `email_templates` — up to 5 templates per user
- `email_sends` — activity log for every email sent
- `activity_logs` — general user actions
- `whatsapp_sessions` — WA session tracking

---

## Step 3 — Set Admin User

After you first sign up (via your frontend), run this in **SQL Editor**:

```sql
UPDATE public.profiles
SET is_admin = TRUE, plan = 'premium'
WHERE email = 'daramolapeter98@gmail.com';
```

---

## Step 4 — Set Up Supabase Storage

1. In Supabase, go to **Storage** → **New Bucket**
2. Name it: `uploads`
3. Set it as **Public**
4. Add this policy (SQL Editor):

```sql
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users upload own files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[2] = auth.uid()::text);

-- Allow public reads
CREATE POLICY "Public reads"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'uploads');
```

---

## Step 5 — Configure Environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required fields:
```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
BREVO_API_KEY=xkeysib-your-admin-brevo-key
GROQ_API_KEY=gsk_your-groq-key
```

### Get API Keys
| Service | URL |
|---------|-----|
| Brevo (Sendinblue) | https://app.brevo.com → SMTP & API → API Keys |
| Groq AI | https://console.groq.com/keys |
| SendGrid (optional) | https://app.sendgrid.com/settings/api_keys |
| Mailgun (optional) | https://app.mailgun.com/settings/api_security |

---

## Step 6 — Install Dependencies & Run

```bash
cd email-marketing-saas/server
npm install
npm run dev       # development (with nodemon)
npm start         # production
```

---

## API Reference

### Authentication
All protected endpoints require:
```
Authorization: Bearer <supabase_access_token>
```
The token comes from Supabase Auth after login (`supabase.auth.signIn()`).

---

### User Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/profile` | Get own profile |
| PUT | `/api/user/profile` | Update name, company, logo, brand color |
| PUT | `/api/user/smtp` | Save SMTP provider keys **(premium)** |
| DELETE | `/api/user/smtp/:provider` | Remove provider credentials |
| GET | `/api/user/activity` | Own activity log |

**PUT `/api/user/smtp` body example:**
```json
{
  "active_smtp": "brevo",
  "brevo_api_key": "xkeysib-..."
}
```
Providers: `system` | `brevo` | `sendgrid` | `mailgun` | `smtp`

---

### Campaigns (Scraping)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/campaigns` | List all campaigns |
| GET | `/api/campaigns/:id` | Campaign + all scraped leads (for preview) |
| POST | `/api/campaigns` | Create + trigger background scrape |
| DELETE | `/api/campaigns/:id` | Delete campaign + leads |

**POST `/api/campaigns` body:**
```json
{
  "name": "Lagos Restaurants",
  "niche": "Restaurant",
  "channels": ["email", "whatsapp"],
  "countries": ["Nigeria"],
  "states": { "Nigeria": ["Lagos", "Abuja"] },
  "emailCount": 100
}
```

**Flow:**
1. POST `/api/campaigns` → returns campaign immediately
2. Scraper runs in background; poll GET `/api/campaigns/:id` for progress
3. Once `status = 'done'`, leads array is populated
4. Show leads to user → user selects recipients → POST `/api/outreach/email`

---

### Outreach (Email Sending)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/outreach/email` | Send email blast |
| POST | `/api/outreach/email/preview` | Preview rendered HTML (no send) |
| GET | `/api/outreach/history` | Send history |
| GET | `/api/outreach/stats` | Aggregate stats |

**POST `/api/outreach/email` body:**
```json
{
  "campaignId": "uuid",
  "leadIds": ["uuid1", "uuid2"],   // or "all"
  "subject": "Partnership Offer",
  "body": "Hello {businessName}, I'm {yourName}...",
  "templateId": "uuid",            // optional
  "provider": "system"             // optional override
}
```

---

### Email Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List templates (max 5) |
| GET | `/api/templates/:id` | Single template |
| POST | `/api/templates` | Create template |
| PUT | `/api/templates/:id` | Update template |
| DELETE | `/api/templates/:id` | Delete template |
| PUT | `/api/templates/:id/default` | Set as default |

---

### AI Message Generation (Groq)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/generate-email` | Generate email subject + body |
| POST | `/api/ai/generate-whatsapp` | Generate WhatsApp message |

**POST `/api/ai/generate-email` body:**
```json
{
  "niche": "Restaurant",
  "tone": "professional",
  "goal": "service_offer",
  "customPrompt": "Mention 3-day free trial"
}
```
**Tones:** `professional` | `friendly` | `urgent` | `casual`  
**Goals:** `service_offer` | `partnership` | `introduction` | `follow_up`

---

### File Upload (Logo & Signature)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/storage/upload/logo` | Upload brand logo (max 2MB) |
| POST | `/api/storage/upload/signature` | Upload email signature (max 1MB) |

**Form data upload:**
```
Content-Type: multipart/form-data
Field: file (jpg/png/svg/gif/webp)
```

---

### Admin Panel (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List all users |
| GET | `/api/admin/users/:id` | User detail + activity + sends |
| PUT | `/api/admin/users/:id/plan` | Set plan (free/premium) |
| PUT | `/api/admin/users/:id/admin` | Toggle admin flag |
| GET | `/api/admin/activity` | Platform activity log |
| GET | `/api/admin/sends` | All email sends |
| GET | `/api/admin/stats` | Platform stats |
| GET | `/api/admin/branding` | Get platform branding |
| PUT | `/api/admin/branding` | Update platform branding |

---

### WhatsApp

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/whatsapp/status` | Session status |
| POST | `/api/whatsapp/connect` | Start session (QR via Socket.io) |
| POST | `/api/whatsapp/disconnect` | End session |
| POST | `/api/whatsapp/send` | Bulk WA message blast |
| GET | `/api/whatsapp/contacts` | List phone contacts |

---

## Socket.io Events

```javascript
// Client connects and subscribes to QR
socket.emit('wa:subscribe', userId);

// Receive QR code (base64 image)
socket.on('wa:qr', ({ qr }) => { /* render QR */ });

// Connection status updates
socket.on('wa:status', ({ status, phone }) => { /* 'connected'/'disconnected' */ });

// Errors
socket.on('wa:error', ({ message }) => { /* display error */ });
```

---

## Premium Features

These endpoints return `403 { upgrade_required: true }` for free users:

- `PUT /api/user/smtp` — use custom SMTP provider
- `DELETE /api/user/smtp/:provider` — remove provider
- Email sending with non-system provider (`provider != 'system'`)

**Admin can upgrade users via:**
```
PUT /api/admin/users/:id/plan
Body: { "plan": "premium" }
```

---

## Merge Fields in Email/WhatsApp

Use these placeholders in your message body:
- `{businessName}` → target business name
- `{niche}` → campaign niche
- `{yourName}` → your name (from profile)
- `{yourCompany}` → your company (from profile)

---

## Security Notes

1. **Never** expose `SUPABASE_SERVICE_ROLE_KEY` to the browser
2. All routes use Supabase JWT verification — tokens expire after 1 hour
3. Row Level Security is enabled on all tables
4. SMTP API keys are stored in the database — consider encrypting them with a server-side key before storing
5. Rate limiting: 100 requests per 15 minutes per IP

---

## Frontend Integration (Supabase Auth)

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sign up
await supabase.auth.signUp({ email, password });

// Sign in
const { data } = await supabase.auth.signInWithPassword({ email, password });
const token = data.session.access_token;

// Call API
fetch('/api/campaigns', {
  headers: { Authorization: `Bearer ${token}` }
});

// Sign out
await supabase.auth.signOut();
```
