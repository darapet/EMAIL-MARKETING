/**
 * server/index.js — LeadForge API Server
 * Express + Socket.io + Firebase Admin
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

// ── Logger ────────────────────────────────────────
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
});

// ── Express app ───────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Middleware ────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Relax for dev; tighten in production
}));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// Request logger
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Request');
  next();
});

// ── Static frontend ───────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ────────────────────────────────────
const campaignsRouter  = require('./routes/campaigns');
const leadsRouter      = require('./routes/leads');
const whatsappRouter   = require('./routes/whatsapp');
const outreachRouter   = require('./routes/outreach');
const userRouter       = require('./routes/user');

app.use('/api/campaigns', campaignsRouter);
app.use('/api/leads',     leadsRouter);
app.use('/api/whatsapp',  whatsappRouter);
app.use('/api/outreach',  outreachRouter);
app.use('/api/user',      userRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Socket.io — WhatsApp session broker ───────────
const waSessionManager = require('./services/whatsapp-session');
waSessionManager.init(io, logger);

// ── SPA Fallback ──────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error(err, 'Unhandled error');
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🚀 LeadForge server running on http://localhost:${PORT}`);
});

module.exports = { app, io, logger };
