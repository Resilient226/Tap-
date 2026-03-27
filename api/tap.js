// api/tap.js — Write a tap to Firestore
// Runs server-side on Vercel — no CORS issues

const { getDb } = require('../lib/firebase-admin')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const tap = req.body
    if (!tap || !tap.id || !tap.bizSlug) {
      res.status(400).json({ error: 'Missing required fields: id, bizSlug' })
      return
    }

    const db = getDb()
    await db.collection('taps').doc(tap.id).set(tap)
    console.log('Tap saved:', tap.id, tap.bizSlug, tap.status)
    res.status(200).json({ ok: true, id: tap.id })

  } catch (e) {
    console.error('api/tap error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
