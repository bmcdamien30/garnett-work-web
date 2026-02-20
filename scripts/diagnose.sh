#!/usr/bin/env bash
set -euo pipefail

LISTING_URL="${1:-https://www.ebay.com/itm/335107704124}"
BUY_PRICE="${2:-35}"
CONDITION="${3:-used}"

PAYLOAD="$(node -e 'const [listingUrl, buyPrice, condition] = process.argv.slice(1); process.stdout.write(JSON.stringify({ listingUrl, buyPrice, condition }));' "$LISTING_URL" "$BUY_PRICE" "$CONDITION")"

RESPONSE="$(curl -sS -X POST "http://localhost:8080/teaser" -H "Content-Type: application/json" --data "$PAYLOAD")"

printf '%s' "$RESPONSE" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    console.log(JSON.stringify(data, null, 2));
    const debug = data && data.debug ? data.debug : {};
    const f = (v) => (v === undefined || v === null ? "" : v);
    console.log(
      "summary " +
        "ok=" + f(data.ok) + " " +
        "reason=" + f(data.reason) + " " +
        "compsCount=" + f(data.compsCount) + " " +
        "marketPrice=" + f(data.marketPrice) + " " +
        "marginPct=" + f(data.marginPct) + " " +
        "usedCache=" + f(debug.usedCache) + " " +
        "usedStaleCache=" + f(debug.usedStaleCache) + " " +
        "cooldownGate=" + f(debug.cooldownGate) + " " +
        "cooldownRemainingSec=" + f(debug.cooldownRemainingSec)
    );
  } catch (err) {
    console.log(raw);
    console.log("summary ok= reason= compsCount= marketPrice= marginPct= usedCache= usedStaleCache= cooldownGate= cooldownRemainingSec=");
    process.exit(1);
  }
});
'
