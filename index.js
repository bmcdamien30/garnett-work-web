import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

console.log("🔥 THIS IS THE ACTIVE INDEX.JS FILE 🔥");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.status(200).send("Garnett Teaser API OK"));

const FINDING_COOLDOWN_MS = 3500;
let lastFindingCallAt = 0;
let cooldownUntilMs = 0;
const EBAY_MIN_CALL_GAP_MS = 2000;
let lastEbayCallAt = 0;
let ebayCallQueue = Promise.resolve();
const IN_FLIGHT_BY_CACHE_KEY = new Map();

function throttledEbayFetch(url, options) {
  const run = async () => {
    const now = Date.now();
    const since = now - lastEbayCallAt;
    if (since < EBAY_MIN_CALL_GAP_MS) {
      await new Promise((r) => setTimeout(r, EBAY_MIN_CALL_GAP_MS - since));
    }
    lastEbayCallAt = Date.now();
    return fetch(url, options);
  };
  const result = ebayCallQueue.then(run, run);
  ebayCallQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function getOrCreateInFlight(cacheKey, factory) {
  const existing = IN_FLIGHT_BY_CACHE_KEY.get(cacheKey);
  if (existing) return existing;
  const created = Promise.resolve()
    .then(factory)
    .finally(() => {
      IN_FLIGHT_BY_CACHE_KEY.delete(cacheKey);
    });
  IN_FLIGHT_BY_CACHE_KEY.set(cacheKey, created);
  return created;
}

// tiny in-memory cache so we don't hammer Finding API
const CACHE = new Map();
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value, ttlMs = 5 * 60 * 1000) {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const TEASER_CACHE_TTL_MS = 15 * 60 * 1000;
const TEASER_CACHE = new Map();
const BUILD_ID =
  process.env.K_REVISION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_COMMIT_SHA ||
  null;

function teaserCachePeek(key) {
  return TEASER_CACHE.get(key) || null;
}

function teaserCacheGetFresh(key) {
  const hit = teaserCachePeek(key);
  if (!hit) return null;
  return Date.now() <= hit.expiresAt ? hit.value : null;
}

function teaserCacheGetAny(key) {
  const hit = teaserCachePeek(key);
  return hit ? hit.value : null;
}

function teaserCacheSet(key, value, ttlMs = TEASER_CACHE_TTL_MS) {
  TEASER_CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function withRuntimeDebug(payload, extraDebug) {
  return {
    ...payload,
    debug: {
      ...(payload.debug || {}),
      serverTs: new Date().toISOString(),
      buildId: BUILD_ID,
      ...extraDebug,
    },
  };
}

function isFindingRateLimited(finding) {
  const msg = JSON.stringify(finding?.data || {}).toLowerCase();
  return (
    finding?.status !== 200 ||
    msg.includes("ratelimiter") ||
    msg.includes("exceeded the number of times")
  );
}

function refuse(res, msg, retryAfterSec = 30) {
  return res.status(200).json({
    ok: false,
    verdict: "REFUSE",
    confidence: "THIN",
    error: msg,
    retryAfterSec,
  });
}

function extractItemId(text) {
  const s = String(text || "");
  const m1 = s.match(/\/itm\/(\d{12,14})/i);
  if (m1) return m1[1];
  const m2 = s.match(/(\d{12,14})/);
  return m2 ? m2[1] : null;
}

function cleanTitle(t) {
  if (!t) return "";
  return String(t)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s*[\|\-]\s*eBay\s*$/i, "")
    .trim();
}

function extractTitleFromHtml(html) {
  if (!html) return "";
  const og = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og?.[1]) return cleanTitle(og[1]);

  const tt = html.match(/<title>\s*([^<]+)\s*<\/title>/i);
  if (tt?.[1]) return cleanTitle(tt[1]);

  return "";
}

async function fetchTitleFromListingHtml(listingUrl) {
  const html = await throttledEbayFetch(listingUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })
    .then((r) => r.text())
    .catch(() => "");

  const title = extractTitleFromHtml(html);
  if (!title) return "";

  // reject obvious block pages
  if (/error page|robot|security|access denied/i.test(title)) return "";

  return title;
}

function median(nums) {
  const arr = [...nums].sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function confidenceFromComps(n) {
  if (n >= 20) return "HIGH";
  if (n >= 10) return "MED";
  if (n >= 5) return "LOW";
  return "THIN";
}

function normalizeKeywords(title) {
  // keep it simple: strip parentheses + punctuation, keep first ~7 words
  const cleaned = String(title)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.split(" ").slice(0, 7).join(" ");
}

async function callFinding(APP_ID, keywords) {
  // cooldown
  const now = Date.now();
  const since = now - lastFindingCallAt;
  if (since < FINDING_COOLDOWN_MS) {
    await new Promise((r) => setTimeout(r, FINDING_COOLDOWN_MS - since));
  }
  lastFindingCallAt = Date.now();

  const findingParams = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": APP_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    keywords,
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "paginationInput.entriesPerPage": "25",
  });

  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${findingParams.toString()}`;
  const resp = await throttledEbayFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });

  const text = await resp.text();

  // rate limit / blocks often return HTML or non-json
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 500) };
  }

  return { url, status: resp.status, data, rawFirst300: text.slice(0, 300) };
}

app.post("/teaser", async (req, res) => {
  try {
    const { listingUrl, buyPrice, condition, title: bodyTitle, keywords: bodyKeywords } =
      req.body;
    const cacheBypassed = Object.prototype.hasOwnProperty.call(req.query || {}, "cb");

    const APP_ID = process.env.EBAY_APP_ID;
    if (!APP_ID) return res.status(500).json({ error: "Missing EBAY_APP_ID in .env" });

    const raw = String(listingUrl || "").trim();
    if (!raw) return res.status(400).json({ error: "Missing listingUrl" });

    const itemId = /^\d{12,14}$/.test(raw) ? raw : extractItemId(raw);
    if (!itemId) {
      return res.status(400).json({
        error:
          "Could not find Item ID. Paste full eBay URL containing /itm/ + 12–14 digits, or paste digits only.",
        received: raw,
      });
    }

    const buy = parseFloat(String(buyPrice ?? "").replace(/[^\d.]/g, "")) || 0;
    if (!buy || buy <= 0) return res.status(400).json({ error: "Invalid buyPrice" });

    const canonicalUrl = `https://www.ebay.com/itm/${itemId}`;
    const canonicalCondition = String(condition || "unknown").trim().toLowerCase();
    const canonicalQuery = `${canonicalUrl}|buy:${buy.toFixed(2)}|condition:${canonicalCondition}`;
    const staleCachedTeaser = cacheBypassed ? null : teaserCacheGetAny(canonicalQuery);
    const sendRateLimited = (payload, extraDebug = {}) => {
      const cooldownRemainingSec = Math.ceil((cooldownUntilMs - Date.now()) / 1000);
      return res.status(200).json(
        withRuntimeDebug(
          {
            ...payload,
            reason: "RATE_LIMITED",
            retryAfterSec: payload?.retryAfterSec ?? cooldownRemainingSec,
            debug: {
              ...(payload?.debug || {}),
              cooldownUntilMs,
              cooldownRemainingSec,
            },
          },
          {
            ...extraDebug,
            cooldownUntilMs,
            cooldownRemainingSec,
          }
        )
      );
    };

    if (Date.now() < cooldownUntilMs) {
      if (staleCachedTeaser?.ok) {
        return res.json(
          withRuntimeDebug(staleCachedTeaser, {
            usedCache: false,
            usedStaleCache: true,
            cacheBypassed,
            cooldownRemainingSec: Math.ceil((cooldownUntilMs - Date.now()) / 1000),
            cooldownUntilMs,
          })
        );
      }

      return sendRateLimited(
        {
          ok: false,
          debug: {
            cooldownGate: true,
          },
        },
        {
          usedCache: false,
          usedStaleCache: false,
          cacheBypassed,
          cooldownGate: true,
        }
      );
    }

    if (!cacheBypassed) {
      const freshCachedTeaser = teaserCacheGetFresh(canonicalQuery);
      if (freshCachedTeaser) {
        return res.json(
          withRuntimeDebug(freshCachedTeaser, {
            usedCache: true,
            usedStaleCache: false,
            cacheBypassed: false,
          })
        );
      }
    }

    const providedKeywords = String(bodyKeywords || "").trim();
    const providedTitle = String(bodyTitle || "").trim();
    let title = "";
    let keywords = "";
    let titleSource = "";

    if (providedKeywords) {
      keywords = providedKeywords;
      title = providedTitle;
      titleSource = "keywords";
    } else if (providedTitle) {
      title = providedTitle;
      keywords = normalizeKeywords(title);
      titleSource = "title";
    } else {
      // title cache
      const titleCacheKey = `title:${itemId}`;
      title = cacheGet(titleCacheKey);
      if (title === undefined) {
        title = await getOrCreateInFlight(titleCacheKey, async () => {
          const cached = cacheGet(titleCacheKey);
          if (cached !== undefined) return cached;
          const fetched = await fetchTitleFromListingHtml(canonicalUrl);
          cacheSet(titleCacheKey, fetched || "", 10 * 60 * 1000);
          return fetched;
        });
      }

      if (!title) {
        return res.status(404).json({
          error:
            "Could not read title from listing page (ended listing or blocked page). Try a different LIVE item link.",
          itemId,
        });
      }

      keywords = normalizeKeywords(title);
      titleSource = "html";
    }

    // Finding cache (same keywords often repeated)
    const findingCacheKey = `finding:${keywords}`;
    let finding = cacheGet(findingCacheKey);
    if (finding === undefined) {
      finding = await getOrCreateInFlight(findingCacheKey, async () => {
        const cached = cacheGet(findingCacheKey);
        if (cached !== undefined) return cached;
        const fetched = await callFinding(APP_ID, keywords);
        cacheSet(findingCacheKey, fetched, 2 * 60 * 1000);
        return fetched;
      });
    }

    if (isFindingRateLimited(finding)) {
      const retryAfterSec = Number(finding?.data?.retryAfterSec) || 1800;
      cooldownUntilMs = Date.now() + (retryAfterSec || 1800) * 1000;
      const cooldownRemainingSec = Math.ceil((cooldownUntilMs - Date.now()) / 1000);
      if (staleCachedTeaser) {
        return res.json(
          withRuntimeDebug(staleCachedTeaser, {
            usedCache: false,
            usedStaleCache: true,
            cacheBypassed: false,
            cooldownRemainingSec,
            cooldownUntilMs,
          })
        );
      }

      return sendRateLimited(
        {
          ok: false,
          error: "eBay rate limit hit (Finding API). Wait 20-30 minutes and retry.",
          retryAfterSec,
          debug: {
            findingStatus: finding.status,
            findingUrl: finding.url,
            findingBodyFirst300: finding.rawFirst300,
            titleSource,
          },
        },
        {
          usedCache: false,
          usedStaleCache: false,
          cacheBypassed,
        }
      );
    }

    const items =
      finding.data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

    const prices = items
      .map((it) =>
        parseFloat(it?.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.__value__)
      )
      .filter((n) => Number.isFinite(n) && n > 0);

    const compsCount = prices.length;
    const marketPrice = median(prices);
    const marginPct = ((marketPrice - buy) / buy) * 100;

    const verdict = marginPct >= 10 ? "PASS" : "FAIL";
    const confidence = confidenceFromComps(compsCount);

    const payload = {
      ok: true,
      verdict,
      confidence,
      marketPrice: Math.round(marketPrice),
      buyPrice: buy,
      marginPct: Math.round(marginPct),
      title,
      itemId,
      compsCount,
      condition: condition || "unknown",
      debug: {
        findingStatus: finding.status,
        findingUrl: finding.url,
        findingBodyFirst300: finding.rawFirst300,
        titleSource,
      },
    };

    if (!cacheBypassed) {
      teaserCacheSet(canonicalQuery, payload);
    }

    return res.json(
      withRuntimeDebug(payload, {
        usedCache: false,
        usedStaleCache: false,
        cacheBypassed,
      })
    );
  } catch (e) {
    return res.status(500).json({ error: `Garnett Error: ${e.message}` });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Garnett Teaser API running on ${PORT}`));
