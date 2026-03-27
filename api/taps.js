// api/taps.js — Read taps from Firestore
// Runs server-side on Vercel — no CORS issues

const { getDb } = require('../lib/firebase-admin')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'GET')    { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const { bizSlug, staffId } = req.query
    if (!bizSlug) {
      res.status(400).json({ error: 'Missing required param: bizSlug' })
      return
    }

    const db  = getDb()
    let query = db.collection('taps').where('bizSlug', '==', bizSlug).limit(500)
    const snap = await query.get()

    let taps = snap.docs.map(d => d.data())

    // Filter client-side to avoid needing composite indexes
    taps = taps.filter(t => t.status === 'rated' || t.rating != null)
    if (staffId) taps = taps.filter(t => t.staffId === staffId)
    taps.sort((a, b) => (b.ts || 0) - (a.ts || 0))

    console.log('Taps read:', bizSlug, staffId || 'all', '→', taps.length)
    res.status(200).json(taps)

  } catch (e) {
    console.error('api/taps error:', e.message)
    res.status(500).json({ error: e.message })
  }
}
