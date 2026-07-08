-- ============================================================
-- LeadForge — B2B Lead Generation & Multi-Tenant Outreach SaaS
-- Supabase PostgreSQL Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS / PROFILES
-- (extends Supabase auth.users — one row per auth user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT        UNIQUE NOT NULL,
  name              TEXT,
  company           TEXT,
  phone             TEXT,
  description       TEXT,

  -- Branding
  logo_url          TEXT,
  brand_color       TEXT        DEFAULT '#dc2626',   -- default red
  default_logo_url  TEXT,

  -- Plan & premium
  plan              TEXT        NOT NULL DEFAULT 'free',  -- 'free' | 'premium'
  is_admin          BOOLEAN     NOT NULL DEFAULT FALSE,

  -- SMTP / Email API Keys (encrypted at application level before storing)
  -- Brevo
  brevo_api_key     TEXT,
  -- SendGrid
  sendgrid_api_key  TEXT,
  -- Mailgun
  mailgun_api_key   TEXT,
  mailgun_domain    TEXT,
  -- Generic SMTP
  smtp_host         TEXT,
  smtp_port         INTEGER,
  smtp_user         TEXT,
  smtp_pass         TEXT,
  smtp_secure       BOOLEAN     DEFAULT TRUE,
  -- Active provider: 'brevo' | 'sendgrid' | 'mailgun' | 'smtp' | 'system'
  active_smtp       TEXT        DEFAULT 'system',

  -- WhatsApp
  wa_session_dir    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  niche         TEXT        NOT NULL,
  channels      JSONB       NOT NULL DEFAULT '[]',   -- ['email','whatsapp','facebook',...]
  countries     JSONB       NOT NULL DEFAULT '[]',
  states        JSONB       NOT NULL DEFAULT '{}',   -- { "Nigeria": ["Lagos","Abuja"], ... }
  status        TEXT        NOT NULL DEFAULT 'pending', -- 'pending'|'running'|'done'|'failed'
  total_leads   INTEGER     NOT NULL DEFAULT 0,
  scraped_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_name   TEXT,
  email           TEXT,
  phone           TEXT,
  whatsapp_valid  BOOLEAN,
  social_urls     JSONB       DEFAULT '{}',  -- { facebook: '', instagram: '', tiktok: '', ... }
  opted_out       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_campaign_id ON public.leads(campaign_id);
CREATE INDEX idx_leads_user_id     ON public.leads(user_id);
CREATE INDEX idx_leads_email       ON public.leads(email);

-- ============================================================
-- EMAIL TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_templates (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  subject       TEXT        NOT NULL,
  body          TEXT        NOT NULL,             -- HTML body with merge fields
  logo_url      TEXT,
  signature_url TEXT,
  is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_user_id ON public.email_templates(user_id);

-- Ensure only one default template per user
CREATE UNIQUE INDEX idx_templates_user_default
  ON public.email_templates(user_id)
  WHERE is_default = TRUE;

-- ============================================================
-- EMAIL SENDS — activity log for every email dispatched
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_sends (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id   UUID        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  lead_id       UUID        REFERENCES public.leads(id) ON DELETE SET NULL,
  template_id   UUID        REFERENCES public.email_templates(id) ON DELETE SET NULL,
  to_email      TEXT        NOT NULL,
  subject       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'sent',  -- 'sent'|'failed'|'bounced'|'opted_out'
  provider      TEXT        NOT NULL DEFAULT 'system', -- 'brevo'|'sendgrid'|'mailgun'|'smtp'|'system'
  error_msg     TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_sends_user_id    ON public.email_sends(user_id);
CREATE INDEX idx_email_sends_campaign   ON public.email_sends(campaign_id);
CREATE INDEX idx_email_sends_sent_at    ON public.email_sends(sent_at);

-- ============================================================
-- ACTIVITY LOGS — general user activity for admin tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL,  -- 'scrape_start'|'email_blast'|'wa_blast'|'login'|...
  meta        JSONB       DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX idx_activity_logs_action  ON public.activity_logs(action);

-- ============================================================
-- WHATSAPP SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_dir   TEXT        NOT NULL,
  phone_number  TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT FALSE,
  connected_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role can do anything" ON public.profiles USING (true) WITH CHECK (true);

-- Campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own campaigns"    ON public.campaigns FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role campaigns"     ON public.campaigns USING (true) WITH CHECK (true);

-- Leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own leads"        ON public.leads FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role leads"         ON public.leads USING (true) WITH CHECK (true);

-- Email Templates
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own templates" ON public.email_templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role templates"     ON public.email_templates USING (true) WITH CHECK (true);

-- Email Sends
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own sends"        ON public.email_sends FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role email_sends"   ON public.email_sends USING (true) WITH CHECK (true);

-- Activity Logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own activity"     ON public.activity_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role activity"      ON public.activity_logs USING (true) WITH CHECK (true);

-- WhatsApp Sessions
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own WA session" ON public.whatsapp_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role wa_sessions"    ON public.whatsapp_sessions USING (true) WITH CHECK (true);

-- ============================================================
-- FUNCTION: auto-create profile on auth signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCTION: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profiles_updated_at   BEFORE UPDATE ON public.profiles        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_campaigns_updated_at  BEFORE UPDATE ON public.campaigns       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_templates_updated_at  BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ADMIN: seed admin user role (run separately with the real UUID)
-- Replace 'YOUR_ADMIN_USER_UUID' with the UUID from auth.users
-- ============================================================
-- UPDATE public.profiles SET is_admin = TRUE WHERE email = 'daramolapeter98@gmail.com';
