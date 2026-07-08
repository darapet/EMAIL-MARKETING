/**
 * server/services/whatsapp-session.js
 * Multi-Tenant WhatsApp Session Manager using Baileys
 *
 * Each user gets an isolated session stored at:
 *   WA_SESSION_BASE_DIR/<userId>/
 *
 * Architecture:
 *  - activeUserSessions Map keeps in-memory socket handles
 *  - Socket.io emits real-time QR codes and session events to user rooms
 *  - Broadcast queue applies randomised jitter delays (60–180s default)
 *  - Opt-out circuit breaker intercepts incoming "STOP" messages
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Baileys — lazy-loaded to avoid crash if not installed
let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers;

try {
  const baileys = require('@whiskeysockets/baileys');
  makeWASocket              = baileys.default || baileys.makeWASocket;
  DisconnectReason          = baileys.DisconnectReason;
  useMultiFileAuthState     = baileys.useMultiFileAuthState;
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
  Browsers                  = baileys.Browsers;
} catch {
  console.warn('[WA] Baileys not installed — WhatsApp features unavailable. Run: npm install');
}

const QRCode = require('qrcode');
const { getDb }   = require('../config/firebase');

// ── In-memory session store ────────────────────────────────────────
// Map<userId, { sock, connected, phone, name, broadcastQueue }>
const activeUserSessions = new Map();

let _io;
let _logger;

// ── init ───────────────────────────────────────────────────────────
function init(io, logger) {
  _io     = io;
  _logger = logger;

  // Store io globally for scraper service
  global._io = io;

  io.on('connection', (socket) => {
    _logger.info({ socketId: socket.id }, '[WA] Socket connected');

    // Client sends userId to join their personal room
    socket.on('wa_init', async ({ userId }) => {
      if (!userId) return;
      socket.join(`user:${userId}`);
      _logger.info({ userId }, '[WA] User joined room, initiating session');
      await createSession(userId);
    });

    socket.on('disconnect', () => {
      _logger.info({ socketId: socket.id }, '[WA] Socket disconnected');
    });
  });
}

// ── Create / restore a WhatsApp session ───────────────────────────
async function createSession(userId) {
  if (!makeWASocket) {
    emitToUser(userId, 'error', { message: 'Baileys library not installed on server' });
    return;
  }

  // Destroy existing session if any
  if (activeUserSessions.has(userId)) {
    await destroySession(userId);
  }

  const sessionDir = getSessionDir(userId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version }          = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds:  state.creds,
        keys:   makeCacheableSignalKeyStore(state.keys, _logger),
      },
      browser:       Browsers.ubuntu('LeadForge'),
      printQRInTerminal: false,
      logger:        _logger.child({ userId }),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });

    // Store session
    activeUserSessions.set(userId, {
      sock,
      connected:  false,
      phone:      null,
      name:       null,
      broadcastActive: false,
    });

    // ── Connection events ──────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR data URL and emit to user's room
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
          emitToUser(userId, 'qr', qrDataUrl);
          _logger.info({ userId }, '[WA] QR emitted');
        } catch (err) {
          _logger.error(err, '[WA] QR generation failed');
        }
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason?.loggedOut;
        _logger.info({ userId, shouldReconnect }, '[WA] Connection closed');

        updateSession(userId, { connected: false });
        emitToUser(userId, 'wa_disconnected', {});

        if (shouldReconnect) {
          await sleep(3000);
          await createSession(userId);
        } else {
          // Logged out — clear session files
          fs.rmSync(sessionDir, { recursive: true, force: true });
          activeUserSessions.delete(userId);
        }
      }

      if (connection === 'open') {
        const me = sock.user;
        updateSession(userId, {
          connected: true,
          phone:     me?.id?.split(':')[0] || '',
          name:      me?.name || me?.verifiedName || 'Unknown',
        });
        emitToUser(userId, 'wa_connected', {
          phone: activeUserSessions.get(userId)?.phone,
          name:  activeUserSessions.get(userId)?.name,
        });
        _logger.info({ userId }, '[WA] Session connected');
      }
    });

    // ── Save credentials on update ─────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Incoming message handler ───────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const text = extractMessageText(msg);
        if (!text) continue;

        _logger.info({ userId, from: msg.key.remoteJid, text }, '[WA] Incoming message');

        // ── Opt-out circuit breaker ────────────────────────────────
        if (text.trim().toUpperCase() === 'STOP') {
          const phone = msg.key.remoteJid.split('@')[0];
          await handleOptOut(userId, phone);
          // Send acknowledgement
          try {
            await sock.sendMessage(msg.key.remoteJid, {
              text: "You've been unsubscribed and won't receive further messages.",
            });
          } catch {}
        }
      }
    });

  } catch (err) {
    _logger.error(err, '[WA] Failed to create session');
    emitToUser(userId, 'error', { message: err.message });
  }
}

// ── Broadcast ──────────────────────────────────────────────────────
async function startBroadcast({ userId, campaignId, message, minDelay, maxDelay, source }) {
  const session = activeUserSessions.get(userId);
  if (!session || !session.connected) throw new Error('Session not connected');

  session.broadcastActive = true;

  const db = getDb();
  let leads = [];

  if (source === 'contacts') {
    // Use Baileys contact store
    const contacts = Object.values(session.sock.store?.contacts || {});
    leads = contacts
      .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
      .map(c => ({ phone: c.id.split('@')[0], businessName: c.name || c.notify || 'Contact' }));
  } else if (db && campaignId) {
    const snap = await db
      .collection('campaigns').doc(campaignId)
      .collection('leads')
      .where('status', '!=', 'optout')
      .where('waVerified', '==', true)
      .get();
    leads = snap.docs.map(d => ({ leadId: d.id, ...d.data() }));
  }

  _logger.info({ userId, count: leads.length }, '[WA] Starting broadcast');
  emitBroadcastLog(userId, `Starting broadcast to ${leads.length} contacts`, 'info');

  let sent = 0;
  for (const lead of leads) {
    if (!session.broadcastActive) {
      emitBroadcastLog(userId, 'Broadcast stopped by user', 'warn');
      break;
    }

    const phone = (lead.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) continue;

    // Interpolate merge fields
    const filled = message
      .replace(/{businessName}/g, lead.businessName || 'there')
      .replace(/{niche}/g, lead.niche || '')
      .replace(/{yourName}/g, '');

    try {
      // Human typing simulation
      await session.sock.sendPresenceUpdate('composing', `${phone}@s.whatsapp.net`);
      const typingDuration = 2000 + Math.random() * 4000;
      await sleep(typingDuration);
      await session.sock.sendPresenceUpdate('paused', `${phone}@s.whatsapp.net`);

      await session.sock.sendMessage(`${phone}@s.whatsapp.net`, { text: filled });
      sent++;

      emitBroadcastLog(userId, `✓ Sent to ${lead.businessName || phone} (${sent}/${leads.length})`, 'success');

      // Log to Firestore
      if (db && lead.leadId) {
        await db.collection('outreach_logs').add({
          userId, campaignId, leadId: lead.leadId,
          type: 'whatsapp', message: filled, sentAt: new Date(),
        });
      }
    } catch (err) {
      emitBroadcastLog(userId, `⚠ Failed for ${phone}: ${err.message}`, 'warn');
    }

    // Anti-ban jitter delay
    const delay = jitter(minDelay * 1000, maxDelay * 1000);
    emitBroadcastLog(userId, `Waiting ${Math.round(delay / 1000)}s before next message...`);
    await sleep(delay);
  }

  session.broadcastActive = false;
  emitBroadcastLog(userId, `✓ Broadcast complete — ${sent}/${leads.length} sent`, 'success');
}

// ── Opt-out handler ────────────────────────────────────────────────
async function handleOptOut(userId, phone) {
  _logger.info({ userId, phone }, '[WA] Opt-out received');
  const db = getDb();
  if (!db) return;

  // Find lead by phone across all campaigns for this user
  const campaigns = await db.collection('campaigns')
    .where('userId', '==', userId).get();

  for (const campaignDoc of campaigns.docs) {
    const leadSnap = await db
      .collection('campaigns').doc(campaignDoc.id)
      .collection('leads')
      .where('phone', '==', phone)
      .limit(1).get();

    for (const leadDoc of leadSnap.docs) {
      await leadDoc.ref.update({ status: 'optout', optedOutAt: new Date() });
      _logger.info({ leadId: leadDoc.id }, '[WA] Lead opted out');
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────
function getSessionDir(userId) {
  const base = process.env.WA_SESSION_BASE_DIR || path.join(process.cwd(), 'sessions');
  return path.join(base, userId);
}

function getSession(userId) {
  return activeUserSessions.get(userId) || null;
}

async function sendMessage(userId, phone, text) {
  const session = activeUserSessions.get(userId);
  if (!session?.sock) throw new Error('No active session');
  return session.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
}

async function disconnectUser(userId) {
  await destroySession(userId);
}

async function destroySession(userId) {
  const session = activeUserSessions.get(userId);
  if (!session) return;
  try { session.sock?.end(); } catch {}
  activeUserSessions.delete(userId);
}

function updateSession(userId, updates) {
  const s = activeUserSessions.get(userId);
  if (s) activeUserSessions.set(userId, { ...s, ...updates });
}

function emitToUser(userId, event, data) {
  if (_io) _io.to(`user:${userId}`).emit(event, data);
}

function emitBroadcastLog(userId, text, type = 'info') {
  emitToUser(userId, 'broadcast_log', { text, type });
}

function extractMessageText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    null
  );
}

function jitter(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  init,
  getSession,
  sendMessage,
  disconnectUser,
  startBroadcast,
  activeUserSessions,
};
