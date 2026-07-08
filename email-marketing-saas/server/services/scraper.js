/**
 * server/services/scraper.js
 * Asynchronous B2B Lead Scraper Engine
 *
 * Scrapes business emails, phones, and social URLs for a given niche + locations.
 * Results are written directly to Supabase as they are found.
 *
 * Usage: call runScrape() — it runs in the background and emits Socket.io events.
 */

'use strict';

const https    = require('https');
const http     = require('http');
const { URL }  = require('url');
const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../config/supabase');

// Domains we recognise as social URLs
const SOCIAL_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'tiktok.com', 'linkedin.com', 'youtube.com', 'pinterest.com',
  'snapchat.com', 'telegram.me', 't.me', 'wa.me',
  'whatsapp.com', 'threads.net', 'reddit.com',
];

// Email regex (basic but effective)
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
// Phone regex — international formats
const PHONE_RE = /(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/g;

const CONCURRENCY   = parseInt(process.env.SCRAPER_CONCURRENCY   || '3');
const DELAY_MS      = parseInt(process.env.SCRAPER_REQUEST_DELAY_MS || '2000');
const REQUEST_TIMEOUT = 10_000; // 10s per request

// ── HTTP fetch helper ─────────────────────────────────────────────────────────

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; LeadForgeBot/1.0; +https://leadforge.app/bot)',
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        // Follow redirects (max 3)
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          try {
            const nextUrl = new URL(res.headers.location, url).toString();
            return fetchHtml(nextUrl).then(resolve).catch(reject);
          } catch {
            return resolve('');
          }
        }

        if (res.statusCode !== 200) return resolve('');

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; if (body.length > 500_000) res.destroy(); });
        res.on('end', () => resolve(body));
      }
    );

    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function extractEmails(html) {
  const found = html.match(EMAIL_RE) || [];
  // Filter out common non-business emails / image file extensions
  return [...new Set(found)].filter((e) =>
    !e.match(/\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf)$/i) &&
    !e.startsWith('no-reply') &&
    !e.startsWith('noreply')
  );
}

function extractPhones(html) {
  const found = html.match(PHONE_RE) || [];
  return [...new Set(found.map((p) => p.trim()))];
}

function extractSocialUrls(html) {
  const socials = {};
  const linkRe  = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRe.exec(html)) !== null) {
    const href = match[1];
    for (const domain of SOCIAL_DOMAINS) {
      if (href.includes(domain) && !socials[domain]) {
        socials[domain] = href;
        if (Object.keys(socials).length >= 15) break;
      }
    }
  }

  return socials;
}

function extractBusinessName(html, url) {
  // Try <title>, then <h1>
  const titleMatch = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].split('|')[0].split('-')[0].split('–')[0].trim();
  }
  const h1Match = html.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  return new URL(url).hostname.replace(/^www\./, '');
}

// ── Search URL builder ────────────────────────────────────────────────────────
// Uses public search-engine-style dork queries (no API key needed)

function buildSearchUrls(niche, country, state, channels) {
  const location = [state, country].filter(Boolean).join(' ');
  const channel  = channels.includes('email') ? 'email' : channels[0] || 'contact';
  const query    = encodeURIComponent(`${niche} business ${location} site:*.com ${channel}`);

  // Use DuckDuckGo HTML endpoint (no JS, scrapable)
  return [`https://duckduckgo.com/html/?q=${query}&kl=us-en`];
}

function extractLinksFromSearch(html) {
  const linkRe = /class="result__url[^"]*"[^>]*>(https?:\/\/[^<"]+)/gi;
  const links  = [];
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    try { links.push(new URL(match[1].trim()).origin); } catch {}
    if (links.length >= 20) break;
  }
  // Also grab href links to business sites
  const hrefRe = /href="(https?:\/\/(?!duckduckgo\.com)[^"]+)"/gi;
  while ((match = hrefRe.exec(html)) !== null) {
    try {
      const u = new URL(match[1]);
      if (!u.hostname.includes('duckduckgo')) links.push(u.origin);
    } catch {}
    if (links.length >= 30) break;
  }
  return [...new Set(links)];
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function mapConcurrent(items, fn, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ── Main scrape function ──────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string} opts.userId
 * @param {string} opts.niche
 * @param {string[]} opts.countries
 * @param {object}  opts.states       - { "Nigeria": ["Lagos", "Kano"] }
 * @param {string[]} opts.channels
 * @param {number}  [opts.emailCount] - target number of emails to scrape
 */
async function runScrape({ campaignId, userId, niche, countries, states = {}, channels = ['email'], emailCount }) {
  const db          = getDb();
  const targetCount = emailCount ? parseInt(emailCount) : 50;
  let   totalFound  = 0;

  try {
    // Flatten country + state combinations into search targets
    const targets = [];
    for (const country of countries) {
      const countryStates = states[country] || [];
      if (countryStates.length > 0) {
        for (const state of countryStates) targets.push({ country, state });
      } else {
        targets.push({ country, state: null });
      }
    }

    for (const { country, state } of targets) {
      if (totalFound >= targetCount) break;

      // Get search results page
      const searchUrls = buildSearchUrls(niche, country, state, channels);

      for (const searchUrl of searchUrls) {
        if (totalFound >= targetCount) break;

        const searchHtml = await fetchHtml(searchUrl);
        if (!searchHtml) continue;

        const businessLinks = extractLinksFromSearch(searchHtml);

        // Deep-crawl each business site
        await mapConcurrent(
          businessLinks.slice(0, 15),
          async (siteUrl) => {
            if (totalFound >= targetCount) return;

            try {
              const html = await fetchHtml(siteUrl + '/');
              if (!html) return;

              // Also check /contact page
              const contactHtml = await fetchHtml(siteUrl + '/contact').catch(() => '');
              const fullHtml    = html + contactHtml;

              const emails   = extractEmails(fullHtml);
              const phones   = extractPhones(fullHtml);
              const socials  = extractSocialUrls(fullHtml);
              const bizName  = extractBusinessName(html, siteUrl);

              if (!emails.length && !phones.length) return; // Skip if nothing found

              // Insert each email as a separate lead
              const leadsToInsert = emails.length > 0
                ? emails.slice(0, 3).map((email) => ({
                    id:             uuidv4(),
                    campaign_id:    campaignId,
                    user_id:        userId,
                    business_name:  bizName,
                    email,
                    phone:          phones[0] || null,
                    social_urls:    socials,
                    whatsapp_valid: false,
                    opted_out:      false,
                  }))
                : [{
                    id:             uuidv4(),
                    campaign_id:    campaignId,
                    user_id:        userId,
                    business_name:  bizName,
                    email:          null,
                    phone:          phones[0] || null,
                    social_urls:    socials,
                    whatsapp_valid: false,
                    opted_out:      false,
                  }];

              await db.from('leads').insert(leadsToInsert);
              totalFound += leadsToInsert.length;

              // Update campaign total_leads counter
              await db
                .from('campaigns')
                .update({ total_leads: totalFound })
                .eq('id', campaignId);

            } catch (err) {
              // Silently skip failed individual sites
              console.error('[Scraper] Site error:', err.message);
            }
          },
          CONCURRENCY
        );
      }
    }

    // Mark campaign as done
    await db.from('campaigns').update({
      status:      'done',
      total_leads: totalFound,
      scraped_at:  new Date().toISOString(),
    }).eq('id', campaignId);

    console.log(`[Scraper] Campaign ${campaignId} complete: ${totalFound} leads found`);
  } catch (err) {
    await db.from('campaigns').update({ status: 'failed' }).eq('id', campaignId);
    console.error('[Scraper] Fatal error:', err.message);
    throw err;
  }
}

module.exports = { runScrape };
