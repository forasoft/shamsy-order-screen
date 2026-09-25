#!/usr/bin/env bash
# Calls the server directly, as the adviser, the way the brief says you will test it.
#
#   bash scripts/prove-server-refusal.sh                       # the live deployment
#   bash scripts/prove-server-refusal.sh http://localhost:3000 # a local run
#
# Needs curl and node. Prints each request's HTTP status and response.
set -euo pipefail
BASE="${1:-${APP_URL:-https://shamsy-forasoft.vercel.app}}"
pick() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(eval('j'+process.argv[1]))})" "$1"; }

echo "== Server: $BASE"
TOKEN=$(curl -sS "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"adviser@shamsy.test","password":"Adviser-2026"}' | pick '.token')
echo "== Signed in as the adviser (bearer token, no browser)"

BOOT=$(curl -sS "$BASE/api/bootstrap" -H "authorization: Bearer $TOKEN")
id_of() { echo "$BOOT" | pick ".products.find(p=>p.sku==='$1').id"; }
CUSTOMER=$(echo "$BOOT" | pick ".customers.find(c=>c.name==='Ahmed Trading').id")
SPF=$(id_of SPF-6000-ES-PLUS); HOPE5=$(id_of HOPE-5.0L-B1); HOPE16=$(id_of HOPE-16.0LM-A1)
count() { curl -sS "$BASE/api/orders" -H "authorization: Bearer $TOKEN" | pick '.orders.length'; }
uuid() { node -e "console.log(crypto.randomUUID())"; }
BEFORE=$(count)

post() {
  echo; echo "== $1"
  curl -sS -o /tmp/shamsy-proof.json -w "HTTP %{http_code}\n" "$BASE/api/orders" \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$2"
  cat /tmp/shamsy-proof.json; echo
}

LINES="{\"productId\":\"$SPF\",\"quantity\":4,\"unitPriceUsdCents\":51500,\"discountUsdCents\":4000},
       {\"productId\":\"$HOPE5\",\"quantity\":2,\"unitPriceUsdCents\":81000,\"discountUsdCents\":7000}"

post "1. The worked example with line 3 at 7.25% and no approval — must be refused" \
  "{\"id\":\"$(uuid)\",\"customerId\":\"$CUSTOMER\",\"rateSdgPerUsd\":8200,\"lines\":[$LINES,
    {\"productId\":\"$HOPE16\",\"quantity\":1,\"unitPriceUsdCents\":207000,\"discountUsdCents\":15000}]}"

post "2. The same, with \"approve\": true written by the adviser herself — must be refused" \
  "{\"id\":\"$(uuid)\",\"customerId\":\"$CUSTOMER\",\"rateSdgPerUsd\":8200,\"lines\":[$LINES,
    {\"productId\":\"$HOPE16\",\"quantity\":1,\"unitPriceUsdCents\":207000,\"discountUsdCents\":15000,\"approve\":true}]}"

post "3. A lower price for line 1 — must be refused" \
  "{\"id\":\"$(uuid)\",\"customerId\":\"$CUSTOMER\",\"rateSdgPerUsd\":8200,\"lines\":[
    {\"productId\":\"$SPF\",\"quantity\":4,\"unitPriceUsdCents\":40000,\"discountUsdCents\":0}]}"

post "4. A rate of 7,900 — must be refused" \
  "{\"id\":\"$(uuid)\",\"customerId\":\"$CUSTOMER\",\"rateSdgPerUsd\":7900,\"lines\":[$LINES]}"

AFTER=$(count)
echo
if [ "$BEFORE" = "$AFTER" ]; then echo "== PASS: every call was refused and no order was saved ($BEFORE orders before and after)."
else echo "== FAIL: the number of orders changed from $BEFORE to $AFTER"; exit 1; fi
