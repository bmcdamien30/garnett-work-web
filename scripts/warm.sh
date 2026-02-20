#!/usr/bin/env bash
set -euo pipefail

BODY='{"listingUrl":"https://www.ebay.com/itm/326195914219","buyPrice":"850","condition":"used"}'

curl -sS -X POST 'http://localhost:8080/teaser' \
  -H 'Content-Type: application/json' \
  --data "$BODY" \
  | python3 -m json.tool
