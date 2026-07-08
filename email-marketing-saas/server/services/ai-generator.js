/**
 * server/services/ai-generator.js
 * AI Message Generator using Groq (llama3-70b-8192)
 *
 * Generates professional outreach email/WhatsApp message drafts
 * based on user's company profile and target lead context.
 */

'use strict';

const Groq = require('groq-sdk');

let _groqClient = null;

function getGroq() {
  if (_groqClient) return _groqClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in environment variables.');
  _groqClient = new Groq({ apiKey });
  return _groqClient;
}

/**
 * Generate a professional email body using Groq AI.
 *
 * @param {object} params
 * @param {string} params.senderName       - Your name
 * @param {string} params.senderCompany    - Your company
 * @param {string} params.targetBusiness   - Target business name (use {businessName} for merge)
 * @param {string} params.niche            - Target industry niche
 * @param {string} params.tone             - 'professional' | 'friendly' | 'urgent' | 'casual'
 * @param {string} params.goal             - 'partnership' | 'service_offer' | 'introduction' | 'follow_up'
 * @param {string} [params.customPrompt]   - Optional extra instructions from the user
 * @returns {Promise<{ subject: string, body: string }>}
 */
async function generateEmailDraft({ senderName, senderCompany, targetBusiness, niche, tone = 'professional', goal = 'service_offer', customPrompt = '' }) {
  const groq = getGroq();

  const systemPrompt = `You are an expert B2B email copywriter. 
Write concise, compelling outreach emails for business development.
Rules:
- Use {businessName} as a merge field for the recipient business name
- Use {yourName} as a merge field for the sender's name
- Use {yourCompany} as a merge field for the sender's company
- Keep emails under 180 words
- Never use hollow phrases like "I hope this email finds you well"
- Include a clear, single call-to-action
- Do NOT include subject lines inside the body
- Always sound human, not robotic
- Tone: ${tone}
- Output ONLY valid JSON in this exact format: {"subject": "...", "body": "..."}`;

  const userPrompt = `Write a B2B outreach email for:
- Sender: ${senderName} from ${senderCompany}
- Target: ${targetBusiness || '{businessName}'} in the "${niche}" industry
- Goal: ${goal}
${customPrompt ? `- Extra instructions: ${customPrompt}` : ''}

Respond ONLY with the JSON object.`;

  const completion = await groq.chat.completions.create({
    model:       'llama3-70b-8192',
    messages:    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature:  0.7,
    max_tokens:   512,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('Groq returned an empty response.');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.subject || !parsed.body) throw new Error('Invalid response shape.');
    return { subject: parsed.subject, body: parsed.body };
  } catch {
    throw new Error('AI returned invalid JSON. Try again.');
  }
}

/**
 * Generate a WhatsApp outreach message draft.
 *
 * @param {object} params
 * @param {string} params.senderName
 * @param {string} params.senderCompany
 * @param {string} params.niche
 * @param {string} params.tone
 * @param {string} params.goal
 * @param {string} [params.customPrompt]
 * @returns {Promise<{ message: string }>}
 */
async function generateWhatsAppDraft({ senderName, senderCompany, niche, tone = 'friendly', goal = 'service_offer', customPrompt = '' }) {
  const groq = getGroq();

  const systemPrompt = `You are an expert WhatsApp B2B outreach copywriter.
Rules:
- Maximum 60 words
- Conversational, no corporate jargon
- Use {businessName} for the business name merge field
- End with ONE question or call-to-action
- Tone: ${tone}
- Output ONLY valid JSON: {"message": "..."}`;

  const userPrompt = `Write a WhatsApp B2B outreach message:
- From: ${senderName} at ${senderCompany}
- Target niche: ${niche}
- Goal: ${goal}
${customPrompt ? `- Extra: ${customPrompt}` : ''}

Respond ONLY with the JSON object.`;

  const completion = await groq.chat.completions.create({
    model:      'llama3-70b-8192',
    messages:   [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature:  0.7,
    max_tokens:   200,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('Groq returned an empty response.');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.message) throw new Error('Invalid response shape.');
    return { message: parsed.message };
  } catch {
    throw new Error('AI returned invalid JSON. Try again.');
  }
}

module.exports = { generateEmailDraft, generateWhatsAppDraft };
