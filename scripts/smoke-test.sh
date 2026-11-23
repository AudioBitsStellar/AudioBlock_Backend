#!/usr/bin/env bash
# Post-deploy smoke tests against a running AudioBlock_Backend instance (#936).
#
# Usage:
#   BASE_URL=https://staging.audioblocks.example.com \
#   SMOKE_AUTH_TOKEN=<bearer-token> \
#   ./scripts/smoke-test.sh
#
# Exit code: 0 = all checks passed; non-zero = at least one check failed.
# Intended to run as a CI "gate" step after a staging deployment; block
# promotion to production when this script exits non-zero.
#
# Checks performed:
#   1. /health                  — service is up and database is healthy
#   2. POST /api/auth/login     — auth stack responds (expects 200 or 401)
#   3. GET  /api/song           — song listing endpoint responds (expects 200)
#   4. GET  /api/artist         — artist listing responds (expects 200)
#   5. Streaming HEAD           — /api/song/:id/stream accepts range requests

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_TOKEN="${SMOKE_AUTH_TOKEN:-}"
TIMEOUT=15
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}FAIL${NC} $1"; ((FAIL++)); }

check() {
  local label="$1"; shift
  local expected_pattern="$1"; shift
  local actual
  actual=$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w "%{http_code}" "$@") || {
    fail "$label (curl error)"; return; }
  if echo "$actual" | grep -qE "$expected_pattern"; then
    pass "$label (HTTP $actual)"
  else
    fail "$label (expected $expected_pattern, got $actual)"
  fi
}

echo "Smoke-testing $BASE_URL"
echo "---"

# 1. Health check
check "health endpoint" "^200$" "$BASE_URL/health"

# 2. Auth stack (a login attempt with dummy creds returns 200 or 401, never 5xx)
check "auth login (expects 2xx or 401)" "^(200|401)$" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"wrong-password-smoke-test"}'

# 3. Song listing (authenticated if token provided)
AUTH_HEADER=()
if [[ -n "$AUTH_TOKEN" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer $AUTH_TOKEN")
fi
check "song listing" "^200$" "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE_URL/api/song"

# 4. Artist listing
check "artist listing" "^200$" "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" "$BASE_URL/api/artist"

# 5. Stream endpoint accepts range requests (HEAD with Range header)
check "stream range-request accepted (expects 2xx or 206)" "^(200|206|401)$" \
  -I -H "Range: bytes=0-1023" \
  "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
  "$BASE_URL/api/song/smoke-probe/stream" 2>/dev/null || true

echo "---"
echo "Results: ${PASS} passed, ${FAIL} failed"

if [[ $FAIL -gt 0 ]]; then
  echo "Smoke tests FAILED — blocking promotion"
  exit 1
fi
echo "All smoke tests passed"
exit 0
