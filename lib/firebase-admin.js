// lib/firebase-admin.js
// Server-side Firebase Admin SDK using existing Vercel env vars

const { initializeApp, getApps, cert } = require('firebase-admin/app')
const { getFirestore }                  = require('firebase-admin/firestore')

function getDb() {
  if (getApps().length > 0) return getFirestore()

  initializeApp({
    credential: cert({
      projectId:   'tapplus-a2d09',
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
      privateKey:  (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })
  })

  return getFirestore()
}

module.exports = { getDb }
