/**
 * server/services/whatsapp-session.js
 * Multi-Tenant WhatsApp Session Manager using Baileys
 *
 * - Each user gets an isolated session directory: WA_SESSION_BASE_DIR/<userId>/
 * - Active sockets are held in a Map (never touches disk for live state)
 * - QR codes are emitted via Socket.io to the user's room: wa:<userId>
 * - Anti-ban: messages are sent with random delays from the outreach route
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const pino      = require('pino');
const { getDb } = require('../config/supabase');

// Active session map: userId → Baileys socket
const activeUserSessions = new Map();

const BASE_DIR  = process.env.WA_SESSION_BASE_DIR || './sessions';
const waLogger  = pino({ level: 'silent' }); // suppress Baileys internal logs

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSessionDir(userId) {
  const dir = path.join(BASE_DIR, userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isActive(userId) {
  return activeUserSessions.has(userId);
}

function getSession(userId) {
  return activeUserSessions.get(userId) || null;
}

// ── Session initializer ───────────────────────────────────────────────────────

async function initSession(userId, io) {
  // Destroy existing session first (clean restart)
  if (activeUserSessions.has(userId)) {
    await destroySession(userId);
  }

  const sessionDir = getSessionDir(userId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger:              waLogger,
    auth:                state,
    printQRInTerminal:   false,
    browser:             ['LeadForge', 'Chrome', '124.0.0'],
    syncFullHistory:     false,
    markOnlineOnConnect: false,  // less visible, safer
  });

  activeUserSessions.set(userId, sock);

  // ── Creds update ────────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── QR Code ─────────────────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Emit QR as data URL to the user's socket room
      try {
        const QRCode = require('qrcode');
        const qrDataUrl = await QRCode.toDataURL(qr);
        io.to(`wa:${userId}`).emit('wa:qr', { qr: qrDataUrl });
      } catch {
        io.to(`wa:${userId}`).emit('wa:qr', { qr });
      }
    }

    if (connection === 'open') {
      io.to(`wa:${userId}`).emit('wa:status', { status: 'connected', phone: sock.user?.id });

      // Save connection to Supabase
      try {
        const db = getDb();
        await db.from('whatsapp_sessions').upsert({
          user_id:      userId,
          session_dir:  sessionDir,
          phone_number: sock.user?.id?.split(':')[0] || null,
          is_active:    true,
          connected_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (err) {
        console.error('[WA] Failed to save session to DB:', err.message);
      }
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      activeUserSessions.delete(userId);
      io.to(`wa:${userId}`).emit('wa:status', {
        status:  'disconnected',
        reason:  DisconnectReason[reason] || reason,
        reconnect: shouldReconnect,
      });

      // Update DB
      try {
        const db = getDb();
        await db.from('whatsapp_sessions').update({ is_active: false }).eq('user_id', userId);
      } catch {}

      // Auto-reconnect unless logged out
      if (shouldReconnect) {
        setTimeout(() => initSession(userId, io).catch(console.error), 5000);
      }
    }
  });

  // ── Opt-out detector ─────────────────────────────────────────────────────────
  // Intercepts incoming "STOP" messages and marks the sender as opted out
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''
      ).trim().toUpperCase();

      if (text === 'STOP') {
        const phone = msg.key.remoteJid?.split('@')[0];
        if (!phone) continue;

        try {
          const db = getDb();
          await db
            .from('leads')
            .update({ opted_out: true })
            .eq('phone', phone)
            .eq('user_id', userId);

          console.log(`[WA] Opted out: ${phone} for user ${userId}`);
        } catch (err) {
          console.error('[WA] Opt-out DB error:', err.message);
        }
      }
    }
  });

  return sock;
}

// ── Destroy session ───────────────────────────────────────────────────────────

async function destroySession(userId) {
  const sock = activeUserSessions.get(userId);
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.end(); } catch {}
    activeUserSessions.delete(userId);
  }
}

module.exports = { initSession, destroySession, getSession, isActive };
