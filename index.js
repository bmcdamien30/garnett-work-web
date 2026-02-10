/**
 * =========================
 * THE TRUTH ENGINE (REAL EBAY COMPS)
 * =========================
 */
let EBAY_APP_TOKEN = null;
let EBAY_APP_TOKEN_EXP = 0;

app.post("/teaser", async (req, res) => {
  try {
    const { listingUrl, buyPrice, condition } = req.body || {};
    const url = String(listingUrl || "").trim();
    const buy = Number(String(buyPrice || "").replace(/[^\d.]/g, ""));
    const cond = String(condition ?? "Used").trim();

    if (!url) return res.status(400).json({ error: "Missing listingUrl" });
    if (!buy || buy <= 0) return res.status(400).json({ error: "Invalid buyPrice" });

    const token = await getEbayAppToken();
    const rawTitle = await fetchHtmlTitle(url);

    // SMARTER SEARCH: Take only the first 5-6 words to avoid specific seller junk
    const q = rawTitle
      .replace(/[^a-zA-Z0-9\s]/g, " ") // Remove symbols
      .split(/\s+/)                   // Split by space
      .slice(0, 6)                    // Take first 6 words
      .join(" ")                      // Put back together
      .trim();

    if (!q || q.length < 3) {
      throw new Error("Could not derive a search query from URL");
    }

    const params = new URLSearchParams({
      q,
      filter: "soldItems",
      limit: "20" // Increased for better accuracy
    });

    const resp = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const data = await resp.json();
    const items = data.itemSummaries || [];
    const prices = items.map(it => parseFloat(it.price.value)).filter(p => p > 0);

    // SAFE MATH: Handle the "No Comps" case so it doesn't show NaN
    if (prices.length === 0) {
      return res.status(200).json({
        ok: true,
        verdict: "FAIL",
        marketPrice: 0,
        buyPrice: buy,
        marginPct: 0,
        why: `No sold comps found for "${q}"`,
        confidence: "Low"
      });
    }

    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const marketPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    const marginPct = ((marketPrice - buy) / buy) * 100;
    const verdict = marginPct >= 10 ? "PASS" : "FAIL";

    return res.status(200).json({
      ok: true,
      verdict,
      confidence: prices.length >= 8 ? "High" : "Med",
      marketPrice: Math.round(marketPrice),
      buyPrice: buy,
      marginPct: Math.round(marginPct),
      why: `Based on ${prices.length} sold comps for "${q}"`,
      condition: cond,
      listingUrl: url
    });

  } catch (e) {
    console.error("Teaser Error:", e.message);
    return res.status(500).json({ error: "Truth Engine Error", detail: e.message });
  }
});

async function fetchHtmlTitle(url) {
  try {
    // Add User-Agent so eBay doesn't block the request
    const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
    });
    const text = await r.text();
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return "item";
    
    // Clean up eBay's long titles
    return m[1].split('|')[0]
             .replace(/For Sale|eBay/gi, "")
             .trim();
  } catch (e) {
    return "item";
  }
}// Update: Tue Feb 10 14:42:34 EST 2026
