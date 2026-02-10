// api/teaser.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { listingUrl, buyPrice, condition } = req.body || {};

    // Basic input hygiene
    const url = String(listingUrl || "").trim();
    const buy = Number(String(buyPrice || "").replace(/[^\d.]/g, ""));
    const cond = String(condition ?? "Used").trim();

    if (!url) return res.status(400).json({ error: "Missing listingUrl" });
    if (!buy || buy <= 0) return res.status(400).json({ error: "Invalid buyPrice" });

    // Demo logic (replace later with real comps)
    const marketPrice = 910;
    const marginPct = ((marketPrice - buy) / buy) * 100;

    const verdict = buy <= 900 ? "PASS" : "FAIL";
    const confidence = buy <= 900 ? "High" : "Med";

    return res.status(200).json({
      ok: true,
      verdict,
      confidence,
      marketPrice,
      buyPrice: buy,
      marginPct: Number(marginPct.toFixed(1)),
      why: "10 sold comps (30d) · Fees included · Rule fired: margin",
      condition: cond,
      listingUrl: url,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: String(e?.message || e),
    });
  }
}
