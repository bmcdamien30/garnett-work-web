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

        // Forward to your real backend (Node) for live eBay sold comps logic
    const BACKEND_URL = process.env.BACKEND_URL;
    if (!BACKEND_URL) {
      return res.status(500).json({ error: "Missing BACKEND_URL env var in Vercel" });
    }

    const upstream = await fetch(`${BACKEND_URL}/api/teaser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingUrl: url, buyPrice: buy, condition: cond }),
    });

    const text = await upstream.text();
    res.status(upstream.status).send(text);
    return;














  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      detail: String(e?.message || e),
    });
  }
}

