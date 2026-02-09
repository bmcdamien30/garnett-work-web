// api/teaser.js
export default async function handler(req, res) {
  // CORS (so your static index.html can call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { listingUrl, buyPrice, condition } = req.body || {};

    // Basic input hygiene
    const url = String(listingUrl || "").trim();
    const buy = Number(String(buyPrice || "").replace(/[^\d.]/g, ""));
    const cond = String(condition || "Used").trim();

    if (!url) return res.status(400).json({ error: "Missing listingUrl" });
    if (!buy || buy <= 0) return res.status(400).json({ error: "Invalid buyPrice" });

    // DEMO RESPONSE (replace later with real eBay sold comps engine)
    // Simple model: market baseline + basic confidence heuristic.
    const market = 910; // demo market price
    const marginPct = ((market - buy) / buy) * 100;

    const verdict = marginPct >= 10 ? "PASS" : marginPct <= -5 ? "FAIL" : "BORDERLINE";

    const compCount = 10;     // demo
    const windowDays = 30;    // demo

    const confidence =
      compCount >= 10 && Math.abs(marginPct) >= 10 ? "High" :
      compCount >= 6 ? "Med" :
      "Low";

    const why = `${compCount} sold comps (${windowDays}d) · Fees included · Rule fired: margin`;

    return res.status(200).json({
      ok: true,
      listingUrl: url,
      buyPrice: buy,
      condition: cond,
      verdict,
      confidence,
      marketPrice: market,
      marginPct: Number(marginPct.toFixed(1)),
      why,
      ts: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
}
