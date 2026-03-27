// api/taps.js — Read taps from Google Sheets
// Called by dashboards to load real data

const { readTaps } = require("../lib/tapSheets");

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET")    { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { bizSlug, staffId } = req.query;

    if (!bizSlug) {
      res.status(400).json({ error: "Missing required param: bizSlug" });
      return;
    }

    const taps = await readTaps(bizSlug, staffId || null);
    console.log("Taps read:", bizSlug, staffId||"all", "→", taps.length);
    res.status(200).json(taps);

  } catch(e) {
    console.error("api/taps error:", e.message);
    res.status(500).json({ error: e.message });
  }
};
