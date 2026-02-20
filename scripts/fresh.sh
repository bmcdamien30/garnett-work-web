#!/usr/bin/env bash
set -euo pipefail

BODY='{"listingUrl":"https://www.ebay.com/itm/406698481540","buyPrice":"1200","condition":"used"}'

curl -sS -X POST 'http://localhost:8080/teaser?cb=1' \
  -H 'Content-Type: application/json' \
  --data "$BODY" \
  | python3 -m json.tool
