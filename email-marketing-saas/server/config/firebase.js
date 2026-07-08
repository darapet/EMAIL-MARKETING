/**
 * server/config/firebase.js
 * Firebase Admin SDK initialisation — singleton pattern
 */

'use strict';

const admin = require('firebase-admin');

let db;
let auth;
let initialized = false;

function init() {
  if (initialized) return { db, auth };

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      '[Firebase] Missing env vars — running without Firebase. ' +
      'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
    );
    return { db: null, auth: null };
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        // Replace escaped newlines from .env string format
        privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }

  db   = admin.firestore();
  auth = admin.auth();

  // Firestore settings
  db.settings({ ignoreUndefinedProperties: true });

  initialized = true;
  return { db, auth };
}

// Convenience getters — call init() on first access
function getDb() {
  if (!db) init();
  return db;
}

function getAuth() {
  if (!auth) init();
  return auth;
}

module.exports = { init, getDb, getAuth };
