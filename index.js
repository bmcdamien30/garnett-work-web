import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.status(200).send("✅ Garnett Backend is Live");
});

/** Extract numeric item id from ebay.com/itm/... */
function extractItemId(listingUrl) {
  const url = String(listingUrl || "");
  const m = url.match(/\/itm\/(?:[^\/]+\/)?(\d{9,})/);
  return m ? m[1] : null;
}

function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

/** Safe JSON parse (prevents “Unexpected end of JSON input”) */
async function safeJson(res) {
  const text = await res.text();
  if (!text) return {}; // empty body
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Non-JSON response (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`
    );
  }
}

/** eBay app token (client credentials) */
async function getAccessToken() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;

  if (!id || !secret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env");
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  const tokenData = await safeJson(tokenRes);

  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      `Token request failed (${tokenRes.status}): ${JSON.stringify(tokenData).slice(0, 250)}`
    );
  }

  return tokenData.access_token;
}

app.post("/teaser", async (req, res) => {
  try {
    const { listingUrl, buyPrice } = req.body;

    const itemIdNum = extractItemId(listingUrl);
    if (!itemIdNum) {
      return res.status(400).json({
        error: "Use a full ebay.com/itm/... link that includes the item number.",
      });
    }

    const buy =
      parseFloat(String(buyPrice ?? "").replace(/[^\d.]/g, "")) || 0;

    const token = await getAccessToken();

    // 1) Get official item details via Browse Item endpoint
    const browseItemId = `v1|${itemIdNum}|0`;
    const itemRes = await fetch(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(browseItemId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      }
    );

    const itemData = await safeJson(itemRes);

    if (!itemRes.ok) {
      return res.status(500).json({
        error: "eBay Browse item lookup failed",
        status: itemRes.status,
        details: itemData,
      });
    }

    const title = itemData?.title;
    if (!title) {
      return res.status(500).json({
        error: "Could not read item title from eBay Browse API.",
        details: itemData,
      });
    }

    // 2) Sold comps via Browse search (soldItems filter)
    const params = new URLSearchParams({
      q: title,
      filter: "soldItems",
      limit: "20",
    });

    const soldRes = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      }
    );

    const soldData = await safeJson(soldRes);

    if (!soldRes.ok) {
      return res.status(500).json({
        error: "eBay sold comps search failed",
        status: soldRes.status,
        details: soldData,
      });
    }

    const items = soldData?.itemSummaries || [];
    const prices = items
      .map((it) => parseFloat(it?.price?.value))
      .filter((n) => Number.isFinite(n));

    const marketPrice = median(prices);
    const marginPct =
      buy > 0 ? Math.round(((marketPrice - buy) / buy) * 100) : 0;

    let confidence = "None";
    if (prices.length >= 15) confidence = "High";
    else if (prices.length >= 6) confidence = "Medium";
    else if (prices.length >= 1) confidence = "Low";

    return res.json({
      ok: true,
      verdict: marginPct >= 10 ? "PASS" : "FAIL",
      marketPrice: Number.isFinite(marketPrice) ? Math.round(marketPrice) : null,
      buyPrice: buy,
      marginPct: buy > 0 ? marginPct : null,
      confidence,
      why: `Based on ${prices.length} sold comps for "${title}".`,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Locked v1 Live on ${PORT}`);
});



















 
 





  
