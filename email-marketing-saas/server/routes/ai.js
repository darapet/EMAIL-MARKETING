/**
 * server/routes/ai.js
 * AI-powered message generation via Groq
 *
 * Routes:
 *   POST /api/ai/generate-email    — generate email subject + body
 *   POST /api/ai/generate-whatsapp — generate WhatsApp message
 */

'use strict';

const express                                  = require('express');
const { requireAuth }                          = require('../middleware/auth');
const { logActivity }                          = require('../services/activity-logger');
const { generateEmailDraft, generateWhatsAppDraft } = require('../services/ai-generator');

const router = express.Router();
router.use(requireAuth);

// ─── POST /api/ai/generate-email ─────────────────────────────────────────────
/**
 * Body:
 * {
 *   niche:          string,   // target industry
 *   tone?:          'professional'|'friendly'|'urgent'|'casual',
 *   goal?:          'service_offer'|'partnership'|'introduction'|'follow_up',
 *   targetBusiness?: string,  // specific business (optional; defaults to {businessName})
 *   customPrompt?:  string,   // extra instructions
 * }
 */
router.post('/generate-email', async (req, res, next) => {
  try {
    const {
      niche,
      tone           = 'professional',
      goal           = 'service_offer',
      targetBusiness = '',
      customPrompt   = '',
    } = req.body;

    if (!niche) return res.status(400).json({ error: 'niche is required.' });

    const user = req.user;
    const { subject, body } = await generateEmailDraft({
      senderName:    user.name    || 'Your Name',
      senderCompany: user.company || 'Your Company',
      targetBusiness,
      niche,
      tone,
      goal,
      customPrompt,
    });

    await logActivity(req.userId, 'ai_email_generate', { niche, tone, goal });

    return res.json({ subject, body });
  } catch (err) {
    if (err.message?.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured. Contact admin.' });
    }
    next(err);
  }
});

// ─── POST /api/ai/generate-whatsapp ─────────────────────────────────────────
/**
 * Body:
 * {
 *   niche:        string,
 *   tone?:        string,
 *   goal?:        string,
 *   customPrompt?: string,
 * }
 */
router.post('/generate-whatsapp', async (req, res, next) => {
  try {
    const {
      niche,
      tone         = 'friendly',
      goal         = 'service_offer',
      customPrompt = '',
    } = req.body;

    if (!niche) return res.status(400).json({ error: 'niche is required.' });

    const user = req.user;
    const { message } = await generateWhatsAppDraft({
      senderName:    user.name    || 'Your Name',
      senderCompany: user.company || 'Your Company',
      niche,
      tone,
      goal,
      customPrompt,
    });

    await logActivity(req.userId, 'ai_wa_generate', { niche, tone, goal });

    return res.json({ message });
  } catch (err) {
    if (err.message?.includes('GROQ_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured. Contact admin.' });
    }
    next(err);
  }
});

module.exports = router;
