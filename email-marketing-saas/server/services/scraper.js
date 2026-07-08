/**
 * server/services/scraper.js
 * Asynchronous B2B Lead Scraper Engine
 *
 * Pipeline:
 *  1. Build search dork queries from niche + location
 *  2. Fetch & parse result pages for business URLs
 *  3. Deep-crawl each URL → extract email, social links, phone
 *  4. Check WhatsApp availability via connected Baileys socket
 *  5. Write verified lead row to Firestore
 */

'use strict';

const axios    = require('axios');
const cheerio  = require('cheerio');
const { getDb }          = require('../config/firebase');
const waSessionManager   = require('./whatsapp-session');

// ── Constants ──────────────────────────────────────────────────────
const SOCIAL_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'pinterest.com',
  'snapchat.com', 'telegram.me', 't.me', 'wa.me',
  'threads.net', 'reddit.com',  'yelp.com',
];

const EMAIL_REGEX   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX   = /(?:\+?(\d{1,3})\s?)?(?:\((\d{1,4})\)[\s\-]?)?(\d{3,4})[\s\-]?(\d{3,4})[\s\-]?(\d{0,4})/g;

// User-agent rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/124.0',
];

// ── Search URL builders ────────────────────────────────────────────
function buildSearchUrls(niche, location, depth) {
  const q    = encodeURIComponent(`"${niche}" "${location}" email contact site:`);
  const dork = encodeURIComponent(`"${niche}" contact email ${location}`);
  const urls = [
    `https://www.google.com/search?q=${dork}&num=${depth * 10}`,
    `https://www.bing.com/search?q=${dork}&count=${depth * 10}`,
    `https://search.yahoo.com/search?p=${dork}&n=${depth * 10}`,
  ];
  return urls;
}

// ── HTTP helper ────────────────────────────────────────────────────
async function fetchPage(url, retries = 2) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': ua,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 5,
      });
      return res.data;
    } catch (err) {
      if (i === retries) return null;
      await sleep(2000);
    }
  }
  return null;
}

// ── Extract business URLs from SERP HTML ──────────────────────────
function extractBusinessUrls(html, niche) {
  const $    = cheerio.load(html || '');
  const urls = new Set();

  // Google result links
  $('a[href*="http"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/url\?q=([^&]+)/) || href.match(/^(https?:\/\/[^?#]+)/);
    if (match) {
      const url = decodeURIComponent(match[1]);
      if (isBusinessUrl(url)) urls.add(url);
    }
  });

  return [...urls].slice(0, 30);
}

function isBusinessUrl(url) {
  const skip = ['google.', 'bing.', 'yahoo.', 'facebook.', 'youtube.', 'wikipedia.', 'amazon.'];
  return skip.every(s => !url.includes(s));
}

// ── Deep-crawl a single business URL ──────────────────────────────
async function crawlBusinessSite(url) {
  const html = await fetchPage(url);
  if (!html) return null;

  const $    = cheerio.load(html);
  const text = $.text();

  // Extract emails
  const emails   = [...new Set((text.match(EMAIL_REGEX) || []).filter(isValidEmail))];

  // Extract social URLs from anchor tags
  const socials  = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (SOCIAL_DOMAINS.some(d => href.includes(d))) socials.push(href);
  });

  // Extract phone numbers
  const rawPhones = text.match(PHONE_REGEX) || [];
  const phones    = [...new Set(rawPhones.map(p => p.replace(/\D+/g, '')).filter(p => p.length >= 10))];

  // Extract business name from <title> or <h1>
  const title    = $('title').first().text().trim().split(/[|\-–—]/)[0].trim();
  const h1       = $('h1').first().text().trim();
  const businessName = title || h1 || extractDomainName(url);

  return {
    businessName,
    email:     emails[0]   || null,
    emails,
    phone:     phones[0]   || null,
    phones,
    socialUrls: [...new Set(socials)].slice(0, 15),
    sourceUrl: url,
  };
}

// ── WhatsApp verification ──────────────────────────────────────────
async function verifyWhatsApp(userId, phone) {
  if (!phone) return false;
  try {
    const session = waSessionManager.getSession(userId);
    if (!session || !session.sock) return false;
    const jid    = `${phone}@s.whatsapp.net`;
    const result = await session.sock.onWhatsApp(jid);
    return !!(result && result[0] && result[0].exists);
  } catch {
    return false;
  }
}

// ── Main scraper entry point ───────────────────────────────────────
async function run({ campaignId, userId, niche, depth = 2, channels = [], locations = [] }) {
  const db        = getDb();
  const io        = global._io; // set by server/index.js
  const totalLocs = locations.length || 1;
  let   found     = 0;
  let   processed = 0;
  const delay     = parseInt(process.env.SCRAPER_REQUEST_DELAY_MS || 2000);

  const emitLog = (text, type = 'info') => {
    if (io) io.to(`user:${userId}`).emit('scrape_log', { text, type });
    console.log(`[Scraper][${campaignId}] ${text}`);
  };

  const emitProgress = (extra = {}) => {
    if (io) io.to(`user:${userId}`).emit('scrape_progress', {
      percent:   Math.min(99, Math.round((processed / Math.max(1, totalLocs * 30)) * 100)),
      found,
      processed,
      waVerified: extra.waVerified || 0,
      status:    extra.status || 'Scraping...',
    });
  };

  emitLog(`Starting scrape — Niche: "${niche}", Depth: ${depth}`);

  const targetLocations = locations.length
    ? locations.flatMap(l => (l.states && l.states.length ? l.states.map(s => `${s}, ${l.country}`) : [l.country]))
    : ['Online'];

  let waVerifiedCount = 0;

  for (const location of targetLocations.slice(0, depth * 5)) {
    emitLog(`Searching: "${niche}" in "${location}"`);
    const searchUrls = buildSearchUrls(niche, location, depth);

    for (const searchUrl of searchUrls.slice(0, 2)) {
      const serpHtml    = await fetchPage(searchUrl);
      const businessUrls = extractBusinessUrls(serpHtml, niche);
      emitLog(`  Found ${businessUrls.length} business URLs from SERP`);

      for (const bUrl of businessUrls) {
        await sleep(delay + Math.random() * 1000);
        processed++;
        emitProgress({ status: `Crawling ${extractDomainName(bUrl)}...`, waVerified: waVerifiedCount });

        const leadData = await crawlBusinessSite(bUrl);
        if (!leadData) continue;
        if (!leadData.email && !leadData.phone) continue; // skip empty leads

        // WhatsApp verification
        let waVerified = false;
        if (channels.includes('whatsapp') && leadData.phone) {
          waVerified = await verifyWhatsApp(userId, leadData.phone);
          if (waVerified) waVerifiedCount++;
        }

        const lead = {
          campaignId,
          businessName: leadData.businessName,
          email:        leadData.email,
          phone:        leadData.phone,
          socialUrls:   leadData.socialUrls,
          waVerified,
          status:       'pending',
          location,
          sourceUrl:    leadData.sourceUrl,
          createdAt:    new Date(),
        };

        // Save to Firestore
        if (db) {
          await db.collection('campaigns').doc(campaignId)
            .collection('leads').add(lead);

          // Increment leadsCount
          await db.collection('campaigns').doc(campaignId).update({
            leadsCount: (found + 1),
          });
        }

        found++;
        emitLog(`✓ Lead found: ${leadData.businessName} — ${leadData.email || leadData.phone}`, 'success');
        emitProgress({ waVerified: waVerifiedCount, status: `Scraping — ${found} leads found` });
      }
    }
  }

  // Mark campaign complete
  if (db) {
    await db.collection('campaigns').doc(campaignId).update({
      status:    'complete',
      leadsCount: found,
      completedAt: new Date(),
    });
  }

  if (io) io.to(`user:${userId}`).emit('scrape_complete', { campaignId, totalLeads: found });
  emitLog(`Scrape complete — ${found} leads found`, 'success');
}

// ── Utilities ──────────────────────────────────────────────────────
function isValidEmail(email) {
  const skipDomains = ['example.', 'test.', 'placeholder.', 'sentry.', 'wix.'];
  return email && email.length < 80 && !skipDomains.some(d => email.includes(d));
}

function extractDomainName(url) {
  try { return new URL(url).hostname.replace('www.', '').split('.')[0]; } catch { return url; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { run };
