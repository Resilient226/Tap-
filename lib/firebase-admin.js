// lib/firebase-admin.js
// Server-side Firebase Admin SDK — no CORS issues, no API key restrictions

const { initializeApp, getApps, cert } = require('firebase-admin/app')
const { getFirestore }                  = require('firebase-admin/firestore')

function getDb() {
  // Reuse existing app if already initialized
  if (getApps().length > 0) return getFirestore()

  // Support full service account JSON or separate env vars
  let credential
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
    credential = cert(sa)
  } else {
    credential = cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })
  }

  initializeApp({ credential })
  return getFirestore()
}

module.exports = { getDb }
