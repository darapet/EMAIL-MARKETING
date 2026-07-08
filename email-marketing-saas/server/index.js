/**
 * server/index.js — LeadForge API Server
 * Express + Socket.io + Supabase
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const helmet     = require('helmet');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const pino       = require('pino');

// ── Logger ───────────────────────────────────────────────────────────────────
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
});

// ── Express app ──────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      100,
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', limiter);

// Attach io instance to req for use in routes
app.use((req, _res, next) => { req.io = io; next(); });

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
const userRoutes      = require('./routes/user');
const campaignRoutes  = require('./routes/campaigns');
const leadRoutes      = require('./routes/leads');
const outreachRoutes  = require('./routes/outreach');
const templateRoutes  = require('./routes/templates');
const storageRoutes   = require('./routes/storage');
const aiRoutes        = require('./routes/ai');
const adminRoutes     = require('./routes/admin');
const whatsappRoutes  = require('./routes/whatsapp');

app.use('/api/user',      userRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/leads',     leadRoutes);
app.use('/api/outreach',  outreachRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/storage',   storageRoutes);
app.use('/api/ai',        aiRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/whatsapp',  whatsappRoutes);

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Catch-all → serve frontend SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error:   process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const waSessionManager = require('./services/whatsapp-session');

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Socket connected');

  // WhatsApp QR: client sends userId to subscribe to QR updates
  socket.on('wa:subscribe', (userId) => {
    if (!userId) return;
    socket.join(`wa:${userId}`);
    logger.info({ userId }, 'WA QR subscription');
  });

  socket.on('wa:connect', async ({ userId }) => {
    try {
      await waSessionManager.initSession(userId, io);
    } catch (err) {
      socket.emit('wa:error', { message: err.message });
    }
  });

  socket.on('wa:disconnect', async ({ userId }) => {
    try {
      await waSessionManager.destroySession(userId);
      io.to(`wa:${userId}`).emit('wa:status', { status: 'disconnected' });
    } catch (err) {
      socket.emit('wa:error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Socket disconnected');
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, () => {
  logger.info(`LeadForge API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = { app, io };
