#!/usr/bin/env bash
set -euo pipefail

BODY='{"listingUrl":"https://www.ebay.com/itm/176311626140","buyPrice":"40","condition":"used"}'

curl -sS -X POST 'http://localhost:8080/teaser?cb=1' \
  -H 'Content-Type: application/json' \
  --data "$BODY" \
  | python3 -m json.tool
