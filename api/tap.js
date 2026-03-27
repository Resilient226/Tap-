// api/tap.js — Write a tap to Google Sheets
// Called by the customer page when a tap is recorded

const { writeTap } = require("../lib/tapSheets");

module.exports = async (req, res) => {
  // CORS — allow requests from any domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const tap = req.body;

    if (!tap || !tap.id || !tap.bizSlug) {
      res.status(400).json({ error: "Missing required fields: id, bizSlug" });
      return;
    }

    await writeTap(tap);
    console.log("Tap written:", tap.id, tap.bizSlug, tap.status);
    res.status(200).json({ ok: true, id: tap.id });

  } catch(e) {
    console.error("api/tap error:", e.message);
    res.status(500).json({ error: e.message });
  }
};
