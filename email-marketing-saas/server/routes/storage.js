/**
 * server/routes/storage.js
 * File Upload — logos and email signatures via Supabase Storage
 *
 * Routes:
 *   POST /api/storage/upload/logo      — upload brand logo (jpg/png/svg, max 2MB)
 *   POST /api/storage/upload/signature — upload email signature image (jpg/png, max 1MB)
 *
 * Files are stored in Supabase Storage bucket: 'uploads'
 * Folders: uploads/logos/<userId>/ and uploads/signatures/<userId>/
 *
 * Prerequisites (run once in Supabase dashboard):
 *   1. Create a Storage bucket named 'uploads' (public)
 *   2. Set bucket policy to allow authenticated reads
 */

'use strict';

const express         = require('express');
const multer          = require('multer');
const path            = require('path');
const { getDb }       = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Multer (in-memory, no disk write) ───────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.svg', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(', ')}`));
    }
    cb(null, true);
  },
});

// ─── POST /api/storage/upload/logo ───────────────────────────────────────────
router.post('/upload/logo', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `logo_${Date.now()}${ext}`;
    const filePath = `logos/${req.userId}/${filename}`;

    const db = getDb();
    const { error: upErr } = await db.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert:      true,
      });

    if (upErr) return res.status(400).json({ error: upErr.message });

    const { data: urlData } = db.storage.from('uploads').getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl;

    // Auto-save to user profile
    await db.from('profiles').update({ logo_url: publicUrl }).eq('id', req.userId);

    return res.json({ url: publicUrl, path: filePath });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/storage/upload/signature ──────────────────────────────────────
router.post('/upload/signature', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    // Signatures: 1MB max
    if (req.file.size > 1 * 1024 * 1024) {
      return res.status(400).json({ error: 'Signature image must be under 1MB.' });
    }

    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `sig_${Date.now()}${ext}`;
    const filePath = `signatures/${req.userId}/${filename}`;

    const db = getDb();
    const { error: upErr } = await db.storage
      .from('uploads')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert:      true,
      });

    if (upErr) return res.status(400).json({ error: upErr.message });

    const { data: urlData } = db.storage.from('uploads').getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl;

    return res.json({ url: publicUrl, path: filePath });
  } catch (err) {
    next(err);
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 2MB.' });
  }
  return res.status(400).json({ error: err.message });
});

module.exports = router;
