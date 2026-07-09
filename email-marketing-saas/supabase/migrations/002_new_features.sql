-- ============================================================
-- LeadForge — Migration 002: New Features
-- Run this in Supabase SQL editor after migration 001
-- ============================================================

-- ── Email sending limits per user ─────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_daily_limit   INTEGER   DEFAULT 300,
  ADD COLUMN IF NOT EXISTS emails_sent_today   INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_send_reset     DATE      DEFAULT CURRENT_DATE;

-- ── 5 Brevo SMTP slots (JSON array of {label, key, sent_today}) ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS brevo_keys   JSONB   DEFAULT '[]'::jsonb;

-- ── Email signature URL on profile ───────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_url   TEXT;

-- ── Scheduled sends table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_sends (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id     UUID        REFERENCES public.campaigns(id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'email',  -- 'email' | 'whatsapp'
  status          TEXT        NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'failed'|'cancelled'
  scheduled_at    TIMESTAMPTZ NOT NULL,
  subject         TEXT,
  body            TEXT        NOT NULL,
  lead_ids        JSONB       DEFAULT '[]'::jsonb,  -- empty = all leads
  provider        TEXT        DEFAULT 'system',
  template_id     UUID,
  error_msg       TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_sends_user_id     ON public.scheduled_sends(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_sends_status      ON public.scheduled_sends(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_sends_scheduled_at ON public.scheduled_sends(scheduled_at);

-- RLS for scheduled_sends
ALTER TABLE public.scheduled_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own scheduled sends" ON public.scheduled_sends
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role scheduled sends" ON public.scheduled_sends
  USING (true) WITH CHECK (true);

-- ── Helper: reset daily email counters (run via cron or call manually) ────────
CREATE OR REPLACE FUNCTION public.reset_daily_email_counters()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET emails_sent_today = 0,
      last_send_reset   = CURRENT_DATE
  WHERE last_send_reset < CURRENT_DATE;
END;
$$;
